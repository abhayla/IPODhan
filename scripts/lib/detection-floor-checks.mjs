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

// issue_size vs (sharesOffered x priceRangeMax) must agree within this tolerance.
export const ISSUE_SIZE_CONSISTENCY_TOLERANCE = 0.25;

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
    return `issue_size (Rs${size.toLocaleString('en-IN')}) is below the ${row.segment} floor of Rs${floor.toLocaleString('en-IN')} — looks like a share count stored as rupees, not a rupee issue size`;
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
  if (ratio < 1 - ISSUE_SIZE_CONSISTENCY_TOLERANCE || ratio > 1 + ISSUE_SIZE_CONSISTENCY_TOLERANCE) {
    return `issue_size (${size}) diverges from shares_offered x price_range_max (${shares} x ${price} = ${estimated}) by more than ${ISSUE_SIZE_CONSISTENCY_TOLERANCE * 100}% (ratio ${ratio.toFixed(3)})`;
  }
  return null;
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
// SCOPE IS DELIBERATELY NARROW: MAINBOARD rows that name NSE among their
// listing exchanges. NSE SME (Emerge) issues and BSE-only issues legitimately
// never appear on these endpoints, so FAILing on them would be pure noise — and
// a noisy channel gets muted, which is how a mechanism dies (the lesson already
// recorded in audit-detection-floor.mjs's digest design). Rows with unknown
// listing exchanges are skipped rather than guessed at.

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
  const openByKey = new Set();
  const knownByKey = new Set();
  for (const row of scoped) {
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

// ---- (n): T-331 P2-9 + P3-4 -- thresholds so "zero" can never pass silently ---
//
// Round 7 found four content tables at 0 rows across 251 IPOs, and
// fieldCompleteness reported as 0.7%. BOTH passed the nightly audit. The audit
// printed the numbers and asserted nothing about them: `record(... reachable)`
// only checked the endpoint answered, and the completeness reading was a
// console WARN that cannot affect an exit code. A number nobody asserts on is
// not a check -- it is a log line that looks like one.

/**
 * Hard floor for fieldCompleteness. Deliberately FAR below the existing 50%
 * WARN in audit-prod.mjs, and the two coexist: WARN at <50 means "investigate",
 * FAIL at <5 means "structurally broken". T-309 left this report-only because
 * the metric's exact denominator is owned elsewhere and it did not want to gate
 * on semantics it could not validate. That caution is respected here -- 5% is
 * low enough that NO reasonable denominator makes it healthy, so the floor
 * holds regardless of which one the endpoint uses.
 */
export const FIELD_COMPLETENESS_FAIL_PCT = 5;

export function checkFieldCompleteness(pct) {
  const n = typeof pct === 'string' ? parseFloat(pct) : pct;
  // An unreadable reading is STALE, never a silent pass -- same posture as the
  // step-ledger age checks.
  if (!Number.isFinite(n)) {
    return `fieldCompleteness is unreadable (${JSON.stringify(pct)}) - cannot prove data quality, treated as a failure rather than a silent pass`;
  }
  if (n < FIELD_COMPLETENESS_FAIL_PCT) {
    return `fieldCompleteness=${n}% is below the ${FIELD_COMPLETENESS_FAIL_PCT}% hard floor - the extractors are not populating fields at all (round-7 P3-4 shape: 0.7% passed silently)`;
  }
  return null;
}

/** Content tables whose emptiness is a defect, not a legitimate empty state. */
export const CONTENT_TABLES = ['ipo_details', 'ipo_scores', 'anchor_investors', 'ipo_reviews'];

/** A content table may sit empty this long before it counts as never-populated. */
export const CONTENT_TABLE_EMPTY_MAX_DAYS = 30;

/**
 * FAIL a NAMED content table that holds 0 rows while IPOs old enough to have
 * populated it exist.
 *
 * "0 rows for > 30 days" cannot be read from a row count alone -- an empty
 * table carries no history. `oldestIpoAgeDays` is the proxy: if IPOs have
 * existed for longer than the window and the table is still empty, the
 * extractor has never run. On a genuinely new database (no IPO older than the
 * window) emptiness is legitimate and this must NOT fire.
 *
 * Does NOT build the missing extractors -- issues #222/#223/#224 own those; the
 * violation text points at them so the audit output is actionable.
 */
export function checkContentTableEmpty(tableName, rowCount, oldestIpoAgeDays) {
  if (!Number.isFinite(rowCount)) {
    return `${tableName}: row count unreadable - cannot prove the table is populated, treated as a failure rather than a silent pass`;
  }
  if (rowCount > 0) return null;
  if (!Number.isFinite(oldestIpoAgeDays)) {
    return `${tableName}: 0 rows and the oldest-IPO age is unreadable - cannot prove this is a legitimately new database`;
  }
  if (oldestIpoAgeDays <= CONTENT_TABLE_EMPTY_MAX_DAYS) return null;
  return `${tableName}: 0 rows while IPOs have existed for ${Math.floor(oldestIpoAgeDays)} days (> ${CONTENT_TABLE_EMPTY_MAX_DAYS}d) - the extractor has never run (see issues #222/#223/#224)`;
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

// Only the fields the oracle publishes reliably. Chittorgarh's price column is
// deliberately excluded: a lone price string is not a real band (see the T-308
// note in chittorgarh-scraper.ts), so comparing it manufactures false positives.
export const ORACLE_COMPARABLE_FIELDS = ['openDate', 'closeDate'];

const LEGAL_SUFFIXES = new Set(['ltd', 'limited', 'pvt', 'private', 'plc', 'corp', 'corporation', 'inc']);

// "Lumino Industries Limited" (ours) and "Lumino Industries Ltd." (oracle, which
// also appends single-letter status flags like a trailing " O") must key the same.
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
      if (!valuesDisagree(ours, theirs)) continue;
      const key = `${ipo.id}-${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ipoId: ipo.id, companyName: ipo.companyName, fieldName: field, signal: 'oracle',
        message: `live IPO "${ipo.companyName}" (${ipo.status}) publishes ${field}=${fmtDay(ours)}, but ${oracleName} currently says ${fmtDay(theirs)} — cross-source disagreement found by this audit's own live fetch, independent of data_conflicts`,
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
