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

// ---- Check 9b: degenerate band on a bookbuilding IPO (T-308, round-6 P1) ---
//
// REWRITTEN 2026-09-11 after measuring it. The old rule was "min === max on a
// non-FIXED_PRICE issue is wrong". On staging that fired on 268 rows and
// exempted 0 - and 266 OF THOSE 268 WERE CORRECT DATA.
//
// Why 266 were correct: after an issue closes, a book-built issue HAS one
// price, the discovered cut-off, and every source publishes it that way.
// Measured at the source (Chittorgarh report 82, FY2026-27, book-built rows):
// all 183 CLOSED rows carry a single price and only the 18 STILL-OPEN ones
// carry a range. Our data mirrors it - 266 of our 268 degenerate rows are
// closed or listed, against a control where rows with a REAL band are 28% open.
//
// So "floor < cap" is a rule about an issue whose book is OPEN, not about every
// issue forever. The old wording made this check fire on normal data 266 times,
// which is not merely noisy: it BURIED 21 real defects (#597) that nobody could
// see. The cost of a noisy check is the signal it hides.
//
// WHAT REPLACES IT - three populations, each genuinely wrong:
//
//   1. The collapsed value equals `face_value`. A price band is not a face
//      value; this is the #515 shape (MUTHOOT 1000/1000, STALLION 10/10).
//   2. The book is still OPEN and the band is degenerate. While bidding is
//      live a book-built issue must have floor < cap - the original rule, kept
//      for the population it is actually true of.
//   3. An authoritative per-share price exists and DISAGREES with the stored
//      one. This is the round-6 class the old check was built for and would
//      have been lost by simply gating on OPEN: 21 rows on staging store the
//      band's FLOOR and lost the cap, all 21 lower than the real price, none
//      higher, average gap 8.63% - exactly the floor-to-cap spread, with a
//      control showing real-band issues price at the CAP in 46 of 46.
//
// `authoritative_issue_price` is the RAW `listing_performance.issue_price`, not
// the caller's `issue_price` alias - that one is
// COALESCE(lp.issue_price, i.price_range_max), which for a degenerate row IS
// the stored value, so comparing against it would compare a number to itself
// and never fire.
export function checkDegenerateBookbuildingBand(row) {
  const min = toNumber(row.price_range_min);
  const max = toNumber(row.price_range_max);
  if (min === null || max === null) return null;
  if (min <= 0) return null; // checkPriceBand already flags this shape
  if (min !== max) return null;
  if (row.issue_type === 'FIXED_PRICE') return null;

  // (1) the face value is sitting in the price column
  const face = toNumber(row.face_value);
  if (face !== null && min === face) {
    return `price band is degenerate (min===max===${min}) AND equals face_value (${face}) — the price column is holding the face value, not a price`;
  }

  // (3) an authoritative price disagrees - the band lost its cap
  const real = toNumber(row.authoritative_issue_price);
  if (real !== null && real !== min) {
    // Magnitude, then direction as a word. The first version printed the signed
    // value next to the word, so a stored price ABOVE the real one read
    // "(-6.7% high)" - a negative number labelled high.
    const gapPct = Math.abs(((real - min) / real) * 100);
    const direction = min < real ? 'low' : 'high';
    // DO NOT NAME THE MECHANISM HERE. The first version said "a collapsed band
    // that kept the floor and lost the cap", which is the right story for 21 of
    // the 22 production rows and WRONG for the 22nd: NET PIX SHORTS DIGITAL
    // MEDIA stores 32 against an authoritative 30, so it kept something ABOVE
    // the real price and cannot have kept a floor. Staging shows 21 low / 0
    // high; production shows 21 low / 1 high. A message that asserts one
    // mechanism for a population with two sends a triager looking for the
    // wrong write path.
    return `stored price ${min} disagrees with the authoritative issue price ${real} (${gapPct.toFixed(1)}% ${direction}) — the stored price is not the price this issue sold at`;
  }

  // (2) still taking bids - or we cannot show that it is not.
  //
  // AN ABSENT close_date DOES NOT MEAN CLOSED. The first version of this read
  // `close === null ? false`, i.e. it treated "we do not know when this closed"
  // as "it is closed, therefore safe" - the same absence-reading-as-a-value
  // shape this file's own history is full of, and the existing
  // web/tests/unit/scripts/substance-checks.test.ts caught it: its Gabion-shape
  // rows carry no close_date at all and were silently passed.
  //
  // Not knowing cannot be the safe answer. Costs nothing on real data: zero
  // degenerate rows lack a close_date on staging (0 of 268) or prod (0 of 90).
  // `close_date` is a DATE column, so it parses to midnight UTC. An issue
  // closing TODAY therefore reads as already past once midnight has gone. That
  // is one day of imprecision at the boundary, inherited from the column type
  // rather than introduced here; it can only make this branch quieter, never
  // louder, and the face-value and oracle branches above are unaffected.
  const close = toTime(row.close_date);
  const notShownClosed = close === null || close >= Date.now();
  if (notShownClosed) {
    const when = row.close_date ? `closes ${row.close_date}` : 'no close date on record';
    return `price band is degenerate (min===max===${min}) and the issue is not shown to have closed (${when}) — a book-built issue must have floor < cap while the book is open`;
  }

  // Closed, priced at a plausible value, and either agreeing with the oracle or
  // having none. This is the normal shape for a closed book-built issue.
  //
  // KNOWN, ACCEPTED, UNDETECTED GAP - stated here and not only in the pull
  // request, because the next reader has the code and not the PR. A CLOSED
  // issue whose band collapsed to a plausible-looking WRONG value AND which has
  // no listing_performance.issue_price to check it against is passed silently.
  // Measured 2026-09-11: 61 of 268 degenerate rows on staging have no such
  // oracle (43 of 90 on production). Nothing in this file can distinguish those
  // from correct data.
  //
  // Accepted deliberately: the alternative is the rule this check used to have,
  // which flagged all of them and buried 21 real defects (#597) under ~239 false
  // positives. Closing the gap needs an oracle for those rows, not a wider rule
  // here - tracked in #589.
  return null;
}


// ---- Check 10: issue_size vs segment floor (W-177) -------------------------
// The T-329 scraper-side guard (`collectImplausibleIssueSizeFields`,
// scraper/src/services/data-consolidation-service.ts) rejects a MAINBOARD
// issue_size below Rs10 Cr or an SME issue_size below Rs1 Cr BEFORE it is
// written — but that guard only fires on a live scrape write. This is the
// read-side companion: it catches a polluted row that reached the DB by any
// other path (a stale write predating the guard, a manual insert, a future
// write-door the guard hasn't been wired into yet) — the W-177 shape
// (shanti-inorganics-ltd, ashutosh-fibre-ltd: SHARE COUNT sitting in the
// issue_size column, ~80x below the real value) that `audit:substance` had
// no bound for and so rendered green while the pages showed impossible sizes.
// SAME floors as the scraper guard (never re-derived): keep both in sync by
// hand — they are independent SSOTs by design (this script has no import
// path into scraper/src), so a floor change must be applied in both places.
export const MAINBOARD_ISSUE_SIZE_FLOOR = 10_00_00_000; // Rs10 Cr
export const SME_ISSUE_SIZE_FLOOR = 1_00_00_000; // Rs1 Cr

export function checkIssueSizeSegmentFloor(row) {
  const size = toNumber(row.issue_size);
  if (size === null || size <= 0) return null; // checkIssueSize already flags <=0
  const band = toNumber(row.price_range_min) ?? toNumber(row.price_range_max);
  if (band === null) return null; // no band on record — nothing to bound this against yet
  const segment = row.segment;
  const floor =
    segment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : segment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null;
  if (floor === null) return null; // no segment (RIGHTS/NCD/REIT/InvIT) — floor doesn't apply
  if (size < floor) {
    return `issue_size (${size}) is below the ${segment} floor (${floor}) while a price band (${row.price_range_min ?? row.price_range_max}) is on record — looks like a share count, not a rupee value`;
  }
  return null;
}

// ---- Check 11: lot-economics retail range (W-171) --------------------------
// Same rule as scraper/src/utils/data-validation.ts Rule 9
// (LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD / _SME) — SEBI ICDR Reg 32(1) caps a
// MAINBOARD retail lot at ~Rs10,000-16,000 (lot_size x price_range_max); SEBI
// ICDR Chapter IX puts a genuine SME lot at ~Rs1,00,000-2,00,000. Bounds are
// READ from that file's own constants at the top of this section (not
// reinvented) — keep both in sync by hand, same convention as
// MAINBOARD_ISSUE_SIZE_FLOOR/SME_ISSUE_SIZE_FLOOR above. A FIXED_PRICE issue
// is exempt (data-validation.ts exempts it for the same reason: its minimum
// investment is not bounded the way SEBI's retail-lot band assumes
// book-building). This is the DB-read-side companion to that scraper-side
// write gate — a Kanohar-shape row (lot 23 x a misread cap of 82 = Rs1,886)
// reaching the DB by any other path is caught here too.
export const MAINBOARD_LOT_ECONOMICS_MIN = 10000;
export const MAINBOARD_LOT_ECONOMICS_MAX = 16000;
export const SME_LOT_ECONOMICS_MIN = 100000;
export const SME_LOT_ECONOMICS_MAX = 200000;

export function checkLotEconomicsRetailRange(row) {
  const lot = toNumber(row.lot_size);
  const cap = toNumber(row.price_range_max);
  if (lot === null || cap === null) return null;
  if (row.issue_type === 'FIXED_PRICE') return null;
  const minInvestment = lot * cap;
  if (row.segment === 'MAINBOARD' &&
      (minInvestment < MAINBOARD_LOT_ECONOMICS_MIN || minInvestment > MAINBOARD_LOT_ECONOMICS_MAX)) {
    return `MAINBOARD minimum investment (lot ${lot} x cap ${cap} = ${minInvestment}) outside the SEBI ICDR Reg 32(1) retail range [${MAINBOARD_LOT_ECONOMICS_MIN}..${MAINBOARD_LOT_ECONOMICS_MAX}]`;
  }
  if (row.segment === 'SME' &&
      (minInvestment < SME_LOT_ECONOMICS_MIN || minInvestment > SME_LOT_ECONOMICS_MAX)) {
    return `SME minimum investment (lot ${lot} x cap ${cap} = ${minInvestment}) outside the SEBI ICDR Chapter IX retail range [${SME_LOT_ECONOMICS_MIN}..${SME_LOT_ECONOMICS_MAX}]`;
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

// ---- Check 14: a stored company website that cannot be a URL ---------------
// #582. `Hy-Tech Engineers Ltd.` carried `https://www.hy{echengineers.com` — a
// brace where a `t` belongs. The host does not resolve (ENOTFOUND), while the
// real `www.hytechengineers.com` answers on two public addresses, so the
// company's own filings were unreachable because of ONE character.
//
// It surfaced wearing the wrong clothes: the download guard reported it as
// "resolves to a private address", because every fail-closed path shared that
// one message. A wrong reason is how a data defect hides as a security event.
//
// The alphabet is RFC 3986's unreserved + reserved set. Anything outside it in
// a stored URL is corruption, not an exotic address — a real URL would have
// been percent-encoded before it was stored.
const URL_ALPHABET = /^[A-Za-z0-9:/?#[\]@!$&'()*+,;=._~%-]+$/;

export function checkCompanyWebsiteCharacters(row) {
  const raw = row.company_website;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  // TRIMMED before testing, not merely before the emptiness check. The first
  // version tested the untrimmed string, so a trailing space - one of the most
  // common scrape artefacts there is - was reported as URL corruption. A check
  // that reds a nightly gate on legal data is the defect it was written to stop.
  const site = raw.trim();
  if (URL_ALPHABET.test(site)) return null;

  // An internationalised domain is LEGAL and is not corruption. .bharat is a
  // live Indian TLD, which matters rather more on this project than most, and a
  // unicode path is legal too. `new URL` punycodes the host and percent-encodes
  // the path, so a URL that normalises cleanly is fine no matter how it was
  // typed. Only something that survives normalisation still carrying an
  // out-of-alphabet character - or that will not parse as a URL at all - is
  // corruption.
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(site);
    const normalised = new URL(hasScheme ? site : `https://${site}`).href;
    if (URL_ALPHABET.test(normalised)) return null;
  } catch {
    // falls through to the report below: unparseable IS the finding
  }

  const bad = [...new Set(Array.from(site).filter((c) => !URL_ALPHABET.test(c)))].join('');
  return `company_website contains character(s) outside the URL alphabet (${JSON.stringify(bad)}): ${site}`;
}

export const SUBSTANCE_CHECKS = [
  { key: 'date_ordering', name: 'Date ordering (open<=close<allotment<listing)', predicate: checkDateOrdering },
  { key: 'lot_size', name: 'lot_size in [1..100000]', predicate: checkLotSize },
  { key: 'price_band', name: 'price band (min>0, min<=max)', predicate: checkPriceBand },
  { key: 'degenerate_bookbuilding_band', name: 'a one-price band is the face value, contradicts the real issue price, or the book is still open', predicate: checkDegenerateBookbuildingBand },
  { key: 'issue_size', name: 'issue_size > 0', predicate: checkIssueSize },
  { key: 'issue_size_segment_floor', name: 'issue_size >= segment floor when a band is present', predicate: checkIssueSizeSegmentFloor },
  { key: 'lot_economics_retail_range', name: 'lot x cap within the SEBI retail range (MAINBOARD/SME)', predicate: checkLotEconomicsRetailRange },
  { key: 'isin_format', name: 'ISIN format IN[E|F]{9 alnum}', predicate: checkIsinFormat },
  { key: 'name_quality', name: 'name has no trailing status token', predicate: checkNameQuality },
  { key: 'listing_performance', name: 'listing_price>0 & gain in [-90..900]%', predicate: checkListingPerformance },
  { key: 'gmp_sanity', name: 'latest GMP premium in [-50..200]% of issue price', predicate: checkGmpSanity, optional: true },
  { key: 'registrar_quality', name: 'registrar free of address/contact pollution', predicate: checkRegistrarQuality },
  { key: 'company_website_characters', name: 'company_website free of characters outside the URL alphabet', predicate: checkCompanyWebsiteCharacters },
];
