/**
 * Resolve a Chittorgarh per-IPO detail-page URL (T-507, issue #394 fix-round
 * correction).
 *
 * RCA of the correction: `chittorgarh-issue-type-visitor.ts` (PR #367,
 * unmerged as of this writing) built the detail URL as
 * `https://www.chittorgarh.com/ipo/<slugified-company-name>/` — no numeric
 * id. Verified LIVE against the real site while building this fix: that
 * pattern 404s for EVERY company tried, including Ather Energy (the PR's own
 * test fixture's source IPO) — `chittorgarh.com/ipo/ather-energy/` is 404;
 * only `chittorgarh.com/ipo/ather-energy-ipo/2357/` (slug WITH the `-ipo`
 * suffix Chittorgarh's own report rows carry, AND the numeric report id)
 * returns 200. PR #367's real-data proof was never obtained (marked "OWED"
 * in its own PR body) — this is exactly the gap that proof would have
 * caught. This module is the fix: resolve slug+id from Chittorgarh's own
 * report-82 discovery feed (the same report `chittorgarh-scraper.ts` already
 * discovers IPOs from) BEFORE building the URL, never guess a slug shape.
 */
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import logger from '../utils/logger.js';

export interface ChittorgarhDetailRef {
  slug: string;
  id: string;
}

export interface FiscalYear {
  year: number;
  range: string;
}

/** The Indian fiscal year (Apr-Mar) `now` falls in. */
export function currentFiscalYear(): FiscalYear {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { year, range: `${year}-${String((year + 1) % 100).padStart(2, '0')}` };
}

async function fetchReport82Page(
  page: number,
  fy: FiscalYear,
  category: 'mainboard' | 'sme'
): Promise<unknown[]> {
  const url = `https://webnodejs.chittorgarh.com/cloud/report/data-read/82/${page}/10/${fy.year}/${fy.range}/0/${category}/0?search=&v=15-11`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://www.chittorgarh.com/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`report 82 HTTP ${res.status}`);
  const data: { reportTableData?: unknown[] } = await res.json();
  return data?.reportTableData ?? [];
}

/** Every row for one fiscal-year/category, paginated (max 20 pages, stops on an empty page). */
async function fetchReport82(fy: FiscalYear, category: 'mainboard' | 'sme'): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; page <= 20; page++) {
    const pageRows = await fetchReport82Page(page, fy, category);
    if (!pageRows.length) break;
    rows.push(...pageRows);
    await new Promise((r) => setTimeout(r, 250));
  }
  return rows;
}

/** Extract {name,slug,id} from a report-82 row's `Company` anchor href. */
function parseRow(row: unknown): { name: string; slug: string; id: string } | null {
  const r = row as Record<string, unknown> | null;
  const nameHtml = r?.Company ? String(r.Company) : '';
  const slug = r?.['~URLRewrite_Folder_Name'] ? String(r['~URLRewrite_Folder_Name']) : '';
  if (!nameHtml || !slug) return null;
  const idMatch = nameHtml.match(/\/ipo\/[^/"]+\/(\d+)\/["']/);
  if (!idMatch) return null;
  const nameMatch = nameHtml.match(/>([^<]+)<\/a>/);
  const name = (nameMatch ? nameMatch[1] : nameHtml).trim();
  if (!name) return null;
  return { name, slug, id: idMatch[1] };
}

/**
 * Build a normalizedName -> {slug,id} map from Chittorgarh's report-82
 * discovery feed across the given fiscal years (mainboard + SME). A fetch
 * failure for one year/category is logged and skipped — never throws, so one
 * bad fiscal year can't abort discovery for the rest.
 */
export async function buildChittorgarhDiscoveryMap(fiscalYears: FiscalYear[]): Promise<Map<string, ChittorgarhDetailRef>> {
  const map = new Map<string, ChittorgarhDetailRef>();
  for (const fy of fiscalYears) {
    for (const category of ['mainboard', 'sme'] as const) {
      try {
        const rows = await fetchReport82(fy, category);
        let added = 0;
        for (const row of rows) {
          const parsed = parseRow(row);
          if (!parsed) continue;
          const key = normalizeCompanyNameForMatching(parsed.name);
          if (key && !map.has(key)) {
            map.set(key, { slug: parsed.slug, id: parsed.id });
            added++;
          }
        }
        logger.debug({ fy: fy.range, category, rows: rows.length, added }, '[chittorgarh-detail-url-resolver] report 82 page fetched');
      } catch (err) {
        logger.warn(
          { fy: fy.range, category, error: err instanceof Error ? err.message : String(err) },
          '[chittorgarh-detail-url-resolver] report 82 fetch failed (continuing)'
        );
      }
    }
  }
  return map;
}

/** The one URL shape that actually resolves — `/ipo/<slug>/<id>/` (verified live). */
export function buildChittorgarhDetailUrlFromRef(ref: ChittorgarhDetailRef): string {
  return `https://www.chittorgarh.com/ipo/${ref.slug}/${ref.id}/`;
}
