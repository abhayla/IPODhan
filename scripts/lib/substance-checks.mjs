// Pure substance-plausibility predicates for genuine IPO rows.
//
// Each predicate takes a single plain row object and returns either:
//   - null            → the row passes this check (no violation)
//   - a string reason → the row VIOLATES this check (the reason is human-readable)
//
// Predicates are PURE: no DB, no IO, no clock. They are unit-testable in isolation
// and are also imported by scripts/audit-substance-plausibility.mjs which feeds them
// real rows read from the DB. This is the machine-checkable "substance" companion to
// scripts/audit-ipo-coverage.mjs ("shape"): coverage asks "is the field populated?",
// these ask "is the value domain-SANE?" (see .claude/rules/output-plausibility-verification.md).
//
// Convention: a NULL/undefined field is treated as "not applicable" → null (no
// violation). Coverage (populated-ness) is audit-ipo-coverage.mjs's job, not ours;
// here we only judge values that are actually present.

// ---- shared helpers --------------------------------------------------------

// Parse a value that may be a JS number, a numeric string (pg numeric columns come
// back as strings), or null. Returns a finite number, or null if absent/unparseable.
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Parse a date-only ('YYYY-MM-DD') or timestamp value into a comparable epoch ms,
// or null if absent/unparseable. pg `date` columns surface as 'YYYY-MM-DD' strings.
function toTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

// ---- plausibility bounds (named, not magic) --------------------------------

export const LOT_SIZE_MIN = 1;
export const LOT_SIZE_MAX = 100000;
export const LISTING_GAIN_MIN_PCT = -90;
export const LISTING_GAIN_MAX_PCT = 900;
export const GMP_PREMIUM_MIN_PCT = -50; // GMP below issue price (discount) floor
export const GMP_PREMIUM_MAX_PCT = 200; // GMP above issue price ceiling

export const ISIN_REGEX = /^IN[EF][0-9A-Z]{9}$/;
// Trailing 1-2 letter status token after a legal-entity suffix — the #42 name smell.
export const NAME_TRAILING_TOKEN_REGEX = /(Ltd\.?|Limited)\s+[A-Za-z]{1,2}$/i;

// ---- Check 1: date ordering ------------------------------------------------
// Where dates are non-null, require open ≤ close < allotment < listing.
// Each adjacent pair is only enforced when BOTH endpoints are present, so a
// partially-dated row is judged on the pairs it can support. (The #41 class.)
export function checkDateOrdering(row) {
  const open = toTime(row.open_date);
  const close = toTime(row.close_date);
  const allot = toTime(row.allotment_date);
  const listing = toTime(row.listing_date);

  if (open !== null && close !== null && open > close) {
    return `open_date (${row.open_date}) is after close_date (${row.close_date})`;
  }
  if (close !== null && allot !== null && !(close < allot)) {
    return `close_date (${row.close_date}) is not before allotment_date (${row.allotment_date})`;
  }
  if (allot !== null && listing !== null && !(allot < listing)) {
    return `allotment_date (${row.allotment_date}) is not before listing_date (${row.listing_date})`;
  }
  // Cross-pair guard: when allotment is missing but close & listing exist, the
  // strict close < listing relationship must still hold.
  if (close !== null && listing !== null && !(close < listing)) {
    return `close_date (${row.close_date}) is not before listing_date (${row.listing_date})`;
  }
  return null;
}

// ---- Check 2: lot_size sanity ----------------------------------------------
export function checkLotSize(row) {
  const lot = toNumber(row.lot_size);
  if (lot === null) return null;
  if (lot < LOT_SIZE_MIN || lot > LOT_SIZE_MAX) {
    return `lot_size (${lot}) outside plausible range [${LOT_SIZE_MIN}..${LOT_SIZE_MAX}]`;
  }
  return null;
}

// ---- Check 3: price band sanity --------------------------------------------
// price_range_min > 0 AND price_range_min ≤ price_range_max (max only checked
// when present, since a fixed-price issue may set only the min).
export function checkPriceBand(row) {
  const min = toNumber(row.price_range_min);
  const max = toNumber(row.price_range_max);
  if (min === null) return null;
  if (min <= 0) {
    return `price_range_min (${min}) must be > 0`;
  }
  if (max !== null && min > max) {
    return `price_range_min (${min}) exceeds price_range_max (${max})`;
  }
  return null;
}

// ---- Check 4: issue_size sanity --------------------------------------------
export function checkIssueSize(row) {
  const size = toNumber(row.issue_size);
  if (size === null) return null;
  if (size <= 0) {
    return `issue_size (${size}) must be > 0`;
  }
  return null;
}

// ---- Check 5: ISIN format --------------------------------------------------
export function checkIsinFormat(row) {
  const isin = row.isin;
  if (isin === null || isin === undefined || isin === '') return null;
  if (!ISIN_REGEX.test(String(isin))) {
    return `isin ("${isin}") does not match ${ISIN_REGEX}`;
  }
  return null;
}

// ---- Check 6: name quality (trailing status token — the #42 class) ---------
export function checkNameQuality(row) {
  const name = row.company_name;
  if (name === null || name === undefined || name === '') return null;
  if (NAME_TRAILING_TOKEN_REGEX.test(String(name))) {
    return `company_name ("${name}") has a trailing status-token smell`;
  }
  return null;
}

// ---- Check 7: listing performance sanity -----------------------------------
// listing_price > 0; listing_gain_percent within [-90, +900].
// Operates on a joined row (listing_performance fields), each judged when present.
export function checkListingPerformance(row) {
  const price = toNumber(row.listing_price);
  if (price !== null && price <= 0) {
    return `listing_price (${price}) must be > 0`;
  }
  const gain = toNumber(row.listing_gain_percent);
  if (gain !== null && (gain < LISTING_GAIN_MIN_PCT || gain > LISTING_GAIN_MAX_PCT)) {
    return `listing_gain_percent (${gain}%) outside plausible range [${LISTING_GAIN_MIN_PCT}..${LISTING_GAIN_MAX_PCT}]`;
  }
  return null;
}

// ---- Check 8: GMP sanity relative to issue price ---------------------------
// Premium = gmp / issue_price * 100, expected within [-50%, +200%].
// Needs both a GMP value and a positive issue price; otherwise not applicable.
// `issue_price` here is the per-share issue price (price_range_max is the proxy
// the audit passes when listing_performance.issue_price is absent).
export function checkGmpSanity(row) {
  const gmp = toNumber(row.gmp_value);
  const issuePrice = toNumber(row.issue_price);
  if (gmp === null || issuePrice === null) return null;
  if (issuePrice <= 0) return null; // guard division — can't judge premium without a real price
  const premiumPct = (gmp / issuePrice) * 100;
  if (premiumPct < GMP_PREMIUM_MIN_PCT || premiumPct > GMP_PREMIUM_MAX_PCT) {
    return `gmp_value (${gmp}) is ${premiumPct.toFixed(1)}% of issue_price (${issuePrice}), outside [${GMP_PREMIUM_MIN_PCT}%..${GMP_PREMIUM_MAX_PCT}%]`;
  }
  return null;
}

// ---- Check 9: registrar quality (#45) --------------------------------------
// A registrar string MUST NOT carry address/contact pollution — '^'/tab/newline
// delimiters or "Tel:"/"E-mail:" blocks (the scrape artifact sanitizeRegistrar removes).
export function checkRegistrarQuality(row) {
  const r = row.registrar;
  if (r === null || r === undefined || r === '') return null;
  const s = String(r);
  if (/[\^\t\n\r]/.test(s)) return `registrar ("${s.slice(0, 40)}…") has an address/contact delimiter (^, tab, newline)`;
  if (/Tel\.?:|E-?mail:|Phone:/i.test(s)) return `registrar ("${s.slice(0, 40)}…") contains contact info`;
  return null;
}

// Ordered registry consumed by the audit script. `name` is the report label;
// `predicate` is the pure function; `optional` flags checks whose underlying
// table/columns may be absent (the audit guards these gracefully).
export const SUBSTANCE_CHECKS = [
  { key: 'date_ordering', name: 'Date ordering (open<=close<allotment<listing)', predicate: checkDateOrdering },
  { key: 'lot_size', name: 'lot_size in [1..100000]', predicate: checkLotSize },
  { key: 'price_band', name: 'price band (min>0, min<=max)', predicate: checkPriceBand },
  { key: 'issue_size', name: 'issue_size > 0', predicate: checkIssueSize },
  { key: 'isin_format', name: 'ISIN format IN[E|F]{9 alnum}', predicate: checkIsinFormat },
  { key: 'name_quality', name: 'name has no trailing status token', predicate: checkNameQuality },
  { key: 'listing_performance', name: 'listing_price>0 & gain in [-90..900]%', predicate: checkListingPerformance },
  { key: 'gmp_sanity', name: 'latest GMP premium in [-50..200]% of issue price', predicate: checkGmpSanity, optional: true },
  { key: 'registrar_quality', name: 'registrar free of address/contact pollution', predicate: checkRegistrarQuality },
];
