/**
 * Duplicate IPO sweep JOB (P2-2b, round-4 review, T-293).
 *
 * The create-time check in `upsertIPO` (exact-normalized-name -> compact ->
 * Levenshtein-typo, see `data-persister.ts`) prevents MOST duplicate creates,
 * but it is not a guarantee across every insert path (backfill scripts,
 * migrations, a future bug). This job is the POST-INSERT convergence sweep:
 * it re-runs the SAME two-tier clustering `scripts/merge-duplicate-ipos.ts`
 * uses (exact key UNION Levenshtein-typo, see `buildDuplicateKeyGroups`) on
 * every cycle, so a pair that slips through still converges instead of
 * living in prod forever.
 *
 * Default DRY-RUN (report/log only, mirrors `stage-reconciler-job.ts`'s
 * convention): it computes + logs the duplicate-cluster plan, but does NOT
 * delete rows. Actual merge/delete is §GATE — `runDuplicateSweepJob({ dryRun:
 * false })` is intentionally never called from the scheduled cron path in
 * this build; activation (wiring `dryRun: false` into the cron trigger) is
 * Abhay's call, same posture as `ENABLE_STAGE_RECONCILER`.
 */
import { db } from '@ipodhan/shared/db';
import { ipos, ipoSlugRedirects } from '@ipodhan/shared/db/schema';
import { sql } from 'drizzle-orm';
import logger from '../../utils/logger.js';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import {
  buildDuplicateKeyGroups,
  completeness,
  pickKeeper,
  type Row,
} from '../../../scripts/merge-duplicate-ipos.js';

export interface DuplicateSweepClusterReport {
  key: string;
  size: number;
  keepId: string;
  keepSlug: string;
  deleteIds: string[];
}

export interface DuplicateSweepResult {
  totalIpos: number;
  clusters: number;
  dupClusters: DuplicateSweepClusterReport[];
  applied: boolean;
}

async function realChildValue(ipoId: string): Promise<number> {
  let v = 0;
  for (const t of ['gmp_records', 'subscriptions']) {
    try {
      const r: any = await db.execute(sql.raw(`SELECT count(*)::int n FROM ${t} WHERE ipo_id = '${ipoId}'`));
      v += (r.rows ?? r)[0]?.n ?? 0;
    } catch {
      /* table may not exist in this env */
    }
  }
  return v;
}

/**
 * Run one sweep cycle. dryRun (default true) computes + logs the plan only —
 * no writes. §GATE: `dryRun: false` performs the actual merge (repoint
 * gmp/subscriptions + scalar-field backfill + CASCADE delete), identical to
 * `scripts/merge-duplicate-ipos.ts --apply`.
 */
export async function runDuplicateSweepJob(
  opts: { dryRun?: boolean } = {}
): Promise<DuplicateSweepResult> {
  const dryRun = opts.dryRun !== false;
  logger.info({ dryRun }, '[duplicate-sweep-job] cycle start');

  const all = (await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      slug: ipos.slug,
      issueSize: ipos.issueSize,
      lotSize: ipos.lotSize,
      priceRangeMax: ipos.priceRangeMax,
      registrar: ipos.registrar,
      createdAt: ipos.createdAt,
    })
    .from(ipos)) as Row[];

  const byExactKey = new Map<string, Row[]>();
  for (const r of all) {
    const key = normalizeCompanyNameForMatching(r.companyName);
    if (!key) continue;
    (byExactKey.get(key) ?? byExactKey.set(key, []).get(key)!).push(r);
  }
  const keyGroups = buildDuplicateKeyGroups([...byExactKey.keys()]);
  const clusters = new Map<string, Row[]>();
  for (const [root, keys] of keyGroups) {
    clusters.set(root, keys.flatMap((k) => byExactKey.get(k) ?? []));
  }
  const dupClusterEntries = [...clusters.entries()].filter(([, rs]) => rs.length > 1);

  const dupClusters: DuplicateSweepClusterReport[] = [];
  for (const [key, rs] of dupClusterEntries) {
    const val = new Map<string, number>();
    for (const r of rs) val.set(r.id, await realChildValue(r.id));
    const keep = pickKeeper(rs, val);
    const dups = rs.filter((r) => r.id !== keep.id);
    dupClusters.push({
      key,
      size: rs.length,
      keepId: keep.id,
      keepSlug: keep.slug,
      deleteIds: dups.map((d) => d.id),
    });

    if (!dryRun) {
      await db.transaction(async (tx) => {
        for (const dup of dups) {
          for (const col of ['symbol', 'isin'] as const) {
            await tx.execute(sql.raw(
              `UPDATE ipos SET ${col} = dup.${col} FROM ipos dup ` +
              `WHERE ipos.id = '${keep.id}' AND dup.id = '${dup.id}' ` +
              `AND ipos.${col} IS NULL AND dup.${col} IS NOT NULL`));
          }
          await tx.execute(sql.raw(`UPDATE subscriptions SET ipo_id = '${keep.id}' WHERE ipo_id = '${dup.id}'`));
          await tx.execute(sql.raw(
            `DELETE FROM gmp_records d WHERE d.ipo_id = '${dup.id}' AND EXISTS (` +
            `SELECT 1 FROM gmp_records k WHERE k.ipo_id = '${keep.id}' ` +
            `AND k."timestamp" = d."timestamp" AND k.source = d.source)`));
          await tx.execute(sql.raw(`UPDATE gmp_records SET ipo_id = '${keep.id}' WHERE ipo_id = '${dup.id}'`));
          // Same redirect-before-delete discipline as merge-duplicate-ipos.ts
          // --apply (T-293): a merged-away slug must not 404.
          await tx
            .insert(ipoSlugRedirects)
            .values({ oldSlug: dup.slug, ipoId: keep.id, reason: 'DUPLICATE_MERGE' })
            .onConflictDoNothing({ target: ipoSlugRedirects.oldSlug });
          await tx.execute(sql.raw(`DELETE FROM ipos WHERE id = '${dup.id}'`));
        }
      });
    }
  }

  const result: DuplicateSweepResult = {
    totalIpos: all.length,
    clusters: clusters.size,
    dupClusters,
    applied: !dryRun,
  };
  logger.info(
    { totalIpos: result.totalIpos, dupClusterCount: dupClusters.length, dryRun },
    '[duplicate-sweep-job] cycle complete'
  );
  return result;
}
