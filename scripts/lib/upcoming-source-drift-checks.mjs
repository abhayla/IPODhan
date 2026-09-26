// c_upcoming_source_drift (#349, T-nightly detection). Every function here is
// PURE (string/data in, data out, no fetch/DB/clock) so it is unit-testable
// against real captured Chittorgarh fixtures — same convention as
// scripts/lib/ipowatch-oracle-parser.mjs and scripts/lib/detection-floor-checks.mjs.
//
// WHY Chittorgarh's DETAIL page, not the dashboard list block or the JSON API
// scraper/src/scrapers/chittorgarh-scraper.ts ingests: issue #349's Karamtara
// defect was the detail page (875 Cr) disagreeing with what our pipeline had
// stored (1,750 Cr, later found to actually be a different IPO's 53.4 Cr via
// a fuzzy-slug bug, #350/#351) for four-plus days. The detail page's own
// "Total Issue Size" table row is the figure a human reads to catch a size
// cut; comparing against it is what proves the RCA candidates in #349,
// unlike re-reading our own ingested list API (which is one hop from the
// same possibly-stale source our scraper already trusts).
//
// Captured 2026-09-26 from three LIVE (UPCOMING) chittorgarh.com/ipo/<slug>/
// pages (fixtures under scripts/tests/fixtures/chittorgarh-issue-size/):
// Nityas Gems & Jewellery (108 Cr), Vishal Nirmiti (178 Cr), SRIT India
// (218 Cr) — all three print the row as:
//   <a title="Total Issue Size" ...>Total Issue Size</a></span></td>
//   <td class="text-end"><span class="text-end">1,44,56,000<!-- --> <!-- -->shares
//   <br/>(agg. up to ₹<!-- -->108<!-- --> <!-- -->Cr)</span></td>

const TOTAL_ISSUE_SIZE_RE =
  /Total Issue Size[\s\S]{0,60}?<span class="text-end">\s*([\d,]+)\s*<!-- -->[\s\S]{0,40}?up to\s*₹\s*<!-- -->\s*([\d,]+(?:\.\d+)?)\s*<!-- -->\s*<!-- -->\s*(Cr|Crore|Lakh)/i;

function toNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses one Chittorgarh IPO detail page's "Total Issue Size" row into a
 * rupee total. Returns null when the row is structurally absent (page
 * redesign, wrong page, 404 rendered as 200) — a caller MUST treat that as
 * UNVERIFIABLE for this company, never as "field absent, skip" (same rule as
 * ipowatch-oracle-parser.mjs's parseIpowatchDetail).
 * @param {string} html
 * @returns {{ shares: number|null, amountRupees: number, unit: 'Cr'|'Lakh' } | null}
 */
export function parseChittorgarhIssueSizeDetail(html) {
  if (typeof html !== 'string' || html.length === 0) return null;
  const m = TOTAL_ISSUE_SIZE_RE.exec(html);
  if (!m) return null;
  const shares = toNumber(m[1]);
  const amount = toNumber(m[2]);
  if (amount === null) return null;
  const unit = /lakh/i.test(m[3]) ? 'Lakh' : 'Cr';
  const amountRupees = unit === 'Cr' ? amount * 1_00_00_000 : amount * 1_00_000;
  return { shares, amountRupees, unit };
}

// CG prints the crore figure with at most 2 decimal places (e.g. "108",
// "17.5"); the smallest difference that print format can express is 0.01 Cr
// = Rs 1,00,000. A stored-vs-page difference at or below that is rounding,
// not drift. #349's real defect (1,750 Cr stored vs 875 Cr on the page) is
// ~87,500x this tolerance.
export const ROUNDING_TOLERANCE_RUPEES = 1_00_000;

/**
 * Pure evaluator: compares each live IPO's stored issue_size against the
 * Chittorgarh detail-page figure matched for it. Never silently drops an
 * unreachable/unparseable company — it is counted and excluded, and an
 * all-unreachable population is signalled via `allUnreachable` so the caller
 * can record UNVERIFIABLE instead of a false PASS (signal-ownership R1/R3).
 *
 * @param {Array<{id:string, companyName:string, slug:string, status:string, issueSize:number|null, issueSizeSource:string|null, issueSizeUpdatedAt:string|null}>} ipoRows
 * @param {Map<string, {ok:true, parsed:{amountRupees:number,unit:string}}|{ok:false, reason:string}>} pageResultsByKey
 *   keyed by normalizeCompanyKey(companyName)
 */
export function evaluateUpcomingSourceDrift({ ipoRows, pageResultsByKey, toleranceRupees = ROUNDING_TOLERANCE_RUPEES }) {
  let examined = 0;
  let unreachable = 0;
  let unparseable = 0;
  const violations = [];
  const unmatchedSlugs = [];

  for (const ipo of ipoRows) {
    const result = pageResultsByKey.get(ipo.normalizedKey);
    if (!result) { unmatchedSlugs.push(ipo.slug ?? ipo.companyName); continue; } // not matched on the dashboard at all — outside this check's reach, not a violation
    examined += 1;
    if (!result.ok) {
      if (result.reason === 'unparseable') unparseable += 1;
      else unreachable += 1;
      continue;
    }
    const pageRupees = result.parsed.amountRupees;
    const stored = ipo.issueSize;
    if (stored === null || stored === undefined) continue; // a NULL stored value is a different check's population
    const diff = Math.abs(Number(stored) - pageRupees);
    if (diff > toleranceRupees) {
      violations.push({
        ipoId: ipo.id,
        slug: ipo.slug,
        companyName: ipo.companyName,
        storedRupees: Number(stored),
        pageRupees,
        diffRupees: diff,
        provenanceSource: ipo.issueSizeSource ?? 'UNKNOWN',
        provenanceDate: ipo.issueSizeUpdatedAt ?? 'UNKNOWN',
        message: `"${ipo.slug}" stored issue_size Rs ${Number(stored).toLocaleString('en-IN')} vs Chittorgarh page Rs ${pageRupees.toLocaleString('en-IN')}`
          + ` (provenance ${ipo.issueSizeSource ?? 'UNKNOWN'} @ ${ipo.issueSizeUpdatedAt ?? 'UNKNOWN'})`,
      });
    }
  }

  const consideredForVerdict = examined - unreachable - unparseable;
  const allUnreachable = examined > 0 && consideredForVerdict === 0;
  // Round-1 review finding (#1128): a live-IPO population that exists but
  // matched ZERO dashboard entries left examined=0, allUnreachable=false (it
  // requires examined>0), and fell through to a false PASS on zero evidence.
  // totalLiveIpos/unmatchedSlugs let the caller tell "0 live IPOs" (genuinely
  // not applicable) apart from "N live IPOs, 0 matched" (BLIND, UNVERIFIABLE).
  const totalLiveIpos = ipoRows.length;
  const noneMatched = totalLiveIpos > 0 && examined === 0;

  return {
    examined,
    unreachable,
    unparseable,
    consideredForVerdict,
    allUnreachable,
    totalLiveIpos,
    noneMatched,
    unmatchedSlugs,
    violations,
  };
}
