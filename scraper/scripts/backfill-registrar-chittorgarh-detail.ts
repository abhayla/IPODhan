/**
 * Backfill: registrar for genuine IPOs from Chittorgarh per-IPO detail pages (B7, #8).
 *
 * WHY: registrar is ~59%. The bulk JSON reports don't carry it; it lives on the
 * per-IPO detail page under the "IPO Registrar" heading
 * (`<a class="registrar-name">…</a>`). Report 118 (full historical, per-FY JSON)
 * supplies the slug+id DISCOVERY map; we fetch each missing IPO's detail page and
 * extract the registrar via the plausibility-gated `extractRegistrarFromDetailHtml`.
 *
 * CORRECTIVE backfill (allotment/lot-backfill precedent): normalizer-match to
 * EXISTING genuine IPOs, fill registrar ONLY where currently NULL — never overwrites
 * (admin edits stay), never creates a row. Real data only; an absent/placeholder
 * registrar is skipped, never faked.
 *
 * dry-run by default; --apply writes. --limit N caps detail fetches (testing).
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 PORT=15432 + creds).
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { extractRegistrarFromDetailHtml } from '../src/scrapers/chittorgarh-detail-fields.js';
import { fillDiscoveryGapsFromReport82 } from './lib/chittorgarh-report82-discovery.js';
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
  console.log(`REGISTRAR BACKFILL (Chittorgarh detail pages via report-118 discovery) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
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
  console.log(`discovery map (report 118, historical): ${discovery.size} IPOs`);

  // Report 82 fallback (P3-7, T-293) — same root cause + fix as the
  // sibling lot-size backfill: report 118 misses not-yet-open IPOs.
  const report82Added = await fillDiscoveryGapsFromReport82(
    discovery,
    normalizeCompanyNameForMatching,
    (cat, err) => logger.warn({ cat, error: err instanceof Error ? err.message : String(err) }, 'report 82 fallback fetch failed (continuing)')
  );
  console.log(`discovery map (+ report 82 upcoming-issue fallback, +${report82Added}): ${discovery.size} IPOs`);

  const candidates = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName })
    .from(schema.ipos)
    .where(and(eq(schema.ipos.offeringType, 'IPO'), isNull(schema.ipos.registrar)));
  console.log(`genuine IPOs with NULL registrar: ${candidates.length}`);

  const matched = candidates
    .map((c) => ({ ...c, disc: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((c): c is typeof c & { disc: DiscoveryEntry } => !!c.disc);
  console.log(`matched to a Chittorgarh detail URL: ${matched.length} (unmatched: ${candidates.length - matched.length})`);

  const plans: Array<{ id: string; name: string; registrar: string; url: string }> = [];
  let fetched = 0, noReg = 0;
  for (const c of matched) {
    if (fetched >= LIMIT) break;
    fetched++;
    const html = await fetchDetailHtml(c.disc.slug, c.disc.id);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600));
    if (!html) { noReg++; continue; }
    const registrar = extractRegistrarFromDetailHtml(html);
    if (!registrar) { noReg++; logger.debug({ company: c.companyName }, 'registrar not found'); continue; }
    plans.push({ id: c.id, name: c.companyName, registrar, url: `/ipo/${c.disc.slug}/${c.disc.id}/` });
  }
  console.log(`\nregistrar extracted for: ${plans.length} | detail had no registrar: ${noReg} | detail-fetched: ${fetched}`);
  for (const p of plans.slice(0, 12)) console.log(`  - ${p.name} -> ${p.registrar}  (${p.url})`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${plans.length} registrar values WOULD be filled. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  let written = 0, failed = 0;
  for (const p of plans) {
    try {
      await db
        .update(schema.ipos)
        .set({ registrar: p.registrar })
        .where(and(eq(schema.ipos.id, p.id), isNull(schema.ipos.registrar)));
      written++;
      logger.info({ company: p.name, registrar: p.registrar }, 'registrar filled');
    } catch (err) {
      failed++;
      logger.error({ company: p.name, error: err instanceof Error ? err.message : String(err) }, 'registrar update failed');
    }
  }
  console.log(`\nAPPLY complete: written=${written} failed=${failed}`);
  console.log('='.repeat(80));
  process.exit(failed > written ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'registrar detail backfill crashed');
  console.error(e);
  process.exit(1);
});
