/**
 * Backfill: allotment_date for genuine IPOs from Chittorgarh per-IPO detail
 * pages (T-278 P3-3).
 *
 * WHY: allotment_date is ~1% populated. Neither NSE, BSE, nor the bulk
 * Chittorgarh JSON reports ever carry it; the live cron scraper never fetches
 * a per-IPO detail page at all. Moneycontrol only captures it while an IPO
 * sits in its site-side "Closed" bucket — a narrow window many scrape cycles
 * miss entirely — so it stays NULL for most rows even after listing. It lives
 * on the detail page's "IPO Timeline" block under the "Tentative Allotment"
 * keyword-popup, extracted deterministically by
 * `extractAllotmentDateFromDetailHtml` (real page shape, plausibility-gated).
 *
 * Registrar-backfill precedent (backfill-registrar-chittorgarh-detail.ts):
 * report-118 (full historical, per-FY JSON) supplies the slug+id DISCOVERY
 * map; we fetch each candidate IPO's detail page and extract the date. Fill
 * ONLY where currently NULL — never overwrites (admin edits stay), never
 * creates a row. Real data only; TBA / unparsable is skipped, never guessed.
 *
 * P3-2 (T-287): OPEN/UPCOMING IPOs are candidates too — Chittorgarh detail
 * pages publish the "Tentative Allotment" date BEFORE the issue closes (e.g.
 * Tempsens, closing 24 Aug, already carries it while still OPEN). The prior
 * assumption that a still-OPEN IPO "correctly has no allotment date to find
 * yet" was wrong; `extractAllotmentDateFromDetailHtml` already handles a
 * genuinely-not-yet-published field safely (returns null, no write), so
 * widening the candidate set costs nothing on rows where the date truly
 * isn't up yet.
 *
 * dry-run by default; --apply writes. --limit N caps detail fetches (testing).
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 PORT=15432 + creds).
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { extractAllotmentDateFromDetailHtml } from '../src/scrapers/chittorgarh-detail-fields.js';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' },
  { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

interface DiscoveryEntry { slug: string; id: string; }

async function fetchReport118(year: number, range: string): Promise<any[]> {
  const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/${year}/${range}/0/all/0?search=&v=15-11`;
  const r = await fetch(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://www.chittorgarh.com/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`report 118 HTTP ${r.status}`);
  const d: any = await r.json();
  return d?.reportTableData ?? [];
}

async function fetchDetailHtml(slug: string, id: string): Promise<string | null> {
  const u = `https://www.chittorgarh.com/ipo/${slug}/${id}/`;
  try {
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
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
  console.log('='.repeat(80));
  console.log(`ALLOTMENT DATE BACKFILL (Chittorgarh detail pages via report-118 discovery) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const discovery = new Map<string, DiscoveryEntry>();
  for (const fy of FISCAL_YEARS) {
    try {
      const rows = await fetchReport118(fy.year, fy.range);
      let added = 0;
      for (const row of rows) {
        const name = row?.Company ? String(row.Company) : '';
        const slug = row?.['~urlrewrite_folder_name'] ? String(row['~urlrewrite_folder_name']) : '';
        const id = row?.['~id'] != null ? String(row['~id']) : '';
        if (!name || !slug || !id) continue;
        const key = normalizeCompanyNameForMatching(name);
        if (key && !discovery.has(key)) { discovery.set(key, { slug, id }); added++; }
      }
      logger.info({ fy: fy.range, rows: rows.length, added }, 'report 118 page fetched');
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      logger.warn({ fy: fy.range, error: err instanceof Error ? err.message : String(err) }, 'report 118 fetch failed (continuing)');
    }
  }
  console.log(`discovery map (name -> detail url): ${discovery.size} IPOs`);

  // Only genuine IPOs (not corporate actions/InvITs/etc) with no admin edit.
  // P3-2 (T-287): OPEN/UPCOMING are included — source pages publish the
  // tentative allotment date pre-listing (Tempsens shape). The extractor
  // safely returns null (no write) when the field genuinely isn't up yet.
  const candidates = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, status: schema.ipos.status })
    .from(schema.ipos)
    .where(and(
      eq(schema.ipos.offeringType, 'IPO'),
      isNull(schema.ipos.allotmentDate),
    ));
  console.log(`genuine IPOs with NULL allotment_date: ${candidates.length}`);

  const matched = candidates
    .map((c) => ({ ...c, disc: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((c): c is typeof c & { disc: DiscoveryEntry } => !!c.disc);
  console.log(`matched to a Chittorgarh detail URL: ${matched.length} (unmatched: ${candidates.length - matched.length})`);

  const plans: Array<{ id: string; name: string; allotmentDate: string; url: string }> = [];
  let fetched = 0, noDate = 0;
  for (const c of matched) {
    if (fetched >= LIMIT) break;
    fetched++;
    const html = await fetchDetailHtml(c.disc.slug, c.disc.id);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600));
    if (!html) { noDate++; continue; }
    const allotmentDate = extractAllotmentDateFromDetailHtml(html);
    if (!allotmentDate) { noDate++; logger.debug({ company: c.companyName }, 'allotment date not found'); continue; }
    plans.push({ id: c.id, name: c.companyName, allotmentDate, url: `/ipo/${c.disc.slug}/${c.disc.id}/` });
  }
  console.log(`\nallotment date extracted for: ${plans.length} | detail had no date: ${noDate} | detail-fetched: ${fetched}`);
  for (const p of plans.slice(0, 20)) console.log(`  - ${p.name} -> ${p.allotmentDate}  (${p.url})`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${plans.length} allotment_date values WOULD be filled. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  let written = 0, failed = 0;
  for (const p of plans) {
    try {
      await db
        .update(schema.ipos)
        .set({ allotmentDate: p.allotmentDate })
        .where(and(eq(schema.ipos.id, p.id), isNull(schema.ipos.allotmentDate)));
      written++;
      logger.info({ company: p.name, allotmentDate: p.allotmentDate }, 'allotment date filled');
    } catch (err) {
      failed++;
      logger.error({ company: p.name, error: err instanceof Error ? err.message : String(err) }, 'allotment date update failed');
    }
  }
  console.log(`\nAPPLY complete: written=${written} failed=${failed}`);
  console.log('='.repeat(80));
  process.exit(failed > written ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'allotment date detail backfill crashed');
  console.error(e);
  process.exit(1);
});
