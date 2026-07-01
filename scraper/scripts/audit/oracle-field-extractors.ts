/**
 * Stage-0 oracle field extractors (pure html -> value functions).
 *
 * These parse the per-IPO field set out of an oracle detail page's HTML. They are
 * deliberately SEPARATE from the write-path scrapers: this is a read-only audit
 * harness, never a persistence path (see .claude/rules/scraper-write-path.md — no
 * scraped value flows to the DB from here).
 *
 * REUSE: for the fields Chittorgarh already has proven, validated extractors
 * (lot size, registrar, issue size) we import them from
 * `../../src/scrapers/chittorgarh-detail-fields.js` rather than re-implement. The
 * remaining fields use a label-anchored plain-text scan that works across both
 * oracles' markup.
 *
 * HONESTY GATE: every extractor returns `null` when the value is absent or fails a
 * domain-plausibility bound. A missing value is NEVER fabricated — the caller maps
 * a null from BOTH oracles to SOURCE-UNAVAILABLE.
 *
 * NOTE (2026-07-01): chittorgarh.com is unreachable from the current build
 * environment (connect timeout on both www + webnodejs hosts), so the label
 * patterns below are authored from the known Chittorgarh/Moneycontrol detail-page
 * layout but are UNVERIFIED against live markup in this session. Freeze a fixture
 * (see fixtures/README.md) on a network that can reach the oracles to lock them in.
 */

import {
  extractLotSizeFromDetailHtml,
  extractRegistrarFromDetailHtml,
  extractIssueSizeRupeesFromDetailHtml,
} from '../../src/scrapers/chittorgarh-detail-fields.js';

/** The normalized field set the cross-check compares per IPO. */
export interface OracleFields {
  companyName: string | null;
  issueSizeCr: number | null; // ₹ crore
  priceMin: number | null; // ₹ per share
  priceMax: number | null;
  lotSize: number | null; // shares per lot
  faceValue: number | null; // ₹
  openDate: string | null; // ISO YYYY-MM-DD
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  subscriptionTotal: number | null; // times
  subscriptionQIB: number | null;
  subscriptionNII: number | null;
  subscriptionRetail: number | null;
  gmp: number | null; // ₹
  listingPrice: number | null; // ₹ day-1 close/price
  listingGainPct: number | null; // %
  registrar: string | null;
  sector: string | null;
}

export type OracleFieldKey = keyof OracleFields;

export const EMPTY_FIELDS: OracleFields = {
  companyName: null,
  issueSizeCr: null,
  priceMin: null,
  priceMax: null,
  lotSize: null,
  faceValue: null,
  openDate: null,
  closeDate: null,
  allotmentDate: null,
  listingDate: null,
  subscriptionTotal: null,
  subscriptionQIB: null,
  subscriptionNII: null,
  subscriptionRetail: null,
  gmp: null,
  listingPrice: null,
  listingGainPct: null,
  registrar: null,
  sector: null,
};

// ---------------------------------------------------------------------------
// plain-text helpers
// ---------------------------------------------------------------------------

/** Strip tags + decode the entities we care about, collapse whitespace. */
export function plainText(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8377;|&rupee;/gi, '₹')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date the oracles publish in mixed formats ("April 28, 2025",
 * "28 Apr 2025", "28-Apr-2025", "2025-04-28") to ISO YYYY-MM-DD. Returns null on
 * anything unrecognised — never guesses a partial date.
 */
export function parseOracleDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // ISO already
  let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // "Month DD, YYYY"
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return isoParts(+m[3], mo, +m[2]);
  }
  // "DD Mon YYYY" / "DD-Mon-YYYY"
  m = s.match(/\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](20\d{2})\b/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return isoParts(+m[3], mo, +m[1]);
  }
  // "DD/MM/YYYY"
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m) return isoParts(+m[3], +m[2], +m[1]);
  return null;
}

function isoParts(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Grab the text that follows a label in the page's plain text, bounded to a short
 * window so we don't drag in the next section. Returns the raw slice (caller
 * parses), or null when the label is absent.
 */
function afterLabel(text: string, label: RegExp, window = 60): string | null {
  const re = new RegExp(label.source + '\\s*:?\\s*([\\s\\S]{0,' + window + '})', label.flags.replace('g', '') + 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// per-field extractors (label-anchored, plausibility-gated)
// ---------------------------------------------------------------------------

/** ₹Cr issue size — prefer the proven Chittorgarh HTML extractor, else text scan. */
function extractIssueSizeCr(html: string, text: string): number | null {
  const rupees = extractIssueSizeRupeesFromDetailHtml(html);
  if (rupees != null) return +(rupees / 1e7).toFixed(2);
  const slice = afterLabel(text, /(?:Total\s+)?Issue\s+Size/, 40);
  const cr = num(slice);
  if (cr == null) return null;
  return cr >= 1 && cr <= 500000 ? cr : null;
}

/** "₹304 to ₹321 per share" -> [304, 321]; also handles "₹304 - ₹321". */
function extractPriceBand(text: string): [number | null, number | null] {
  const slice = afterLabel(text, /Price\s+Band/, 50) ?? afterLabel(text, /IPO\s+Price/, 50);
  if (!slice) return [null, null];
  const m = slice.match(/₹?\s*([\d,]+(?:\.\d+)?)\s*(?:to|-|–|—)\s*₹?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) {
    // single fixed price ("₹120 per share")
    const one = slice.match(/₹\s*([\d,]+(?:\.\d+)?)/);
    const v = num(one?.[1]);
    return gatePrice(v) ? [v, v] : [null, null];
  }
  const lo = num(m[1]);
  const hi = num(m[2]);
  if (!gatePrice(lo) || !gatePrice(hi) || (lo as number) > (hi as number)) return [null, null];
  return [lo, hi];
}
const gatePrice = (v: number | null): boolean => v != null && v >= 1 && v <= 100000;

/** "Face Value ₹1 per share" -> 1 */
function extractFaceValue(text: string): number | null {
  const slice = afterLabel(text, /Face\s+Value/, 30);
  const v = num(slice);
  return v != null && v > 0 && v <= 10000 ? v : null;
}

/** IPO open/close from an "IPO Date <open> to <close>" or discrete labels. */
function extractOpenClose(text: string): [string | null, string | null] {
  // Range form: "IPO Date April 28, 2025 to April 30, 2025"
  const range = afterLabel(text, /IPO\s+(?:Open\s+)?Date/, 70);
  if (range) {
    const parts = range.split(/\bto\b/i);
    if (parts.length >= 2) {
      const o = parseOracleDate(parts[0]);
      const c = parseOracleDate(parts[1]);
      if (o || c) return [o, c];
    }
    const single = parseOracleDate(range);
    if (single) {
      const close = parseOracleDate(afterLabel(text, /IPO\s+Close\s+Date/, 40) ?? '');
      return [single, close];
    }
  }
  return [
    parseOracleDate(afterLabel(text, /(?:IPO\s+)?Open\s+Date/, 40) ?? ''),
    parseOracleDate(afterLabel(text, /(?:IPO\s+)?Clos(?:e|ing)\s+Date/, 40) ?? ''),
  ];
}

function extractDate(text: string, label: RegExp): string | null {
  return parseOracleDate(afterLabel(text, label, 40) ?? '');
}

/** Subscription "N.NN times" beside a QIB/NII/Retail/Total label. */
function extractSubscription(text: string, label: RegExp): number | null {
  const slice = afterLabel(text, label, 30);
  if (!slice) return null;
  const m = slice.match(/([\d,]+(?:\.\d+)?)\s*(?:x|times)?/i);
  const v = num(m?.[1]);
  return v != null && v >= 0 && v <= 100000 ? v : null;
}

/** Sector/Industry label. */
function extractSector(text: string): string | null {
  const slice = afterLabel(text, /(?:Sector|Industry)/, 40);
  if (!slice) return null;
  const s = slice.split(/[|•\d]/)[0].replace(/[^A-Za-z &,-]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length >= 3 && s.length <= 60 && /[A-Za-z]/.test(s) ? s : null;
}

/** Company name from the page <h1> (fallback to a "<Name> IPO" title). */
function extractCompanyName(html: string): string | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const raw = h1 ? plainText(h1) : null;
  if (!raw) return null;
  const name = raw.replace(/\bIPO\b.*$/i, '').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 120 ? name : null;
}

/**
 * Extract the full oracle field set from a detail page's HTML.
 *
 * @param html   raw HTML of the oracle detail page
 * @param source 'chittorgarh' | 'moneycontrol' — enables source-specific reuse
 *               (Chittorgarh gets the proven lot/registrar HTML extractors)
 */
export function extractOracleFields(html: string | null, source: string): OracleFields {
  const out: OracleFields = { ...EMPTY_FIELDS };
  if (!html) return out;
  const text = plainText(html);

  out.companyName = extractCompanyName(html);
  out.issueSizeCr = extractIssueSizeCr(html, text);
  const [pmin, pmax] = extractPriceBand(text);
  out.priceMin = pmin;
  out.priceMax = pmax;
  out.faceValue = extractFaceValue(text);
  const [open, close] = extractOpenClose(text);
  out.openDate = open;
  out.closeDate = close;
  out.allotmentDate = extractDate(text, /(?:Basis\s+of\s+Allotment|Allotment\s+Date)/);
  out.listingDate = extractDate(text, /(?:IPO\s+)?Listing\s+Date/);
  out.subscriptionTotal = extractSubscription(text, /Total\s+Subscription|Overall\s+Subscription/);
  out.subscriptionQIB = extractSubscription(text, /QIB/);
  out.subscriptionNII = extractSubscription(text, /NII|Non[-\s]?Institutional/);
  out.subscriptionRetail = extractSubscription(text, /Retail|RII\b/);
  out.sector = extractSector(text);

  if (source === 'chittorgarh') {
    // Reuse the validated write-path extractors for these three.
    out.lotSize = extractLotSizeFromDetailHtml(html);
    out.registrar = extractRegistrarFromDetailHtml(html);
  } else {
    const lot = num(afterLabel(text, /Lot\s+Size/, 30));
    out.lotSize = lot != null && lot > 1 && lot <= 1_000_000 ? lot : null;
    const reg = afterLabel(text, /Registrar/, 60);
    const regName = reg ? reg.split(/[|•]/)[0].replace(/\s+/g, ' ').trim() : null;
    out.registrar = regName && regName.length >= 3 && regName.length <= 120 && /[A-Za-z]/.test(regName) ? regName : null;
  }

  // gmp + listingPrice/gain are NOT reliably on the detail page for either oracle
  // (Chittorgarh GMP + listing live on separate report pages). Leave null here;
  // the cross-check fills listingPrice/gain from the Chittorgarh listing report.
  return out;
}
