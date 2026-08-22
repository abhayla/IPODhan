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
 *     merged (redirect written, row deleted) ONLY if it has zero rows across
 *     all 18 ipo_id-bearing child tables; otherwise it is left untouched and
 *     logged for manual review.
 *  6. Shadow guard (checker #3a, belt-and-suspenders alongside the app-level
 *     fix in IPORepository.findRedirectSlug): before writing a redirect row
 *     for `oldSlug`, skip if some OTHER live ipos row currently holds that
 *     exact slug — never shadow a live row.
 *  7. Redirect writes are idempotent via `onConflictDoNothing` on the unique
 *     `old_slug` column.
 *
 * Run from scraper/ with tunnel env exported
 * (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 + creds). Usage:
 *   npx tsx scripts/repair-name-pollution-and-redirects.ts            # dry-run
 *   npx tsx scripts/repair-name-pollution-and-redirects.ts --apply    # writes
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { sanitizeDisplayCompanyName, normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { isRealIPO } from '@ipodhan/shared/utils/offering-type';
import { eq, sql } from 'drizzle-orm';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');

// The 18 ipo_id-bearing child tables (schema.ts), excluding ipoSlugRedirects
// itself (that's what this script writes, not a dependency to check).
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

async function hasChildRows(ipoId: string): Promise<string[]> {
  const owners: string[] = [];
  for (const { name, table } of CHILD_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = table as any;
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.ipoId, ipoId)).limit(1);
    if (row && row.n > 0) owners.push(`${name}(${row.n})`);
  }
  return owners;
}

async function slugIsLive(slug: string, excludeId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.ipos.id })
    .from(schema.ipos)
    .where(eq(schema.ipos.slug, slug))
    .limit(2);
  return rows.some((r) => r.id !== excludeId);
}

/**
 * `excludeId` is the row that CURRENTLY, legitimately owns `oldSlug` and is
 * about to be renamed-away or deleted in this same operation — not the
 * redirect's target. Excluding the target here would false-positive on every
 * merge (the loser being merged always "shadows" itself until it is deleted).
 */
async function writeRedirect(oldSlug: string, ipoId: string, reason: string, excludeId: string): Promise<'written' | 'skipped-shadow' | 'skipped-exists'> {
  if (await slugIsLive(oldSlug, excludeId)) {
    logger.warn({ oldSlug, ipoId }, 'skip redirect write: oldSlug is a LIVE slug on a different IPO (shadow guard)');
    return 'skipped-shadow';
  }
  if (!APPLY) return 'written';
  const result = await db
    .insert(schema.ipoSlugRedirects)
    .values({ oldSlug, ipoId, reason })
    .onConflictDoNothing({ target: schema.ipoSlugRedirects.oldSlug })
    .returning({ id: schema.ipoSlugRedirects.id });
  return result.length > 0 ? 'written' : 'skipped-exists';
}

async function main() {
  console.log('='.repeat(80));
  console.log(`NAME-POLLUTION + REDIRECT REPAIR (T-278 P3-1 recreate) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const rows = (await db
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

  let renamed = 0, merged = 0, skippedNotServable = 0, skippedChildRows = 0, skippedShadow = 0, skippedAmbiguous = 0, untouched = 0;

  for (const [key, bucket] of groups) {
    const anyPolluted = bucket.some((r) => sanitizeDisplayCompanyName(r.companyName) !== r.companyName.trim());
    if (bucket.length === 1 && !anyPolluted) {
      untouched++;
      continue; // already clean, no duplicates — nothing to do (idempotent no-op)
    }

    const alreadyClean = bucket.filter((r) => sanitizeDisplayCompanyName(r.companyName) === r.companyName.trim());
    let canonical: IpoRow;
    if (alreadyClean.length === 1) {
      canonical = alreadyClean[0];
    } else if (alreadyClean.length === 0) {
      canonical = [...bucket].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    } else {
      // 2+ already-clean rows share an identity key — never guess which is
      // canonical; leave for manual review.
      logger.warn({ key, ids: alreadyClean.map((r) => r.id) }, 'ambiguous group: multiple already-clean rows share identity key, skipping');
      skippedAmbiguous++;
      continue;
    }

    if (!isRealIPO(canonical.offeringType)) {
      logger.warn({ key, canonicalId: canonical.id, offeringType: canonical.offeringType }, 'skip group: canonical offeringType not servable by /ipos/[slug]');
      skippedNotServable++;
      continue;
    }

    const cleanName = sanitizeDisplayCompanyName(canonical.companyName);
    const cleanSlug = generateIPOSlug(cleanName);
    const losers = bucket.filter((r) => r.id !== canonical.id);

    console.log(`\ngroup "${key}" | canonical=${canonical.companyName} (${canonical.id}) | losers=${losers.length}`);

    if (canonical.companyName !== cleanName || canonical.slug !== cleanSlug) {
      const oldSlug = canonical.slug;
      console.log(`  RENAME canonical: "${canonical.companyName}" -> "${cleanName}" | slug ${oldSlug} -> ${cleanSlug}`);
      if (cleanSlug !== oldSlug) {
        const outcome = await writeRedirect(oldSlug, canonical.id, losers.length > 0 ? 'DUPLICATE_MERGE_AND_NAME_POLLUTION_CLEANUP' : 'NAME_POLLUTION_CLEANUP', canonical.id);
        if (outcome === 'skipped-shadow') skippedShadow++;
      }
      if (APPLY) {
        await db.update(schema.ipos).set({ companyName: cleanName, slug: cleanSlug }).where(eq(schema.ipos.id, canonical.id));
      }
      renamed++;
    }

    for (const loser of losers) {
      const owners = await hasChildRows(loser.id);
      if (owners.length > 0) {
        logger.warn({ loserId: loser.id, slug: loser.slug, owners }, 'skip merge: loser has child rows, needs manual review');
        skippedChildRows++;
        continue;
      }
      console.log(`  MERGE loser "${loser.companyName}" (${loser.slug}) -> canonical ${cleanSlug}`);
      const outcome = await writeRedirect(loser.slug, canonical.id, 'DUPLICATE_MERGE_AND_NAME_POLLUTION_CLEANUP', loser.id);
      if (outcome === 'skipped-shadow') {
        skippedShadow++;
        continue; // do NOT delete a row whose slug we couldn't safely redirect
      }
      if (APPLY) {
        await db.delete(schema.ipos).where(eq(schema.ipos.id, loser.id));
      }
      merged++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`renamed: ${renamed} | merged(deleted): ${merged} | untouched(already clean): ${untouched}`);
  console.log(`skipped — not servable: ${skippedNotServable} | child rows: ${skippedChildRows} | shadow: ${skippedShadow} | ambiguous: ${skippedAmbiguous}`);
  if (!APPLY) console.log('\nDRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'name-pollution repair crashed');
  console.error(e);
  process.exit(1);
});
