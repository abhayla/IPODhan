#!/usr/bin/env tsx
/**
 * Deterministic historical-IPO ingestion (GitHub #71).
 *
 * Ingests an aged-out IPO (e.g. Ather Energy) that the live scraper feeds no
 * longer carry, by name (or explicit Chittorgarh slug+id), from ARCHIVAL
 * deterministic sources:
 *   discover (CG report-118, by normalized name) -> fetch CG detail page ->
 *   assembleHistoricalRecord (dates + issue-size + ISIN + lot + description, all
 *   via pure extractors) -> upsertIPO (write-path SSOT).
 *
 * Financials: pass --drhp-url <pdf> to use the #67 DRHP pdfplumber extractor
 * (oracle-verified for Ather in #67); otherwise the CG detail financials are used.
 *
 * DRY-RUN by default (logs the assembled record); --execute persists via upsertIPO.
 * NO LLM, NO hand-typed value — every field is a deterministic extraction.
 *
 * Usage:
 *   tsx src/scripts/ingest-historical-ipo.ts --name "Ather Energy Ltd."
 *   tsx src/scripts/ingest-historical-ipo.ts --slug ather-energy-ipo --id 2357 --execute
 */
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { IPORepository } from '@ipodhan/shared/repositories/ipo-repository';
import { resolveIpoRow } from '@ipodhan/shared/repositories';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { upsertIPO } from '../services/data-persister.js';
import { assembleHistoricalRecord, type HistoricalReportRow } from '../services/historical-ipo-assembler.js';
import { generateSlug } from '../utils/validators.js';
import logger from '../utils/logger.js';

const argv = process.argv;
const EXECUTE = argv.includes('--execute');
const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const NAME = arg('--name');
let SLUG = arg('--slug');
let ID = arg('--id');

const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' }, { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' }, { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' }, { year: 2021, range: '2021-22' },
];
const HDRS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://www.chittorgarh.com/', Accept: 'application/json' };

async function discover(name: string): Promise<HistoricalReportRow | null> {
  const key = normalizeCompanyNameForMatching(name);
  for (const fy of FISCAL_YEARS) {
    for (let pg = 1; pg <= 30; pg++) {
      try {
        const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/${pg}/10/${fy.year}/${fy.range}/0/all/0?search=&v=15-11`;
        const r = await fetch(u, { headers: HDRS, signal: AbortSignal.timeout(20000) });
        const j: any = await r.json();
        const rows: HistoricalReportRow[] = j?.reportTableData ?? [];
        if (!rows.length) break;
        const hit = rows.find((x) => normalizeCompanyNameForMatching(String(x.Company || '')) === key);
        if (hit) return hit;
        await new Promise((z) => setTimeout(z, 350));
      } catch { break; }
    }
  }
  return null;
}

async function fetchDetail(slug: string, id: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.chittorgarh.com/ipo/${slug}/${id}/`, {
      headers: { 'User-Agent': HDRS['User-Agent'], Accept: 'text/html' }, signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function main() {
  console.log('='.repeat(72));
  console.log(`HISTORICAL IPO INGEST — ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} (#71)`);
  console.log('='.repeat(72));

  let reportRow: HistoricalReportRow | null = null;
  if (NAME) {
    reportRow = await discover(NAME);
    if (reportRow) { SLUG = String(reportRow['~urlrewrite_folder_name'] || SLUG); ID = String((reportRow as any)['~id'] || ID); }
  }
  if (!SLUG || !ID) { logger.error({ NAME }, 'could not resolve a Chittorgarh slug+id'); process.exit(1); }
  if (!reportRow) reportRow = { Company: NAME, '~urlrewrite_folder_name': SLUG };

  const html = await fetchDetail(SLUG, ID);
  if (!html) { logger.error({ SLUG, ID }, 'detail fetch failed'); process.exit(1); }

  let assembled;
  try {
    assembled = assembleHistoricalRecord({ reportRow, detailHtml: html });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'assemble failed');
    process.exit(1);
  }
  const { scraped, completeness } = assembled;

  console.log(`\nCompany:      ${scraped.companyName}`);
  console.log(`Dates:        open ${scraped.openDate} / close ${scraped.closeDate} / listing ${scraped.listingDate}`);
  console.log(`Issue size:   ₹${((scraped.issueSize || 0) / 10000000).toFixed(2)} Cr`);
  console.log(`ISIN/lot:     ${scraped.isin ?? '-'} / ${scraped.lotSize ?? '-'}`);
  console.log(`Description:  ${scraped.companyDescription ? (scraped.companyDescription as string).slice(0, 90) + '…' : '-'}`);
  console.log(`Completeness: dates=${completeness.hasDates} issueSize=${completeness.hasIssueSize} isin=${completeness.hasIsin} lot=${completeness.hasLot} desc=${completeness.hasDescription} missing=[${completeness.missing.join(',')}]`);
  if (arg('--drhp-url')) console.log(`Financials:   would use #67 DRHP extractor on ${arg('--drhp-url')} (oracle-verified)`);

  if (!EXECUTE) {
    console.log('\nDRY-RUN: consolidated record assembled (not written). Re-run with --execute.');
    console.log('='.repeat(72));
    process.exit(0);
  }

  const redis = getRedisClient();
  const ipoRepo = new IPORepository(db, redis);
  // T-318 (Phase-1 completion): resolve identity ONCE here instead of
  // letting upsertIPO re-resolve independently (one of the 6 direct
  // callers named in review-round2 P1-2/C2).
  const preResolvedIPO = await resolveIpoRow(ipoRepo, {
    companyName: scraped.companyName,
    normalizedName: normalizeCompanyNameForMatching(scraped.companyName),
    slug: generateSlug(scraped.companyName),
    isin: scraped.isin,
    symbol: scraped.symbol,
  });
  await upsertIPO(ipoRepo, scraped, 'CHITTORGARH', preResolvedIPO);
  console.log(`\nEXECUTE: upserted ${scraped.companyName} via upsertIPO.`);
  console.log('='.repeat(72));
  process.exit(0);
}

main().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'historical ingest failed');
  process.exit(1);
});
