/**
 * BSE IPO scraper — JSON API edition.
 *
 * BSE migrated publicissue.html and the IPO detail pages to a JS SPA, breaking
 * the Puppeteer list scraper and the `td.TTRow_left` HTML detail parser. This
 * module sources data from BSE's JSON API instead (the SPA's own backend):
 *   - list:   GET /BseIndiaAPI/api/IPO_HomePageDetail/w   (current board)
 *   - detail: GET /BseIndiaAPI/api/GetMkt_ISSUE_BBS_IPO/w?IPO_NO=<n>  (core fields)
 *
 * Discovered from the SPA bundle: `type=='IPO' → GetMkt_ISSUE_BBS_IPO/w?IPO_NO=`.
 * Headers MUST include Origin/Referer https://www.bseindia.com or BSE 403s.
 */

import logger from '../utils/logger.js';
import { retryWithExponentialBackoff } from '../utils/scraper-utils.js';
import { parseBseParties } from '../services/bse-party-parser.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';

const BSE_API_BASE = 'https://api.bseindia.com/BseIndiaAPI/api/';
const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Origin: 'https://www.bseindia.com',
  Referer: 'https://www.bseindia.com/',
  Accept: 'application/json',
};

export interface BSEListRow {
  Scrip_name: string;
  Start_Dt: string; // "2026-06-11T00:00:00"
  End_Dt: string;
  Status: string; // L / etc.
  IR_flag: string; // "IPO" for genuine IPOs (others are corporate actions, PR #23)
  IR_FLAG_FULL: string; // "Book Building"
  IPO_NO: number;
  Scrip_cd: number;
}

export interface BSEDetailRow {
  IPO_NO: string;
  ScripCode: string;
  ScripName: string;
  Symbol: string;
  Issue_Period: string;
  Issue_Size_No_of_shares: string;
  Price_Band: string; // "120.00-127.00"
  Face_Value: string; // "10.00"
  Market_Lot: string; // "1000"
  Minimum_Bid_Quantity?: string;
  Registrar?: string;
  Book_Running_Lead_Manager?: string;
  Co_Book_Running_Lead_Manager?: string;
  [k: string]: unknown;
}

/** A category row from Pubissues_GetBkbldgCatdem_ng/w (bid demand by category). */
export interface BSESubscriptionRow {
  SRNo: string; // "1" QIB / "2" NII / "3" Retail / "4" Employee / "" Total / "Sr.No." header
  col2: string; // category label
  col5: string; // "No. of times of total meant for the category" (subscription multiple)
  Scripname?: string;
  Maxdt?: string; // "6/15/2026 4:59:06 PM"
  [k: string]: unknown;
}

export interface BSEApiScrapeResult {
  ipos: ScrapedIPO[];
  subscriptions: ScrapedSubscription[];
  errors: string[];
}

/**
 * "120.00-127.00" -> {min:120,max:127}; "95.00" -> {} (T-308: a lone price is
 * NOT a real book-built band -- writing it into both min and max silently
 * collapses a previously-published band once BSE's API stops returning the
 * range at close/listing); ""/"-" -> {}.
 */
export function parsePriceBand(band: string): { min?: number; max?: number } {
  if (!band) return {};
  const parts = band
    .split('-')
    .map((p) => parseFloat(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length !== 2) return {};
  return { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) };
}

/** "2026-06-11T00:00:00" → "2026-06-11"; ""/invalid → null. */
export function parseBSEDate(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Registrar NAME only, capped to the column width.
 *
 * T-403 RC1: the packed-entity format (`Name^address|...|email|contact`, with a
 * literal `#` between MULTIPLE parties) is now parsed in ONE place --
 * `services/bse-party-parser.ts`. The local `cleanBSEEntityName` this used to
 * call split on `^`/`|` but never on `#`, so any field carrying more than one
 * party silently lost every party after the first.
 */
export function parseBSERegistrar(raw?: string): string | null {
  if (!raw) return null;
  const name = parseBseParties({ Registrar: raw }).registrar;
  if (!name) return null;
  return name.length > 100 ? name.slice(0, 100).trim() : name;
}

/**
 * Every lead manager: the BRLM followed by ALL co-BRLMs, in payload order.
 *
 * T-403 RC1 (matrix F17). BSE packs co-managers as
 * `A^...|a@x.com#B^...|b@x.com` -- `#`-separated. The previous implementation
 * stripped the `^` tail FIRST and then split the remainder on `,;/`, so the `#`
 * and everything after it stayed inside the discarded tail: Skyways' three
 * managers (Holani + Shannon + Dolat Finserv) came back as two. Delegating to
 * `parseBseParties` splits on `#` before `^`, fixing every consumer at once.
 */
export function parseLeadManagers(brlm?: string, co?: string): string[] {
  const { leadManagers } = parseBseParties({
    Book_Running_Lead_Manager: brlm ?? null,
    Co_Book_Running_Lead_Manager: co ?? null,
  });

  // LEGACY secondary split, kept deliberately. `#` is the separator BSE actually
  // uses (verified live), and it is the one this function got wrong. But some
  // older BSE rows pack managers into one name segment with `,`/`;`/`/`, and
  // this adapter has split on those since it shipped. Dropping that here would
  // be an unrelated behaviour change smuggled into a bug fix, so the legacy
  // split stays — applied AFTER the `#` split, never instead of it. It lives
  // here rather than in `bse-party-parser.ts`, which stays faithful to the
  // one format the live payload demonstrates.
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of leadManagers) {
    for (const part of name.split(/[,;/]+/).map((x) => x.trim()).filter(Boolean)) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }
  return out;
}

/** Issue size in RUPEES = shares × top-of-band price; 0 if either missing. */
export function computeBSEIssueSize(shares: number, priceMax?: number): number {
  if (!shares || !priceMax || !Number.isFinite(shares) || !Number.isFinite(priceMax)) return 0;
  const v = shares * priceMax;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/**
 * Derive IPO status from the open/close window. BSE's JSON `Status` is an opaque
 * code ('L'), so the window is the reliable signal. `today`/`open`/`close` are
 * 'YYYY-MM-DD' strings (lexicographic compare is correct for that format).
 * LISTED needs a listing date this endpoint doesn't carry, so it is left to
 * other sources / the time-based priority matrix to set.
 */
export function deriveBSEStatus(
  open: string | null,
  close: string | null,
  today: string,
): 'UPCOMING' | 'OPEN' | 'CLOSED' {
  if (!open || !close) return 'UPCOMING';
  if (today < open) return 'UPCOMING';
  if (today > close) return 'CLOSED';
  return 'OPEN';
}

/**
 * Parse BSE's `Issue_Period` ("01 Jun 2026 to 03 Jun 2026") into open/close
 * 'YYYY-MM-DD' strings. A trailing "|extension note" (rights issues carry one)
 * is dropped first. This is the date source for the detail-only (historical)
 * path, where there is no list row to supply Start_Dt/End_Dt.
 */
export function parseIssuePeriod(period: string): { open: string | null; close: string | null } {
  const MONTHS: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const toIso = (d: string): string | null => {
    const m = d.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/);
    if (!m) return null;
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return null;
    return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  };
  if (!period) return { open: null, close: null };
  const cleaned = period.split('|')[0];
  const parts = cleaned.split(/\s+to\s+/i);
  if (parts.length !== 2) return { open: null, close: null };
  return { open: toIso(parts[0]), close: toIso(parts[1]) };
}

/** Shared field extraction for both the list+detail and detail-only mappers. */
function buildScrapedIPO(
  detail: BSEDetailRow,
  companyName: string,
  openDate: string | null,
  closeDate: string | null,
): ScrapedIPO {
  const band = parsePriceBand(detail.Price_Band || '');
  const shares = parseInt(String(detail.Issue_Size_No_of_shares || '0').replace(/[,\s]/g, ''), 10);
  const lot = parseInt(String(detail.Market_Lot || '0').replace(/[,\s]/g, ''), 10);
  const face = Math.round(parseFloat(String(detail.Face_Value || '0')));
  const registrar = parseBSERegistrar(detail.Registrar);
  const leads = parseLeadManagers(detail.Book_Running_Lead_Manager, detail.Co_Book_Running_Lead_Manager);
  const today = new Date().toISOString().split('T')[0];

  return {
    companyName,
    issueSize: computeBSEIssueSize(shares, band.max),
    priceRangeMin: band.min,
    priceRangeMax: band.max,
    openDate: openDate || today,
    closeDate: closeDate || today,
    listingExchange: 'BSE',
    status: deriveBSEStatus(openDate, closeDate, today),
    // BSE's JSON API exposes no segment field (the old HTML scraper read a
    // `platform` column that no longer exists). The IR_flag=IPO board carries
    // both SME and mainboard IPOs, so asserting a segment here mislabels them
    // (e.g. an SME IPO -> MAINBOARD). Leave segment undefined: a source that
    // can't determine a field must not overwrite it (data-persister drops it).
    segment: undefined,
    offeringType: 'IPO',
    lotSize: lot > 0 ? lot : undefined,
    faceValue: face > 0 ? face : undefined,
    registrar,
    leadManagers: leads.length ? leads : null,
    symbol: detail.Symbol?.trim() || null,
  };
}

/** Map a BSE list row + its detail row into a ScrapedIPO (current-board path). */
export function mapBSEToScrapedIPO(list: BSEListRow, detail: BSEDetailRow): ScrapedIPO {
  return buildScrapedIPO(
    detail,
    (list.Scrip_name || detail.ScripName || '').trim(),
    parseBSEDate(list.Start_Dt),
    parseBSEDate(list.End_Dt),
  );
}

/**
 * Map a detail row alone (no list row) into a ScrapedIPO — the historical
 * backfill path (enumerate IPO_NO → detail). Returns null for archive rows that
 * are NOT book-built equity IPOs (empty `Price_Band` → NCD / rights / OFS) or
 * whose `Issue_Period` can't be parsed, so the backfill never imports non-IPOs.
 */
export function mapBSEDetailToScrapedIPO(detail: BSEDetailRow): ScrapedIPO | null {
  const band = parsePriceBand(detail.Price_Band || '');
  if (band.max === undefined) return null; // no price band → not a book-built IPO
  const { open, close } = parseIssuePeriod(detail.Issue_Period || '');
  if (!open || !close) return null;
  const companyName = (detail.ScripName || '').trim();
  if (!companyName) return null;
  return buildScrapedIPO(detail, companyName, open, close);
}

export interface BSEApiSummary {
  ipos: ScrapedIPO[];
  subscriptions: ScrapedSubscription[];
  smeCount: number;
  mainboardCount: number;
}

/**
 * Reduce an API scrape result into the orchestrator's ScrapedData shape plus
 * segment counts. A null/blank segment counts as MAINBOARD (the BSE IPO board
 * default). Subscriptions captured in Stage C are carried through unchanged.
 */
export function summarizeBSEApiResult(result: BSEApiScrapeResult): BSEApiSummary {
  let smeCount = 0;
  let mainboardCount = 0;
  for (const ipo of result.ipos) {
    if (ipo.segment === 'SME') smeCount++;
    else mainboardCount++;
  }
  return { ipos: result.ipos, subscriptions: result.subscriptions, smeCount, mainboardCount };
}

/** Subscription multiple from BSE's `col5`; 0 for blank / non-numeric / negative. */
export function parseSubTimes(v?: string): number {
  const n = parseFloat(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Map BSE bid-demand category rows (Pubissues_GetBkbldgCatdem_ng/w `table2`)
 * into a ScrapedSubscription. Top-level `SRNo` 1/2/3 = QIB/NII/Retail, the
 * `Total` row = total, `col5` = subscription multiple, `Maxdt` = timestamp.
 * Returns null if there are no category data rows (header-only / empty).
 */
export function mapBSESubscription(rows: BSESubscriptionRow[], companyName: string): ScrapedSubscription | null {
  let qib = 0, nii = 0, retail = 0, total = 0;
  let employee: number | undefined;
  let maxdt = '';
  let sawData = false;

  for (const r of rows) {
    const sr = String(r.SRNo ?? '').trim();
    const cat = String(r.col2 ?? '').trim();
    if (cat === 'Category' || sr === 'Sr.No.') continue; // header row
    if (r.Maxdt) maxdt = String(r.Maxdt);
    if (sr === '1') { qib = parseSubTimes(r.col5); sawData = true; }
    else if (sr === '2') { nii = parseSubTimes(r.col5); sawData = true; }
    else if (sr === '3') { retail = parseSubTimes(r.col5); sawData = true; }
    else if (sr === '4') { const e = parseSubTimes(r.col5); if (e > 0) employee = e; }
    else if (cat === 'Total') { total = parseSubTimes(r.col5); sawData = true; }
  }
  if (!sawData) return null;

  const parsed = maxdt ? new Date(maxdt) : new Date();
  const timestamp = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();

  return {
    ipoCompanyName: companyName,
    qibSubscription: qib,
    niiSubscription: nii,
    retailSubscription: retail,
    totalSubscription: total,
    ...(employee !== undefined ? { employeeSubscription: employee } : {}),
    timestamp,
  };
}

async function fetchBSEJson<T>(path: string): Promise<T> {
  const res = await fetch(BSE_API_BASE + path, { headers: BSE_HEADERS });
  if (!res.ok) throw new Error(`BSE API HTTP ${res.status} for ${path}`);
  return (await res.json()) as T;
}

function asArray<T>(j: unknown): T[] {
  if (Array.isArray(j)) return j as T[];
  if (j && typeof j === 'object') {
    const arr = Object.values(j as Record<string, unknown>).find((v) => Array.isArray(v));
    if (arr) return arr as T[];
  }
  return [];
}

/** Fetch + map the bid-demand subscription for one IPO; null if unavailable. */
async function fetchBSESubscription(ipoNo: number, companyName: string): Promise<ScrapedSubscription | null> {
  const subJson = await retryWithExponentialBackoff(
    () => fetchBSEJson<unknown>(`Pubissues_GetBkbldgCatdem_ng/w?IPO_NO=${ipoNo}`),
    3,
    1000,
  );
  return mapBSESubscription(asArray<BSESubscriptionRow>(subJson), companyName);
}

/** Scrape the current BSE IPO board + per-IPO detail + subscription via the JSON API. */
export async function scrapeBSEViaAPI(): Promise<BSEApiScrapeResult> {
  const result: BSEApiScrapeResult = { ipos: [], subscriptions: [], errors: [] };
  try {
    const listJson = await retryWithExponentialBackoff(
      () => fetchBSEJson<unknown>('IPO_HomePageDetail/w'),
      3,
      1000,
    );
    const rows = asArray<BSEListRow>(listJson).filter((r) => (r.IR_flag || '').toUpperCase() === 'IPO');
    logger.info({ total: asArray<BSEListRow>(listJson).length, ipoRows: rows.length }, 'BSE list fetched (JSON API)');

    for (const row of rows) {
      try {
        const detailJson = await retryWithExponentialBackoff(
          () => fetchBSEJson<unknown>(`GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${row.IPO_NO}`),
          3,
          1000,
        );
        const detail = asArray<BSEDetailRow>(detailJson)[0];
        if (!detail) {
          logger.warn({ ipoNo: row.IPO_NO, name: row.Scrip_name }, 'BSE detail empty — skipping');
          continue;
        }
        const ipo = mapBSEToScrapedIPO(row, detail);
        result.ipos.push(ipo);

        // Stage C: best-effort subscription capture (a failure must not drop the IPO).
        try {
          const sub = await fetchBSESubscription(row.IPO_NO, ipo.companyName);
          if (sub) result.subscriptions.push(sub);
        } catch (subErr) {
          const msg = subErr instanceof Error ? subErr.message : String(subErr);
          logger.warn({ ipoNo: row.IPO_NO, error: msg }, 'BSE subscription fetch failed');
          result.errors.push(`subscription ${row.IPO_NO}: ${msg}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ ipoNo: row.IPO_NO, error: msg }, 'BSE detail fetch failed');
        result.errors.push(`detail ${row.IPO_NO}: ${msg}`);
      }
    }
    logger.info(
      { mapped: result.ipos.length, subscriptions: result.subscriptions.length, errors: result.errors.length },
      'BSE API scrape completed',
    );
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ error: msg }, 'BSE API scrape failed');
    result.errors.push(`scrape: ${msg}`);
    return result;
  }
}
