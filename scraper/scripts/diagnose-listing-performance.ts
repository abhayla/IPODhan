/**
 * DIAGNOSTIC (read-only) — Listing performance 0% root cause
 *
 * Answers, before any build/backfill (systematic-debugging / contract B1):
 *  1. How many LISTED genuine IPOs lack a listing_performance row, split by segment + symbol presence?
 *  2. Does NSE /api/public-past-issues actually return `listingPrice`? (the field is documented optional)
 *  3. What securityType distribution does NSE return — does it include SME?
 *  4. Of our LISTED candidates, how many match an NSE record by symbol AND have a usable listingPrice?
 *
 * Read-only: NO DB writes, NO network writes. Run from scraper/ with tunnel env exported:
 *   npx tsx scripts/diagnose-listing-performance.ts
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { fetchPastIPOs } from '../src/scrapers/nse-api-client.js';

function norm(s: string | null | undefined): string {
  return (s || '').trim().toUpperCase();
}

async function main() {
  console.log('='.repeat(80));
  console.log('LISTING-PERFORMANCE DIAGNOSTIC (read-only)');
  console.log('='.repeat(80));

  // 1. LISTED genuine IPOs missing listing_performance, by segment + symbol presence
  const candidates = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      symbol: schema.ipos.symbol,
      segment: schema.ipos.segment,
      listingDate: schema.ipos.listingDate,
      priceRangeMax: schema.ipos.priceRangeMax,
    })
    .from(schema.ipos)
    .leftJoin(schema.listingPerformance, eq(schema.ipos.id, schema.listingPerformance.ipoId))
    .where(
      and(
        eq(schema.ipos.status, 'LISTED'),
        eq(schema.ipos.offeringType, 'IPO'),
        isNull(schema.listingPerformance.ipoId)
      )
    );

  const bySeg = new Map<string, { total: number; withSymbol: number }>();
  for (const c of candidates) {
    const seg = c.segment || 'null';
    const e = bySeg.get(seg) || { total: 0, withSymbol: 0 };
    e.total++;
    if (norm(c.symbol)) e.withSymbol++;
    bySeg.set(seg, e);
  }
  console.log(`\nLISTED genuine IPOs missing listing_performance: ${candidates.length}`);
  for (const [seg, e] of bySeg) {
    console.log(`  ${seg.padEnd(10)} total=${e.total}  withSymbol=${e.withSymbol}`);
  }

  // 2-3. NSE feed shape
  console.log('\nFetching NSE past-issues (cookie-primed)...');
  let nse;
  try {
    nse = await fetchPastIPOs();
  } catch (err) {
    console.error('NSE fetch FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const rows = nse.pastIPOs || [];
  const withListingPrice = rows.filter(
    (r) => r.listingPrice != null && Number(String(r.listingPrice).replace(/\s+/g, '')) > 0
  ).length;
  const secTypeDist = new Map<string, number>();
  for (const r of rows) {
    const st = r.securityType || 'UNKNOWN';
    secTypeDist.set(st, (secTypeDist.get(st) || 0) + 1);
  }
  console.log(`\nNSE records: ${rows.length}`);
  console.log(`NSE records with usable listingPrice>0: ${withListingPrice}`);
  console.log('NSE securityType distribution:');
  for (const [st, n] of [...secTypeDist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${st.padEnd(10)} ${n}`);
  }
  if (rows.length) {
    const sample = rows[0];
    console.log('\nSample NSE record keys:', Object.keys(sample).join(', '));
    console.log('Sample NSE record:', JSON.stringify(sample).slice(0, 400));
  }

  // 4. Symbol match yield for our candidates
  const nseBySymbol = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const sym = norm((r as any).symbol);
    if (sym) nseBySymbol.set(sym, r);
  }
  let matched = 0;
  let matchedWithPrice = 0;
  const matchedExamples: string[] = [];
  const matchedNoPrice: string[] = [];
  for (const c of candidates) {
    const sym = norm(c.symbol);
    if (!sym) continue;
    const hit = nseBySymbol.get(sym);
    if (!hit) continue;
    matched++;
    const lp = hit.listingPrice != null ? Number(String(hit.listingPrice).replace(/\s+/g, '')) : NaN;
    if (Number.isFinite(lp) && lp > 0) {
      matchedWithPrice++;
      if (matchedExamples.length < 8)
        matchedExamples.push(`${c.symbol} (${c.segment}) listingPrice=${lp} issue=${hit.issuePrice}`);
    } else {
      if (matchedNoPrice.length < 8) matchedNoPrice.push(`${c.symbol} (${c.segment})`);
    }
  }
  console.log(`\nCandidates matched to an NSE record by symbol: ${matched}/${candidates.length}`);
  console.log(`  ...of those, with usable listingPrice>0: ${matchedWithPrice}`);
  if (matchedExamples.length) console.log('  examples WITH price:\n   - ' + matchedExamples.join('\n   - '));
  if (matchedNoPrice.length) console.log('  examples MATCHED-NO-PRICE:\n   - ' + matchedNoPrice.join('\n   - '));

  console.log('\n' + '='.repeat(80));
  console.log('VERDICT INPUTS: nseHasListingPrice=' + (withListingPrice > 0) +
    `  symbolMatchYield=${matched}  priceYield=${matchedWithPrice}`);
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((e) => {
  console.error('Diagnostic crashed:', e);
  process.exit(1);
});
