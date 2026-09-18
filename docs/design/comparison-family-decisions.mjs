// docs/design/comparison-family-decisions.mjs — S3b step 1 Layer 3 (issue #775).
//
// The generator (scripts/generate-field-manifest.mjs) resolves `comparisonFamily`
// in three layers, exactly as `unitForField()` already layers `unit`:
//   Layer 1 — docs/design/probes/amount-columns.out.json (structural, 100 fields)
//   Layer 2 — the schema.ts column DECLARATION LINE (structural, DATE/BOOLEAN/
//             SET-or-ABSTAIN for array-jsonb; regex anchored to the declaration,
//             never a byte-window lookahead — see the plan's false-positive note)
//   Layer 3 — THIS FILE, for what layers 1 and 2 leave as a human call: plain
//             text/varchar fields (IDENTITY vs IDENTIFIER), the 11 integer
//             columns the probe does not cover, and the enum columns.
//
// Every entry states its family AND a one-line reason. Never a bare list — a
// reason-less entry here would be exactly the "guessed from naming" mistake
// this whole slice exists to avoid.
//
// The three human decisions this file encodes (docs/design/s3b-verdict-plan.md
// "THE THREE REMAINING HUMAN DECISIONS"):
//   (a) the 42 text fields: IDENTITY vs IDENTIFIER
//   (b) the 13 array/jsonb fields: SET (6 true sets of scalars) vs ABSTAIN
//       (7 structured lists of objects) — encoded as ARRAY_FAMILY_DECISIONS
//       below because layer 2 can DETECT "this is an array/jsonb column" but
//       cannot decide SET-of-scalars vs list-of-objects from the type alone.
//   (c) the 11 integer columns absent from the amount-columns probe: MONEY,
//       RATIO, or IDENTIFIER, one look each.
// Plus the 10 enum columns (exact-match category codes -> IDENTIFIER) and the
// free-text columns (prose -> ABSTAIN), decided the same way: one reason each.

// ---- (b) array/jsonb: SET (unordered multiset of scalars) vs ABSTAIN (list of objects) ----
export const ARRAY_FAMILY_DECISIONS = {
  'ipos.listing_exchanges': {
    family: 'SET',
    reason: 'jsonb array of exchange codes (NSE/BSE) — an unordered multiset of scalars, borrows the element key from unionSetValues (data-consolidation-service.ts:459)',
  },
  'ipo_details.exchanges': {
    family: 'SET',
    reason: 'text[] of exchange codes — same shape as ipos.listing_exchanges, unordered multiset of scalars',
  },
  'ipo_details.sponsor_banks': {
    family: 'SET',
    reason: 'text[] of bank names — an unordered multiset of scalars (order of listing is not meaningful)',
  },
  'ipo_details.sub_categories_upi': {
    family: 'SET',
    reason: 'text[] of UPI sub-category codes (e.g. IND, EMP) — an unordered multiset of scalars',
  },
  'ipos.lead_managers': {
    family: 'SET',
    reason: 'jsonb array of lead-manager names — an unordered multiset of scalars',
  },
  'ipo_details.lead_managers': {
    family: 'SET',
    reason: 'text[] of lead-manager names — same shape as ipos.lead_managers, unordered multiset of scalars',
  },
  'anchor_investors.investor_list': {
    family: 'ABSTAIN',
    reason: 'jsonb array of investor OBJECTS (IndividualInvestor) — "same list of objects" needs a key, an ordering policy and an optional-field policy; that is a slice of its own. Explicitly abstains from consensus rather than reaching the string comparator and marking every anchor list permanently DISPUTED on JSON key-order noise.',
  },
  'ipos.objectives': {
    family: 'ABSTAIN',
    reason: 'jsonb array of IPOObjective objects ({serial, description, amount}) — a list of objects, same reasoning as anchor_investors.investor_list',
  },
  'ipo_details.category_details': {
    family: 'ABSTAIN',
    reason: 'jsonb object of category codes — structured, not a flat scalar set; abstains rather than string-compare a JSON blob',
  },
  'ipo_details.bid_windows': {
    family: 'ABSTAIN',
    reason: 'jsonb array of bid-window objects — a list of objects, same reasoning as anchor_investors.investor_list',
  },
  'ipo_details.allocation_pct': {
    family: 'ABSTAIN',
    reason: 'jsonb object of per-category allocation percentages — structured, not a flat scalar set',
  },
  'ipo_risk_factors.kpis': {
    family: 'ABSTAIN',
    reason: 'jsonb array of KPI objects — a list of objects, same reasoning as anchor_investors.investor_list',
  },
  'ipo_details.promoter_group_transactions_since_drhp': {
    family: 'ABSTAIN',
    reason: 'jsonb array of transaction objects — a list of objects, same reasoning as anchor_investors.investor_list',
  },
};

// ---- (c) integer columns absent from the amount-columns probe (11 fields) ----
export const NUMERIC_FAMILY_DECISIONS = {
  'ipos.lot_size': { family: 'MONEY', reason: 'a share count (lot size) — same tolerant-numeric treatment as the probe\'s SHARE_COUNT class' },
  'ipos.price_range_min': { family: 'MONEY', reason: 'a rupee price-band bound' },
  'ipos.price_range_max': { family: 'MONEY', reason: 'a rupee price-band bound' },
  'ipos.face_value': { family: 'MONEY', reason: 'a rupee-per-share amount' },
  'ipo_details.lot_multiple': { family: 'RATIO', reason: 'a multiple (lot size steps) — same treatment as the probe\'s MULTIPLE class' },
  'ipo_details.retail_max_allottees': { family: 'MONEY', reason: 'a count of allottees — same tolerant-numeric treatment as the probe\'s SHARE_COUNT class' },
  'financial_statements.fiscal_year': { family: 'IDENTIFIER', reason: 'a calendar year (e.g. 2024) — exact match is correct; a 0.5% MONEY tolerance on a year is meaningless and would mask a genuinely wrong year' },
  'ipo_risk_factors.seq': { family: 'IDENTIFIER', reason: 'a display-order integer, not an amount (schema.ts comment: "re-derived from array position on every write and no longer load-bearing for identity") — exact match, no tolerance' },
  'brlm_track_record.issues_3y': { family: 'MONEY', reason: 'a count of issues brought out in the last 3 years — same tolerant-numeric treatment as the probe\'s SHARE_COUNT class' },
  'brlm_track_record.closed_below_issue_price': { family: 'MONEY', reason: 'a count of issues that closed below their issue price — same tolerant-numeric treatment as the probe\'s SHARE_COUNT class' },
  'anchor_investors.anchor_investors_count': { family: 'MONEY', reason: 'a count of anchor investors — same tolerant-numeric treatment as the probe\'s SHARE_COUNT class' },
};

// ---- (a) plain text/varchar fields: IDENTITY vs IDENTIFIER (42 fields) ----
export const TEXT_FAMILY_DECISIONS = {
  // IDENTIFIER — exact match, case-sensitive codes/contact identifiers. There
  // is no close-enough for an identifier (normalization-engine.ts comment).
  'ipos.symbol': { family: 'IDENTIFIER', reason: 'exchange trading symbol — exact match, no fuzzy equivalence' },
  'ipos.isin': { family: 'IDENTIFIER', reason: 'ISIN — exact match, no fuzzy equivalence' },
  'ipo_details.isin': { family: 'IDENTIFIER', reason: 'ISIN — exact match, no fuzzy equivalence' },
  'ipos.cin': { family: 'IDENTIFIER', reason: 'Corporate Identification Number — exact match, no fuzzy equivalence' },
  'ipos.company_website': { family: 'IDENTIFIER', reason: 'a URL — exact match, no fuzzy equivalence' },
  'ipo_details.compliance_officer_phone': { family: 'IDENTIFIER', reason: 'a phone number — exact match, no fuzzy equivalence' },
  'ipo_details.compliance_officer_email': { family: 'IDENTIFIER', reason: 'an email address — exact match, no fuzzy equivalence' },
  'ipo_details.company_phone': { family: 'IDENTIFIER', reason: 'a phone number — exact match, no fuzzy equivalence' },
  'ipo_details.company_email': { family: 'IDENTIFIER', reason: 'an email address — exact match, no fuzzy equivalence' },
  'ipo_details.company_pincode': { family: 'IDENTIFIER', reason: 'a postal code — exact match, no fuzzy equivalence' },
  'ipo_details.registrar_link': { family: 'IDENTIFIER', reason: 'a URL — exact match, no fuzzy equivalence' },
  'ipo_details.upi_cutoff_time': { family: 'IDENTIFIER', reason: 'a time-of-day string (e.g. "5:00 PM") — exact match; not a DATE (no calendar date component) and not an amount' },
  'ipo_intermediaries.sebi_reg_no': { family: 'IDENTIFIER', reason: 'a SEBI registration number — exact match, no fuzzy equivalence' },
  'ipo_intermediaries.phone': { family: 'IDENTIFIER', reason: 'a phone number — exact match, no fuzzy equivalence' },
  'ipo_intermediaries.email': { family: 'IDENTIFIER', reason: 'an email address — exact match, no fuzzy equivalence' },
  'ipo_intermediaries.grievance_email': { family: 'IDENTIFIER', reason: 'an email address — exact match, no fuzzy equivalence' },
  'registrars.email': { family: 'IDENTIFIER', reason: 'an email address — exact match, no fuzzy equivalence' },
  'registrars.phone': { family: 'IDENTIFIER', reason: 'a phone number — exact match, no fuzzy equivalence' },
  'registrars.website': { family: 'IDENTIFIER', reason: 'a URL — exact match, no fuzzy equivalence' },

  // IDENTITY — names, compared after folding corporate forms so "Pvt Ltd" and
  // "Private Limited" are one entity, not two.
  'ipos.company_name': { family: 'IDENTITY', reason: 'a company name — fold corporate forms before comparing (Pvt Ltd / Private Limited is one company)' },
  'ipos.registrar': { family: 'IDENTITY', reason: 'a registrar/RTA name — fold corporate forms before comparing' },
  'promoters.name': { family: 'IDENTITY', reason: 'a person/entity name — fold corporate forms before comparing' },
  'ipo_intermediaries.name': { family: 'IDENTITY', reason: 'an intermediary firm name — fold corporate forms before comparing' },
  'brlm_track_record.brlm_name': { family: 'IDENTITY', reason: 'a BRLM firm name — fold corporate forms before comparing' },
  'peer_companies.company_name': { family: 'IDENTITY', reason: 'a company name — fold corporate forms before comparing' },
  'registrars.name': { family: 'IDENTITY', reason: 'a registrar/RTA name — fold corporate forms before comparing' },
  'registrars.short_name': { family: 'IDENTITY', reason: 'a registrar short name — fold corporate forms before comparing' },
  'ipo_details.compliance_officer': { family: 'IDENTITY', reason: 'a person name — fold corporate forms before comparing (title variations)' },
  'ipo_intermediaries.contact_person': { family: 'IDENTITY', reason: 'a person name — fold corporate forms before comparing (title variations)' },
  'ipo_details.company_address': { family: 'IDENTITY', reason: 'a postal address — free-form text describing the same physical place, not an exact-match identifier; treated as identity text (abbreviation variance expected, not disagreement)' },
  'registrars.address': { family: 'IDENTITY', reason: 'a postal address — same reasoning as ipo_details.company_address' },
  'ipo_details.company_city': { family: 'IDENTITY', reason: 'a city name — free-form text naming the same place' },
  'ipo_details.company_state': { family: 'IDENTITY', reason: 'a state name — free-form text naming the same place' },
  'ipo_details.designated_exchange': { family: 'IDENTITY', reason: 'an exchange name (e.g. "BSE Limited" vs "BSE") — free-form text naming the same entity, not a strict code' },
  'ipos.sector': { family: 'IDENTITY', reason: 'a sector/industry label — free-form text naming the same category, sources phrase it differently' },

  // ABSTAIN — free prose. Two independent sources never produce identical
  // text; permanent DISPUTED on every row buries the real disputes.
  'ipos.company_description': { family: 'ABSTAIN', reason: 'free-form prose — two sources never produce identical text' },
  'ipo_details.company_description': { family: 'ABSTAIN', reason: 'free-form prose — two sources never produce identical text' },
  'ipo_valuation.pe_not_ascertainable_reason': { family: 'ABSTAIN', reason: 'free-form prose explaining why PE could not be computed — two sources never phrase it identically' },
  'ipo_risk_factors.heading': { family: 'ABSTAIN', reason: 'free-form prose (risk factor heading) — two sources never produce identical text' },
  'ipo_risk_factors.body': { family: 'ABSTAIN', reason: 'free-form prose (risk factor body) — two sources never produce identical text' },
  'ipo_details.sebi_regulation_cited': { family: 'ABSTAIN', reason: 'free-form prose citing a SEBI regulation clause — phrasing varies by source' },
  'ipo_details.ipo_market_timings': { family: 'ABSTAIN', reason: 'free-form prose describing market timing windows — phrasing varies by source' },
};

// ---- enum columns (10 fields): exact-match category codes -> IDENTIFIER ----
export const ENUM_FAMILY_DECISION = {
  family: 'IDENTIFIER',
  reason: 'a database enum column — a fixed set of category codes compared exactly, no fuzzy equivalence (a wrong enum value is a wrong value, not a rounding difference)',
};
