/**
 * Backfill: listing_performance for LISTED IPOs via Chittorgarh report 25 (B1)
 *
 * WHY: listing_performance is 0/91. NSE feed lacks listingPrice; BSE has no day-1 price endpoint.
 * Chittorgarh report 25 publishes the REAL day-1 "Close Price on Listing" + listing gain% +
 * current BSE/NSE price + current gain% (mainboard AND SME). This backfill matches those rows to
 * our LISTED IPOs and writes full, honest listing_performance rows.
 *
 * SAFETY: dry-run by default; --apply persists via ListingPerformanceRepository (ipoId-unique upsert).
 * Match: isin -> nse_symbol -> canonical-name. Only real data written; gains out of the numeric(5,2)
 * range are stored null (never clamped to a fake value). Unmatched IPOs are reported, never guessed.
 *
 * Run from scraper/ with tunnel env (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 ...):
 *   npx tsx scripts/backfill-listing-performance-chittorgarh.ts          # dry-run
 *   npx tsx scripts/backfill-listing-performance-chittorgarh.ts --apply
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories';
import { fetchChittorgarhListingRows, type ChittorgarhListingRow } from '../src/scrapers/chittorgarh-listing-scraper.js';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');

// P3-3 (T-287): widened from a 4-year window (2023-24..2026-27) to cover every
// fiscal year Chittorgarh's report-25 has ever returned data for. Root cause
// of 5/8 missing rows (CMS Info Systems, Windlas Biotech, Maruti Interior
// Products, Net Pix Shorts, AAA Technologies — all listed 2020-2022) was
// this window excluding them outright, not a matching bug: verified their
// exact ISIN/close-price rows exist in FY2020-21/2021-22/2022-23. This is a
// ONE-TIME backfill script (not the live cron job, which stays recent-only
// by design), so a wider window here has no ongoing cost.
const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' },
  { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

/** numeric(7,2) bound (#79, post-C3) — keep a real value or null; never fabricate a
 *  clamped one. Widened from ±999.99 to ±99999.99 so a legit unbounded current gain
 *  (old IPOs up >1000% since listing) is preserved, not silently nulled. */
function gainOrNull(v: number | null): string | null {
  if (v == null || !Number.isFinite(v) || Math.abs(v) > 99999.99) return null;
  return v.toFixed(2);
}
/** Prices are numeric(10,2) (#79, post-C3) — keep paise, never Math.round to whole ₹. */
const rnd = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

async function main() {
  console.log('='.repeat(80));
  console.log(`LISTING-PERFORMANCE (Chittorgarh report 25) BACKFILL — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const candidates = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      symbol: schema.ipos.symbol,
      isin: schema.ipos.isin,
      priceRangeMax: schema.ipos.priceRangeMax,
      listingDate: schema.ipos.listingDate,
    })
    .from(schema.ipos)
    .leftJoin(schema.listingPerformance, eq(schema.ipos.id, schema.listingPerformance.ipoId))
    .where(and(eq(schema.ipos.status, 'LISTED'), eq(schema.ipos.offeringType, 'IPO'), isNull(schema.listingPerformance.ipoId)));

  const byIsin = new Map<string, (typeof candidates)[number]>();
  const bySym = new Map<string, (typeof candidates)[number]>();
  const byNorm = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    if (c.isin) byIsin.set(c.isin.trim().toUpperCase(), c);
    if (c.symbol) bySym.set(c.symbol.trim().toUpperCase(), c);
    const n = normalizeCompanyNameForMatching(c.companyName);
    if (n && !byNorm.has(n)) byNorm.set(n, c);
  }
  console.log(`LISTED genuine IPOs missing listing_performance: ${candidates.length}`);

  console.log('Fetching Chittorgarh report 25 (mainboard+sme across fiscal years)...');
  const rows = await fetchChittorgarhListingRows(FISCAL_YEARS);
  console.log(`Chittorgarh listing rows with a real day-1 close: ${rows.length}`);

  type Plan = { c: (typeof candidates)[number]; r: ChittorgarhListingRow; via: string };
  const plans: Plan[] = [];
  const seenIpo = new Set<string>();
  let unmatched = 0;
  for (const r of rows) {
    let c: (typeof candidates)[number] | undefined;
    let via = '';
    const ik = r.isin?.trim().toUpperCase();
    const sk = r.nseSymbol?.trim().toUpperCase();
    const nk = r.companyName ? normalizeCompanyNameForMatching(r.companyName) : '';
    if (ik && byIsin.has(ik)) { c = byIsin.get(ik); via = 'isin'; }
    else if (sk && bySym.has(sk)) { c = bySym.get(sk); via = 'symbol'; }
    else if (nk && byNorm.has(nk)) { c = byNorm.get(nk); via = 'name'; }
    if (!c || seenIpo.has(c.id)) { if (!c) unmatched++; continue; }
    seenIpo.add(c.id);
    plans.push({ c, r, via });
  }

  const viaCounts = plans.reduce<Record<string, number>>((a, p) => ((a[p.via] = (a[p.via] || 0) + 1), a), {});
  console.log(`\nmatched -> our LISTED IPOs: ${plans.length}  via ${JSON.stringify(viaCounts)}  (unmatched chittorgarh rows: ${unmatched})`);
  for (const p of plans.slice(0, 12)) {
    console.log(`  - ${p.c.companyName} [${p.via}] listClose=₹${p.r.listingClose} listGain=${p.r.listingGainPct}% current=₹${p.r.currentBse ?? p.r.currentNse} curGain=${p.r.currentGainPct}%`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${plans.length} listing_performance rows WOULD be written. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  let redis: any; try { redis = getRedisClient(); } catch { /* optional */ }
  const repo = new ListingPerformanceRepository(db, redis);
  let written = 0, failed = 0;
  const errors: string[] = [];
  for (const { c, r } of plans) {
    try {
      await repo.upsert({
        ipoId: c.id,
        symbol: c.symbol ?? r.nseSymbol,
        companyName: c.companyName,
        listingDate: c.listingDate,
        listingPrice: rnd(r.listingClose),
        issuePrice: rnd(r.issuePrice ?? c.priceRangeMax),
        listingGainPercent: gainOrNull(r.listingGainPct),
        currentPrice: rnd(r.currentBse ?? r.currentNse),
        currentPriceBSE: rnd(r.currentBse),
        currentPriceNSE: rnd(r.currentNse),
        currentGainPercent: gainOrNull(r.currentGainPct),
        dataSource: 'SCRAPER',
      });
      written++;
      logger.info({ company: c.companyName, listClose: r.listingClose, listGain: r.listingGainPct }, 'listing_performance written');
    } catch (err) {
      failed++;
      const m = err instanceof Error ? err.message : String(err);
      errors.push(`${c.companyName}: ${m}`);
      logger.error({ company: c.companyName, error: m }, 'listing_performance upsert failed');
    }
  }
  console.log(`\nAPPLY complete: written=${written} failed=${failed}`);
  if (errors.length) console.log(`  errors:\n   - ${errors.slice(0, 8).join('\n   - ')}`);
  console.log('='.repeat(80));
  process.exit(failed > written ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'listing-perf chittorgarh backfill crashed');
  console.error(e);
  process.exit(1);
});
