/**
 * W-90 retype — fix documents stored as PRICE_BAND_AD that are actually NSE's
 * `RATIOS_<SYMBOL>.zip` filing (the combined "Price Band Advertisement-cum-
 * Basis of Issue Price" document).
 *
 * ROOT CAUSE (see document-download-verifier.ts `isNseRatiosArchiveUrl` and
 * document-discovery-runner.ts's W-29 "bytes win" rule): NSE's ratios archive
 * ships with ONE member named "<Company> - Price Band Advertisement.pdf". The
 * member-name classifier types that PDF as PRICE_BAND_AD, and the W-29 rule
 * let that member-name classification win over the fetch's wantedType — so
 * every such filing was stored as PRICE_BAND_AD and RATIOS_BASIS_ISSUE_PRICE
 * stayed permanently unreachable. The verifier fix (W-90) stops this for NEW
 * downloads by trusting NSE's own archive naming over the member name; this
 * script repairs the rows already stored wrong by that bug.
 *
 * Selection: any `documents` row whose `url` matches NSE's ratios-archive
 * naming (`RATIOS_<SYMBOL>.zip`, case-insensitive) AND whose `type` is
 * currently `PRICE_BAND_AD`. Exported as `isRetypeCandidate` and unit-tested
 * directly — no DB needed to prove the predicate is right.
 *
 * DRY-RUN BY DEFAULT. Lists every candidate row (id, ipo, url) and does
 * nothing else. Pass `--apply` to actually update `type` to
 * `RATIOS_BASIS_ISSUE_PRICE` and invalidate that IPO's document cache.
 *
 * Run (from scraper/):
 *   npx tsx scripts/retype-ratios-documents.ts            # dry run (default)
 *   npx tsx scripts/retype-ratios-documents.ts --apply     # apply the retype
 */

import { db } from '@ipodhan/shared/db';
import { documents, ipos } from '@ipodhan/shared/db/schema';
import { DocumentRepository } from '@ipodhan/shared';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { and, eq, ilike } from 'drizzle-orm';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';

/** NSE's own `RATIOS_<SYMBOL>.zip` naming — see document-classifier.ts `isNseRatiosArchiveUrl`. */
export const RATIOS_URL_PATTERN = /RATIOS_/i;

const RETYPE_FROM = 'PRICE_BAND_AD';
const RETYPE_TO = 'RATIOS_BASIS_ISSUE_PRICE';

/**
 * True when a stored document row is a W-90 mistype: its url is NSE's ratios
 * archive naming, but its type is still PRICE_BAND_AD instead of
 * RATIOS_BASIS_ISSUE_PRICE.
 *
 * Pure and DB-free by design so it can be unit-tested without a database.
 */
export function isRetypeCandidate(url: string | null | undefined, type: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.trim() === '') return false;
  if (type !== RETYPE_FROM) return false;
  return RATIOS_URL_PATTERN.test(url);
}

const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await db
    .select({
      id: documents.id,
      ipoId: documents.ipoId,
      url: documents.url,
      type: documents.type,
      companyName: ipos.companyName,
      slug: ipos.slug,
    })
    .from(documents)
    .innerJoin(ipos, eq(documents.ipoId, ipos.id))
    .where(and(eq(documents.type, RETYPE_FROM), ilike(documents.url, '%RATIOS_%')));

  const candidates = rows.filter((r) => isRetypeCandidate(r.url, r.type));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${candidates.length} candidate row(s) found.`);
  for (const r of candidates) {
    console.log(`  [${r.id}] ${r.companyName} — ${r.type} -> ${RETYPE_TO} — ${r.url}`);
  }

  if (!APPLY) {
    console.log('\nDry run only — pass --apply to write the retype.');
    return;
  }

  const redis = getRedisClient();
  const documentRepository = new DocumentRepository(db, redis);
  void documentRepository; // reserved for future cache-aware read paths

  const touchedSlugs = new Set<string>();
  for (const r of candidates) {
    await db.update(documents).set({ type: RETYPE_TO }).where(eq(documents.id, r.id));
    if (r.slug) touchedSlugs.add(r.slug);
  }
  for (const slug of touchedSlugs) {
    await invalidateIPOCaches(redis, slug);
  }
  console.log(`Retyped ${candidates.length} row(s), invalidated cache for ${touchedSlugs.size} IPO(s).`);
}

if (process.argv[1] && process.argv[1].endsWith('retype-ratios-documents.ts')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
