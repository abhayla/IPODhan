/**
 * Pure extractors for the Chittorgarh per-IPO detail page (#8 data-completeness).
 *
 * The bulk Chittorgarh JSON reports do NOT carry lot size — it lives only on the
 * per-IPO detail page (`/ipo/<slug>/<id>/`), rendered as:
 *   <a title="Lot Size" ...>Lot Size</a></span></td>
 *   <td class="text-end"><span class="text-end">400 Shares</span></td>
 *
 * These are pure (html -> value) functions so they unit-test without network and
 * carry an output-plausibility gate: a value outside the domain-sane range is
 * rejected (returns null) rather than persisted.
 */

/** Plausible application-lot bounds for an Indian IPO (mainboard + SME). */
const MIN_LOT = 1;
const MAX_LOT = 1_000_000;

/**
 * Extract the application lot size (shares per lot) from a Chittorgarh detail
 * page. Returns null when not found or implausible. A lot of exactly 1 is
 * rejected (it is the known "lot size unknown" placeholder, mirroring
 * validateLotSize in the scraper validators).
 */
export function extractLotSizeFromDetailHtml(html: string): number | null {
  if (!html) return null;

  // Anchor on the "Lot Size" label, then take the nearest "<N> Shares" value
  // that follows it within the same detail row.
  const m = html.match(/Lot\s*Size\s*<\/a>[\s\S]{0,160}?([\d,]+)\s*Shares/i)
    // Fallback: label without the keyword-popup anchor wrapper.
    ?? html.match(/Lot\s*Size[\s\S]{0,120}?([\d,]+)\s*Shares/i);
  if (!m) return null;

  const lot = parseInt(m[1].replace(/,/g, ''), 10);
  if (!Number.isFinite(lot)) return null;
  if (lot <= MIN_LOT || lot > MAX_LOT) return null; // reject 1 and absurd values
  return lot;
}

/**
 * Extract the IPO registrar from a Chittorgarh detail page. The value is rendered
 * under the "IPO Registrar" heading as:
 *   <a ... class="registrar-name" href="/report/ipo-registrar-review/...">Kfin Technologies Ltd.</a>
 * Returns the whitespace-normalized name, or null when absent/implausible. The
 * report-link variants ("Registrar- List of Issues Managed") are NOT the value
 * and are deliberately not matched (the class="registrar-name" anchor is unique).
 */
export function extractRegistrarFromDetailHtml(html: string): string | null {
  if (!html) return null;

  const m = html.match(/class="registrar-name"[^>]*>([^<]+)<\/a>/i);
  if (!m) return null;

  const name = m[1]
    .replace(/\s+/g, ' ')
    // Fix the common missing-space smell Chittorgarh renders ("Pvt.Ltd." ->
    // "Pvt. Ltd.") so the displayed registrar is canonical (#8 registrar norm).
    .replace(/\bPvt\.(?=[A-Za-z])/g, 'Pvt. ')
    .trim();
  // Plausibility: a real registrar name has letters and a sane length; reject
  // empty, numeric-only, or boilerplate placeholders.
  if (name.length < 3 || name.length > 120) return null;
  if (!/[A-Za-z]/.test(name)) return null;
  if (/^(n\/?a|tbd|tba|-+)$/i.test(name)) return null;
  return name;
}

// ============================================================================
// C3b — financials / peers / objectives from the same Chittorgarh detail page.
//
// The detail page renders three more tables we extract deterministically (NO
// LLM): the restated "Company Financials" table (id="financialTable"), the KPI
// + valuation tables (under the "Key Performance Indicator" heading), the
// "Objects of the Issue" table (id="ObjectiveIssue"), and the peer-comparison
// table (id="analysisTable", which lives inside the Next.js RSC stream and is
// HTML-entity-escaped). Every numeric field passes a domain-plausibility gate:
// a value outside its sane bound is dropped (left NULL), never persisted/guessed.
// ============================================================================

/**
 * Domain-sane bounds for each extracted numeric field. Single source of truth —
 * the field-priority-matrix entries (Stage B) reference these same numbers so
 * the extraction gate and the conflict-resolution validation never drift.
 *
 * Units: rupee-crore amounts as published by Chittorgarh; ratios as plain
 * numbers; percentages as plain percent values. Profit/EBITDA/net-worth/reserves
 * MAY be negative (real losses); revenue/income/assets/borrowing MUST be >= 0.
 */
export const FINANCIAL_FIELD_BOUNDS = {
  revenue: { min: 0, max: 5_000_000 },
  totalIncome: { min: 0, max: 5_000_000 },
  profit: { min: -5_000_000, max: 5_000_000 },
  ebitda: { min: -5_000_000, max: 5_000_000 },
  netWorth: { min: -5_000_000, max: 5_000_000 },
  reservesAndSurplus: { min: -5_000_000, max: 5_000_000 },
  totalAssets: { min: 0, max: 50_000_000 },
  totalBorrowing: { min: 0, max: 50_000_000 },
  eps: { min: -100_000, max: 100_000 },
  peRatio: { min: 0, max: 100_000 },
  roe: { min: -100, max: 300 },
  ronw: { min: -100, max: 300 },
  debtToEquity: { min: 0, max: 1_000 },
  promoterHolding: { min: 0, max: 100 },
  marketCap: { min: 0, max: 50_000_000 },
  objectiveAmount: { min: 0, max: 1_000_000 },
} as const;

/** Fiscal-year slots the schema's per-FY columns can hold (revenue/profit/etc.). */
const FY_SLOTS = [2022, 2023, 2024] as const;

/** Financial fields the detail page can yield (mirrors ScrapedFinancialData, no ipoId). */
export interface ExtractedFinancials {
  revenueFy2022?: number;
  revenueFy2023?: number;
  revenueFy2024?: number;
  profitFy2022?: number;
  profitFy2023?: number;
  profitFy2024?: number;
  ebitdaFy2022?: number;
  ebitdaFy2023?: number;
  ebitdaFy2024?: number;
  totalIncomeFy2022?: number;
  totalIncomeFy2023?: number;
  totalIncomeFy2024?: number;
  netWorth?: number;
  reservesAndSurplus?: number;
  totalAssets?: number;
  totalBorrowing?: number;
  eps?: number;
  preIpoEps?: number;
  postIpoEps?: number;
  peRatio?: number;
  roe?: number;
  ronw?: number;
  debtToEquity?: number;
  promoterHoldingPreIssue?: number;
  promoterHoldingPostIssue?: number;
  marketCap?: number;
}

/** A peer-comparison row as published in the detail page's peer table. */
export interface ExtractedPeer {
  companyName: string;
  eps?: number;
  dilutedEps?: number;
  nav?: number;
  peRatio?: number;
  ronw?: number;
}

/** An object-of-issue line (matches the IPOObjective schema interface). */
export interface ExtractedObjective {
  sno: number;
  description: string;
  amount: number | null;
}

type Bound = { min: number; max: number };

/** Return v when finite and within [min,max], else null (the plausibility gate). */
function gate(v: number | null, b: Bound): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < b.min || v > b.max) return null;
  return v;
}

/** Strip HTML tags/comments and collapse whitespace to a plain text value. */
function stripTags(s: string): string {
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a Chittorgarh-formatted number: strips ₹, thousands separators, "Cr.",
 * "%", and "(x)"; maps "(12.3)" accounting-negatives to -12.3; treats blank,
 * "-", "[●]", and "N/A" as absent (null).
 */
function parseFinancialNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = stripTags(String(raw))
    .replace(/₹/g, '')
    .replace(/,/g, '')
    .replace(/cr\.?/gi, '')
    .replace(/%/g, '')
    .replace(/\(x\)/gi, '')
    .trim();
  let neg = false;
  const paren = s.match(/^\((.+)\)$/);
  if (paren) {
    neg = true;
    s = paren[1].trim();
  }
  if (s === '' || /^[-–—]$/.test(s) || /^\[?[•●]\]?$/.test(s) || /^n\/?a$/i.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Extract the inner text of every <td>/<th> cell in a table row, in order. */
function rowCells(tr: string): string[] {
  return [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
}

/** All <tr> blocks inside the table's <tbody> (falls back to the whole table). */
function tbodyRows(tableHtml: string): string[] {
  const body = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? tableHtml;
  return body.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
}

/** Grab a complete <table>…</table> by its id attribute. */
function getTableById(html: string, id: string): string {
  const m = html.match(new RegExp(`<table[^>]*id=['"]${id}['"][\\s\\S]*?<\\/table>`, 'i'));
  return m ? m[0] : '';
}

/**
 * The peer table is delivered inside the Next.js RSC stream where HTML is
 * unicode-escaped — sometimes double-escaped (`\\u003c`). Collapse double
 * backslashes, then decode the escapes we care about, so the same id/cell
 * regexes work on it.
 */
function unescapeRscHtml(html: string): string {
  return html
    .replace(/\\\\/g, '\\')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026amp;/gi, '&')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u0027/gi, "'")
    .replace(/\\u002f/gi, '/')
    .replace(/\\"/g, '"');
}

/** Map a financial-table header cell ("31 Mar 2024", "Mar 31, 2024") to its fiscal year. */
function headerFiscalYear(headerCell: string): number | null {
  const m = headerCell.match(/Mar\D*?(20\d{2})|(20\d{2})\D*?Mar/i);
  if (!m) return null;
  const y = parseInt(m[1] ?? m[2], 10);
  return Number.isFinite(y) ? y : null;
}

/**
 * Extract financials/KPIs/valuation from a Chittorgarh detail page. Returns only
 * the fields actually found and domain-sane; returns null when none are present.
 * Per-FY P&L (revenue/profit/EBITDA/total-income) is mapped by the column's TRUE
 * fiscal year — a 2025-ending column is NOT mislabelled into an FY2024 slot
 * (honesty: never fabricate a year). Balance-sheet snapshots (net worth, assets,
 * borrowing, reserves) take the most-recent reported column.
 */
export function extractFinancialsFromDetailHtml(html: string): ExtractedFinancials | null {
  if (!html) return null;
  const out: ExtractedFinancials = {};
  const setIf = (key: keyof ExtractedFinancials, v: number | null) => {
    if (v != null) out[key] = v;
  };

  // ---- Restated "Company Financials" table (per-fiscal-year P&L + balance sheet) ----
  const finTable = getTableById(html, 'financialTable');
  if (finTable) {
    const headRow = finTable.match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? '';
    const headCells = rowCells(headRow);
    const colYears = headCells.slice(1).map(headerFiscalYear); // aligned with data cells

    const setPerFy = (prefix: 'revenue' | 'profit' | 'ebitda' | 'totalIncome', vals: string[], b: Bound) => {
      vals.forEach((cell, i) => {
        const year = colYears[i];
        if (year && (FY_SLOTS as readonly number[]).includes(year)) {
          const n = gate(parseFinancialNumber(cell), b);
          if (n != null) (out as Record<string, number>)[`${prefix}Fy${year}`] = n;
        }
      });
    };

    for (const tr of tbodyRows(finTable)) {
      const cells = rowCells(tr);
      if (cells.length < 2) continue;
      const label = cells[0].toLowerCase();
      const vals = cells.slice(1);
      const leftmost = parseFinancialNumber(vals[0]); // most-recent reported column

      if (/total\s*income/.test(label)) setPerFy('totalIncome', vals, FINANCIAL_FIELD_BOUNDS.totalIncome);
      else if (/profit\s*after\s*tax|^pat\b/.test(label)) setPerFy('profit', vals, FINANCIAL_FIELD_BOUNDS.profit);
      else if (/ebitda/.test(label)) setPerFy('ebitda', vals, FINANCIAL_FIELD_BOUNDS.ebitda);
      else if (/revenue/.test(label)) setPerFy('revenue', vals, FINANCIAL_FIELD_BOUNDS.revenue);
      else if (/net\s*worth/.test(label)) setIf('netWorth', gate(leftmost, FINANCIAL_FIELD_BOUNDS.netWorth));
      else if (/reserves/.test(label)) setIf('reservesAndSurplus', gate(leftmost, FINANCIAL_FIELD_BOUNDS.reservesAndSurplus));
      else if (/total\s*borrow/.test(label)) setIf('totalBorrowing', gate(leftmost, FINANCIAL_FIELD_BOUNDS.totalBorrowing));
      else if (/\bassets\b/.test(label)) setIf('totalAssets', gate(leftmost, FINANCIAL_FIELD_BOUNDS.totalAssets));
    }
  }

  // ---- KPI + valuation tables (under the "Key Performance Indicator" heading) ----
  const kpiIdx = html.search(/Key Performance Indicator/i);
  if (kpiIdx >= 0) {
    const region = html.slice(kpiIdx, kpiIdx + 8000);
    const tables = region.match(/<table[\s\S]*?<\/table>/gi) ?? [];
    const kpiTable = tables.find((t) => /RoNW|RoE\b|Debt\s*\/?\s*Equity/i.test(t) && !/Pre\s*IPO/i.test(t));
    const valTable = tables.find((t) => /Pre\s*IPO/i.test(t));

    if (kpiTable) {
      for (const tr of tbodyRows(kpiTable)) {
        const cells = rowCells(tr);
        if (cells.length < 2) continue;
        const label = cells[0].toLowerCase();
        if (/^roe\b/.test(label)) setIf('roe', gate(parseFinancialNumber(cells[1]), FINANCIAL_FIELD_BOUNDS.roe));
        else if (/ronw/.test(label)) setIf('ronw', gate(parseFinancialNumber(cells[1]), FINANCIAL_FIELD_BOUNDS.ronw));
        else if (/debt\s*\/?\s*equity/.test(label)) setIf('debtToEquity', gate(parseFinancialNumber(cells[1]), FINANCIAL_FIELD_BOUNDS.debtToEquity));
      }
    }

    if (valTable) {
      for (const tr of tbodyRows(valTable)) {
        const cells = rowCells(tr);
        if (cells.length < 2) continue;
        const label = cells[0].toLowerCase();
        if (/\beps\b/.test(label)) {
          setIf('preIpoEps', gate(parseFinancialNumber(cells[1]), FINANCIAL_FIELD_BOUNDS.eps));
          const post = gate(parseFinancialNumber(cells[2]), FINANCIAL_FIELD_BOUNDS.eps);
          setIf('postIpoEps', post);
          setIf('eps', post); // the post-issue EPS is the listed-share EPS
        } else if (/p\s*\/\s*e/.test(label)) {
          setIf('peRatio', gate(parseFinancialNumber(cells[2]), FINANCIAL_FIELD_BOUNDS.peRatio));
        } else if (/promoter\s*holding/.test(label)) {
          setIf('promoterHoldingPreIssue', gate(parseFinancialNumber(cells[1]), FINANCIAL_FIELD_BOUNDS.promoterHolding));
          setIf('promoterHoldingPostIssue', gate(parseFinancialNumber(cells[2]), FINANCIAL_FIELD_BOUNDS.promoterHolding));
        } else if (/market\s*cap/.test(label)) {
          setIf('marketCap', gate(parseFinancialNumber(cells[1]), FINANCIAL_FIELD_BOUNDS.marketCap));
        }
      }
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Extract the peer-comparison rows from a Chittorgarh detail page. The IPO's own
 * row is included (the page lists it for comparison); the caller filters it out
 * by company name. Returns [] when the page carries no peer table.
 */
export function extractPeersFromDetailHtml(html: string): ExtractedPeer[] {
  if (!html) return [];
  const peerTable = getTableById(unescapeRscHtml(html), 'analysisTable');
  if (!peerTable) return [];

  const headRow = peerTable.match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? '';
  const heads = rowCells(headRow).map((h) => h.toLowerCase());
  const colIndex = (re: RegExp) => heads.findIndex((h) => re.test(h));
  const iEps = heads.findIndex((h) => /eps/.test(h) && !/dilut/.test(h));
  const iDil = colIndex(/diluted/);
  const iNav = colIndex(/nav/);
  const iPe = colIndex(/p\s*\/\s*e/);
  const iRonw = colIndex(/ronw/);

  const num = (cells: string[], i: number): number | undefined => {
    if (i < 0) return undefined;
    const n = parseFinancialNumber(cells[i]);
    return n == null ? undefined : n;
  };

  const peers: ExtractedPeer[] = [];
  for (const tr of tbodyRows(peerTable)) {
    const cells = rowCells(tr);
    if (cells.length < 2) continue;
    const companyName = cells[0].trim();
    if (companyName.length < 2 || !/[A-Za-z]/.test(companyName)) continue;
    const peer: ExtractedPeer = { companyName };
    const eps = num(cells, iEps);
    const dil = num(cells, iDil);
    const nav = num(cells, iNav);
    const pe = gate(num(cells, iPe) ?? NaN, FINANCIAL_FIELD_BOUNDS.peRatio);
    const ronw = gate(num(cells, iRonw) ?? NaN, FINANCIAL_FIELD_BOUNDS.ronw);
    if (eps != null) peer.eps = eps;
    if (dil != null) peer.dilutedEps = dil;
    if (nav != null) peer.nav = nav;
    if (pe != null) peer.peRatio = pe;
    if (ronw != null) peer.ronw = ronw;
    peers.push(peer);
  }
  return peers;
}

/**
 * Extract the objects-of-issue lines from a Chittorgarh detail page. Returns []
 * when the page carries no objectives table. Amount is null when not yet
 * disclosed (e.g. "[●]") — never guessed.
 */
export function extractObjectivesFromDetailHtml(html: string): ExtractedObjective[] {
  if (!html) return [];
  const objTable = getTableById(html, 'ObjectiveIssue');
  if (!objTable) return [];

  const objectives: ExtractedObjective[] = [];
  for (const tr of tbodyRows(objTable)) {
    const cells = rowCells(tr);
    if (cells.length < 2) continue;
    const sno = parseInt(cells[0].replace(/\D/g, ''), 10);
    const description = cells[1].trim();
    if (!Number.isFinite(sno) || description.length < 3) continue;
    const amount = gate(parseFinancialNumber(cells[2] ?? ''), FINANCIAL_FIELD_BOUNDS.objectiveAmount);
    objectives.push({ sno, description, amount });
  }
  return objectives;
}

/** Plausible company-description length bounds (#69). */
const MIN_DESC = 20;
const MAX_DESC = 5000;

/**
 * Extract the company business description ("About <Company>") from a Chittorgarh
 * detail page (#69 — company_description is 0/285). Chittorgarh renders it as:
 *   <div id="ipoSummary" class="...collapse "><p>Incorporated in 2019, ...</p>...</div>
 *
 * Pure (html -> value), with an output-plausibility gate: returns null when the
 * block is absent or the text is implausibly short/long. HTML tags are stripped
 * and entities decoded so the stored value is clean prose (never markup).
 */
export function extractCompanyDescriptionFromDetailHtml(html: string): string | null {
  if (!html) return null;

  const m = html.match(/<div[^>]*id="ipoSummary"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return null;

  const text = m[1]
    .replace(/<\/(p|li|br)\s*>/gi, ' ') // keep word spacing across block tags
    .replace(/<[^>]+>/g, ' ') // strip remaining tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length < MIN_DESC || text.length > MAX_DESC) return null; // implausible
  return text;
}

/**
 * Extract the ISIN from a Chittorgarh detail page (#71 historical ingestion).
 * Rendered as: <a href="/glossary/isin/...">ISIN</a></span></td><td ...>INE0LEZ01016</td>.
 * ISIN format: 2 letters + 9 alphanumerics + 1 check digit (12 chars). Returns
 * null when absent/malformed.
 */
export function extractIsinFromDetailHtml(html: string): string | null {
  if (!html) return null;
  const m = html.match(/ISIN<\/a>[\s\S]{0,160}?\b([A-Z]{2}[0-9A-Z]{9}[0-9])\b/i);
  if (!m) return null;
  const isin = m[1].toUpperCase();
  return /^[A-Z]{2}[0-9A-Z]{9}[0-9]$/.test(isin) ? isin : null;
}

/** Plausible issue-size bounds in crore (#71): ₹1 Cr .. ₹5,00,000 Cr. */
const MIN_ISSUE_CR = 1;
const MAX_ISSUE_CR = 500000;

/**
 * Extract the total issue size (in RUPEES) from a Chittorgarh detail page
 * (#71). Rendered as: "book build issue </a></span> of ₹2,980.76 cr". Returns
 * rupees (crore × 1e7) to match the issue_size storage convention, or null when
 * absent/implausible.
 */
export function extractIssueSizeRupeesFromDetailHtml(html: string): number | null {
  if (!html) return null;
  const m = html.match(/issue\s*<\/a>\s*<\/span>\s*of\s*₹\s*([0-9,]+(?:\.[0-9]+)?)\s*cr/i)
    ?? html.match(/of\s*₹\s*([0-9,]+(?:\.[0-9]+)?)\s*cr/i);
  if (!m) return null;
  const cr = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(cr) || cr < MIN_ISSUE_CR || cr > MAX_ISSUE_CR) return null;
  return Math.round(cr * 10000000); // crore -> rupees
}
