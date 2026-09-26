/**
 * Repair: name-pollution cleanup + duplicate-merge + ipo_slug_redirects (P3-1,
 * T-278). Recreates the one-off manual operation that produced the 17 redirect
 * rows / 5 renames / 15-row merge on 2026-08-22 (evidence/2026-08-22-T-278/
 * {01-pre-state,02-p3-1-applied-log,03-post-state}.json) as a COMMITTED,
 * IDEMPOTENT, re-runnable script (T-278F, checker finding #2 — the original
 * operation was never committed and could not be re-run).
 *
 * WHY a re-run is needed: the write-path fix (sanitizeDisplayCompanyName /
 * normalizeCompanyNameForMatching stripping a trailing status code before the
 * trailing-paren strip) stops FUTURE pollution once deployed, but prod's
 * scraper cron kept running the OLD deployed code after the one-off manual
 * cleanup and re-minted 5 of the same duplicate rows again (created_at
 * 2026-08-22T13:30Z). This script needs to run again post-deploy to clear
 * those. DO NOT run against prod before the write-path fix is deployed — the
 * still-running old code would just re-pollute again on its next cron tick.
 *
 * Algorithm (dry-run by default; --apply writes):
 *  1. Group ALL ipos rows by the identity key
 *     `normalizeCompanyNameForMatching(sanitizeDisplayCompanyName(companyName))`.
 *  2. Skip a group unless it contains a polluted row (companyName differs from
 *     its sanitized form) or more than one row (a duplicate set) — this is
 *     what makes a re-run a no-op once everything converges.
 *  3. Canonical = the row already exactly clean (companyName === sanitized),
 *     if one exists in the group; else the OLDEST row (createdAt) becomes
 *     canonical and is renamed in place.
 *  4. Target-servability guard (checker #3b): skip the WHOLE group if the
 *     canonical's `offeringType` is not servable by `/ipos/[slug]`
 *     (`isRealIPO`) — never write a redirect that chains into a 404 (e.g. the
 *     citius-transnet INVITS case).
 *  5. Child-row safety guard (mirrors the original manual op): a loser is
 *     merged ONLY if it has zero rows across the ipo_id-bearing child tables
 *     listed below; otherwise it is left untouched and logged for manual review.
 *  6. #1051: every loser is merged through `IPORepository.mergeDuplicateInto`
 *     (spec section 2.3.3.3, OD-38, OD-69, OD-92) — the gated, logged,
 *     undoable merge. It runs the eligibility gate (`checkMergeEligibility`),
 *     writes the `ipo_merge_log` row, the slug redirect (reason
 *     DUPLICATE_MERGE, so `repair-merge-duplicate-ipo.ts --unmerge <merge-id>`
 *     can take it back) and removes the loser, all in one transaction. A
 *     refused pair is reported with the gate's reason and SKIPPED, never
 *     forced: the tool never passes forceDifferentName. Known refusal
 *     (measured 2026-09-26 on the gate as it stands): a bare trailing status
 *     letter ("X Ltd. O") or a trailing " IPO" word — the identity fold keeps
 *     those on purpose (company-identity-fold.ts, "DELIBERATELY NARROW"), so a
 *     human reviews the pair and, if it really is one IPO, runs
 *     `repair-merge-duplicate-ipo.ts --keep <id> --drop <id> --force-different-name`.
 *     The bracketed "(X IPO) CT" twin shape passes.
 *  7. Canonical rename: shadow guard (checker #3a) first — skip the slug
 *     rename if some OTHER live ipos row already holds the clean slug; then
 *     `IPORepository.renameSlugWithRedirect` (slug + redirect, one
 *     transaction) and `applySanitizedCompanyName`. No direct `ipos` write
 *     lives in this file (#1051, write ratchet).
 *
 * Run from scraper/ with tunnel env exported
 * (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 + creds). Usage:
 *   npx tsx scripts/repair-name-pollution-and-redirects.ts            # dry-run
 *   npx tsx scripts/repair-name-pollution-and-redirects.ts --apply    # writes
 */
import { db, getRedisClient, IPORepository } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { sanitizeDisplayCompanyName, normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { isRealIPO } from '@ipodhan/shared/utils/offering-type';
import { eq, sql } from 'drizzle-orm';
import logger from '../src/utils/logger.js';
import { pathToFileURL } from 'node:url';
import { createNoopRedisClient, guardCacheInvalidation, openRepairDb } from './lib/repair-tool.js';

/** Recorded verbatim in `ipo_merge_log.merged_by` for every merge this tool makes. */
export const MERGED_BY = 'repair-name-pollution-and-redirects.ts';

// The ipo_id-bearing child tables (schema.ts) a loser must have none of,
// excluding ipoSlugRedirects itself.
const CHILD_TABLES: { name: string; table: (typeof schema)[keyof typeof schema] }[] = [
  { name: 'subscriptions', table: schema.subscriptions },
  { name: 'ipoDemandGraph', table: schema.ipoDemandGraph },
  { name: 'gmpRecords', table: schema.gmpRecords },
  { name: 'financialData', table: schema.financialData },
  { name: 'ipoFinancials', table: schema.ipoFinancials },
  { name: 'documents', table: schema.documents },
  { name: 'listingPerformance', table: schema.listingPerformance },
  { name: 'peerCompanies', table: schema.peerCompanies },
  { name: 'affiliateClicks', table: schema.affiliateClicks },
  { name: 'extractionLogs', table: schema.extractionLogs },
  { name: 'ipoReviews', table: schema.ipoReviews },
  { name: 'ipoScores', table: schema.ipoScores },
  { name: 'ipoDetails', table: schema.ipoDetails },
  { name: 'fieldProtectionMetadata', table: schema.fieldProtectionMetadata },
  { name: 'anchorInvestors', table: schema.anchorInvestors },
  { name: 'auditLogs', table: schema.auditLogs },
  { name: 'fieldSources', table: schema.fieldSources },
  { name: 'dataConflicts', table: schema.dataConflicts },
];

interface IpoRow {
  id: string;
  companyName: string;
  slug: string;
  offeringType: string | null;
  createdAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type MergeRepo = Pick<IPORepository, 'mergeDuplicateInto'>;
type RepairRepo = Pick<IPORepository, 'mergeDuplicateInto' | 'renameSlugWithRedirect' | 'applySanitizedCompanyName'>;

export type LoserOutcome = { outcome: 'merged' | 'planned' } | { outcome: 'refused'; reason: string };

/**
 * #1051: merge one loser into the canonical row through the gated, logged, undoable merge.
 * `mergeDuplicateInto` throws `mergeDuplicateInto: refused — <reason>` when its eligibility gate
 * says the pair is two offers; that refusal is returned for this row (never retried with a looser
 * option, never forced). Any other error is rethrown, so a broken merge stops the run.
 */
export async function mergeLoser(
  repo: MergeRepo,
  canonicalId: string,
  loserId: string,
  opts: { apply: boolean; allowProd?: boolean }
): Promise<LoserOutcome> {
  try {
    await repo.mergeDuplicateInto(canonicalId, loserId, {
      apply: opts.apply,
      mergedBy: MERGED_BY,
      allowProd: opts.allowProd,
    });
    return { outcome: opts.apply ? 'merged' : 'planned' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const refused = message.match(/mergeDuplicateInto: refused — ([\s\S]*)$/);
    if (refused) return { outcome: 'refused', reason: refused[1] };
    throw err;
  }
}

async function hasChildRows(dbx: Db, ipoId: string): Promise<string[]> {
  const owners: string[] = [];
  for (const { name, table } of CHILD_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    const [row] = await dbx.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.ipoId, ipoId)).limit(1);
    if (row && row.n > 0) owners.push(`${name}(${row.n})`);
  }
  return owners;
}

async function slugIsLive(dbx: Db, slug: string, excludeId?: string): Promise<boolean> {
  const rows: { id: string }[] = await dbx
    .select({ id: schema.ipos.id })
    .from(schema.ipos)
    .where(eq(schema.ipos.slug, slug))
    .limit(2);
  return rows.some((r) => r.id !== excludeId);
}

export interface RepairCounts {
  renamed: number;
  merged: number;
  refused: { loserId: string; slug: string; reason: string }[];
  untouched: number;
  skippedNotServable: number;
  skippedChildRows: number;
  skippedShadow: number;
  skippedAmbiguous: number;
}

/** The whole repair, over every `ipos` row. Dry run unless `opts.apply`. */
export async function runNamePollutionRepair(
  dbx: Db,
  repo: RepairRepo,
  opts: { apply: boolean; allowProd?: boolean; log?: (line: string) => void }
): Promise<RepairCounts> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const rows = (await dbx
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      offeringType: schema.ipos.offeringType,
      createdAt: schema.ipos.createdAt,
    })
    .from(schema.ipos)) as IpoRow[];

  const groups = new Map<string, IpoRow[]>();
  for (const row of rows) {
    const clean = sanitizeDisplayCompanyName(row.companyName);
    const key = normalizeCompanyNameForMatching(clean || row.companyName);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const c: RepairCounts = {
    renamed: 0,
    merged: 0,
    refused: [],
    untouched: 0,
    skippedNotServable: 0,
    skippedChildRows: 0,
    skippedShadow: 0,
    skippedAmbiguous: 0,
  };

  for (const [key, bucket] of groups) {
    const anyPolluted = bucket.some((r) => sanitizeDisplayCompanyName(r.companyName) !== r.companyName.trim());
    if (bucket.length === 1 && !anyPolluted) {
      c.untouched++;
      continue; // already clean, no duplicates — nothing to do (idempotent no-op)
    }

    const alreadyClean = bucket.filter((r) => sanitizeDisplayCompanyName(r.companyName) === r.companyName.trim());
    let canonical: IpoRow;
    if (alreadyClean.length === 1) {
      canonical = alreadyClean[0];
    } else if (alreadyClean.length === 0) {
      canonical = [...bucket].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    } else {
      // 2+ already-clean rows share an identity key — never guess which is canonical.
      logger.warn({ key, ids: alreadyClean.map((r) => r.id) }, 'ambiguous group: multiple already-clean rows share identity key, skipping');
      c.skippedAmbiguous++;
      continue;
    }

    if (!isRealIPO(canonical.offeringType)) {
      logger.warn({ key, canonicalId: canonical.id, offeringType: canonical.offeringType }, 'skip group: canonical offeringType not servable by /ipos/[slug]');
      c.skippedNotServable++;
      continue;
    }

    const cleanName = sanitizeDisplayCompanyName(canonical.companyName);
    const cleanSlug = generateIPOSlug(cleanName);
    const losers = bucket.filter((r) => r.id !== canonical.id);

    log(`\ngroup "${key}" | canonical=${canonical.companyName} (${canonical.id}) | losers=${losers.length}`);

    // Order note (#1051 finding 2): the canonical rename below runs BEFORE the loser merges in
    // this group. An unexpected (non-refusal) throw from a later mergeLoser call in the SAME
    // group therefore leaves that group half-applied for this run. This is safe by construction,
    // not by luck: the script is idempotent and re-runnable (see file header) — it recomputes
    // every group fresh from `ipos` on each run, so a re-run finds the canonical already clean
    // (folds into `alreadyClean`) and the group still has `bucket.length > 1` (the unmerged
    // loser is still present), which retries exactly the merge that threw. The only case this
    // does NOT self-heal is `--allow-prod` reaching `openRepairDb` but not `mergeDuplicateInto`
    // (the class this round fixes) — with that threaded through consistently, the remaining
    // "unexpected" throws are real failures (connection loss, a broken merge) that should stop
    // the whole run regardless of ordering, exactly as every other repair tool in this codebase
    // behaves on a rethrown error.
    if (canonical.companyName !== cleanName || canonical.slug !== cleanSlug) {
      const oldSlug = canonical.slug;
      log(`  RENAME canonical: "${canonical.companyName}" -> "${cleanName}" | slug ${oldSlug} -> ${cleanSlug}`);
      let slugOk = cleanSlug !== oldSlug;
      if (slugOk && (await slugIsLive(dbx, cleanSlug, canonical.id))) {
        logger.warn({ oldSlug, cleanSlug, ipoId: canonical.id }, 'skip slug rename: target slug is LIVE on a different IPO (shadow guard)');
        c.skippedShadow++;
        slugOk = false;
      }
      if (opts.apply) {
        if (slugOk) {
          const reason = losers.length > 0 ? 'DUPLICATE_MERGE_AND_NAME_POLLUTION_CLEANUP' : 'NAME_POLLUTION_CLEANUP';
          const r = await repo.renameSlugWithRedirect(canonical.id, oldSlug, cleanSlug, reason);
          if (r === 'raced') logger.warn({ ipoId: canonical.id, oldSlug }, 'slug rename raced: the row no longer holds oldSlug, left as is');
        }
        if (canonical.companyName !== cleanName) await repo.applySanitizedCompanyName(canonical.id, cleanName);
      }
      c.renamed++;
    }

    for (const loser of losers) {
      const owners = await hasChildRows(dbx, loser.id);
      if (owners.length > 0) {
        logger.warn({ loserId: loser.id, slug: loser.slug, owners }, 'skip merge: loser has child rows, needs manual review');
        c.skippedChildRows++;
        continue;
      }
      const out = await mergeLoser(repo, canonical.id, loser.id, { apply: opts.apply, allowProd: opts.allowProd });
      if (out.outcome === 'refused') {
        log(`  REFUSED loser "${loser.companyName}" (${loser.slug}, ${loser.id}) -> canonical ${canonical.id}: ${out.reason}`);
        c.refused.push({ loserId: loser.id, slug: loser.slug, reason: out.reason });
        continue;
      }
      log(`  MERGE loser "${loser.companyName}" (${loser.slug}) -> canonical ${canonical.id} [${out.outcome}]`);
      c.merged++;
    }
  }
  return c;
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  console.log('='.repeat(80));
  console.log(`NAME-POLLUTION + REDIRECT REPAIR (T-278 P3-1 recreate) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const ALLOW_PROD = process.argv.includes('--allow-prod');
  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-name-pollution-and-redirects',
  });
  // mergeDuplicateInto / renameSlugWithRedirect invalidate cache internally, so the guard decides
  // which Redis client the repository ever sees (#715 class).
  const guard = guardCacheInvalidation({
    dbName,
    toolName: 'repair-name-pollution-and-redirects',
    keys: ['ipo:detail:*', 'ipo:list:*', 'ipo:search:*'],
  });
  const redis = guard.blocked ? (createNoopRedisClient() as unknown as ReturnType<typeof getRedisClient>) : getRedisClient();
  const repo = new IPORepository(db, redis);

  const c = await runNamePollutionRepair(db, repo, { apply: APPLY, allowProd: ALLOW_PROD });

  console.log('\n' + '='.repeat(80));
  console.log(
    `renamed: ${c.renamed} | merged${APPLY ? '' : '(planned)'}: ${c.merged} | refused by merge gate: ${c.refused.length} | untouched(already clean): ${c.untouched}`
  );
  console.log(
    `skipped — not servable: ${c.skippedNotServable} | child rows: ${c.skippedChildRows} | shadow: ${c.skippedShadow} | ambiguous: ${c.skippedAmbiguous}`
  );
  for (const r of c.refused) console.log(`  refused ${r.slug} (${r.loserId}): ${r.reason}`);
  if (!APPLY) console.log('\nDRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'name-pollution repair crashed');
    console.error(e);
    process.exit(1);
  });
}
