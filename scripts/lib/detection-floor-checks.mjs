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
  if (row.segment === null || row.segment === undefined) {
    return `offering_type=IPO row "${row.companyName}" has a NULL segment — segment is not nullable in intent for real IPOs`;
  }
  return null;
}
