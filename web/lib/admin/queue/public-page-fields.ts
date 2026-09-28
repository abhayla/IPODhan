/**
 * The fields the public IPO page (web/app/ipos/[slug]/page.tsx) SHOWS — OD-136's first group
 * ("for the fields the public IPO page shows"). Keyed by SQL table name; field names are the
 * drizzle (camelCase) keys the admin write and data_conflicts use.
 *
 * Derived 2026-09-29, not typed from memory: every (table, field) in ipo_field_plan on
 * ipodhan_staging (176 pairs) was converted to camelCase and kept when the name is read by the
 * page or one of the components it imports (`.field`, `field:` or a quoted `'field'`). 130 of 176
 * matched. A field that did not match is still in the queue (group 2, never hidden). The unit test
 * web/tests/unit/lib/admin/queue/public-page-fields.test.ts re-reads the page files and fails when
 * a listed field is no longer rendered, so this list cannot silently go stale.
 */
export const PUBLIC_PAGE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  anchor_investors: ['anchorInvestorsCount', 'bidDate', 'investorList', 'totalAmountRaised', 'totalSharesOffered'],
  brlm_track_record: ['brlmName', 'closedBelowIssuePrice', 'issues3y'],
  documents: ['filingDate'],
  financial_data: ['eps', 'marketCap', 'netWorth', 'peRatio', 'postIpoEps', 'preIpoEps', 'promoterHoldingPostIssue', 'promoterHoldingPreIssue', 'roe', 'ronw'],
  financial_statements: ['basis', 'dscr', 'fiscalYear', 'netWorth', 'rentExpense', 'unit'],
  ipo_details: ['allocationPct', 'anchorSharesOffered', 'basisOfAllotmentDate', 'bidWindows', 'categoryDetails', 'companyAddress', 'companyCity', 'companyDescription', 'companyEmail', 'companyPhone', 'companyPincode', 'companyState', 'complianceOfficer', 'complianceOfficerEmail', 'complianceOfficerPhone', 'creditOfSharesDate', 'designatedExchange', 'employeeDiscount', 'employeeSharesOffered', 'faceValue', 'freshIssue', 'initiationOfRefundsDate', 'ipoMarketTimings', 'isin', 'issueType', 'leadManagers', 'maxEmployeeSubscription', 'maxRetailSubscription', 'niiSharesOffered', 'ofsIssue', 'preIpoPlacement', 'promoterGroupTransactionsSinceDrhp', 'promoterSharesHeld', 'qibSharesOffered', 'retailMaxAllottees', 'retailSharesOffered', 'sebiRegulationCited', 'sponsorBanks', 'tickSize', 'upiCutoffTime'],
  ipo_intermediaries: ['name', 'role', 'sebiRegNo'],
  ipo_risk_factors: ['body', 'heading', 'kpis', 'seq'],
  ipo_valuation: ['freshSharesAtCap', 'freshSharesAtFloor', 'mcapAtCap', 'mcapAtFloor', 'ofsShares', 'peAtCap', 'peAtFloor', 'peNotAscertainableReason', 'priceCap', 'priceFloor', 'ronwWeighted3y', 'sharesAtCap', 'sharesAtFloor', 'totalSharesAtCap', 'totalSharesAtFloor'],
  ipos: ['allotmentDate', 'cin', 'closeDate', 'companyDescription', 'companyName', 'faceValue', 'isin', 'issueSize', 'leadManagers', 'listingDate', 'listingExchanges', 'lotSize', 'objectives', 'offeringType', 'openDate', 'priceRangeMax', 'priceRangeMin', 'registrar', 'sector', 'segment', 'status', 'symbol'],
  listing_performance: ['currentPrice', 'listingPrice'],
  peer_companies: ['companyName', 'eps', 'isListed', 'nav', 'pbvRatio', 'peRatio', 'ronw'],
  promoter_acquisition_ranges: ['capMultiple', 'period', 'priceHigh', 'priceLow', 'waca'],
  promoters: ['isPromoterGroup', 'name', 'sharesHeld', 'waca'],
  registrars: ['name', 'shortName', 'website'],
};

/** Row tables store a hold under `<table>:<rowKey>`; the page list is keyed by the bare table. */
function bareTable(tableName: string): string {
  const i = tableName.indexOf(':');
  return i === -1 ? tableName : tableName.slice(0, i);
}

/** True when the public IPO page renders this field (OD-136 group 1 for a live IPO). */
export function isPublicPageField(tableName: string, fieldName: string): boolean {
  return PUBLIC_PAGE_FIELDS[bareTable(tableName)]?.includes(fieldName) ?? false;
}
