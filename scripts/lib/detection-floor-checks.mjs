// Pure predicates for the T-335 "detection floor" — the round-7 fresh-review
// coverage floor promoted into FAIL-level nightly-audit checks (see
// docs/reviews/round-7-detection-rca.md and evidence/2026-08-26-T-322/DETECTION-RCA.md).
//
// Every predicate here is PURE: no DB, no IO, no clock, no network — same
// convention as scripts/lib/substance-checks.mjs, which these checks
// deliberately do NOT duplicate (that file owns per-row SHAPE plausibility;
// this file owns the round-7 classes that shape checks provably missed:
// cross-source disagreement on a live IPO, magnitude/cross-field consistency,
// SEBI-window economics, freshness-per-type, wire-or-retire, and a handful of
// small P3 gates). Each predicate returns either `null` (pass) or a
// human-readable violation string (fail) — consumed by
// scripts/audit-detection-floor.mjs, and unit-tested against round-7-shaped
// fixtures in scripts/tests/audit-detection-floor.test.mjs.

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---- named thresholds (not magic numbers) ----------------------------------

export const LIVE_STATUSES = ['OPEN', 'UPCOMING'];

// Fields whose disagreement between sources is high-stakes enough that an
// unresolved conflict on a LIVE IPO must never sail through to a rendered page.
// Mirrors scraper/src/services/cross-source-disagreement-monitor.ts
// HIGH_VALUE_FIELDS exactly (that module is TypeScript, imported at scraper
// runtime via tsx; this audit script runs as plain Node .mjs on the box with
// no TS toolchain, so the set is mirrored rather than imported — same
// convention as this file's DB-pool-config comment in audit-ipo-coverage.mjs).
// issueSize/lotSize magnitude problems are covered separately by (c)/(d) below.
export const HIGH_VALUE_FIELDS = ['priceRangeMin', 'priceRangeMax', 'openDate', 'closeDate'];

// issue_size floor by segment, in RUPEES (schema: issueSize is INR rupees).
export const ISSUE_SIZE_FLOOR_RUPEES = {
  MAINBOARD: 10_00_00_000, // Rs 10 Cr
  SME: 1_00_00_000, // Rs 1 Cr
};

// issue_size vs (sharesOffered x priceRangeMax) plausibility band (T-452).
//
// `ipos.issue_size` is the TOTAL issue size INCLUDING OFS (owner decision
// 2026-09-07; schema.ts documents fresh_issue + ofs_issue summing to
// issue_size). `subscriptions.shares_offered` is the NET public offer
// (excludes anchor/market-maker allocations). Because the numerator (total,
// incl. OFS + anchor) is structurally larger than the denominator's basis
// (net public offer only), total / (shares x cap) LEGITIMATELY runs
// 1.0-1.9x on real rows (Meesho 1.76x, Wakefit 1.82x, Aequs 1.77x) — a
// SYMMETRIC +/-25% band around 1.0 false-positived every one of them. The
// band is now ONE-SIDED under the total-incl-OFS definition: a ratio far
// BELOW 1 still means "share count stored as rupees" (wrong unit down —
// c_issue_size_floor already catches most of this class by an absolute
// floor, this check catches it relative to the row's own shares/price); a
// ratio far ABOVE the upper multiple means "wrong unit up" (e.g. a value
// scaled by 100x). Values legitimately clearing 1.0-1.9x from OFS/anchor
// inclusion must NOT fail.
export const ISSUE_SIZE_CONSISTENCY_LOWER_MULTIPLIER = 0.75;
export const ISSUE_SIZE_CONSISTENCY_UPPER_MULTIPLIER = 3.0;

// SEBI retail lot-value window (lot_size x upper price band), in rupees, by segment.
// MAINBOARD book-built retail applications are steered to ~Rs10k-15k; SME minimum
// application sizes run far higher (~Rs1-2 lakh). Margins added both sides so a
// borderline-but-legitimate issue doesn't false-positive.
export const LOT_VALUE_WINDOW_RUPEES = {
  MAINBOARD: [8_000, 20_000],
  SME: [90_000, 3_00_000],
};

// Corporate-action shape: fixed price (min===max), the near-universal lot_size=100
// corporate-action default, and a 10-14 day "bidding window" — the exact shape of
// the seven round-7 polluting rows (KWALITY WALLS, MORGANITE CRUCIBLE, etc).
export const CORPORATE_ACTION_LOT_SIZE = 100;
export const CORPORATE_ACTION_WINDOW_DAYS_MIN = 10;
export const CORPORATE_ACTION_WINDOW_DAYS_MAX = 14;

// Conflict-noise ratio ceiling (P2-6): empty value2 or value1===value2 among
// unresolved conflicts must stay under this fraction.
export const CONFLICT_NOISE_RATIO_MAX = 0.05;

// Newest-row-age ceiling per offering_type, in days (P2-10: OFS frozen 78 days).
export const FRESHNESS_MAX_AGE_DAYS = {
  IPO: 3,
  SME: 3,
  OFS: 21,
  NCD: 21,
  RIGHTS: 21,
};

// pm2 log file size ceiling in bytes (P2-11).
export const PM2_LOG_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// A dead/degraded source must be either healthy again or carry a documented
// retire-by decision within this many consecutive degraded cycles (P3-6).
export const DEAD_SOURCE_MAX_DEGRADED_CYCLES = 7;

// Minimum acceptable population percentage for `sector` (P3-1). Deliberately
// not 100% — a freshly-scraped IPO may not have sector enriched yet — but 0%
// (today's live value) must FAIL.
export const SECTOR_MIN_POPULATED_PCT = 50;

// ---- (a)/(b): live IPO vs unresolved cross-source conflict -----------------
// One shared predicate for both item (a) (date fields specifically) and item
// (b) (any HIGH_VALUE field): a LIVE IPO (OPEN/UPCOMING) MUST NOT publish a
// value that has an unresolved cross-source disagreement recorded against it.
// This is P1-1 + P1-2 in one check: detection (data_conflicts already records
// the disagreement) is now WIRED to a FAIL, not just an FYI page.
export function checkNoUnresolvedConflictOnLiveIpo(row) {
  if (!LIVE_STATUSES.includes(row.status)) return null;
  if (!row.hasUnresolvedConflict) return null;
  return `${row.fieldName} is LIVE (status=${row.status}) but has an unresolved cross-source conflict (${row.source1}="${row.value1}" vs ${row.source2}="${row.value2}") — the published value may be wrong (P1-1/P1-2 class)`;
}

// ---- (c): issue_size plausibility -------------------------------------------

export function checkIssueSizeSegmentFloor(row) {
  const size = toNumber(row.issueSize);
  if (size === null || size <= 0) return null; // absence/zero is substance-checks.mjs's job
  const floor = ISSUE_SIZE_FLOOR_RUPEES[row.segment];
  if (floor === undefined) return null; // no floor defined for this segment (e.g. null segment)
  if (size < floor) {
    // DO NOT ASSERT THE MECHANISM UNLESS THE ROW CARRIES SOMETHING THAT TESTS IT.
    // This message used to end "looks like a share count stored as rupees, not a
    // rupee issue size" for every row below the floor. That claim is FALSE for the
    // two rows it is actually printed about on production: NIRBHAY COLOURS INDIA
    // and PIYUSH LIMITED had their issue_size independently verified CORRECT
    // against the BSE source (lane C item 14 slice 2, issue #472) - their defect is
    // the segment/offering_type, not the size. Naming one mechanism for a
    // population with more than one sends a triager to the wrong write path.
    //
    // #608 removed the same claim from the OTHER implementation of this predicate
    // (scripts/lib/substance-checks.mjs) and missed this copy, because nothing
    // watched this pair. scripts/tests/detection-floor-issue-size-select.test.mjs
    // is that missing instrument.
    const real = toNumber(row.authoritative_issue_price);
    const base = `issue_size (Rs${size.toLocaleString('en-IN')}) is below the ${row.segment} floor of Rs${floor.toLocaleString('en-IN')}`;
    if (real !== null && real > 0) {
      // A real price exists, so the share-count reading is TESTABLE - say with what.
      const asShares = size * real;
      return `${base} — at the authoritative issue price of ${real} this figure would be Rs${asShares.toLocaleString('en-IN')} if it is a share count`;
    }
    return `${base} — no authoritative issue price is on record, so whether this is a share count stored as rupees or a genuinely small issue is untested here`;
  }
  return null;
}

export function checkIssueSizeSharesConsistency(row) {
  const size = toNumber(row.issueSize);
  const shares = toNumber(row.sharesOffered);
  const price = toNumber(row.priceRangeMax);
  if (size === null || size <= 0 || shares === null || shares <= 0 || price === null || price <= 0) return null;
  const estimated = shares * price;
  const ratio = size / estimated;
  if (ratio < ISSUE_SIZE_CONSISTENCY_LOWER_MULTIPLIER) {
    return `issue_size (${size}) is far BELOW shares_offered x price_range_max (${shares} x ${price} = ${estimated}, ratio ${ratio.toFixed(3)} < ${ISSUE_SIZE_CONSISTENCY_LOWER_MULTIPLIER}) — looks like a share count or wrong-unit value stored in issue_size, not the total issue size incl. OFS`;
  }
  if (ratio > ISSUE_SIZE_CONSISTENCY_UPPER_MULTIPLIER) {
    return `issue_size (${size}) is far ABOVE shares_offered x price_range_max (${shares} x ${price} = ${estimated}, ratio ${ratio.toFixed(3)} > ${ISSUE_SIZE_CONSISTENCY_UPPER_MULTIPLIER}) — looks like a wrong-unit-up value, not the total issue size incl. OFS`;
  }
  return null;
}

// ---- (c, source capability): current provenance must be a source the -------
// manifest actually ranks as CAPABLE for ipos.issue_size. Item 14 measured
// (2026-09-24, staging): 8 LISTED + 7 CLOSED IPO rows currently source their
// issueSize from BSE, which the manifest (`scraper/config/field-manifest.json`,
// #728) marks `capable: false` — BSE measured 41-76% below the printed total
// offer on 6/6 live mainboard IPOs. This predicate is what would have caught
// that BEFORE it aged into 15 rows: any write whose source the manifest does
// not list as capable for this field is a defect regardless of segment,
// status, or whether a price cap exists to cross-check against.
//
// `field_sources.source` (the Postgres `scraper_source` enum) has no `DOC`
// member — every filing document type collapses to the writer value `DRHP`
// (scraper/src/config/field-source-codes.ts, mirrored here in plain JS since
// this audit runs with no TS toolchain, same convention as HIGH_VALUE_FIELDS
// above). `ADMIN` is a manual override that always wins and is never listed
// in the manifest's capability map for any field — it is never flagged here.
export function manifestCodeForWriterSource(writerSource) {
  return writerSource === 'DRHP' ? 'DOC' : writerSource;
}

/**
 * @param {{ source: string|null, companyName?: string, slug?: string, issueSize?: number|string|null }} row
 * @param {Record<string, { capable?: boolean, reason?: string }>|null|undefined} capability
 *   `field-manifest.json`'s `fields['ipos.issue_size'].capability` map.
 */
export function checkIssueSizeSourceCapability(row, capability) {
  if (!row.source) return null; // no provenance row at all — a different check's job (d_segment_provenance's sibling)
  if (row.source === 'ADMIN') return null; // manual override always wins, never ranked
  if (!capability) return null; // manifest unreadable — caller reports UNVERIFIABLE, not a false PASS
  const manifestCode = manifestCodeForWriterSource(row.source);
  const cap = capability[manifestCode];
  if (cap && cap.capable === true) return null;
  const value = row.issueSize === null || row.issueSize === undefined ? 'NULL' : row.issueSize;
  return `issue_size=${value} is currently sourced from ${row.source} (manifest code ${manifestCode}), which field-manifest.json does${cap ? '' : ' (no entry at all)'} NOT rank as capable for ipos.issue_size`;
}

/**
 * Item 14 slice 4: `checkIssueSizeSharesConsistency` returns null BOTH for a row
 * it examined and found clean AND for a row it could not examine at all. That
 * conflation is why the check could report "0 violation(s)" while looking at
 * 24 of 277 production rows (8.7%) - and while skipping the exact two rows
 * `c_issue_size_floor` was failing on. This predicate is the missing half: it
 * says whether the row carries the data the check needs.
 */
export function issueSizeConsistencyExaminable(row) {
  const size = toNumber(row.issueSize);
  const shares = toNumber(row.sharesOffered);
  const price = toNumber(row.priceRangeMax);
  return size !== null && size > 0 && shares !== null && shares > 0 && price !== null && price > 0;
}

/**
 * Runs the consistency check over a population and reports COVERAGE alongside
 * the verdict. A scan that examined nothing returns UNVERIFIABLE, never PASS -
 * an unexaminable population is the audit being blind, not the data being clean.
 */
export function summariseIssueSizeConsistency(rows) {
  const violations = [];
  let examined = 0;
  for (const row of rows) {
    if (!issueSizeConsistencyExaminable(row)) continue;
    examined++;
    const v = checkIssueSizeSharesConsistency(row);
    if (v) violations.push({ row, message: v });
  }
  const total = rows.length;
  const skipped = total - examined;
  const status = examined === 0 ? 'UNVERIFIABLE' : violations.length === 0 ? 'PASS' : 'FAIL';
  const coverage = `examined ${examined} of ${total} row(s), ${skipped} skipped (no shares_offered / issue_size / price_range_max)`;
  const detail =
    examined === 0
      ? `${coverage} — nothing could be checked, so this is NOT a pass`
      : `${violations.length} violation(s); ${coverage}`;
  return { status, examined, skipped, total, violations, detail };
}

// ---- (d): lot x band SEBI window + corporate-action shape ------------------

export function checkLotBandSebiWindow(row) {
  if (row.offeringType !== 'IPO') return null;
  const lot = toNumber(row.lotSize);
  const priceMax = toNumber(row.priceRangeMax);
  if (lot === null || lot <= 0 || priceMax === null || priceMax <= 0) return null;
  const window = LOT_VALUE_WINDOW_RUPEES[row.segment];
  if (!window) return null; // no window defined for this segment
  const lotValue = lot * priceMax;
  const [min, max] = window;
  if (lotValue < min || lotValue > max) {
    return `lot_size x price_range_max (${lot} x Rs${priceMax} = Rs${lotValue.toLocaleString('en-IN')}) is outside the ${row.segment} SEBI retail window [Rs${min.toLocaleString('en-IN')}..Rs${max.toLocaleString('en-IN')}]`;
  }
  return null;
}

export function checkCorporateActionShape(row) {
  if (row.offeringType !== 'IPO') return null;
  const min = toNumber(row.priceRangeMin);
  const max = toNumber(row.priceRangeMax);
  const lot = toNumber(row.lotSize);
  const windowDays = toNumber(row.windowDays);
  if (min === null || max === null || lot === null || windowDays === null) return null;
  if (min <= 0 || min !== max) return null;
  if (lot !== CORPORATE_ACTION_LOT_SIZE) return null;
  if (windowDays < CORPORATE_ACTION_WINDOW_DAYS_MIN || windowDays > CORPORATE_ACTION_WINDOW_DAYS_MAX) return null;
  return `row is typed offering_type=IPO but matches the corporate-action shape (fixed price Rs${min}, lot_size=${lot}, ${windowDays}-day window) — likely a demerger/scheme-of-arrangement mistyped as an IPO`;
}

// ---- (e): API route sweep — pure response classifier -----------------------
// hit(status, bodyText) is done by the orchestrator (needs fetch); this pure
// function only classifies an already-fetched response, so it is fixture-testable.
export const SQL_LEAK_PATTERNS = [
  /\bSELECT\b.+\bFROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b.+\bSET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\$\d+\s*[,)]/, // bound-param placeholders ($1, $2, ...) leaking into a response
  /at\s+[\w./\\-]+\.(?:ts|js|mjs):\d+:\d+/, // a stack-trace frame
];

export function classifyRouteResponse(routePath, status, bodyText) {
  const reasons = [];
  if (status >= 500) reasons.push(`HTTP ${status}`);
  const body = bodyText || '';
  for (const re of SQL_LEAK_PATTERNS) {
    if (re.test(body)) { reasons.push(`response body matches SQL/stack-trace leak pattern ${re}`); break; }
  }
  return { routePath, fail: reasons.length > 0, reasons };
}

// ---- (e, OD-61 half): no PUBLIC route payload carries a verdict or a second value --------------
// S7 (docs/design/s7-consensus-check-plan.md) half 2. The owner's words: "keep everything admin
// only... no user should not see any disagreement." Reuses the SAME e_route_sweep loop and the
// SAME already-fetched response text checkE() has in hand at the classifyRouteResponse call site
// -- a second enumeration/fetch would drift out of sync with the first and double the outbound
// traffic against a box that serves production (the plan's own "REUSE, measured" section).
// MEASURED 2026-09-19: zero occurrences of "verdict"/"witnesses" in web/app/api/** today, so this
// starts GREEN; the mutation test is adding either key to a public serializer and watching it fail.
const VERDICT_LEAK_KEYS = ['verdict', 'witnesses'];

// #897: e_verdict_leak_sweep was red 4 nights straight on the SAME offender, /api/performance/
// mainboard, because its `ipoScore.verdict` field is the public IPO RATING (rendered on the reader
// card by IPOCard.tsx via VerdictBadge) — a same-named-but-different-concept "verdict" from OD-61's
// consensus verdict (a disagreement between sources). The check matched the WORD "verdict"
// anywhere in the response text, never the CONCEPT, so a public field that has always been public
// reads as a leak forever. A permanently-red check teaches people to ignore it, which is exactly
// when a REAL OD-61 leak would go unseen.
//
// Fix is a PATH allow-list, not a schema-shape match (the smaller change the issue names): the
// `ipoScore` object is a flat DB row (packages/shared's ipoScores table — string/number/null
// values only, no nested objects per web/lib/repositories/ipo-repository.ts), so every
// `"ipoScore":{...}` (or `"ipoScore":null`) occurrence can be stripped from the body BEFORE the
// leak scan without risking swallowing an unrelated OD-61 key that happens to sit right after it.
// Anything else named `verdict`/`witnesses` anywhere else in the payload — the OD-61 shape this
// check exists to catch — still fails.
const IPO_SCORE_OBJECT_PATTERN = /\\?"ipoScore\\?"\s*:\s*(\\?\{[^{}]*\\?\}|null)/g;

export function classifyVerdictLeak(routePath, bodyText) {
  const reasons = [];
  const rawBody = bodyText || '';
  // Strip every known-public ipoScore object (by path, not by key name) before scanning — this is
  // the ONLY allow-list; every other verdict/witnesses occurrence in the payload still fails.
  const body = rawBody.replace(IPO_SCORE_OBJECT_PATTERN, '"ipoScore":null');
  // A plain substring match on the raw JSON text (not a parsed-object key walk) so a leak is
  // caught even if the key sits inside a stringified/escaped nested payload — the same
  // "match the text, not a schema" posture SQL_LEAK_PATTERNS above uses.
  //
  // The optional `\\?` before each quote is what makes that claim true. A verdict nested inside
  // a STRINGIFIED payload reaches us as `\"verdict\":`, not `"verdict":` — the escaping quote is
  // preceded by a backslash. The first version required a bare quote and therefore missed exactly
  // the nested case its own comment promised to catch; found by calling this function directly
  // with an escaped fixture rather than trusting the comment. The `?` keeps the bare form matching.
  for (const key of VERDICT_LEAK_KEYS) {
    if (new RegExp(`\\\\?["']${key}\\\\?["']\\s*:`).test(body)) {
      reasons.push(`response body contains a "${key}" JSON key — OD-61 requires this stay admin-only`);
    }
  }
  return { routePath, fail: reasons.length > 0, reasons };
}

// ---- (f): conflict noise ratio ----------------------------------------------

export function classifyConflictNoiseRatio(unresolvedTotal, noiseCount) {
  if (unresolvedTotal === 0) return { ratio: 0, fail: false };
  const ratio = noiseCount / unresolvedTotal;
  return { ratio, fail: ratio >= CONFLICT_NOISE_RATIO_MAX };
}

// ---- (g): freshness per offering_type ---------------------------------------

export function checkFreshnessPerType(offeringType, newestRowAgeDays) {
  const maxAge = FRESHNESS_MAX_AGE_DAYS[offeringType];
  if (maxAge === undefined) return null; // no freshness expectation defined for this type
  if (newestRowAgeDays === null || newestRowAgeDays === undefined) return null;
  if (newestRowAgeDays > maxAge) {
    return `newest ${offeringType} row is ${newestRowAgeDays} days old, exceeds the ${maxAge}-day freshness ceiling for this type`;
  }
  return null;
}

// ---- (h): pm2 env TZ + log size ---------------------------------------------

export function checkPm2EnvHasTz(processName, envMap) {
  if (!envMap || !envMap.TZ) {
    return `pm2 process "${processName}" has no TZ in its environment — new Date() parsing is exposed to the box's local TZ (the P1-1 enabling gap)`;
  }
  return null;
}

export function checkPm2LogSize(processName, logPath, sizeBytes) {
  if (typeof sizeBytes !== 'number') return null;
  if (sizeBytes > PM2_LOG_MAX_BYTES) {
    return `pm2 log ${logPath} for "${processName}" is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB, exceeds the ${PM2_LOG_MAX_BYTES / 1024 / 1024} MB ceiling (unrotated-log-growth class, 2026-06-13 disk-full incident)`;
  }
  return null;
}

// ---- (i): wire-or-retire — every scheduler/cron/job def is referenced ------
// Pure diff: given the set of job/scheduler identifiers DEFINED in the repo and
// the set of identifiers actually REFERENCED from a prod entrypoint (pm2
// ecosystem/start commands, crontab lines, or an imported+invoked scheduler
// module), return the defined-but-unreferenced ones — each one names a
// definition that exists on paper and never runs (P2-8's exact class).
export function findUnreferencedDefinitions(definedNames, referencedNames) {
  const referenced = new Set(referencedNames);
  return definedNames.filter((name) => !referenced.has(name));
}

// ---- (k): T-340 post-scrape step ledger -------------------------------------
// The RUNTIME twin of (i) wire_or_retire above. (i) catches a step that exists
// on paper and is never wired to prod. (k) catches the harder case: a step that
// IS wired, runs every cycle, and quietly does nothing — skipped for a reason
// nobody reads (ADMIN_API_TOKEN unset was exactly this: triggerStatusUpdate
// returned early, the cycle exited 0, statuses went stale, nothing alerted), or
// failing every cycle inside its non-fatal catch. Both shapes are "green cycle,
// dead step"; only the ledger (scraper_steps, T-340 item 1) can see the second.

/** A step failing this many cycles in a row is a live defect, not a blip. */
export const STEP_LEDGER_MAX_CONSECUTIVE_FAILURES = 3;
/** The window in which every expected step must produce at least one `ok`. */
export const STEP_LEDGER_WINDOW_HOURS = 24;

/**
 * Derive the expected-step list from the prod entrypoint's exported STEP_NAMES
 * constant. NEVER hand-type this list in the audit: a hand-typed duplicate is
 * the `i_wire_or_retire` failure class itself — a step added to index.ts and
 * forgotten in the audit would be silently unmonitored forever.
 *
 * Throws when the constant cannot be found, so the caller reports UNVERIFIABLE
 * (the audit is blind) instead of PASSing an empty expected-step list — an
 * empty list would make every check vacuously green, the T-321 silent-pass class.
 */
export function parseStepNames(indexTsSource) {
  const m = indexTsSource.match(/export\s+const\s+STEP_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/);
  if (!m) {
    throw new Error('could not parse `export const STEP_NAMES = [...] as const` from scraper/src/index.ts');
  }
  const names = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
  if (names.length === 0) {
    throw new Error('STEP_NAMES parsed but is empty — refusing to run the step-ledger checks against an empty list');
  }
  return names;
}

/**
 * FAIL when an expected step produced zero `ok` rows in the window. Deliberately
 * counts `ok` only: a step skipped every cycle for a documented reason is still
 * a step that is not doing its job, and that is the precise defect this task
 * exists for.
 */
export function checkStepSilence(stepName, okCountInWindow) {
  if (okCountInWindow > 0) return null;
  return `post-scrape step "${stepName}" has ZERO ok rows in the last ${STEP_LEDGER_WINDOW_HOURS}h `
    + `— it is wired but silently skipped or failing every cycle (T-340 runtime wire-or-retire)`;
}

/** Leading run of 'failed' in a newest-first status list. Any non-'failed' ends it. */
export function countLeadingFailures(statusesNewestFirst) {
  let n = 0;
  for (const s of statusesNewestFirst) {
    if (s !== 'failed') break;
    n += 1;
  }
  return n;
}

export function checkStepConsecutiveFailures(stepName, statusesNewestFirst) {
  const streak = countLeadingFailures(statusesNewestFirst);
  if (streak < STEP_LEDGER_MAX_CONSECUTIVE_FAILURES) return null;
  return `post-scrape step "${stepName}" has failed in ${streak} consecutive cycles `
    + `(>= ${STEP_LEDGER_MAX_CONSECUTIVE_FAILURES}) — its non-fatal catch is hiding a persistent failure`;
}

// ---- (l): T-340 NSE status cross-check ---------------------------------------
// Our OPEN/UPCOMING set is produced entirely by our own pipeline; until now
// nothing independent checked it. NSE's own current-issue + upcoming feeds are
// the primary oracle for "is this issue actually open right now".
//
// DIRECTION 1 (what we publish, checked against NSE) is deliberately scoped to
// MAINBOARD rows that name NSE among their listing exchanges — SME status
// disagreements are not checked by direction 1 (tracked separately, #895
// item 3). BSE-only issues legitimately never appear on these endpoints, so
// FAILing direction 1 on them would be pure noise — and a noisy channel gets
// muted, which is how a mechanism dies (the lesson already recorded in
// audit-detection-floor.mjs's digest design). Rows with unknown listing
// exchanges are skipped rather than guessed at.
//
// DIRECTION 2 (what NSE publishes, checked against us) matches against EVERY
// row we publish, not the MAINBOARD-scoped set. Measured 2026-09-23 on the
// prod floor run (#895): NSE's current/upcoming feeds DO carry SME issues
// (Himalayan Solar, Pooja Logistics, Coreintegra all seen), so scoping
// direction 2 to MAINBOARD reported every one of them as "we have no row for
// it at all" — a false FAIL on every nightly run for every SME IPO NSE lists.

/** Normalized lookup keys for an NSE feed: exact symbol plus normalized name. */
export function buildNseKeySet(feedRows) {
  const keys = new Set();
  for (const r of feedRows || []) {
    if (r.symbol) keys.add(String(r.symbol).trim().toUpperCase());
    if (r.companyName) keys.add(normalizeCompanyKey(r.companyName));
  }
  return keys;
}

function ourKeys(row) {
  const keys = [];
  if (row.symbol) keys.push(String(row.symbol).trim().toUpperCase());
  if (row.companyName) keys.push(normalizeCompanyKey(row.companyName));
  return keys;
}

function inScope(row) {
  if (row.segment !== 'MAINBOARD') return false;
  const ex = row.listingExchanges;
  if (!Array.isArray(ex) || ex.length === 0) return false;
  return ex.includes('NSE');
}

export function crossCheckNseStatuses({ ourRows = [], nseCurrent = [], nseUpcoming = [] }) {
  const currentKeys = buildNseKeySet(nseCurrent);
  const upcomingKeys = buildNseKeySet(nseUpcoming);
  const mismatches = [];
  const seen = new Set();
  const push = (key, companyName, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    mismatches.push({ key, companyName, message });
  };

  // Direction 1: what WE publish, checked against NSE.
  const scoped = ourRows.filter(inScope);
  for (const row of scoped) {
    const keys = ourKeys(row);
    const onCurrent = keys.some((k) => currentKeys.has(k));
    const onUpcoming = keys.some((k) => upcomingKeys.has(k));
    const label = row.companyName || keys[0];
    if (row.status === 'OPEN' && !onCurrent) {
      push(keys[0], row.companyName,
        `we publish "${label}" as OPEN, but NSE's current-issue feed does not list it (and NSE ${onUpcoming ? 'still calls it upcoming' : 'does not list it at all'})`);
    } else if (row.status === 'UPCOMING' && onCurrent) {
      push(keys[0], row.companyName,
        `NSE lists "${label}" as a CURRENT (open) issue while we still publish it as UPCOMING`);
    }
  }

  // Direction 2: what NSE publishes, checked against us. A live issue we never
  // show at all is the worse defect of the two and is invisible to direction 1.
  // Built from ALL our rows (not `scoped`) — NSE's feeds carry SME issues too.
  const openByKey = new Set();
  const knownByKey = new Set();
  for (const row of ourRows) {
    for (const k of ourKeys(row)) {
      knownByKey.add(k);
      if (row.status === 'OPEN') openByKey.add(k);
      if (row.status === 'UPCOMING') knownByKey.add(k);
    }
  }
  for (const r of nseCurrent || []) {
    const keys = buildNseKeySet([r]);
    if ([...keys].some((k) => openByKey.has(k))) continue;
    const key = [...keys][0];
    push(key, r.companyName,
      `NSE's current-issue feed lists "${r.companyName || key}" as OPEN, but we publish no OPEN row for it${[...keys].some((k) => knownByKey.has(k)) ? ' (we have the company, with a different status)' : ' (we have no row for it at all)'}`);
  }
  for (const r of nseUpcoming || []) {
    const keys = buildNseKeySet([r]);
    if ([...keys].some((k) => knownByKey.has(k) || openByKey.has(k))) continue;
    const key = [...keys][0];
    push(key, r.companyName,
      `NSE's upcoming feed lists "${r.companyName || key}", but we have no OPEN/UPCOMING row for it`);
  }

  return mismatches;
}

// ---- (j): assorted P3 gates --------------------------------------------------

export function checkSectorPopulatedPct(populatedCount, totalCount) {
  if (totalCount === 0) return null;
  const pct = (populatedCount / totalCount) * 100;
  if (pct < SECTOR_MIN_POPULATED_PCT) {
    return `sector populated for only ${populatedCount}/${totalCount} (${pct.toFixed(1)}%), below the ${SECTOR_MIN_POPULATED_PCT}% floor`;
  }
  return null;
}

export function checkCronScriptExecutable(scriptPath, mode) {
  // POSIX mode bits: owner-execute is 0o100. `mode` is the numeric st_mode
  // (or a bare permission int like 0o644/0o755) from fs.statSync().
  const isExecutable = (mode & 0o111) !== 0;
  if (!isExecutable) {
    return `${scriptPath} is not executable (mode ${mode.toString(8)}) — a cron line invoking it directly will fail with "Permission denied" (P3-5 class)`;
  }
  return null;
}

export function checkDeadSourceHasRetireBy(sourceName, consecutiveDegradedCycles, retireByDocumented) {
  if (consecutiveDegradedCycles < DEAD_SOURCE_MAX_DEGRADED_CYCLES) return null;
  if (retireByDocumented) return null;
  return `source "${sourceName}" has been DEGRADED for ${consecutiveDegradedCycles} consecutive cycles (>= ${DEAD_SOURCE_MAX_DEGRADED_CYCLES}) with no documented retire-by date`;
}

export function checkSegmentPopulatedForIpo(row) {
  if (row.offeringType !== 'IPO') return null;
  // An empty string is the round-7 P3-7 shape and is just as broken as NULL —
  // the sibling sector check already handles `<> ''` (checker finding).
  if (row.segment === null || row.segment === undefined || String(row.segment).trim() === '') {
    const shown = row.segment === null || row.segment === undefined ? 'NULL' : 'empty';
    return `offering_type=IPO row "${row.companyName}" has a ${shown} segment — segment is not nullable in intent for real IPOs`;
  }
  return null;
}

// ---- (d, segment provenance): a non-NULL segment with no field_sources row
// for it — the "asserted, not sourced" shape the binary-test write bug (lane
// C item 2 slice 3b) produced. Distinct from checkSegmentPopulatedForIpo
// above (which measures SHARE — is segment populated at all); this measures
// PRESENCE OF PROVENANCE for whatever value is stored, on every offering
// type, not just IPO — a sourced value has a field_sources row, a guessed
// one does not, and that absence is exactly what this predicate flags.
export function checkSegmentHasProvenance(row) {
  if (row.segment === null || row.segment === undefined) return null;
  if (row.hasSegmentProvenance) return null;
  return `"${row.companyName}" [${row.offeringType}] carries segment=${row.segment} with no field_sources row for segment — a value with no record of who said it`;
}

// ---- T-335 fix round 1 (checker T-335C blockers) ------------------------------
// Everything below is still PURE (no DB/IO/clock/network beyond an injected
// `now`) so each behaviour has a fixture in
// scripts/tests/audit-detection-floor.test.mjs.

// (blocker 2) The live-IPO date check must not depend on `data_conflicts`
// alone: the cross-source-disagreement monitor RESOLVES and RE-INSERTS every
// conflict each 30-minute cycle, so there is a ~11-30s window per cycle with
// zero unresolved rows — the T-335C checker observed the check PASS at
// 05:00:22Z and FAIL naming Lumino + Annu at 05:03:03Z on the same live defect.
// Worse, if that monitor ever dies the table stays empty and the check shows a
// permanent green PASS on a live wrong-date defect.
//
// So the PRIMARY signal is a LIVE FETCH of the non-NSE oracle (Chittorgarh's
// public IPO report, the same endpoint scraper/src/scrapers/chittorgarh-scraper.ts
// uses), compared against what `ipos` publishes. Nothing in our own pipeline can
// resolve it away. `data_conflicts` is kept only as a SECONDARY signal, and a
// failed oracle fetch is UNVERIFIABLE (which pages) — never a silent PASS.
//
// An earlier cut of this fix used field_sources.previous_source/previous_value
// as the independent signal. Measured on prod: 1 of 5746 rows has
// previous_source populated, so that comparison found ZERO disagreements on a
// night when two were live. It is not used.

// T-472: extended from ['openDate','closeDate'] (the Chittorgarh-oracle era,
// where Chittorgarh's price column was excluded because a lone price string
// there is not a real band) to the six fields behind the P1 classes GitHub
// #199 cited (band/lot/issue-size wrong, invisible while the only compared
// fields were dates) — now safe because the oracle is ipowatch.in, which
// publishes a real min/max band, not a single price string.
//
// T-506 (#415): 'lotSize' removed from this generic exact-match list.
// ipowatch's "minimum bid is N Shares" line (parsed into oracle.values.lotSize
// by scripts/lib/ipowatch-oracle-parser.mjs) is the MINIMUM APPLICATION size,
// not the exchange lot — for SME issues SEBI has required a 2-lot minimum
// retail application since 2025, so ipowatch prints 2x our stored
// ipos.lot_size (Qualiance International: lot_size=1000, ipowatch=2000) while
// ipos.lot_size correctly stores the exchange lot. Comparing the two directly
// (the pre-T-506 behavior) manufactured a FAIL on every live SME IPO. The lot
// pair is now compared via findLotDisagreements() (still folded into
// a_b_live_conflict, dividing the oracle figure by the segment's minimum-lot
// multiplier first) and the min-application pair via
// findMinApplicationDisagreements() (its own a_b_min_application check) —
// see scripts/audit-detection-floor.mjs checkA_B().
export const ORACLE_COMPARABLE_FIELDS = ['openDate', 'closeDate', 'priceRangeMin', 'priceRangeMax', 'issueSize'];

// SEBI ICDR minimum RETAIL application, in exchange lots, by segment. MAINBOARD
// retail applies for exactly 1 lot; SME retail has required a minimum of 2
// lots since SEBI's 2025 tightening (owner decision, T-506/#415). No stored
// field carries this directly (ipos.lot_size is the exchange lot; ipo_details
// .lotMultiple comes from the DRHP price-band-ad extractor, which is not wired
// into the prod scraper pipeline per docs/reviews — see
// ipo-data-source-map memory — so it is null for the vast majority of rows and
// is not a safe general-purpose source for this ratio). Deriving the multiplier
// from segment is therefore the class-level fix, not a per-IPO lookup.
export function minApplicationLots(segment) {
  return segment === 'SME' ? 2 : 1;
}

/**
 * (a) Lot check, folded into a_b_live_conflict: our exchange lot vs the
 * EXCHANGE lot implied by the oracle's minimum-bid-shares figure (their
 * figure divided by the segment's minimum-application-lot multiplier).
 */
export function findLotDisagreements({ ipoRows = [], oracleRows = [] }) {
  const live = ipoRows.filter((r) => LIVE_STATUSES.includes(r.status));
  const oracleByKey = new Map();
  for (const o of oracleRows) {
    const k = normalizeCompanyKey(o.companyName);
    if (k && !oracleByKey.has(k)) oracleByKey.set(k, o);
  }
  const out = [];
  for (const ipo of live) {
    const oracle = oracleByKey.get(normalizeCompanyKey(ipo.companyName));
    if (!oracle) continue;
    const ourLot = toNumber((ipo.values || {}).lotSize);
    const theirsMinApp = toNumber((oracle.values || {}).lotSize);
    if (ourLot === null || theirsMinApp === null) continue;
    const multiplier = minApplicationLots(ipo.segment);
    const impliedExchangeLot = theirsMinApp / multiplier;
    if (impliedExchangeLot === ourLot) continue;
    out.push({
      ipoId: ipo.id, companyName: ipo.companyName, fieldName: 'lotSize', signal: 'oracle',
      message: `live IPO "${ipo.companyName}" (${ipo.status}) publishes lotSize=${ourLot}, but IPOWATCH's minimum-bid figure of ${theirsMinApp} implies an exchange lot of ${impliedExchangeLot} (÷${multiplier} for ${ipo.segment ?? 'unknown segment'}) — cross-source disagreement found by this audit's own live fetch, independent of data_conflicts`,
    });
  }
  return out;
}

/**
 * (b) Separate check, a_b_min_application: our derived minimum RETAIL
 * application (exchange lot x segment multiplier) vs the oracle's own
 * "minimum bid is N Shares" figure.
 */
export function findMinApplicationDisagreements({ ipoRows = [], oracleRows = [] }) {
  const live = ipoRows.filter((r) => LIVE_STATUSES.includes(r.status));
  const oracleByKey = new Map();
  for (const o of oracleRows) {
    const k = normalizeCompanyKey(o.companyName);
    if (k && !oracleByKey.has(k)) oracleByKey.set(k, o);
  }
  const out = [];
  for (const ipo of live) {
    const oracle = oracleByKey.get(normalizeCompanyKey(ipo.companyName));
    if (!oracle) continue;
    const ourLot = toNumber((ipo.values || {}).lotSize);
    const theirsMinApp = toNumber((oracle.values || {}).lotSize);
    if (ourLot === null || theirsMinApp === null) continue;
    const multiplier = minApplicationLots(ipo.segment);
    const ourMinApplication = ourLot * multiplier;
    if (ourMinApplication === theirsMinApp) continue;
    out.push({
      ipoId: ipo.id, companyName: ipo.companyName, fieldName: 'minApplicationShares', signal: 'oracle',
      message: `live IPO "${ipo.companyName}" (${ipo.status}) implies a minimum retail application of ${ourMinApplication} shares (lot ${ourLot} x ${multiplier} for ${ipo.segment ?? 'unknown segment'}), but IPOWATCH currently says the minimum bid is ${theirsMinApp} shares`,
    });
  }
  return out;
}

// Rupee-valued fields are compared with a relative tolerance: ipowatch rounds
// ("Approx ₹40.88 Crores") and our own figures carry paisa, so an exact-equality
// compare on these two fields alone would manufacture false positives that
// dates/lot size (compared exactly, below) must never have.
const RUPEE_TOLERANCE_FIELDS = new Set(['priceRangeMin', 'priceRangeMax', 'issueSize']);
const RUPEE_TOLERANCE_PCT = 0.01;

/**
 * Field-aware disagreement: dates and lot size compare exactly (via
 * valuesDisagree below); the three rupee fields tolerate a 1% relative
 * difference before calling it a disagreement.
 */
export function fieldValuesDisagree(field, a, b) {
  if (a === null || a === undefined || a === '') return false;
  if (b === null || b === undefined || b === '') return false;
  if (RUPEE_TOLERANCE_FIELDS.has(field)) {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na === null || nb === null) return valuesDisagree(a, b);
    if (na === 0 && nb === 0) return false;
    const denom = Math.max(Math.abs(na), Math.abs(nb), 1);
    return Math.abs(na - nb) / denom > RUPEE_TOLERANCE_PCT;
  }
  return valuesDisagree(a, b);
}

const LEGAL_SUFFIXES = new Set(['ltd', 'limited', 'pvt', 'private', 'plc', 'corp', 'corporation', 'inc']);

// "Lumino Industries Limited" (ours) and "Lumino Industries Ltd." (oracle, which
// also appends single-letter status flags like a trailing " O") must key the same.
// Matching is EXACT on the normalized key, deliberately not fuzzy: a fuzzy match
// between two independent sources risks silently pairing two different
// companies (the exact failure class #344/T-485 fixed for slug resolution) —
// a live IPO simply going unmatched (skipped, not compared) is the safe failure
// mode here, not a wrong pairing.
export function normalizeCompanyKey(name) {
  if (!name) return '';
  return String(name)
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !LEGAL_SUFFIXES.has(t))
    .join(' ');
}

// Compare two scraped values the way a reader would: dates by calendar day,
// numbers numerically, everything else as a trimmed string.
export function valuesDisagree(a, b) {
  if (a === null || a === undefined || a === '') return false;
  if (b === null || b === undefined || b === '') return false;
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (sa === sb) return false;
  const na = Number(sa);
  const nb = Number(sb);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na !== nb;
  const da = new Date(sa);
  const db = new Date(sb);
  if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime())) {
    return da.toISOString().slice(0, 10) !== db.toISOString().slice(0, 10);
  }
  return true;
}

/**
 * Independent cross-source disagreement detector for live IPOs.
 *
 * ipoRows      [{ id, companyName, status, values: { openDate, closeDate, ... } }]
 * oracleRows   [{ companyName, values: { openDate, closeDate } }]  — LIVE non-NSE fetch
 * conflictRows [{ ipoId, companyName, fieldName, source1, value1, source2, value2 }] (SECONDARY)
 * returns      [{ ipoId, companyName, fieldName, signal, message }]
 */
export function findLiveCrossSourceDisagreements({ ipoRows = [], oracleRows = [], conflictRows = [], oracleName = 'CHITTORGARH' }) {
  const live = ipoRows.filter((r) => LIVE_STATUSES.includes(r.status));
  const liveById = new Map(live.map((r) => [r.id, r]));
  const oracleByKey = new Map();
  for (const o of oracleRows) {
    const k = normalizeCompanyKey(o.companyName);
    if (k && !oracleByKey.has(k)) oracleByKey.set(k, o);
  }
  const out = [];
  const seen = new Set();

  // PRIMARY — our own comparison against a source nothing in our pipeline owns.
  for (const ipo of live) {
    const oracle = oracleByKey.get(normalizeCompanyKey(ipo.companyName));
    if (!oracle) continue;
    for (const field of ORACLE_COMPARABLE_FIELDS) {
      const ours = (ipo.values || {})[field];
      const theirs = (oracle.values || {})[field];
      if (!fieldValuesDisagree(field, ours, theirs)) continue;
      const key = `${ipo.id}-${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ipoId: ipo.id, companyName: ipo.companyName, fieldName: field, signal: 'oracle',
        message: `live IPO "${ipo.companyName}" (${ipo.status}) publishes ${field}=${fmtFieldValue(field, ours)}, but ${oracleName} currently says ${fmtFieldValue(field, theirs)} — cross-source disagreement found by this audit's own live fetch, independent of data_conflicts`,
      });
    }
  }

  // SECONDARY — unresolved data_conflicts rows, when the monitor happens to
  // have one on the table at this instant. Never the only signal.
  for (const c of conflictRows) {
    const ipo = liveById.get(c.ipoId);
    if (!ipo) continue;
    if (!HIGH_VALUE_FIELDS.includes(c.fieldName)) continue;
    const key = `${c.ipoId}-${c.fieldName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ipoId: c.ipoId, companyName: ipo.companyName ?? c.companyName, fieldName: c.fieldName, signal: 'data_conflicts',
      message: `live IPO "${ipo.companyName ?? c.companyName}" (${ipo.status}) has an unresolved ${c.fieldName} conflict: ${c.source1}=${c.value1} vs ${c.source2}=${c.value2}`,
    });
  }
  return out;
}

function fmtDay(v) {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

const DATE_FIELDS = new Set(['openDate', 'closeDate']);

function fmtFieldValue(field, v) {
  if (v === null || v === undefined || v === '') return 'null';
  return DATE_FIELDS.has(field) ? fmtDay(v) : String(v);
}

// ---- (blocker 4) page-flood control: one digest per check per night ----------

export const DIGEST_MAX_ROWS = 10;

/**
 * Shape ONE Notifier payload for a whole check, instead of one page per row.
 *
 * Severity is P1 only when the check has rows that were NOT present last night
 * (a genuinely new defect); an unchanged backlog pages P2 so the owner still
 * sees the state without the channel being drowned. The dedupeKey is scoped to
 * check+date so the Notifier's 30-minute cooldown can never swallow the nightly
 * digest (a date-less key would).
 */
export function buildCheckDigest({ checkId, checkTitle, rows = [], previousRowKeys = [], date, reportPath }) {
  if (rows.length === 0) return null;
  const previous = new Set(previousRowKeys);
  const newRows = rows.filter((r) => !previous.has(r.rowKey));
  const shown = rows.slice(0, DIGEST_MAX_ROWS).map((r) => `- ${r.body ?? r.title}`);
  const more = rows.length - shown.length;
  const bodyLines = [
    `${rows.length} row(s) failing; ${newRows.length} new since the previous run.`,
    '',
    ...shown,
  ];
  if (more > 0) bodyLines.push(`- ...and ${more} more`);
  if (reportPath) bodyLines.push('', `Full report: ${reportPath}`);
  return {
    project: 'ipodhan',
    severity: newRows.length > 0 ? 'P1' : 'P2',
    title: `[detection-floor] ${checkId}: ${rows.length} failing${newRows.length ? ` (${newRows.length} new)` : ''} — ${checkTitle}`,
    body: bodyLines.join('\n'),
    type: 'detection-floor',
    dedupeKey: `detection-floor-${checkId}-${date}`,
    newCount: newRows.length,
  };
}

/**
 * (blocker 1) An UNVERIFIABLE check MUST page. A check that cannot see its
 * source is not a pass — the T-321 silent-pass class is exactly "the dependency
 * was down, so nothing was reported". P2 (the owner must look, but nothing is
 * proven broken), one page per check per night.
 */
export function buildUnverifiableDigest({ checkId, checkTitle, detail, date, reportPath }) {
  const bodyLines = [
    `Check "${checkId}" could not run: ${detail || 'source unreachable'}.`,
    '',
    'An UNVERIFIABLE check is NOT a pass — the coverage floor has a hole tonight.',
  ];
  if (reportPath) bodyLines.push('', `Full report: ${reportPath}`);
  return {
    project: 'ipodhan',
    severity: 'P2',
    title: `[detection-floor] ${checkId} UNVERIFIABLE — ${checkTitle}`,
    body: bodyLines.join('\n'),
    type: 'detection-floor',
    dedupeKey: `detection-floor-unverifiable-${checkId}-${date}`,
  };
}

/**
 * (blocker 1) Exit-code contract, documented and tested:
 *   0 — every check PASSed.
 *   1 — at least one check FAILed (a defect is live).
 *   3 — no FAIL, but at least one check is UNVERIFIABLE (the floor has a hole
 *       tonight; distinct from 1 so the cron/log can tell "broken data" from
 *       "blind audit"). FAIL dominates when both are present.
 */
export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_UNVERIFIABLE = 3;

export function computeExitCode({ failCount = 0, unverifiableCount = 0 }) {
  if (failCount > 0) return EXIT_FAIL;
  if (unverifiableCount > 0) return EXIT_UNVERIFIABLE;
  return EXIT_OK;
}

// T-465 round 3: SKIP (empty-window cross-check, "no signal", e.g.
// g_inert_detector) is its own bucket in the summary line — it must NEVER
// fall into PASS via `results.length - fail - unverifiable` subtraction, or
// a quiet night with no signal reads as "healthy".
export function computeSummaryCounts(results) {
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const unverifiable = results.filter((r) => r.status === 'UNVERIFIABLE').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  const pass = results.length - fail - unverifiable - skip;
  return { pass, fail, unverifiable, skip };
}

/**
 * (blocker 1 + 4) RUN-LEVEL payload assembly, kept here rather than in the
 * runner so the self-tests can prove the whole night's paging behaviour from
 * fixtures — including the case the T-335C checker caught, where every check is
 * UNVERIFIABLE and the first cut paged nobody and exited 0.
 *
 * results          [{ id, name, status, detail }]
 * findingsByCheck  Map|Object  checkId -> [{ rowKey, title, body }]
 * previousState    { checkId: [rowKey, ...] } from the previous run
 */
export function buildRunPayloads({ results = [], findingsByCheck = new Map(), previousState = {}, date, reportPath }) {
  const entries = findingsByCheck instanceof Map
    ? Array.from(findingsByCheck.entries())
    : Object.entries(findingsByCheck);
  const nameOf = (id) => results.find((r) => r.id === id)?.name || id;
  const payloads = [];

  for (const [checkId, rows] of entries) {
    const digest = buildCheckDigest({
      checkId, checkTitle: nameOf(checkId), rows,
      previousRowKeys: previousState[checkId] || [], date, reportPath,
    });
    if (digest) payloads.push(digest);
  }

  // An UNVERIFIABLE check pages. Always. This is the branch whose absence let
  // an all-blind night exit 0 with silence.
  for (const r of results) {
    if (r.status !== 'UNVERIFIABLE') continue;
    payloads.push(buildUnverifiableDigest({
      checkId: r.id, checkTitle: r.name, detail: r.detail, date, reportPath,
    }));
  }
  return payloads;
}

/**
 * (blocker 3) The cron-executable gate, with git injected so "git is not
 * installed" is a fixture rather than a machine state. The first cut used
 * `execOffenders.length = -1` as an "already recorded" sentinel, which throws
 * `RangeError: Invalid array length` — turning the git-missing fallback into a
 * crash that aborted the check and skipped ALL paging for that night.
 *
 * gitLsFiles: (paths) => string   — may throw; a throw means UNVERIFIABLE.
 * returns { status, offenders, detail }
 */
export function evaluateCronExecutable(paths, gitLsFiles) {
  let out;
  try {
    out = gitLsFiles(paths);
  } catch (e) {
    return { status: 'UNVERIFIABLE', offenders: [], detail: `git ls-files failed: ${e.message}` };
  }
  const offenders = [];
  for (const line of String(out).trim().split('\n').filter(Boolean)) {
    const [modeStr, , , path] = line.trim().split(/\s+/);
    const mode = parseInt(modeStr, 8) & 0o777;
    const v = checkCronScriptExecutable(path, mode);
    if (v) offenders.push({ path, violation: v });
  }
  return {
    status: offenders.length === 0 ? 'PASS' : 'FAIL',
    offenders,
    detail: offenders.length ? offenders.map((o) => o.violation).join('; ') : 'all executable',
  };
}

// ---- (i): identity — one IPO stored as two rows, or two offerings folded ----
// into one company. Step 1 of #903 (owner decisions S1/S2/S3/S4/S7,
// 2026-09-23) — detection only, no change to matching/write code. Spec
// deviation: none — implements docs/design/data-sourcing-pull-model.md
// §2.3.3.1's "standing sweep" (F-103) and §2.3.3.2's OD-34 name-bound
// reporting; §2.3.3.2's OD-35 same-offering/lapsed-draft rules are the
// MATCHING step (#903 order-of-work item 2), out of scope here.
//
// Deliberately its OWN name-fold, not a reuse of normalizeCompanyKey() above:
// that key is tuned for oracle cross-matching (drop legal suffixes only) and
// is exactly the fold that MISSED Rays of Belief (the owner's correction on
// record in #903 — "the second name carries '- For Profit Social Enterprise'").
// This fold additionally drops bracketed text and everything after a
// ' - '/'- ' separator, because S3's title-in-name pollution
// ("... - Pernia's Pop-Up Studio IPO") and S1's page-status suffix both live
// past a legal-suffix-only fold.
// PLAIN-JS TWIN of packages/shared/src/utils/identity-decoration.ts (OD-68) --
// the matching code in resolveIpoRow / IPORepository.create uses the TS copy, this
// nightly check uses this one, and scripts/tests/identity-decoration-parity.test.mjs
// imports BOTH and fails on any divergence. Change them together.
const IDENTITY_STOPWORDS = new Set([
  'limited', 'ltd', 'company', 'co', 'private', 'pvt', 'india', 'the', 'ipo',
]);
const IDENTITY_STATUS_TOKEN = /(\b(?:ltd|limited)\.?(?:\s*\([^)]*\))?)\s+(?:o|p|lt|ct)$/i;

export function stripIdentityNameDecoration(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(IDENTITY_STATUS_TOKEN, '$1').trim();
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  s = s.split(/\s+-\s+|-\s+(?=[A-Za-z])/)[0].trim();
  s = s.replace(IDENTITY_STATUS_TOKEN, '$1').trim();
  s = s.replace(/\s+(IPO|FPO)$/i, '').trim();
  return s;
}

export function normalizeIdentityCompanyName(name) {
  if (!name) return '';
  const s = stripIdentityNameDecoration(name).replace(/\([^)]*\)/g, ' ');
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !IDENTITY_STOPWORDS.has(t))
    .join(' ');
}

// S1: a page-status suffix (-o/-p/-lt/-ct) appended to an otherwise identical
// slug. Stripped BEFORE matching, per the owner's decision text verbatim.
export function stripIdentitySlugSuffix(slug) {
  if (!slug) return '';
  return String(slug).replace(/-(ltd|limited)-(?:o|p|lt|ct)$/i, '-$1');
}

// The identifiers the §2.3.3.1 "standing sweep" groups by: "every row by each
// identifier it holds" -- CIN, ISIN, exchange symbol and BSE scrip code (the
// four identifier columns that actually exist on `ipos`; see schema.ts --
// there is no separate BSE-code table, `bseScripCode` IS it). The suffix-
// stripped-slug and normalised-name+open-date keys are additional groupings
// this check keeps from the original brief (S1's page-status suffix and
// S2's spelling-variant class are not literal identifier columns, so F-103's
// sweep does not name them, but leaving them out would un-detect the Rays of
// Belief pair itself, which carries no shared identifier at all).
function identityMatchKeys(row) {
  const keys = [];
  if (row.cin) keys.push(`cin:${String(row.cin).trim().toUpperCase()}`);
  if (row.isin) keys.push(`isin:${String(row.isin).trim().toUpperCase()}`);
  if (row.symbol) keys.push(`sym:${String(row.symbol).trim().toUpperCase()}`);
  if (row.bseScripCode) keys.push(`bse:${String(row.bseScripCode).trim().toUpperCase()}`);
  const strippedSlug = stripIdentitySlugSuffix(row.slug);
  if (strippedSlug) keys.push(`slug:${strippedSlug.toLowerCase()}`);
  const nameKey = normalizeIdentityCompanyName(row.companyName);
  if (nameKey && row.openDate) keys.push(`name+open:${nameKey}|${row.openDate}`);
  return keys;
}

/**
 * i_same_ipo_two_rows — implements the §2.3.3.1 "standing sweep" (F-103):
 * groups every IPO row (offering_type='IPO') by EACH identifier it holds
 * (CIN, ISIN, exchange symbol, BSE scrip code — the identifier columns OD-34
 * ranks) plus the suffix-stripped slug and normalised-name+open-date keys
 * (S1/S2/S7), and reports any group of more than one, BY NAME (never a bare
 * count — signal-ownership R1). Deliberately NOT matched by name alone (S6:
 * two different companies with similar names must never pair) — every
 * name-based key here also requires the same open_date.
 *
 * rows: [{ id, slug, companyName, cin, isin, symbol, bseScripCode, openDate, offeringType }]
 * returns: [{ keyType, key, rows: [{id, slug}, ...] }] — one group per
 * matched key, each naming the identifier that grouped them and every row in it.
 */
export function findSameIpoTwoRows(rows = []) {
  const ipoRows = rows.filter((r) => r.offeringType === 'IPO');
  const byKey = new Map();
  for (const row of ipoRows) {
    for (const key of identityMatchKeys(row)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
    }
  }
  const groups = [];
  const seenRowSets = new Set();
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const ids = [...new Set(group.map((r) => r.id))];
    if (ids.length < 2) continue; // same row matched itself twice on two keys
    const dedupeSig = ids.slice().sort().join(',');
    if (seenRowSets.has(dedupeSig)) continue;
    seenRowSets.add(dedupeSig);
    const [keyType] = key.split(':');
    groups.push({
      keyType,
      key,
      rows: [...new Map(group.map((r) => [r.id, { id: r.id, slug: r.slug, companyName: r.companyName }])).values()],
    });
  }
  return groups;
}

// OD-34: a row bound on nothing stronger than the name carries the flag
// `name-bound` until an identifier arrives, and "the nightly audit reports
// the name-bound rows by name — never as a count". This predicate finds
// them: an IPO row with no CIN, no symbol and no ISIN, that is currently
// live (UPCOMING/OPEN — the identifiers arrive "days before listing" per
// OD-34's own table, so a CLOSED/LISTED row with none of them is the
// F-103 duplicate shape, not an ordinary name-bound row; that shape is
// caught by findSameIpoTwoRows/findCompanyTwoLiveRows instead).
export function findNameBoundLiveRows(rows = []) {
  return rows.filter((r) =>
    r.offeringType === 'IPO'
    && LIVE_STATUSES.includes(r.status)
    && !r.cin && !r.symbol && !r.isin
  ).map((r) => ({ id: r.id, slug: r.slug, companyName: r.companyName, status: r.status }));
}

// OD-68 hold-for-review (PR #910 review round 1, MAJOR-2): IPORepository.create
// writes one audit_logs row (action_type IDENTITY_HELD_FOR_REVIEW) per held
// record per candidate per day. A hold recorded inside `recentDays` whose
// incoming slug has NO later IDENTITY_HOLD_OVERRIDDEN row is still happening
// (the record keeps arriving and keeps being refused) and nobody has decided
// it — reported by name, never as a count (signal-ownership.md R1).
// `holds`/`overrides`: [{ slug, companyName?, candidates?, at }] with `at` an
// ISO timestamp; `now` injectable for tests.
export function findUndecidedIdentityHolds(holds = [], overrides = [], now = new Date(), recentDays = 2) {
  const cutoff = now.getTime() - recentDays * 86_400_000;
  const lastOverride = new Map();
  for (const o of overrides) {
    const t = Date.parse(o.at);
    if (!lastOverride.has(o.slug) || t > lastOverride.get(o.slug)) lastOverride.set(o.slug, t);
  }
  const bySlug = new Map();
  for (const h of holds) {
    const t = Date.parse(h.at);
    if (!(t >= cutoff)) continue;
    const ov = lastOverride.get(h.slug);
    if (ov != null && ov >= t) continue;
    const prev = bySlug.get(h.slug);
    if (!prev || t > Date.parse(prev.at)) bySlug.set(h.slug, h);
  }
  return [...bySlug.values()].sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

// S3: page title / brand text landed in the stored company name or slug —
// "... (... IPO)", a trailing " IPO" word, a slug matching -ipo(-|$), or a
// slug still carrying the page-status suffix shape (-o/-p/-lt/-ct).
export function checkIpoTitleInName(row) {
  const name = row.companyName || '';
  const slug = row.slug || '';
  const violations = [];
  if (/\(\s*[^)]*\bipo\b[^)]*\)/i.test(name)) violations.push('company_name has "(...IPO)"');
  if (/\bipo\b\s*$/i.test(name.trim())) violations.push('company_name ends in the word IPO');
  if (/-ipo(-|$)/i.test(slug)) violations.push('slug matches -ipo(-|$)');
  // Anchored to a legal suffix, same as the matcher (PR #910 MINOR-4): "om-metallogic-p" is a name.
  if (stripIdentitySlugSuffix(slug) !== slug) violations.push('slug carries a page-status suffix (-o/-p/-lt/-ct)');
  if (violations.length === 0) return null;
  return `"${row.companyName}" [${slug}]: ${violations.join('; ')}`;
}

// S4: the same normalized company holding two or more rows simultaneously
// "live" (UPCOMING/OPEN/CLOSED — LISTED excluded per the owner's decision:
// a LISTED row plus a fresh filing is exactly S4's "new filing after
// withdrawal" shape and is legitimate until reviewed). Any offering_type —
// the owner's decision is about the COMPANY holding two live rows, not just
// two IPO rows.
const IDENTITY_LIVE_STATUSES = new Set(['UPCOMING', 'OPEN', 'CLOSED']);

export function findCompanyTwoLiveRows(rows = []) {
  const live = rows.filter((r) => IDENTITY_LIVE_STATUSES.has(r.status));
  const byName = new Map();
  for (const row of live) {
    const key = normalizeIdentityCompanyName(row.companyName);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  const groups = [];
  for (const [key, group] of byName) {
    const ids = [...new Set(group.map((r) => r.id))];
    if (ids.length < 2) continue;
    groups.push({
      key,
      rows: [...new Map(group.map((r) => [r.id, { id: r.id, slug: r.slug, companyName: r.companyName, status: r.status, offeringType: r.offeringType }])).values()],
    });
  }
  return groups;
}

// ---- s_settled_field_rewritten: OD-73 / OD-65 / OD-75 (#908) ------------------------
// OD-73 (owner, 2026-09-23): a field is settled once the best-ranked source seen so far has set
// it. After that only a HIGHER-ranked source may change it; an identical incoming value is never
// written and never re-stamps provenance; an exchange may move a date it stated (OD-35); a
// website changing its own earlier value is ignored for the page (OD-75).
//
// ONE ranking (review round 1, MAJOR-2 on PR #914): the rank is the WRITER's — the answers of
// getSourcePriority / allowsSameSourceRefresh themselves, snapshotted per field, source, IPO type,
// venue and ENABLE_POLICY_WRITER state into scraper/config/writer-source-ranking.json by
// scraper/scripts/build-writer-ranking-snapshot.ts (a scraper unit test fails on a stale file).
// Nothing here keeps a second source order; it only looks the writer's answers up.

/** `ipos` column for each settled field_sources.field_name (the field list itself is the snapshot's). */
export const SETTLED_FIELD_COLUMNS = Object.freeze({
  priceRangeMin: 'price_range_min', priceRangeMax: 'price_range_max', lotSize: 'lot_size',
  issueSize: 'issue_size', faceValue: 'face_value', openDate: 'open_date', closeDate: 'close_date',
  listingDate: 'listing_date', allotmentDate: 'allotment_date', registrar: 'registrar',
  leadManagers: 'lead_managers',
});

/** The SQL CASE that reads each settled field's stored value off `ipos i`. */
export function settledCurrentValueSql(columns = SETTLED_FIELD_COLUMNS) {
  return 'CASE fs.field_name ' +
    Object.entries(columns).map(([f, c]) => `WHEN '${f}' THEN i.${c}::text`).join(' ') + ' END';
}

/** MAINBOARD / SME_BSE / SME_NSE — the writer's ipoType keys. */
export function manifestIpoType(segment, listingExchanges) {
  if (String(segment ?? '').toUpperCase() !== 'SME') return 'MAINBOARD';
  const ex = Array.isArray(listingExchanges) ? listingExchanges : [];
  return ex.includes('NSE') && !ex.includes('BSE') ? 'SME_NSE' : 'SME_BSE';
}

/** The snapshot's venue key for `ipos.listing_exchanges` (OD-64: unknown / NSE / BSE / both / none). */
export function venueKey(listingExchanges) {
  if (!Array.isArray(listingExchanges) || listingExchanges.length === 0) return 'unknown';
  const ex = [...new Set(listingExchanges.filter((e) => e === 'NSE' || e === 'BSE'))].sort();
  return ex.length === 0 ? 'none' : ex.join(',');
}

/**
 * ENABLE_POLICY_WRITER as the writer's slotAwareFlagDefault computes it
 * (scraper/src/config/feature-flags.ts): unset -> on only when DEPLOY_SLOT=staging; set -> the
 * truthy set; empty or unrecognised -> off (fail-closed). Parity-tested against the TS function.
 */
export function policyWriterOnFromEnv(env = process.env) {
  const explicit = env.ENABLE_POLICY_WRITER;
  if (explicit === undefined) return env.DEPLOY_SLOT === 'staging';
  return new Set(['true', '1', 'yes', 'on']).has(String(explicit).trim().toLowerCase());
}

/** Writer priority index (lower = higher; -1 = the writer does not rank this source here). */
export function writerPriority(snapshot, policyWriterOn, fieldName, ipoType, venue, source) {
  const table = snapshot?.rank?.[policyWriterOn ? 'policyWriterOn' : 'policyWriterOff'];
  const bySource = table?.[ipoType]?.[venue]?.[fieldName];
  if (!bySource) throw new Error(`writer-source-ranking.json has no entry for ${fieldName}/${ipoType}/${venue}`);
  return Object.prototype.hasOwnProperty.call(bySource, source) ? bySource[source] : -1;
}

function writerAllowsSameSourceRefresh(snapshot, policyWriterOn, fieldName, ipoType, source) {
  const list = snapshot.sameSourceRefresh[policyWriterOn ? 'policyWriterOn' : 'policyWriterOff']?.[ipoType]?.[fieldName];
  return Array.isArray(list) && list.includes(source);
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 330 * 60 * 1000;

/** The IST calendar day of an instant — an IPO date is an Indian market date (ist-timezone.md). */
function istDay(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function comparable(value) {
  if (value === null || value === undefined) return null;
  let v = value;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) {
      try { v = JSON.parse(t); } catch { /* keep the string */ }
    } else if (/^-?\d+(\.\d+)?$/.test(t)) {
      return String(Number(t));
    } else if (PLAIN_DATE.test(t)) {
      return t;
    } else if (ISO_INSTANT.test(t)) {
      // MINOR-5: an instant is compared by its IST day, never by its first 10 UTC characters
      // (2026-09-19T18:30:00Z is 2026-09-20 in India). Staging on 2026-09-23 stored every date
      // previous_value as a plain YYYY-MM-DD (224 of 224 rows), so this is the defensive branch.
      const ms = Date.parse(t);
      return Number.isNaN(ms) ? t.toLowerCase() : istDay(ms);
    } else {
      return t.toLowerCase();
    }
  }
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => String(x).trim().toLowerCase()).sort());
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return istDay(v.getTime());
  return String(v).trim().toLowerCase();
}

/**
 * Pure predicate. `rows` are `field_sources` rows for `ipos` settled fields written in the
 * window, each joined with the IPO's current stored value (`currentValue`), `slug`, `segment`
 * and `listingExchanges`. `snapshot` is scraper/config/writer-source-ranking.json;
 * `policyWriterOn` is the slot's ENABLE_POLICY_WRITER. One finding per row the writer's own
 * ranking would not have written:
 *   IDENTICAL_RESTAMP    — re-stamped although previous_value equals the stored value
 *   LOWER_RANK_REWRITE   — replaced by a source the writer ranks below (or does not rank)
 *   EQUAL_RANK_REWRITE   — replaced by a different source the writer ranks equal
 *   SELF_CHANGE_REWRITE  — a source changed its own value where the writer allows no refresh (OD-75)
 * A row with no previous_source is a first write and is never a finding.
 */
export function findSettledFieldRewrites(rows, snapshot, policyWriterOn = false) {
  const fields = new Set(snapshot?.fields ?? []);
  const timeBased = new Set(snapshot?.timeBased ?? []);
  const findings = [];
  for (const r of rows ?? []) {
    if (!fields.has(r.fieldName)) continue;
    if (!r.previousSource || !r.source) continue;
    if (r.source === 'ADMIN') continue;
    const prev = comparable(r.previousValue);
    const cur = comparable(r.currentValue);
    if (prev === null) continue;
    if (prev === cur) {
      findings.push({ ...pick(r), kind: 'IDENTICAL_RESTAMP' });
      continue;
    }
    const ipoType = manifestIpoType(r.segment, r.listingExchanges);
    const venue = venueKey(r.listingExchanges);
    const oldP = writerPriority(snapshot, policyWriterOn, r.fieldName, ipoType, venue, r.previousSource);
    const newP = writerPriority(snapshot, policyWriterOn, r.fieldName, ipoType, venue, r.source);
    if (oldP !== newP) {
      if (newP !== -1 && (oldP === -1 || newP < oldP)) continue; // the writer's SOURCE_PRIORITY win
      findings.push({ ...pick(r), kind: 'LOWER_RANK_REWRITE' });
      continue;
    }
    if (timeBased.has(r.fieldName)) continue; // the writer's newest-wins on an equal rank
    if (r.source === r.previousSource) {
      // OD-35 postponement / a later offer document: the writer's own same-source refresh list.
      if (writerAllowsSameSourceRefresh(snapshot, policyWriterOn, r.fieldName, ipoType, r.source)) continue;
      findings.push({ ...pick(r), kind: 'SELF_CHANGE_REWRITE' });
      continue;
    }
    findings.push({ ...pick(r), kind: 'EQUAL_RANK_REWRITE' });
  }
  return findings;
}

function pick(r) {
  return {
    slug: r.slug,
    fieldName: r.fieldName,
    source: r.source,
    previousSource: r.previousSource,
    previousValue: r.previousValue,
    currentValue: r.currentValue,
    updatedAt: r.updatedAt,
  };
}

/**
 * #717 / OD-76 (closed_ipo_done_without_walk): the closed-IPO job must never
 * record DONE for an IPO it did not walk -- spec §6.1 as rewritten by OD-76:
 * "An IPO whose plan could not be generated, or whose walk asked nothing, is
 * never recorded DONE." DONE is never re-picked (§6.2), so each such row is an
 * IPO dropped from the backlog with nothing done.
 *
 * "Walked" is read from the plan itself, not from the ledger's own counters: a
 * row the walk asked carries last_attempt_at. 0 plan rows, or plan rows none of
 * which was ever asked, both mean no walk. Staging 2026-09-23: 10 of 10 DONE
 * rows had 0 plan rows.
 *
 * OD-73 correction (PR #918): a never-asked DONE is legitimate when EVERY plan
 * row is already settled (SUPPLIED / NOT_PRINTED / EXHAUSTED) -- nothing was
 * left to ask. So the flag is: DONE with 0 plan rows, or DONE with no row ever
 * asked while at least one row is unsettled.
 *
 * OD-79 widening (review round 3): DONE means EVERY plan row is settled,
 * whatever the walk asked. A walked IPO (5 fields asked, 3 answered) was
 * recorded DONE with 37 rows still open; the never-asked-only predicate passed
 * it. So the flag is now: DONE with 0 plan rows, or DONE with ANY unsettled
 * plan row -- walked or not. walkedRows stays in the row for the report only.
 *
 * Rows: { ipoId, companyName, outcome, planRows, walkedRows, unsettledRows }.
 * Numbers may arrive as strings from pg; they are coerced.
 */
export function findClosedIpoDoneWithoutWalk(rows) {
  return (rows ?? []).filter(
    (r) =>
      String(r.outcome).toUpperCase() === 'DONE' &&
      (Number(r.planRows) === 0 || Number(r.unsettledRows) > 0)
  );
}

// i_source_key_conflict (OD-85, §2.3.3.2 "Source record keys"). `keys`: rows of ipo_source_keys in
// state ACTIVE or DISPUTED, joined to their ipo slug: [{ slug, ipoId, source, keyType, value, state,
// reason?, changedAt }]. Two shapes are a wrong or unresolved bind a human must read: one IPO holding
// two ACTIVE keys of the same source+type (a supersede that never happened, or a merge that brought
// two relaunch numbers together), and a key DISPUTED by the CIN/ISIN re-check inside `disputedDays`.
// (One key on two rows cannot exist: the plain UNIQUE(source,key_type,binding_value) forbids it.)
//
// `tableMissing` alone is NOT enough to decide UNVERIFIABLE-vs-not-applicable: this check's table
// (ipo_source_keys) arrived in migration 0053, and a DB that has simply never run 0053 yet (any DB
// audited by main between a merge and the next release cut -- production every night, by the
// release-branch model) is not "blind", it is "this class cannot exist here yet". Conflating the two
// makes every un-migrated DB read as a nightly audit failure (GATE BLIND, exit 3, an auto-filed
// needs-decision issue) for a check that was never expected to run there. So the caller passes
// `migration0053Applied` (true / false / null-for-"could not tell"), decided from the SAME signal
// drizzle-kit's own migrate() uses (MAX(created_at) in drizzle.__drizzle_migrations vs the journal's
// `when` for 0053 -- see assert-migrations-applied.sh), never a hand re-derivation:
//   - table missing, migration confirmed NOT applied  -> PASS, not-applicable (this DB predates 0053)
//   - table missing, migration confirmed applied        -> UNVERIFIABLE (the table should be there and
//                                                            is not -- an absent check is not a clean one)
//   - table missing, migration state unknown (read error)-> UNVERIFIABLE (cannot tell the two apart)
//   - table present, unreadable                          -> UNVERIFIABLE
export function evaluateSourceKeyConflicts({ keys = [], tableMissing = false, readError = null, migration0053Applied = null, now = new Date(), disputedDays = 30 } = {}) {
  if (tableMissing) {
    if (migration0053Applied === false) {
      return { status: 'PASS', detail: 'not applicable - migration 0053 (ipo_source_keys) not applied on this DB', doubleActive: [], disputed: [] };
    }
    return { status: 'UNVERIFIABLE', detail: 'ipo_source_keys table does not exist on this database - migration 0053 not applied here; nothing checked', doubleActive: [], disputed: [] };
  }
  if (readError) {
    return { status: 'UNVERIFIABLE', detail: `ipo_source_keys not readable: ${readError}`, doubleActive: [], disputed: [] };
  }
  const groups = new Map();
  for (const k of keys) {
    if (k.state !== 'ACTIVE') continue;
    const id = `${k.ipoId ?? k.slug}\u0000${k.source}\u0000${k.keyType}`;
    if (!groups.has(id)) groups.set(id, { slug: k.slug, source: k.source, keyType: k.keyType, values: [] });
    groups.get(id).values.push(String(k.value));
  }
  const doubleActive = [...groups.values()]
    .filter((g) => g.values.length > 1)
    .map((g) => ({ ...g, values: g.values.sort().join(',') }))
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  const cutoff = now.getTime() - disputedDays * 86_400_000;
  const disputed = keys
    .filter((k) => k.state === 'DISPUTED' && new Date(k.changedAt).getTime() > cutoff)
    .map((k) => ({ slug: k.slug, source: k.source, keyType: k.keyType, value: String(k.value), reason: k.reason ?? null }))
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  const offenders = [
    ...doubleActive.map((r) => `${r.slug} two ACTIVE ${r.source} ${r.keyType} (${r.values})`),
    ...disputed.map((r) => `${r.slug} DISPUTED ${r.source} ${r.keyType} ${r.value}`),
  ];
  return {
    status: offenders.length === 0 ? 'PASS' : 'FAIL',
    detail: offenders.length === 0 ? `0 double-ACTIVE, 0 DISPUTED in ${disputedDays} days` : offenders.join('; '),
    doubleActive,
    disputed,
  };
}
