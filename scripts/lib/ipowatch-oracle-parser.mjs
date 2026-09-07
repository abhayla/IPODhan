// Pure HTML parsers for ipowatch.in — the T-472 non-ingested oracle for
// a_b_live_conflict (scripts/audit-detection-floor.mjs). ipowatch.in is not a
// scraper source (scraper/src/scrapers only reads NSE/BSE/Moneycontrol/
// Chittorgarh/InvestorGain — see field-priority-matrix.ts), so comparing our
// published fields against it is a genuine independent check — unlike the
// Chittorgarh oracle a_b_live_conflict used before T-472, which the scraper
// itself ingests and therefore proves nothing about a scraper defect.
//
// Every function here is PURE (string in, data out, no fetch/fs/clock) so it
// is unit-testable against a real captured fixture without a network call —
// same convention as scripts/lib/detection-floor-checks.mjs.

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '-')
    .replace(/&amp;/g, '&')
    .trim();
}

function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the "Upcoming Mainboard IPO" + "Upcoming SME IPO" tables on
 * https://ipowatch.in/upcoming-ipo-list/ into {companyName, detailUrl} pairs.
 * These are the only two tables shaped `<td class="column-1"><a href=...>`
 * on that page — every live (OPEN/UPCOMING) IPO the site tracks has a row here.
 */
export function parseIpowatchListIndex(html) {
  const out = [];
  const rowRe = /<td class="column-1"><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    out.push({ companyName: decodeEntities(m[2]), detailUrl: m[1] });
  }
  return out;
}

// "₹104 Per Share" (fixed-price issue) -> min=max=104.
// "₹71 to ₹75 Per Share" (book-built) -> min=71, max=75.
// "₹[.] to ₹[.] Per Share" (not priced yet) -> null, null.
export function parsePriceBand(raw) {
  if (!raw || /\[\.\]/.test(raw)) return { min: null, max: null };
  const rangeM = raw.match(/₹\s*([\d,]+(?:\.\d+)?)\s*to\s*₹\s*([\d,]+(?:\.\d+)?)/i);
  if (rangeM) return { min: toNumber(rangeM[1]), max: toNumber(rangeM[2]) };
  const singleM = raw.match(/₹\s*([\d,]+(?:\.\d+)?)/);
  if (singleM) {
    const v = toNumber(singleM[1]);
    return { min: v, max: v };
  }
  return { min: null, max: null };
}

// "Approx ₹40.88 Crores" -> 408800000 rupees. "Approx ₹[.] Crores" -> null.
export function parseRupeeAmount(raw) {
  if (!raw || /\[\.\]/.test(raw)) return null;
  const croreM = raw.match(/₹\s*([\d,]+(?:\.\d+)?)\s*Cr(?:ore)?s?/i);
  if (croreM) return toNumber(croreM[1]) * 1_00_00_000;
  const lakhM = raw.match(/₹\s*([\d,]+(?:\.\d+)?)\s*Lakh?s?/i);
  if (lakhM) return toNumber(lakhM[1]) * 1_00_000;
  return null;
}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};

// "September 9, 2026" -> UTC midnight for that calendar day, built from the
// Y/M/D parts rather than `new Date(raw)`. `new Date('September 9, 2026')` is
// LOCAL-TIME parsing (implementation-defined for non-ISO strings): on a UTC
// box it returns 2026-09-09T00:00:00Z, but on an IST box it returns
// 2026-09-08T18:30:00Z — a different calendar day once compared via
// `.toISOString().slice(0,10)` (how valuesDisagree compares dates). A nightly
// cron and a laptop dev run must never disagree with each other about what
// day ipowatch published; only the explicit Y/M/D construction guarantees that.
export function parseIpowatchDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  const ms = Date.UTC(year, month, day);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const KEY_FACTS_START = /<figure class="wp-block-table has-medium-font-size"><table><tbody><tr><td>IPO Open Date<\/td>[\s\S]*?<\/figure>/;

function extractRow(block, label) {
  const re = new RegExp(`<td>${label}<\\/td><td>([^<]*)<\\/td>`);
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/**
 * Parses one ipowatch.in IPO detail page (e.g. https://ipowatch.in/<slug>-ipo/)
 * into the six fields the a_b_live_conflict check compares.
 *
 * Returns null when the key-facts block itself is missing — a structural
 * failure (wrong page, site redesign, 404 rendered as 200) that the caller
 * MUST treat as UNVERIFIABLE for this company, never as "fields absent, skip".
 *
 * Lot size lives in an FAQ answer, not the key-facts table, and ipowatch's
 * "related IPOs" sidebar widget duplicates OTHER companies' FAQ text earlier
 * in the same HTML document (verified against the captured Infrax Renewable
 * fixture: a "Q-Line Biotech" lot-size answer appears BEFORE the key-facts
 * block, the page's own answer AFTER it) — so lot size is read from the
 * first "minimum bid is N Shares" match AT OR AFTER the key-facts block, not
 * the first match in the whole document.
 */
export function parseIpowatchDetail(html) {
  const blockMatch = html.match(KEY_FACTS_START);
  if (!blockMatch) return null;
  const block = blockMatch[0];
  const blockEnd = blockMatch.index + block.length;

  const openDate = parseIpowatchDate(extractRow(block, 'IPO Open Date'));
  const closeDate = parseIpowatchDate(extractRow(block, 'IPO Close Date'));
  const { min: priceRangeMin, max: priceRangeMax } = parsePriceBand(extractRow(block, 'IPO Price Band'));
  const issueSize = parseRupeeAmount(extractRow(block, 'Issue Size'));

  let lotSize = null;
  const lotRe = /minimum bid is\s*(?:&nbsp;)?\s*([\d,]+)\s*Shares/i;
  const lotM = lotRe.exec(html.slice(blockEnd));
  if (lotM) lotSize = toNumber(lotM[1]);

  return { openDate, closeDate, priceRangeMin, priceRangeMax, lotSize, issueSize };
}
