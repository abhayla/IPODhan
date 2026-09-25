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
 * DRY-RUN ONLY (report/log only, mirrors `stage-reconciler-job.ts`'s
 * convention): it computes + logs the duplicate-cluster plan and never
 * writes. #1003: the `dryRun: false` apply branch this file used to carry
 * merged pairs with raw SQL, ungated (no `checkMergeEligibility`, no
 * `ipo_merge_log` row) — it is removed; `opts.dryRun === false` is refused.
 * A discovered cluster is merged through `IPORepository.mergeDuplicateInto`.
 */
import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
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
 * Run one sweep cycle. This job is DRY-RUN ONLY: it computes + logs the
 * duplicate-cluster plan and never writes.
 *
 * #1003 (Tier A review of #1001, 2026-09-24): the old `dryRun: false` branch
 * merged pairs with raw SQL — no `checkMergeEligibility` gate (#1001) and no
 * `ipo_merge_log` row (#994), so a merge it made could not be undone and
 * could combine two different offers the gated tool would refuse. Its only
 * caller (`index.ts`) always passed `dryRun: true`, so nothing in production
 * used the removed path; `opts.dryRun === false` now throws rather than
 * silently keep it reachable. To actually merge a discovered cluster, use
 * `IPORepository.mergeDuplicateInto` (the gated path both `--apply` CLIs and
 * this job's plan should route through) — never a raw `DELETE FROM ipos`.
 */
export async function runDuplicateSweepJob(
  opts: { dryRun?: boolean } = {}
): Promise<DuplicateSweepResult> {
  if (opts.dryRun === false) {
    throw new Error(
      '[duplicate-sweep-job] dryRun: false is refused (#1003) — the raw-SQL apply path bypassed ' +
        'checkMergeEligibility and wrote no ipo_merge_log row; merge a discovered cluster through ' +
        'IPORepository.mergeDuplicateInto instead.'
    );
  }
  logger.info({ dryRun: true }, '[duplicate-sweep-job] cycle start');

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
    // #1003: this job only ever computes and reports the plan. The apply
    // branch that used to run here (ungated raw-SQL merge) is removed —
    // `opts.dryRun === false` is refused above, before any row is read.
  }

  const result: DuplicateSweepResult = {
    totalIpos: all.length,
    clusters: clusters.size,
    dupClusters,
    applied: false,
  };
  logger.info(
    { totalIpos: result.totalIpos, dupClusterCount: dupClusters.length, dryRun: true },
    '[duplicate-sweep-job] cycle complete'
  );
  return result;
}
