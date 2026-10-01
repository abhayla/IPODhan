/**
 * OD-157 (#1166 round 2): live field_sources records of a peer_companies row that no longer exists.
 *
 * Rows deleted BEFORE OD-157 shipped left their source records in field_sources, so every reader
 * (admin provenance view, nightly audits, the walk) reads a deleted row as live; the nightly check
 * `r_child_provenance_orphan` reports them. This module finds them and moves them to
 * field_sources_retired through the SAME function the live replace uses (`retireChildRowSources`),
 * one IPO per transaction, under the IPO's write lock, re-reading the orphans inside the lock so a
 * peer row written meanwhile is never retired.
 *
 * Callers: scraper/scripts/repair-retire-orphan-peer-sources.ts (the guarded CLI) and its
 * integration test.
 */
import { and, count, eq, inArray, ne, notExists, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { lockAndReadRowHolds, type HoldExecutor } from '@ipodhan/shared/services/field-hold';
import { retireChildRowSources, type RetiredSourceRef } from '@ipodhan/shared/repositories/field-sources-retirement';

export const PRE_OD157_ORPHAN_REASON = 'pre-OD-157 orphan';

export interface OrphanPeerSourceKey {
  ipoId: string;
  rowKey: string;
  records: number;
}

function orphanWhere(db: NodePgDatabase<typeof schema>, ipoIds: readonly string[] | null): SQL | undefined {
  const fs = schema.fieldSources;
  const p = schema.peerCompanies;
  return and(
    eq(fs.tableName, 'peer_companies'),
    ne(fs.rowKey, ''),
    notExists(
      db
        .select({ one: p.id })
        .from(p)
        .where(and(eq(p.ipoId, fs.ipoId), eq(p.normalizedName, fs.rowKey)))
    ),
    ipoIds && ipoIds.length > 0 ? inArray(fs.ipoId, [...ipoIds]) : undefined
  );
}

/** Every orphan peer row key (with its live record count), optionally scoped to some IPOs. */
export async function findOrphanPeerSourceKeys(
  db: NodePgDatabase<typeof schema>,
  ipoIds: readonly string[] | null = null
): Promise<OrphanPeerSourceKey[]> {
  const fs = schema.fieldSources;
  const rows = await db
    .select({ ipoId: fs.ipoId, rowKey: fs.rowKey, records: count() })
    .from(fs)
    .where(orphanWhere(db, ipoIds))
    .groupBy(fs.ipoId, fs.rowKey)
    .orderBy(fs.ipoId, fs.rowKey);
  return rows.map((r) => ({ ipoId: r.ipoId, rowKey: r.rowKey, records: Number(r.records) }));
}

export interface RetireOrphansResult {
  ipoId: string;
  /** Orphan row keys found by the scan. */
  scanned: string[];
  /** Orphan row keys still orphaned under the lock (and retired). */
  retiredKeys: string[];
  retired: RetiredSourceRef[];
}

/**
 * Apply: for each IPO, lock its ipos row (the admin's and the peer writer's lock), re-read the
 * orphans of that IPO, and retire them with `reason`. Never touches a key that gained a peer row.
 */
export async function retireOrphanPeerSources(
  db: NodePgDatabase<typeof schema>,
  orphans: readonly OrphanPeerSourceKey[],
  reason: string = PRE_OD157_ORPHAN_REASON
): Promise<RetireOrphansResult[]> {
  const byIpo = new Map<string, string[]>();
  for (const o of orphans) byIpo.set(o.ipoId, [...(byIpo.get(o.ipoId) ?? []), o.rowKey]);
  const results: RetireOrphansResult[] = [];
  for (const [ipoId, scanned] of byIpo) {
    const result = await db.transaction(async (tx) => {
      const t = tx as unknown as NodePgDatabase<typeof schema> & HoldExecutor;
      await lockAndReadRowHolds(t, ipoId, 'peer_companies');
      const still = (await findOrphanPeerSourceKeys(t, [ipoId])).map((o) => o.rowKey).filter((k) => scanned.includes(k));
      const retired = await retireChildRowSources(t, { ipoId, tableName: 'peer_companies', rowKeys: still, reason });
      return { ipoId, scanned, retiredKeys: still, retired };
    });
    results.push(result);
  }
  return results;
}
