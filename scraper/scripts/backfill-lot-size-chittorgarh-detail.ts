/**
 * Backfill: lot_size for genuine IPOs from Chittorgarh per-IPO detail pages (B7, #8).
 *
 * WHY: lot_size is ~71%. No bulk Chittorgarh JSON report carries it (report 118 is
 * timetable-only despite its name; report 82's HTML list is now SPA/empty). Lot size
 * lives ONLY on the per-IPO detail page (`/ipo/<slug>/<id>/`). Report 118 (full
 * historical, per-fiscal-year JSON) provides the slug+id DISCOVERY map; we then fetch
 * each missing IPO's detail page and extract lot via the plausibility-gated
 * `extractLotSizeFromDetailHtml`.
 *
 * CORRECTIVE backfill (allotment-backfill precedent): matches report rows to EXISTING
 * genuine IPOs by the canonical normalizer, fills lot_size ONLY where currently NULL —
 * never overwrites (admin edits stay), never creates a row (no pollution). Real data
 * only; an implausible/absent lot is skipped, never faked.
 *
 * dry-run by default; --apply writes. --limit N caps detail fetches (testing).
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 PORT=15432 + creds).
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { extractLotSizeFromDetailHtml } from '../src/scrapers/chittorgarh-detail-fields.js';
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
  console.log(`LOT-SIZE BACKFILL (Chittorgarh detail pages via report-118 discovery) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  // 1. Build normalizedName -> {slug,id} discovery map from report 118 (full historical).
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

  // 2. Genuine IPOs missing lot_size.
  const candidates = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName })
    .from(schema.ipos)
    .where(and(eq(schema.ipos.offeringType, 'IPO'), isNull(schema.ipos.lotSize)));
  console.log(`genuine IPOs with NULL lot_size: ${candidates.length}`);

  // 3. Match to a detail URL.
  const matched = candidates
    .map((c) => ({ ...c, disc: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((c): c is typeof c & { disc: DiscoveryEntry } => !!c.disc);
  console.log(`matched to a Chittorgarh detail URL: ${matched.length} (unmatched: ${candidates.length - matched.length})`);

  // 4. Fetch detail + extract lot (plausibility-gated).
  const plans: Array<{ id: string; name: string; lot: number; url: string }> = [];
  let fetched = 0, noLot = 0;
  for (const c of matched) {
    if (fetched >= LIMIT) break;
    fetched++;
    const html = await fetchDetailHtml(c.disc.slug, c.disc.id);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600)); // rate limit
    if (!html) { noLot++; continue; }
    const lot = extractLotSizeFromDetailHtml(html);
    if (lot == null) { noLot++; logger.debug({ company: c.companyName }, 'lot not found / implausible'); continue; }
    plans.push({ id: c.id, name: c.companyName, lot, url: `/ipo/${c.disc.slug}/${c.disc.id}/` });
  }
  console.log(`\nlot extracted for: ${plans.length} | detail had no plausible lot: ${noLot} | detail-fetched: ${fetched}`);
  for (const p of plans.slice(0, 12)) console.log(`  - ${p.name} -> ${p.lot} shares  (${p.url})`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${plans.length} lot_size values WOULD be filled. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  // 5. Fill only where still NULL (admin-edit / concurrent-write safe).
  let written = 0, failed = 0;
  for (const p of plans) {
    try {
      await db
        .update(schema.ipos)
        .set({ lotSize: p.lot })
        .where(and(eq(schema.ipos.id, p.id), isNull(schema.ipos.lotSize)));
      written++;
      logger.info({ company: p.name, lot: p.lot }, 'lot_size filled');
    } catch (err) {
      failed++;
      logger.error({ company: p.name, error: err instanceof Error ? err.message : String(err) }, 'lot_size update failed');
    }
  }
  console.log(`\nAPPLY complete: written=${written} failed=${failed}`);
  console.log('='.repeat(80));
  process.exit(failed > written ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'lot-size detail backfill crashed');
  console.error(e);
  process.exit(1);
});
