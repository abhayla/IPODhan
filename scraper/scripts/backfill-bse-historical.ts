/**
 * BSE historical enrichment backfill (enumerate-and-match).
 *
 * BSE's list endpoint exposes only the current board, but the detail endpoint
 * (GetMkt_ISSUE_BBS_IPO/w?IPO_NO=n) reaches the full archive by sequential
 * IPO_NO. This script enumerates IPO_NO downward, fetches each detail, keeps
 * only book-built IPOs (mapBSEDetailToScrapedIPO returns null otherwise), and
 * matches each to an EXISTING MAINBOARD skeleton by normalized company name.
 * Matches are enriched through upsertIPO (the consolidation/protection write
 * path) — never creating new rows, so NCDs/rights/OFS are skipped.
 *
 * Usage (tunnel: DATABASE_HOST=localhost DATABASE_PORT=15432):
 *   npx tsx --tsconfig tsx.tsconfig.json scripts/backfill-bse-historical.ts [--from=7772] [--to=7100] [--apply]
 *   Default is DRY-RUN (no writes): reports the proposed enrichments only.
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { and, eq, or, isNull, sql } from 'drizzle-orm';
import logger from '../src/utils/logger.js';
import {
  mapBSEDetailToScrapedIPO,
  type BSEDetailRow,
} from '../src/scrapers/bse-api-scraper.js';
import { normalizeCompanyNameForMatching, upsertIPO } from '../src/services/data-persister.js';
import { IPORepository, getRedisClient, resolveIpoRow } from '@ipodhan/shared';
import { generateSlug } from '../src/utils/validators.js';

const BSE_API_BASE = 'https://api.bseindia.com/BseIndiaAPI/api/';
const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Origin: 'https://www.bseindia.com',
  Referer: 'https://www.bseindia.com/',
  Accept: 'application/json',
};

function arg(name: string, def: number): number {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? parseInt(m.split('=')[1], 10) : def;
}
const FROM = arg('from', 7772);
const TO = arg('to', 7100);
const APPLY = process.argv.includes('--apply');

function asArray<T>(j: unknown): T[] {
  if (Array.isArray(j)) return j as T[];
  if (j && typeof j === 'object') {
    const arr = Object.values(j as Record<string, unknown>).find((v) => Array.isArray(v));
    if (arr) return arr as T[];
  }
  return [];
}

async function fetchDetail(ipoNo: number): Promise<BSEDetailRow | null> {
  try {
    const res = await fetch(`${BSE_API_BASE}GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${ipoNo}`, { headers: BSE_HEADERS });
    if (!res.ok) return null;
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null; // archive gap → XHTML
    }
    return asArray<BSEDetailRow>(json)[0] || null;
  } catch (e) {
    logger.warn({ ipoNo, error: e instanceof Error ? e.message : String(e) }, 'BSE detail fetch failed');
    return null;
  }
}

interface Skeleton {
  id: string;
  companyName: string;
  issueSize: string | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  lotSize: number | null;
  registrar: string | null;
  leadManagers: string[] | null;
  status: string | null;
  openDate: string | null;
}

/** Fields BSE can fill that are currently empty on the skeleton. */
function missingFields(s: Skeleton, bse: ReturnType<typeof mapBSEDetailToScrapedIPO>): string[] {
  if (!bse) return [];
  const out: string[] = [];
  const sizeEmpty = s.issueSize === null || Number(s.issueSize) === 0;
  if (sizeEmpty && bse.issueSize > 0) out.push(`issue_size→₹${(bse.issueSize / 1e7).toFixed(2)}cr`);
  // BSE returns market lot (1) for mainboard, NOT the IPO application/bid lot — only
  // trust a plausible bid-lot (>1). SME rows carry a real bid lot and pass this.
  if ((s.lotSize === null || s.lotSize === 0) && bse.lotSize && bse.lotSize > 1) out.push(`lot→${bse.lotSize}`);
  if ((s.priceRangeMax === null || s.priceRangeMax === 0) && bse.priceRangeMax) out.push(`band→${bse.priceRangeMin}-${bse.priceRangeMax}`);
  if (!s.registrar && bse.registrar) out.push('registrar');
  if ((!s.leadManagers || s.leadManagers.length === 0) && bse.leadManagers && bse.leadManagers.length) out.push('leadMgrs');
  return out;
}

async function main() {
  logger.info({ from: FROM, to: TO, apply: APPLY }, `BSE historical backfill — ${APPLY ? 'APPLY (writes)' : 'DRY-RUN (no writes)'}`);

  // 1. Pull MAINBOARD skeletons missing structural data.
  const skeletons = (await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      issueSize: ipos.issueSize,
      priceRangeMin: ipos.priceRangeMin,
      priceRangeMax: ipos.priceRangeMax,
      lotSize: ipos.lotSize,
      registrar: ipos.registrar,
      leadManagers: ipos.leadManagers,
      status: ipos.status,
      openDate: ipos.openDate,
    })
    .from(ipos)
    .where(
      and(
        eq(ipos.segment, 'MAINBOARD'),
        // Genuine IPOs only — never enrich corporate actions (BUYBACK/TENDER/OFS/etc.).
        // Mirrors the isRealIPO predicate; without this, WIPRO (buyback), Sarda/Zydus
        // (tender/OFS) etc. get matched and written with IPO-shaped fields.
        eq(ipos.offeringType, 'IPO'),
        or(isNull(ipos.issueSize), eq(ipos.issueSize, sql`'0'`), isNull(ipos.lotSize)),
      ),
    )) as Skeleton[];

  const byName = new Map<string, Skeleton>();
  for (const s of skeletons) byName.set(normalizeCompanyNameForMatching(s.companyName), s);
  logger.info({ skeletons: skeletons.length, uniqueNames: byName.size }, 'Loaded MAINBOARD skeletons');

  // 2. Enumerate IPO_NO downward; match book-built IPOs to skeletons.
  let scanned = 0;
  let ipoRows = 0;
  const matches: { ipoNo: number; skeleton: Skeleton; bse: NonNullable<ReturnType<typeof mapBSEDetailToScrapedIPO>>; fills: string[] }[] = [];

  for (let n = FROM; n >= TO; n--) {
    const detail = await fetchDetail(n);
    scanned++;
    if (!detail) continue;
    const bse = mapBSEDetailToScrapedIPO(detail);
    if (!bse) continue; // not a book-built IPO
    ipoRows++;
    const skel = byName.get(normalizeCompanyNameForMatching(bse.companyName));
    if (!skel) continue;
    const fills = missingFields(skel, bse);
    matches.push({ ipoNo: n, skeleton: skel, bse, fills });
    if (scanned % 50 === 0) logger.info({ scanned, ipoRows, matches: matches.length, atIpoNo: n }, 'progress');
  }

  // 3. Report.
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SCANNED ${scanned} IPO_NO (${FROM}→${TO}) · book-built IPO rows: ${ipoRows} · skeleton MATCHES: ${matches.length}`);
  console.log('='.repeat(80));
  const enrichable = matches.filter((m) => m.fills.length > 0);
  for (const m of matches) {
    const tag = m.fills.length ? m.fills.join(', ') : '(already complete — no fill)';
    console.log(`  #${m.ipoNo} ${m.bse.companyName}  →  ${tag}`);
  }
  console.log(`\n${enrichable.length} of ${matches.length} matched skeletons have fields to enrich.`);

  // 4. Apply (gated).
  if (!APPLY) {
    console.log('\nDRY-RUN — no writes. Re-run with --apply to enrich via upsertIPO.');
    return;
  }
  console.log(`\nAPPLY: enriching ${enrichable.length} skeletons via upsertIPO...`);
  // upsertIPO signature is (ipoRepository, scrapedIPO, source) — construct the repo once.
  const ipoRepository = new IPORepository(db as any, getRedisClient());
  let ok = 0;
  let fail = 0;
  for (const m of enrichable) {
    try {
      // Preserve the skeleton's existing status (avoid regressing LISTED→CLOSED on historical rows).
      // Omit lotSize unless it's a plausible IPO bid-lot (>1) — never write the BSE market-lot of 1.
      const { lotSize, ...rest } = m.bse;
      const payload: any = { ...rest, status: (m.skeleton.status as any) || m.bse.status };
      if (typeof lotSize === 'number' && lotSize > 1) payload.lotSize = lotSize;
      // T-318 (Phase-1 completion): resolve identity ONCE here, the same way
      // the protected path does, instead of letting upsertIPO re-resolve
      // independently — this is a direct upsertIPO caller with no
      // preResolvedIPO, one of the 6 named in review-round2 P1-2/C2.
      const preResolvedIPO = await resolveIpoRow(ipoRepository, {
        companyName: payload.companyName,
        normalizedName: normalizeCompanyNameForMatching(payload.companyName),
        slug: generateSlug(payload.companyName),
        isin: payload.isin,
        symbol: payload.symbol,
      });
      await upsertIPO(ipoRepository, payload, 'BSE', preResolvedIPO);
      ok++;
      logger.info({ ipoNo: m.ipoNo, company: m.bse.companyName, fills: m.fills }, 'enriched');
    } catch (e) {
      fail++;
      logger.error({ ipoNo: m.ipoNo, error: e instanceof Error ? e.message : String(e) }, 'enrich failed');
    }
  }
  console.log(`\nDONE — enriched ${ok}, failed ${fail}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'backfill crashed');
    process.exit(1);
  });
