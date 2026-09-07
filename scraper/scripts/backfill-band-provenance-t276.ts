/**
 * Backfill: field_sources provenance repair for the 87 T-276 band-corrected rows (GitHub #165).
 *
 * WHY: the T-276 price-band backfill (evidence/2026-08-22-T-276/33-applied-ledger.csv, 87
 * `UPDATED` rows) wrote via direct `db.update(ipos)`, bypassing the consolidation/persister
 * write path that stamps `field_sources`. Every one of those 87 rows still credits whatever
 * source last consolidated the OLD (wrong) band — CHITTORGARH (76), MONEYCONTROL (6), NSE (5) —
 * even though the corrected value actually came from NSE's report-118/82 endpoints. Two
 * concrete harms: (1) the provenance audit (`g_provenance_lineage`, #361) cannot tell these
 * rows are NSE-sourced; (2) before #165 F1 landed (field-priority-matrix.ts
 * `sameSourceRefreshSources`), a MONEYCONTROL-credited row could be silently overwritten by a
 * later MONEYCONTROL scrape with no priority contest.
 *
 * SCOPE: this is a ONE-TIME repair of the 87 ledger rows, not a general provenance-repair tool
 * (that standing detector is #361's C1 check). It only ever writes `field_sources` rows — it
 * NEVER touches `ipos.price_range_min/max` (those are correct; T-276 already applied them).
 *
 * Modelled on `backfill-issue-size-chittorgarh-detail.ts`
 * (`upsertIssueSizeProvenance`/`resolveDatabaseName`/`PRODUCTION_DATABASE_NAME` shape): same
 * same-transaction upsert on `unique_field_source_per_ipo`, same previous_source-kept
 * semantics, same production-database guard (refuse a write against "ipodhan" without
 * --allow-prod — NODE_ENV never distinguishes prod from staging on this VPS).
 *
 * Usage (from scraper/, tunnel env exported):
 *   npx tsx scripts/backfill-band-provenance-t276.ts --ledger <path-to-33-applied-ledger.csv>
 *   npx tsx scripts/backfill-band-provenance-t276.ts --ledger <path> --apply --allow-prod
 *
 * The ledger lives in the GetWorkDone bus repo's evidence/ tree (shared audit trail, per the
 * owner's bus-isolation rule — evidence is not duplicated into this repo), so --ledger is
 * required with no baked-in default path.
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const ledgerIdx = process.argv.indexOf('--ledger');
const LEDGER_PATH = ledgerIdx >= 0 ? process.argv[ledgerIdx + 1] : null;

/** The one database name this CLI refuses to WRITE to without --allow-prod. */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';

/**
 * Round 2 (#165 review, CRITICAL): resolveDatabaseName-from-env is NOT the guard — it inspects
 * DATABASE_URL, but packages/shared/src/db/index.ts's initPool() prefers
 * DATABASE_HOST/DATABASE_PASSWORD when DATABASE_HOST is set (the tunnel env sets both DATABASE_URL
 * AND DATABASE_HOST), so the env-derived name can read "ipodhan_staging" while the pool that
 * actually opens is connected to prod. The only trustworthy source is asking the SAME pool what
 * database it is in, via `SELECT current_database()`, before any write.
 */
export async function queryCurrentDatabase(dbLike: { execute: typeof db.execute }): Promise<string> {
  const result = await dbLike.execute<{ name: string }>(sql`SELECT current_database() AS name`);
  const rows = Array.isArray(result) ? result : (result as unknown as { rows: { name: string }[] }).rows;
  const name = rows?.[0]?.name;
  if (!name) {
    throw new Error('backfill-band-provenance-t276: SELECT current_database() returned no row — cannot verify which database this pool is writing to.');
  }
  return name;
}

/**
 * Round 3 (#165 review): pure decision extracted from main() so deleting the refusal actually
 * turns a test red. `dbName` MUST be the value from `queryCurrentDatabase()` (the real pool),
 * never env-derived.
 */
export function decideProdWriteRefusal(input: {
  apply: boolean;
  dbName: string;
  allowProd: boolean;
}): { refuse: boolean; reason?: string } {
  const isProdDb = input.dbName === PRODUCTION_DATABASE_NAME;
  if (input.apply && isProdDb && !input.allowProd) {
    return {
      refuse: true,
      reason: `backfill-band-provenance-t276: refusing to APPLY writes against the production database "${PRODUCTION_DATABASE_NAME}" (current_database()) — pass --allow-prod to override.`,
    };
  }
  return { refuse: false };
}

export interface LedgerRow {
  slug: string;
  afterMin: number;
  afterMax: number;
  /** The value BEFORE the T-276 correction, per the ledger — null if the ledger lacks it
   *  (round 2, #165 HIGH: previous_value must record what was there before T-276, never the
   *  now-current corrected value). */
  beforeMin: number | null;
  beforeMax: number | null;
}

/**
 * Parse the T-276 applied ledger, keeping only `UPDATED` rows with numeric
 * afterMin/afterMax (SKIP_NO_MATCH / SKIP_DEGENERATE_SOURCE rows never touched the DB, so
 * they carry no provenance to repair). The CSV has no quoted fields (verified against the
 * live file — company names contain no commas), so a naive split is safe.
 */
export function parseAppliedLedger(csvText: string): LedgerRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  const idx = (name: string) => header.indexOf(name);
  const slugIdx = idx('slug');
  const afterMinIdx = idx('afterMin');
  const afterMaxIdx = idx('afterMax');
  const beforeMinIdx = idx('beforeMin');
  const beforeMaxIdx = idx('beforeMax');
  const actionIdx = idx('action');
  if (slugIdx < 0 || afterMinIdx < 0 || afterMaxIdx < 0 || actionIdx < 0) {
    throw new Error('backfill-band-provenance-t276: ledger CSV missing an expected column (slug/afterMin/afterMax/action)');
  }
  const parseNum = (v: string | undefined) => {
    if (v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const rows: LedgerRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    if (cols[actionIdx] !== 'UPDATED') continue;
    const slug = cols[slugIdx];
    const afterMin = Number(cols[afterMinIdx]);
    const afterMax = Number(cols[afterMaxIdx]);
    if (!slug || !Number.isFinite(afterMin) || !Number.isFinite(afterMax)) continue;
    rows.push({
      slug,
      afterMin,
      afterMax,
      beforeMin: beforeMinIdx >= 0 ? parseNum(cols[beforeMinIdx]) : null,
      beforeMax: beforeMaxIdx >= 0 ? parseNum(cols[beforeMaxIdx]) : null,
    });
  }
  return rows;
}

export type RepairDecision = { write: boolean; reason: string };

/**
 * Pure decision: only repair provenance for a row whose CURRENT stored band still equals the
 * ledger's `after` value — if it has since changed (a later admin edit, a fresh correction),
 * writing NSE provenance over an unrelated current value would itself be a lie. Extracted for
 * unit testing (no DB).
 */
export function decideBandProvenanceRepair(input: {
  currentMin: number | null;
  currentMax: number | null;
  ledgerMin: number;
  ledgerMax: number;
}): RepairDecision {
  if (input.currentMin === input.ledgerMin && input.currentMax === input.ledgerMax) {
    return { write: true, reason: 'current band matches the ledger corrected value' };
  }
  return {
    write: false,
    reason: `current band (${input.currentMin}-${input.currentMax}) no longer matches the ledger value (${input.ledgerMin}-${input.ledgerMax}) — skipped, not overwritten`,
  };
}

export const BACKFILL_UPDATED_BY = 'backfill-band-provenance-t276';

export function buildDataLineage(ledgerPath: string) {
  return { note: 'T-276 band repair provenance backfill 2026-09-07', ledger: ledgerPath };
}

/**
 * Same-transaction upsert on `unique_field_source_per_ipo`, mirroring
 * `upsertIssueSizeProvenance` in backfill-issue-size-chittorgarh-detail.ts: reads the existing
 * row (if any) to preserve `previousSource`, then upserts crediting NSE at confidence 100.
 */
export async function upsertBandFieldSourceProvenance(
  txLike: {
    select: typeof db.select;
    insert: typeof db.insert;
  },
  params: {
    ipoId: string;
    fieldName: 'priceRangeMin' | 'priceRangeMax';
    previousValue: number | null;
    ledgerPath: string;
    updatedBy: string;
  }
): Promise<void> {
  const existing = await txLike
    .select({ source: schema.fieldSources.source })
    .from(schema.fieldSources)
    .where(
      and(
        eq(schema.fieldSources.ipoId, params.ipoId),
        eq(schema.fieldSources.tableName, 'ipos'),
        eq(schema.fieldSources.fieldName, params.fieldName)
      )
    )
    .limit(1);
  const previousSource = existing[0]?.source ?? null;
  const previousValue = params.previousValue === null ? null : String(params.previousValue);
  const dataLineage = buildDataLineage(params.ledgerPath);

  await txLike
    .insert(schema.fieldSources)
    .values({
      ipoId: params.ipoId,
      tableName: 'ipos',
      fieldName: params.fieldName,
      source: 'NSE',
      confidence: 100,
      previousValue,
      previousSource,
      dataLineage,
      updatedAt: new Date(),
      updatedBy: params.updatedBy,
    })
    .onConflictDoUpdate({
      target: [schema.fieldSources.ipoId, schema.fieldSources.tableName, schema.fieldSources.fieldName],
      set: {
        source: 'NSE',
        confidence: 100,
        previousValue,
        previousSource,
        dataLineage,
        updatedAt: new Date(),
        updatedBy: params.updatedBy,
      },
    });
}

async function main() {
  console.log('='.repeat(80));
  console.log(`BAND PROVENANCE BACKFILL (T-276 ledger, #165) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  if (!LEDGER_PATH) {
    console.error('backfill-band-provenance-t276: --ledger <path-to-33-applied-ledger.csv> is required.');
    process.exit(1);
  }

  // Round 2 (#165 CRITICAL): ask the SAME pool, not the env, which database it is actually
  // connected to — env-derived guards can lie when DATABASE_HOST is also set (the tunnel sets
  // both DATABASE_URL and DATABASE_HOST; initPool() prefers DATABASE_HOST).
  const dbName = await queryCurrentDatabase(db);
  console.log(`current_database(): ${dbName}`);
  const allowProd = process.argv.includes('--allow-prod');
  const refusal = decideProdWriteRefusal({ apply: APPLY, dbName, allowProd });
  if (refusal.refuse) {
    console.error(refusal.reason);
    process.exit(1);
  }
  if (APPLY && dbName === PRODUCTION_DATABASE_NAME && allowProd) {
    console.log(`ALLOW-PROD: writing against "${PRODUCTION_DATABASE_NAME}" (--allow-prod given).`);
  }

  const ledger = parseAppliedLedger(readFileSync(LEDGER_PATH, 'utf-8'));
  console.log(`ledger: ${ledger.length} UPDATED rows loaded from ${LEDGER_PATH}`);

  const slugs = ledger.map((r) => r.slug);
  const dbRows = await db
    .select({
      id: schema.ipos.id,
      slug: schema.ipos.slug,
      priceRangeMin: schema.ipos.priceRangeMin,
      priceRangeMax: schema.ipos.priceRangeMax,
    })
    .from(schema.ipos)
    .where(inArray(schema.ipos.slug, slugs));
  const bySlug = new Map(dbRows.map((r) => [r.slug, r]));

  // Re-run idempotency: a row already carrying THIS backfill's NSE stamp on both fields needs
  // no further write — without this check every re-run would re-upsert unchanged rows and the
  // "written" counter could never prove convergence.
  const ipoIds = dbRows.map((r) => r.id);
  const existingProvenance = ipoIds.length
    ? await db
        .select({
          ipoId: schema.fieldSources.ipoId,
          fieldName: schema.fieldSources.fieldName,
          source: schema.fieldSources.source,
          dataLineage: schema.fieldSources.dataLineage,
        })
        .from(schema.fieldSources)
        .where(
          and(
            eq(schema.fieldSources.tableName, 'ipos'),
            inArray(schema.fieldSources.ipoId, ipoIds),
            inArray(schema.fieldSources.fieldName, ['priceRangeMin', 'priceRangeMax'])
          )
        )
    : [];
  const alreadyRepairedKey = (ipoId: string, fieldName: string) => `${ipoId}::${fieldName}`;
  const alreadyRepaired = new Set(
    existingProvenance
      .filter(
        (r) =>
          r.source === 'NSE' &&
          (r.dataLineage as { note?: string } | null)?.note === buildDataLineage('').note
      )
      .map((r) => alreadyRepairedKey(r.ipoId, r.fieldName))
  );

  let matched = 0;
  let skippedNoRow = 0;
  let skippedChanged = 0;
  let skippedAlreadyRepaired = 0; // FIELD count, not row count (round 2: per-field now)
  let written = 0; // FIELD count
  let writeFailures = 0;

  for (const row of ledger) {
    const dbRow = bySlug.get(row.slug);
    if (!dbRow) {
      skippedNoRow++;
      console.log(`  SKIP ${row.slug}: no matching ipos row (renamed/deleted since T-276)`);
      continue;
    }
    const decision = decideBandProvenanceRepair({
      currentMin: dbRow.priceRangeMin,
      currentMax: dbRow.priceRangeMax,
      ledgerMin: row.afterMin,
      ledgerMax: row.afterMax,
    });
    if (!decision.write) {
      skippedChanged++;
      console.log(`  SKIP ${row.slug}: ${decision.reason}`);
      continue;
    }
    matched++;
    // Round 2 (#165 MEDIUM): decide per FIELD, independently — a partial prior run may have
    // already repaired priceRangeMin but not priceRangeMax. Re-upserting an already-repaired
    // field would overwrite its previous_source (the ORIGINAL wrong source, the audit trail)
    // with 'NSE', since upsertBandFieldSourceProvenance reads whatever is currently there as
    // "previous". Skipping already-repaired fields preserves that trail.
    const fieldPlan: { fieldName: 'priceRangeMin' | 'priceRangeMax'; previousValue: number | null }[] = [
      { fieldName: 'priceRangeMin', previousValue: row.beforeMin },
      { fieldName: 'priceRangeMax', previousValue: row.beforeMax },
    ].filter((f) => {
      if (alreadyRepaired.has(alreadyRepairedKey(dbRow.id, f.fieldName))) {
        skippedAlreadyRepaired++;
        console.log(`  SKIP ${row.slug}.${f.fieldName}: already carries this backfill's NSE provenance stamp (idempotent no-op)`);
        return false;
      }
      return true;
    });
    if (fieldPlan.length === 0) continue;
    if (!APPLY) {
      console.log(`  WOULD WRITE ${row.slug}: ${fieldPlan.map((f) => f.fieldName).join(', ')} -> source=NSE (band ${row.afterMin}-${row.afterMax}, previous_value from ledger before=${row.beforeMin ?? 'null'}-${row.beforeMax ?? 'null'})`);
      continue;
    }
    try {
      await db.transaction(async (tx) => {
        for (const f of fieldPlan) {
          await upsertBandFieldSourceProvenance(tx, {
            ipoId: dbRow.id,
            fieldName: f.fieldName,
            previousValue: f.previousValue,
            ledgerPath: LEDGER_PATH,
            updatedBy: BACKFILL_UPDATED_BY,
          });
        }
      });
      written += fieldPlan.length;
      console.log(`  WROTE ${row.slug}: field_sources ${fieldPlan.map((f) => f.fieldName).join(', ')} -> NSE (previous_value from ledger before-band)`);
    } catch (err) {
      writeFailures++;
      logger.error({ slug: row.slug, error: err instanceof Error ? err.message : String(err) }, 'band provenance write failed');
      console.log(`  FAILED ${row.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // F3 (#165): this script writes ONLY field_sources rows, never ipos.price_range_min/max —
  // the values themselves were already corrected by T-276 — so it deliberately does NOT call
  // invalidateIPOCaches. Root cause of the "appears to no-op in direct-write scripts" report:
  // packages/shared/src/redis-client.ts's getRedisClient() defaults to
  // 'redis://localhost:6379' when REDIS_URL is unset, so a script run from the laptop (no
  // REDIS_URL exported) silently connects to a local Redis that isn't the app's real cache —
  // invalidateIPOCaches "succeeds" against the wrong instance and the real cache never clears.
  // Same class as the manual-db-reset-bypasses-redis-cache gotcha. No new infra: if a future
  // script DOES need to invalidate, it must fail loudly when REDIS_URL is unset rather than
  // falling back to localhost, and print the keys it would have dropped either way.
  if (!process.env.REDIS_URL) {
    console.log('NOTE (F3): REDIS_URL is unset — any cache-invalidation call in this session would silently target');
    console.log('           redis://localhost:6379, not the real cache. field_sources is not read through the IPO');
    console.log('           detail/list cache, so this script does not need to invalidate anything; flagging for');
    console.log('           any future direct-write script that DOES touch ipos/*.');
  }

  console.log(`\nledger rows: ${ledger.length}, matched (band unchanged since T-276): ${matched}, fields written: ${written}, skipped-no-row: ${skippedNoRow}, skipped-changed: ${skippedChanged}, fields skipped-already-repaired: ${skippedAlreadyRepaired}, failures: ${writeFailures}`);
  process.exit(writeFailures > 0 ? 1 : 0);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
