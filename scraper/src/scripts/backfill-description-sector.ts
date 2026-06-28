#!/usr/bin/env tsx
/**
 * Backfill: company_description (+ sector carry-through) from Chittorgarh detail
 * pages (GitHub #69).
 *
 * company_description and sector are 0/285 for genuine IPOs: neither had a
 * field-priority-matrix entry, so consolidation silently dropped them. This run
 * adds the matrix entries (see field-priority-matrix.ts) AND fills
 * company_description from the Chittorgarh detail "About" block (id=ipoSummary)
 * via the plausibility-gated extractCompanyDescriptionFromDetailHtml.
 *
 * sector: NSE is the intended source (nse-api-client reads it; now carried through
 * via the matrix entry). Chittorgarh's detail page exposes only a numeric industry
 * CODE, not a clean name, so sector VALUE backfill from CG is out of scope here —
 * the matrix entry + NSE carry-through is the structural fix (see #69 sub-issue).
 *
 * Writes via upsertIPO (write-path SSOT) — NEVER a direct db.update (contract).
 * DRY-RUN by default; --execute persists. --limit N caps detail fetches.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { IPORepository } from '@ipodhan/shared/repositories/ipo-repository';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { upsertIPO } from '../services/data-persister.js';
import { extractCompanyDescriptionFromDetailHtml } from '../scrapers/chittorgarh-detail-fields.js';
import { buildDescriptionScrapedIPO, type DescBackfillIpo } from '../services/description-backfill.js';
import logger from '../utils/logger.js';

const EXECUTE = process.argv.includes('--execute');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
];

async function fetchReport118(year: number, range: string): Promise<any[]> {
  const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/${year}/${range}/0/all/0?search=&v=15-11`;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://www.chittorgarh.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`report 118 HTTP ${r.status}`);
  const d: any = await r.json();
  return d?.reportTableData ?? [];
}

async function fetchDetailHtml(slug: string, id: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.chittorgarh.com/ipo/${slug}/${id}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { logger.warn({ slug, id, status: r.status }, 'detail HTTP error'); return null; }
    return await r.text();
  } catch (err) {
    logger.warn({ slug, id, error: err instanceof Error ? err.message : String(err) }, 'detail fetch failed');
    return null;
  }
}

async function main() {
  console.log('='.repeat(72));
  console.log(`DESCRIPTION BACKFILL (Chittorgarh detail "About") — ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} (#69)`);
  console.log('='.repeat(72));

  // Discovery: name -> {slug,id}
  const discovery = new Map<string, { slug: string; id: string }>();
  for (const fy of FISCAL_YEARS) {
    try {
      const rows = await fetchReport118(fy.year, fy.range);
      for (const row of rows) {
        const name = row?.Company ? String(row.Company) : '';
        const slug = row?.['~urlrewrite_folder_name'] ? String(row['~urlrewrite_folder_name']) : '';
        const id = row?.['~id'] != null ? String(row['~id']) : '';
        if (!name || !slug || !id) continue;
        const key = normalizeCompanyNameForMatching(name);
        if (key && !discovery.has(key)) discovery.set(key, { slug, id });
      }
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      logger.warn({ fy: fy.range, error: err instanceof Error ? err.message : String(err) }, 'report 118 fetch failed (continuing)');
    }
  }
  console.log(`discovery map: ${discovery.size} IPOs`);

  // Candidates: genuine IPOs missing company_description.
  const candidates = (await db
    .select({
      id: schema.ipos.id, companyName: schema.ipos.companyName, slug: schema.ipos.slug,
      symbol: schema.ipos.symbol, isin: schema.ipos.isin, segment: schema.ipos.segment,
      offeringType: schema.ipos.offeringType, status: schema.ipos.status, openDate: schema.ipos.openDate, closeDate: schema.ipos.closeDate,
      listingDate: schema.ipos.listingDate, issueSize: schema.ipos.issueSize, sector: schema.ipos.sector,
      companyDescription: schema.ipos.companyDescription,
    })
    .from(schema.ipos)
    .where(and(eq(schema.ipos.offeringType, 'IPO'), or(isNull(schema.ipos.companyDescription), eq(schema.ipos.companyDescription, ''))))) as DescBackfillIpo[];
  console.log(`genuine IPOs with NULL/empty company_description: ${candidates.length}`);

  const matched = candidates
    .map((c) => ({ c, disc: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((x): x is { c: DescBackfillIpo; disc: { slug: string; id: string } } => !!x.disc);
  console.log(`matched to a detail URL: ${matched.length}`);

  const redis = getRedisClient();
  const ipoRepo = new IPORepository(db, redis);
  let fetched = 0, extracted = 0, written = 0, errors = 0, noDesc = 0;
  const samples: string[] = [];

  for (const { c, disc } of matched) {
    if (fetched >= LIMIT) break;
    fetched++;
    try {
      const html = await fetchDetailHtml(disc.slug, disc.id);
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));
      if (!html) { noDesc++; continue; }
      const description = extractCompanyDescriptionFromDetailHtml(html);
      if (!description) { noDesc++; continue; }
      extracted++;
      if (samples.length < 12) samples.push(`${c.companyName}: ${description.slice(0, 80)}…`);

      if (EXECUTE) {
        const scraped = buildDescriptionScrapedIPO(c, description);
        await upsertIPO(ipoRepo, scraped, 'CHITTORGARH');
        written++;
      } else {
        logger.info({ company: c.companyName, len: description.length }, '[DRY-RUN] would set company_description');
      }
    } catch (err) {
      errors++;
      logger.warn({ company: c.companyName, error: err instanceof Error ? err.message : String(err) }, 'row failed (continuing)');
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log(`Mode:        ${EXECUTE ? 'EXECUTE' : 'DRY-RUN (no writes)'}`);
  console.log(`Candidates:  ${candidates.length}  Matched: ${matched.length}  Fetched: ${fetched}`);
  console.log(`Extracted:   ${extracted}   No description on page: ${noDesc}   Errors: ${errors}`);
  if (EXECUTE) console.log(`Written:     ${written}`);
  console.log('Samples:');
  for (const s of samples) console.log('  ' + s);
  console.log('='.repeat(72) + '\n');
  process.exit(0);
}

main().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'description backfill failed');
  process.exit(1);
});
