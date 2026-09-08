#!/usr/bin/env node
// T-335 — the fresh-review coverage floor, promoted into FAIL-level nightly
// checks. See docs/reviews/round-7-detection-rca.md (why the existing
// substance audit missed P1-3/P1-4) and docs/reviews/detection-checks.json
// (the machine-readable check->finding-class->threshold map the round-8
// review contract reads).
//
// READ-ONLY against prod: SELECT-only SQL, GET-only HTTP, read-only
// filesystem/git inspection. Never writes. Every check enumerates its
// population from the filesystem/DB/git tree — no hand-maintained lists.
//
// Usage:
//   node scripts/audit-detection-floor.mjs           -> human report, exit 0 always
//   node scripts/audit-detection-floor.mjs --gate    -> report + gate (see exit codes)
//   BASE_URL=https://ipodhan.com node scripts/audit-detection-floor.mjs --gate
//
// EXIT CODES (--gate mode; report mode always exits 0):
//   0  every check PASSed.
//   1  at least one check FAILed — a defect is live.
//   3  no FAIL, but at least one check is UNVERIFIABLE — the audit was BLIND
//      tonight. Distinct from 1 so the cron log and the owner can tell "the
//      data is broken" from "the audit could not see". FAIL dominates when both
//      are present.
//   2  the audit itself crashed / could not start.
//
// A source that cannot be reached reports UNVERIFIABLE (never OK), PAGES the
// owner at P2, and makes the gate exit non-zero. A check that silently passes
// when its dependency is down is the T-321 silent-pass class again (see
// evidence/2026-08-26-T-322/DETECTION-RCA.md "Honest limits"); the T-335C
// checker found exactly that hole in the first cut of this file and it is
// closed here.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createUtcPool, installUtcTimestampParsing, assertUtcSession } from './lib/pg-utc.mjs';
import { parseIpowatchListIndex, parseIpowatchDetail, computeOracleCoverageWarning } from './lib/ipowatch-oracle-parser.mjs';
import {
  checkBlockedAllAge,
  checkFoundNotExtracted,
  checkLiveIpoHasStateRows,
  checkListedRotationStall,
  LISTED_ROTATION_WINDOW_DAYS,
  STALE_ROTATION_HOURS,
  checkExtractFailed,
  checkLeadManagerCount,
  checkDocumentTypeMatchesClassifier,
  checkNotYetFiledAge,
  checkAbsenceWithoutEvidence,
  checkCycleOverrun,
  checkExtractionStuck,
} from './lib/document-state-checks.mjs';
import {
  checkNoUnresolvedConflictOnLiveIpo, HIGH_VALUE_FIELDS, LIVE_STATUSES,
  checkIssueSizeSegmentFloor, checkIssueSizeSharesConsistency,
  checkLotBandSebiWindow, checkCorporateActionShape,
  classifyRouteResponse, classifyConflictNoiseRatio, checkFreshnessPerType,
  checkPm2EnvHasTz, checkPm2LogSize, findUnreferencedDefinitions,
  checkSectorPopulatedPct, checkCronScriptExecutable, checkDeadSourceHasRetireBy,
  checkSegmentPopulatedForIpo, DEAD_SOURCE_MAX_DEGRADED_CYCLES,
  findLiveCrossSourceDisagreements, ORACLE_COMPARABLE_FIELDS, normalizeCompanyKey,
  findLotDisagreements, findMinApplicationDisagreements,
  buildRunPayloads, evaluateCronExecutable,
  computeExitCode, EXIT_UNVERIFIABLE, computeSummaryCounts,
  parseStepNames, checkStepSilence, checkStepConsecutiveFailures,
  STEP_LEDGER_WINDOW_HOURS,
  crossCheckNseStatuses,
} from './lib/detection-floor-checks.mjs';
import { checkFixMergedNotServed, checkDeployFailureOpen } from './lib/fix-served-checks.mjs';
import { DEPLOY_STATUS_FILE } from './deploy-status.mjs';
import { checkPriceBand } from './lib/substance-checks.mjs';
import {
  classifyRepeatedMessages, classifyConflictBacklogRatchet, nextRatchetBaseline, classifyInertDetector,
  REPEATED_MESSAGE_MAX_OCCURRENCES_24H,
} from './lib/signal-health-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const envPath = join(REPO_ROOT, 'web', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.DATABASE_HOST && !process.env.DATABASE_URL) {
  console.error('FATAL: no DB connection configured — provide web/.env.local or DATABASE_* in the environment');
  process.exit(2);
}

const GATE = process.argv.includes('--gate');
// T-465 round 2: seeds/lowers config/conflict-backlog-baseline.json for the
// CURRENT database (current_database()) — never raises an existing entry.
const REBASELINE_CONFLICTS = process.argv.includes('--rebaseline-conflicts');
const CONFLICT_BASELINE_PATH = join(REPO_ROOT, 'config', 'conflict-backlog-baseline.json');
function readConflictBaseline() {
  try { return JSON.parse(readFileSync(CONFLICT_BASELINE_PATH, 'utf8')); }
  catch { return { databases: {} }; }
}
function writeConflictBaseline(data) {
  writeFileSync(CONFLICT_BASELINE_PATH, JSON.stringify(data, null, 2) + '\n');
}
const BASE_URL = (process.env.BASE_URL || 'https://ipodhan.com').replace(/\/$/, '');
const MAX_OFFENDERS = 8;

// installUtcTimestampParsing() MUST run before the pool is created / any
// query runs — it registers the process-wide OID-1114 parser (see pg-utc.mjs
// for why this and the session-level pin are both required).
installUtcTimestampParsing();

const pool = createUtcPool(
  process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
    ? {
        host: process.env.DATABASE_HOST,
        port: parseInt(process.env.DATABASE_PORT || '5432'),
        database: process.env.DATABASE_NAME || 'ipodhan',
        user: process.env.DATABASE_USER || 'postgres',
        password: process.env.DATABASE_PASSWORD,
        ssl: false,
        max: 4,
      }
    : { connectionString: process.env.DATABASE_URL, ssl: false, max: 4 }
);

async function assertSessionTimezoneUtc() {
  try {
    await assertUtcSession(pool);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const REAL_IPO = `offering_type = 'IPO'`;

// Findings are collected PER CHECK and emitted as ONE DIGEST per check per
// night — not one page per row. The first cut of this file paged per row: the
// T-335C checker measured ~72 Notifier pages per run against a 30-minute
// cooldown, i.e. ~72 Telegram messages every night until every legacy defect
// cleared. A channel that noisy gets muted, and a muted channel is a dead
// mechanism. See buildCheckDigest() for the severity rule (P1 only for rows
// that are NEW versus the previous run).
const findingsByCheck = new Map(); // checkId -> [{ rowKey, title, body }]
function notify(checkId, _severity, rowKey, title, body) {
  if (!findingsByCheck.has(checkId)) findingsByCheck.set(checkId, []);
  findingsByCheck.get(checkId).push({ rowKey: String(rowKey), title, body });
}

const results = []; // { id, name, status: 'PASS'|'FAIL'|'UNVERIFIABLE', detail }
function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

// Last night's failing row keys, so a digest can say what is NEW. Kept in the
// audit's own state dir on the box (same dir the cron script already owns);
// falls back to the OS temp dir off-box so a dev run never writes to /root.
const STATE_DIR = process.env.DETECTION_FLOOR_STATE_DIR
  || (existsSync('/root/data-audit-ipodhan/state') ? '/root/data-audit-ipodhan/state' : tmpdir());
const STATE_FILE = join(STATE_DIR, 'detection-floor-last-run.json');
const FINDINGS_FILE = join(STATE_DIR, 'findings-latest.json');
const RUN_DATE = new Date().toISOString().slice(0, 10);
const REPORT_PATH = join(STATE_DIR, `run-${RUN_DATE}.log`);

// Cap per check so one runaway check (e.g. a full-table sweep with thousands
// of offenders) cannot blow up the findings file or, downstream, the number
// of rows the issue-sync script tries to render into a single GitHub issue
// body.
const FINDINGS_MAX_ROWS_PER_CHECK = 200;

function readPreviousState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeCurrentState(state) {
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e) { console.log(`[STATE-WARN] could not persist ${STATE_FILE}: ${e.message} — every row will look "new" next run`); }
}

// Recurrence loop part 2 (nightly audit -> GitHub issues): a durable,
// machine-readable snapshot of tonight's run that scripts/audit-findings-to-issues.mjs
// reads. Written in the SAME try/catch shape as writeCurrentState — this file
// must never be the reason the audit itself fails or exits non-zero.
function writeFindingsLatest({ results, findingsByCheck, runDate }) {
  try {
    const failed = results.filter((r) => r.status === 'FAIL');
    const unverifiable = results.filter((r) => r.status === 'UNVERIFIABLE');
    const findings = {};
    for (const [checkId, rows] of findingsByCheck) {
      findings[checkId] = rows.slice(0, FINDINGS_MAX_ROWS_PER_CHECK).map((r) => ({
        rowKey: r.rowKey, title: r.title, body: r.body,
      }));
    }
    const payload = {
      runDate,
      generatedAt: new Date().toISOString(),
      gate: failed.length === 0 && unverifiable.length === 0 ? 'PASS' : 'FAIL',
      results,
      findings,
    };
    writeFileSync(FINDINGS_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    console.log(`[FINDINGS-WARN] could not persist ${FINDINGS_FILE}: ${e.message} — tonight's findings will not sync to GitHub issues`);
  }
}

async function tableExists(name) {
  const rows = await q(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  return rows[0]?.reg !== null && rows[0]?.reg !== undefined;
}

// ---- (a)/(b): live IPO vs cross-source disagreement -----------------------
// INDEPENDENT BY CONSTRUCTION. The first cut read `data_conflicts` only, and the
// T-335C checker caught it PASSing at 05:00:22Z and FAILing (Lumino, Annu) at
// 05:03:03Z on the SAME live defect: the cross-source-disagreement monitor
// resolves and re-inserts every conflict each 30-minute cycle, so there is a
// ~11-30s window with zero unresolved rows — and a dead monitor would mean a
// permanent green PASS on a live wrong-date defect.
//
// The PRIMARY signal is now this audit's OWN live fetch of ipowatch.in — a
// source the scraper does NOT ingest (scraper/src/scrapers only reads NSE,
// BSE, Moneycontrol, Chittorgarh, InvestorGain; see field-priority-matrix.ts).
// T-472 replaced the prior Chittorgarh oracle (which IS ingested — comparing
// against it proved nothing about a scraper defect) and extended the compare
// from 2 fields (dates only) to all 6 fields behind GitHub #199's cited P1
// classes: band, lot size, and issue size wrong. `data_conflicts` is a
// SECONDARY signal only. A failed oracle fetch is UNVERIFIABLE, which pages
// (blocker 1) — never a silent PASS.
const IPOWATCH_LIST_URL = 'https://ipowatch.in/upcoming-ipo-list/';
// Identifies this as the nightly audit, not a scrape masquerading as a browser
// — ipowatch is a courtesy oracle, not a scraper source, and the fetch volume
// here is bounded (one page per matched live IPO), so there is no reason to
// disguise it.
const IPOWATCH_HEADERS = {
  'User-Agent': 'IPODhan-detection-floor-audit/1.0 (+https://ipodhan.com; non-ingested cross-check, see scripts/audit-detection-floor.mjs)',
  Accept: 'text/html',
};
// Delay between successive detail-page requests so this audit does not hammer
// ipowatch with a back-to-back burst (round-2 review note). Configurable for
// tests/local runs; the nightly cron uses the 400ms default.
const IPOWATCH_REQUEST_DELAY_MS = Number(process.env.IPOWATCH_REQUEST_DELAY_MS ?? 400);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A matched-but-unreadable share this high means the page template likely
// changed under us — the check would otherwise shrink to near-nothing without
// ever going UNVERIFIABLE. Named, not a magic number.
const IPOWATCH_COVERAGE_WARN_THRESHOLD = 0.5;

async function fetchIpowatchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(url, { signal: ctrl.signal, headers: IPOWATCH_HEADERS }).finally(() => clearTimeout(t));
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// Fetches ipowatch's own figures for the SAME companies our `ipoRows` name —
// never the whole site. The list-index page (mainboard + SME tables) maps
// company name -> detail-page URL; only detail pages for names we can match
// against our own live IPOs are fetched, so this stays bounded to however
// many IPOs are actually live tonight, not every IPO ipowatch tracks.
//
// A detail page whose key-facts block cannot be parsed at all (structural
// failure — wrong page, redesign) is skipped from oracleRows rather than
// silently contributing nulls: skipping means the company is simply not
// compared this run (same as "not found"), not a false PASS on a broken parse.
async function fetchOracleRows(ipoRows) {
  const listHtml = await fetchIpowatchHtml(IPOWATCH_LIST_URL);
  const index = parseIpowatchListIndex(listHtml);
  if (index.length === 0) throw new Error('ipowatch list index returned zero rows — page shape likely changed');

  const indexByKey = new Map();
  for (const entry of index) {
    const k = normalizeCompanyKey(entry.companyName);
    if (k && !indexByKey.has(k)) indexByKey.set(k, entry);
  }

  const out = [];
  let unparseable = 0;
  let matched = 0;
  let first = true;
  for (const ipo of ipoRows) {
    const entry = indexByKey.get(normalizeCompanyKey(ipo.companyName));
    if (!entry) continue;
    matched += 1;
    if (!first) await sleep(IPOWATCH_REQUEST_DELAY_MS);
    first = false;
    let detailHtml;
    try {
      detailHtml = await fetchIpowatchHtml(entry.detailUrl);
    } catch {
      continue; // this one company's page is unreachable; not a whole-audit failure
    }
    const values = parseIpowatchDetail(detailHtml);
    if (!values) {
      unparseable += 1;
      continue;
    }
    out.push({ companyName: entry.companyName, values });
  }

  const coverageWarning = computeOracleCoverageWarning(
    { liveCount: ipoRows.length, matched, unparseable }, IPOWATCH_COVERAGE_WARN_THRESHOLD);

  return { rows: out, matchedFromIndex: index.length, matched, unparseable, coverageWarning };
}

async function checkA_B() {
  const name = `live IPO open/close/band/lot/issue-size agree with the independent non-ingested oracle (ipowatch.in; fields: ${ORACLE_COMPARABLE_FIELDS.join(', ')})`;

  const ipoRows = (await q(
    `SELECT id, company_name AS "companyName", status, segment,
            open_date AS "openDate", close_date AS "closeDate",
            price_range_min AS "priceRangeMin", price_range_max AS "priceRangeMax",
            lot_size AS "lotSize", issue_size AS "issueSize"
       FROM ipos
      WHERE ${REAL_IPO} AND status IN ('${LIVE_STATUSES.join("','")}')`
  )).map((r) => ({
    id: r.id, companyName: r.companyName, status: r.status, segment: r.segment,
    values: {
      openDate: r.openDate, closeDate: r.closeDate,
      priceRangeMin: r.priceRangeMin, priceRangeMax: r.priceRangeMax,
      lotSize: r.lotSize, issueSize: r.issueSize,
    },
  }));

  let oracleRows;
  let oracleFetchNote = '';
  try {
    const fetched = await fetchOracleRows(ipoRows);
    oracleRows = fetched.rows;
    if (fetched.unparseable > 0) {
      oracleFetchNote = `; ${fetched.unparseable} matched ipowatch page(s) could not be parsed and were excluded, not silently passed`;
    }
    if (fetched.coverageWarning) {
      oracleFetchNote += `; WARN: ${fetched.coverageWarning}`;
    }
  } catch (e) {
    record('a_b_live_conflict', name, 'UNVERIFIABLE',
      `could not reach the independent oracle (${e.message}) — this check is BLIND tonight, not passing`);
    record('a_b_min_application', 'live IPO minimum retail application agrees with the independent non-ingested oracle (ipowatch.in)', 'UNVERIFIABLE',
      `could not reach the independent oracle (${e.message}) — this check is BLIND tonight, not passing`);
    return;
  }

  // SECONDARY — best-effort; its absence must never blind the primary signal.
  let conflictRows = [];
  let conflictSignalAvailable = false;
  if (await tableExists('data_conflicts')) {
    conflictSignalAvailable = true;
    const fieldList = HIGH_VALUE_FIELDS.map((f) => `'${f}'`).join(',');
    conflictRows = await q(
      `SELECT c.ipo_id AS "ipoId", i.company_name AS "companyName", c.field_name AS "fieldName",
              c.source1, c.value1, c.source2, c.value2
         FROM data_conflicts c
         JOIN ipos i ON i.id = c.ipo_id AND i.${REAL_IPO}
        WHERE c.resolved_at IS NULL
          AND c.field_name IN (${fieldList})
          AND i.status IN ('${LIVE_STATUSES.join("','")}')`
    );
  }

  const fieldViolations = findLiveCrossSourceDisagreements({ ipoRows, oracleRows, conflictRows, oracleName: 'IPOWATCH' });
  // T-506 (#415): the lot pair is compared separately from the generic field
  // loop — ipowatch's figure is a minimum-BID-shares figure, not the exchange
  // lot, so it must be divided by the segment's minimum-application-lot
  // multiplier before comparison (see ORACLE_COMPARABLE_FIELDS comment).
  const lotViolations = findLotDisagreements({ ipoRows, oracleRows });
  const violations = [...fieldViolations, ...lotViolations];
  for (const v of violations) {
    notify('a_b_live_conflict', 'P1', `${v.ipoId}-${v.fieldName}`,
      `Live IPO "${v.companyName}" publishes a disputed ${v.fieldName}`, v.message);
  }
  const primary = violations.filter((v) => v.signal === 'oracle').length;
  const detail = `${violations.length} violation(s) (${primary} from this audit's own live oracle comparison over `
    + `${oracleRows.length} matched oracle rows vs ${ipoRows.length} live IPOs, ${violations.length - primary} `
    + `data_conflicts-only${conflictSignalAvailable ? '' : '; data_conflicts absent'})${oracleFetchNote}`
    + (violations.length ? `: ${violations.slice(0, MAX_OFFENDERS).map((v) => v.message).join('; ')}` : '');
  record('a_b_live_conflict', name, violations.length === 0 ? 'PASS' : 'FAIL', detail);

  // (b) SEPARATE check, its own PASS/FAIL: our derived minimum RETAIL
  // application (exchange lot x segment multiplier) vs ipowatch's own
  // "minimum bid is N Shares" figure. Same oracle fetch, no second HTTP round.
  const minAppName = 'live IPO minimum retail application (lot_size x segment multiplier) agrees with the independent non-ingested oracle (ipowatch.in)';
  const minAppViolations = findMinApplicationDisagreements({ ipoRows, oracleRows });
  for (const v of minAppViolations) {
    notify('a_b_min_application', 'P1', `${v.ipoId}-${v.fieldName}`,
      `Live IPO "${v.companyName}" publishes a disputed minimum retail application`, v.message);
  }
  record('a_b_min_application', minAppName, minAppViolations.length === 0 ? 'PASS' : 'FAIL',
    `${minAppViolations.length} violation(s) over ${oracleRows.length} matched oracle rows vs ${ipoRows.length} live IPOs${oracleFetchNote}`
    + (minAppViolations.length ? `: ${minAppViolations.slice(0, MAX_OFFENDERS).map((v) => v.message).join('; ')}` : ''));
}

// ---- (c): issue_size plausibility -------------------------------------------
async function checkC() {
  const rows = await q(
    `SELECT id, company_name, segment, issue_size AS "issueSize", price_range_max AS "priceRangeMax",
            (SELECT s.shares_offered FROM subscriptions s WHERE s.ipo_id = i.id AND s.shares_offered IS NOT NULL
              ORDER BY s.timestamp DESC LIMIT 1) AS "sharesOffered"
       FROM ipos i WHERE ${REAL_IPO}`
  );
  const floorOffenders = [];
  const consistencyOffenders = [];
  for (const r of rows) {
    const v1 = checkIssueSizeSegmentFloor(r);
    if (v1) { floorOffenders.push(`"${r.company_name}" — ${v1}`); notify('c_issue_size_floor', 'P1', r.id, `issue_size below segment floor: ${r.company_name}`, v1); }
    const v2 = checkIssueSizeSharesConsistency(r);
    if (v2) { consistencyOffenders.push(`"${r.company_name}" — ${v2}`); notify('c_issue_size_consistency', 'P1', r.id, `issue_size inconsistent with shares x price: ${r.company_name}`, v2); }
  }
  record('c_issue_size_floor', 'issue_size >= segment-appropriate floor', floorOffenders.length === 0 ? 'PASS' : 'FAIL',
    `${floorOffenders.length} violation(s)` + (floorOffenders.length ? `: ${floorOffenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
  record('c_issue_size_consistency', 'issue_size (total incl. OFS) is within 0.75x-3.0x of shares_offered (net public offer) x price_range_max', consistencyOffenders.length === 0 ? 'PASS' : 'FAIL',
    `${consistencyOffenders.length} violation(s)` + (consistencyOffenders.length ? `: ${consistencyOffenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
}

// ---- (d): lot x band SEBI window + corporate-action shape -------------------
async function checkD() {
  const rows = await q(
    `SELECT i.id, i.company_name, i.offering_type AS "offeringType", i.segment,
            i.lot_size AS "lotSize", i.price_range_min AS "priceRangeMin", i.price_range_max AS "priceRangeMax",
            CASE WHEN i.open_date IS NOT NULL AND i.close_date IS NOT NULL
                 THEN (i.close_date - i.open_date) ELSE NULL END AS "windowDays"
       FROM ipos i WHERE i.offering_type = 'IPO'`
  );
  const lotOffenders = [];
  const shapeOffenders = [];
  for (const r of rows) {
    const v1 = checkLotBandSebiWindow(r);
    if (v1) { lotOffenders.push(`"${r.company_name}" — ${v1}`); notify('d_lot_band_window', 'P1', r.id, `lot x band outside SEBI window: ${r.company_name}`, v1); }
    const v2 = checkCorporateActionShape(r);
    if (v2) { shapeOffenders.push(`"${r.company_name}" — ${v2}`); notify('d_corporate_action_shape', 'P1', r.id, `corporate-action shape typed as IPO: ${r.company_name}`, v2); }
  }
  record('d_lot_band_window', 'lot_size x price_range_max within the segment SEBI retail window', lotOffenders.length === 0 ? 'PASS' : 'FAIL',
    `${lotOffenders.length} violation(s)` + (lotOffenders.length ? `: ${lotOffenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
  record('d_corporate_action_shape', 'no offering_type=IPO row matches the corporate-action shape', shapeOffenders.length === 0 ? 'PASS' : 'FAIL',
    `${shapeOffenders.length} violation(s)` + (shapeOffenders.length ? `: ${shapeOffenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
}

// ---- (e): every web/app/api/** route, enumerated from the filesystem -------
function enumerateApiRoutes() {
  const apiDir = join(REPO_ROOT, 'web', 'app', 'api');
  const routes = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name === 'route.ts' || entry.name === 'route.js') {
        const rel = relative(apiDir, dirname(full)).split(/[\\/]/).join('/');
        routes.push('/api/' + rel);
      }
    }
  })(apiDir);
  return routes;
}

// A route path may contain [param] / [...param] segments — substitute a
// representative value so the sweep exercises the real handler rather than
// a guaranteed-404 literal bracket.
function fillRouteParams(routePath, sampleSlug, sampleId) {
  return routePath
    .replace(/\[\.\.\.[^\]]+\]/g, sampleSlug)
    .replace(/\[id\]/gi, sampleId)
    .replace(/\[ipoId\]/gi, sampleId)
    .replace(/\[table\]/gi, 'ipos')
    .replace(/\[slug\]/gi, sampleSlug)
    .replace(/\[[^\]]+\]/g, sampleSlug);
}

async function checkE() {
  const allRoutes = enumerateApiRoutes();
  const adminRoutes = allRoutes.filter((r) => r.startsWith('/api/admin/'));
  const publicRoutes = allRoutes.filter((r) => !r.startsWith('/api/admin/'));

  const [{ slug } = {}] = await q(`SELECT slug FROM ipos WHERE ${REAL_IPO} AND status = 'LISTED' ORDER BY listing_date DESC NULLS LAST LIMIT 1`);
  const [{ id } = {}] = await q(`SELECT id FROM ipos WHERE ${REAL_IPO} AND status = 'LISTED' ORDER BY listing_date DESC NULLS LAST LIMIT 1`);
  const sampleSlug = slug || 'sample-ipo';
  const sampleId = id || '00000000-0000-0000-0000-000000000000';

  const offenders = [];
  let unreachable = 0;
  for (const route of publicRoutes) {
    const path = fillRouteParams(route, sampleSlug, sampleId);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(BASE_URL + path, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      const text = await res.text();
      const cls = classifyRouteResponse(path, res.status, text);
      if (cls.fail) offenders.push(`${path} — ${cls.reasons.join('; ')}`);
    } catch (e) {
      unreachable++;
    }
  }
  for (const o of offenders) notify('e_route_sweep', 'P1', o.split(' — ')[0], `Public API route unhealthy: ${o.split(' — ')[0]}`, o);
  // ANY unreachable route means this sweep did not cover its whole population.
  // The first cut only reported UNVERIFIABLE when EVERY route was unreachable,
  // so 39/40 reachable + 1 hanging read as a clean PASS (checker finding). A
  // real FAIL still dominates — an unreachable route cannot un-break a broken
  // one — but a sweep with holes and no failures is BLIND, not green.
  const status = offenders.length > 0 ? 'FAIL' : unreachable > 0 ? 'UNVERIFIABLE' : 'PASS';
  record('e_route_sweep', `every web/app/api/** public route (${publicRoutes.length} enumerated, ${adminRoutes.length} admin routes skipped) returns non-5xx with no SQL/stack leak`,
    status, `${offenders.length} failing, ${unreachable} unreachable (of ${publicRoutes.length})` + (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join(' | ')}` : ''));
}

// ---- (e2): #350 — an unknown IPO slug must 404, never resolve to a
// different company via the fuzzy fallback. Three nonsense slugs (never a
// real row) must each 404; one real, currently-live slug must resolve to
// itself. Catches the NEXT member of the class: any slug the fuzzy fallback
// starts resolving to an unrelated IPO again (threshold regression, a
// normalization change, a new confusable pair) fails this check the same
// night it ships.
async function checkE_unknownSlug404() {
  const nonsenseSlugs = [
    'zzz-not-a-real-ipo',
    'this-company-does-not-exist-ltd',
    'qwzxy-industries-fake-9999',
  ];

  const offenders = [];
  let unreachable = 0;
  for (const slug of nonsenseSlugs) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${BASE_URL}/api/ipos/${slug}`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (res.status !== 404) {
        offenders.push(`${slug} -> HTTP ${res.status} (want 404)`);
      }
    } catch (e) {
      unreachable++;
    }
  }

  const [{ slug: realSlug } = {}] = await q(
    `SELECT slug FROM ipos WHERE ${REAL_IPO} ORDER BY listing_date DESC NULLS LAST, created_at DESC LIMIT 1`
  );
  let realSlugOk = null; // null = skipped (no row to test against)
  if (realSlug) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${BASE_URL}/api/ipos/${realSlug}`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
      const body = res.ok ? await res.json().catch(() => null) : null;
      realSlugOk = res.ok && body?.data?.ipo?.slug === realSlug;
      if (!realSlugOk) {
        offenders.push(`${realSlug} (real slug) -> HTTP ${res.status}, resolved slug ${body?.data?.ipo?.slug ?? 'n/a'} (want itself)`);
      }
    } catch (e) {
      unreachable++;
    }
  }

  const status = offenders.length > 0 ? 'FAIL' : unreachable > 0 ? 'UNVERIFIABLE' : 'PASS';
  record(
    'e_unknown_slug_404',
    `/api/ipos/<slug>: ${nonsenseSlugs.length} nonsense slugs 404, and a real slug resolves to itself (never a different IPO via the fuzzy fallback, #350)`,
    status,
    `${offenders.length} failing, ${unreachable} unreachable` + (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join(' | ')}` : realSlug ? `; real slug checked: ${realSlug}` : '; no LISTED row to check the positive case')
  );
}

// ---- (f): conflict noise ratio + shrink-only backlog ratchet ----------------
async function checkF() {
  if (!(await tableExists('data_conflicts'))) {
    record('f_conflict_noise_ratio', 'unresolved data_conflicts noise ratio < 5% AND backlog within shrink-only ratchet baseline', 'UNVERIFIABLE', 'data_conflicts table not present');
    return;
  }
  const [{ dbName }] = await q(`SELECT current_database() AS "dbName"`);
  const [{ total }] = await q(`SELECT count(*)::int total FROM data_conflicts WHERE resolved_at IS NULL`);
  const [{ noise }] = await q(`SELECT count(*)::int noise FROM data_conflicts WHERE resolved_at IS NULL AND (value2 IS NULL OR value2 = '' OR value1 = value2)`);
  const cls = classifyConflictNoiseRatio(total, noise);
  if (cls.fail) notify('f_conflict_noise_ratio', 'P2', 'aggregate', 'data_conflicts noise ratio too high', `${noise}/${total} (${(cls.ratio * 100).toFixed(1)}%) unresolved conflicts are noise (empty value2 or value1==value2)`);

  // F2 (#191, round 2): a flat 500-row ceiling is red forever on a database
  // that starts above 500 (staging: 14,252) — a ratchet instead: FAIL only on
  // a RISE above this database's checked-in baseline (T-285 unbounded-growth
  // class), WARN (not FAIL) with the delta on a fall, and the baseline is
  // only ever lowered by an explicit `--rebaseline-conflicts` run, which
  // itself refuses to raise a stored baseline.
  if (REBASELINE_CONFLICTS) {
    const baseline = readConflictBaseline();
    const existing = baseline.databases[dbName]?.unresolved ?? null;
    const next = nextRatchetBaseline(existing, total);
    baseline.databases[dbName] = { unresolved: next, recordedAt: new Date().toISOString() };
    writeConflictBaseline(baseline);
    console.log(`[REBASELINE] data_conflicts backlog for "${dbName}": ${existing ?? '(none)'} -> ${next}`);
  }
  const baselineNow = readConflictBaseline();
  const baselineEntry = baselineNow.databases[dbName]?.unresolved ?? null;
  const ratchetCls = classifyConflictBacklogRatchet(total, baselineEntry);
  if (ratchetCls.status === 'FAIL') {
    notify('f_conflict_noise_ratio', 'P2', 'aggregate', 'data_conflicts unresolved backlog ROSE above its shrink-only baseline', `${total} unresolved > baseline ${ratchetCls.baseline} for database "${dbName}" (+${ratchetCls.delta}) — unbounded-growth class, T-285`);
  }

  const status = cls.fail || ratchetCls.status === 'FAIL' ? 'FAIL'
    : ratchetCls.status === 'UNVERIFIABLE' ? 'UNVERIFIABLE'
    : 'PASS';
  const ratchetDetail = ratchetCls.status === 'UNVERIFIABLE'
    ? `no ratchet baseline seeded for database "${dbName}" — run --rebaseline-conflicts to seed`
    : ratchetCls.status === 'WARN'
      ? `backlog fell ${Math.abs(ratchetCls.delta)} below baseline ${ratchetCls.baseline} (WARN; baseline not auto-lowered, rerun --rebaseline-conflicts to lower it)`
      : `${total} vs baseline ${ratchetCls.baseline} (${ratchetCls.delta >= 0 ? '+' : ''}${ratchetCls.delta})`;
  record('f_conflict_noise_ratio', 'unresolved data_conflicts noise ratio < 5% AND backlog within shrink-only ratchet baseline', status, `${noise}/${total} = ${(cls.ratio * 100).toFixed(1)}% noise; ${ratchetDetail}`);
}

// ---- (g1): repeated-WARN detector (#191 F1) ---------------------------------
// A validation warning logged 20+ times per cycle while the mis-typed rows
// still write through stops being a signal (T-272 P2-2, InvIT/REIT). Groups
// scraper_logs FAILURE/PARTIAL rows by their (truncated) error message over
// the last 24h; any single message occurring more than the threshold FAILs.
async function checkG1_repeatedWarn() {
  if (!(await tableExists('scraper_logs'))) {
    record('g_repeated_warn', `no single scraper_logs message repeats >${REPEATED_MESSAGE_MAX_OCCURRENCES_24H}x/24h`, 'UNVERIFIABLE', 'scraper_logs table not present');
    return;
  }
  const rows = await q(`
    SELECT left(error_message, 120) AS message, count(*)::int AS count
      FROM scraper_logs
     WHERE status IN ('FAILURE', 'PARTIAL')
       AND error_message IS NOT NULL
       AND created_at > now() - interval '24 hours'
     GROUP BY 1
     HAVING count(*) > $1
     ORDER BY count(*) DESC`, [REPEATED_MESSAGE_MAX_OCCURRENCES_24H]);
  const cls = classifyRepeatedMessages(rows);
  for (const o of cls.offenders.slice(0, MAX_OFFENDERS)) {
    notify('g_repeated_warn', 'P2', o.message, 'scraper_logs message repeated beyond threshold', `"${o.message}" logged ${o.count}x in the last 24h (>${REPEATED_MESSAGE_MAX_OCCURRENCES_24H}) — a signal that repeats forever stops being a signal`);
  }
  record('g_repeated_warn', `no single scraper_logs message repeats >${REPEATED_MESSAGE_MAX_OCCURRENCES_24H}x/24h`, cls.fail ? 'FAIL' : 'PASS', `${cls.offenders.length} offending message(s)`);
}

// ---- (g3): inert detector, WINDOWED (#191 F3, T-465 round 2) ----------------
// The important one, per the issue: a detector reporting zero is
// indistinguishable from a healthy system UNLESS cross-checked against an
// invariant independently known to be violated (T-272 P3-5, conflictsDetected
// read 0 across 3,760 fields while real disagreements demonstrably existed).
// Round 2: compares LIKE WITH LIKE — violations are counted only among rows
// whose relevant fields were WRITTEN in the same trailing-24h window the
// conflict count is windowed to (round 1 compared an all-time violation
// snapshot against a 24h conflict count: a violation caught days ago with no
// new activity, or one that never involves cross-source disagreement, was
// wrongly called "inert"). An empty windowed population (nothing written)
// SKIPs — the cross-check has nothing to say, so a quiet night is never
// silently read as "detector healthy".
async function checkG3_inertDetector() {
  if (!(await tableExists('data_conflicts')) || !(await tableExists('ipos'))) {
    record('g_inert_detector', 'windowed price-band violations without any windowed conflicts inserted -> detector inert', 'UNVERIFIABLE', 'data_conflicts or ipos table not present');
    return;
  }
  const priceRows = await q(`SELECT price_range_min, price_range_max FROM ipos WHERE ${REAL_IPO} AND updated_at > now() - interval '24 hours'`);
  const population = priceRows.length;
  const violations = priceRows.filter((r) => checkPriceBand(r) !== null).length;
  const [{ inserted }] = await q(`SELECT count(*)::int inserted FROM data_conflicts WHERE detected_at > now() - interval '24 hours'`);
  const cls = classifyInertDetector(population, violations, inserted);
  if (cls.status === 'FAIL') notify('g_inert_detector', 'P1', 'aggregate', 'conflict detector appears inert', `${cls.violations} of ${cls.population} IPO row(s) written in the last 24h fail checkPriceBand (real corruption exists) but 0 data_conflicts rows were inserted in that SAME window — the detector is inert, not the data clean`);
  record('g_inert_detector', 'windowed price-band violations without any windowed conflicts inserted -> detector inert', cls.status, `${cls.violations} violation(s) among ${cls.population} row(s) written/24h, ${cls.inserted} conflict(s) inserted/24h`);
}

// ---- (m): document_fetch_state — did the document machine do its job? ---------
// T-403 WP B, decision-matrix 7.4 item 4. Four FAIL-level checks plus one WARN.
// The most important is m_live_ipo_has_state: every other check reads rows the
// job wrote, and only that one notices it wrote NONE — i.e. that the whole
// machine silently stopped.
async function checkM() {
  if (!(await tableExists('document_fetch_state'))) {
    // UNVERIFIABLE, never PASS: a missing table means the audit is BLIND to
    // documents tonight, which is not the same as documents being healthy.
    record('m_document_state', 'document_fetch_state checks', 'UNVERIFIABLE',
      'document_fetch_state table not present (migration 0035 not applied here)');
    return;
  }

  const now = new Date().toISOString();
  // Only meaningful once WP C wires the extractor; until then FOUND is terminal
  // by design and this check is deliberately inert rather than noisily wrong.
  const extractionWired = process.env.ENABLE_DRHP_EXTRACTION === 'true';

  const rows = await q(`
    SELECT s.doc_type, s.state, s.blocked_since_at, s.last_attempt_at, s.first_seen_at,
           s.last_attempt, s.extractor_version, i.company_name, i.open_date, i.close_date
      FROM document_fetch_state s JOIN ipos i ON i.id = s.ipo_id
     WHERE i.offering_type = 'IPO'
  `);

  const norm = (r) => ({
    docType: r.doc_type, state: r.state, blockedSinceAt: r.blocked_since_at,
    lastAttemptAt: r.last_attempt_at, firstSeenAt: r.first_seen_at,
    lastAttempt: r.last_attempt,
    extractorVersion: r.extractor_version, companyName: r.company_name,
    openDate: r.open_date, closeDate: r.close_date,
  });

  const blocked = rows.map(norm).map((r) => checkBlockedAllAge(r, now)).filter(Boolean);
  for (const v of blocked) notify('m_blocked_all_age', 'P2', v, 'Document blocked on every source > 24h', v);
  record('m_blocked_all_age', 'no document BLOCKED_ALL for more than 24h',
    blocked.length === 0 ? 'PASS' : 'FAIL', blocked.slice(0, MAX_OFFENDERS).join('; '));

  const unread = rows.map(norm).map((r) => checkFoundNotExtracted(r, now, extractionWired)).filter(Boolean);
  for (const v of unread) notify('m_found_not_extracted', 'P2', v, 'Document found but never read', v);
  record('m_found_not_extracted',
    `no document FOUND-but-unextracted for more than 48h${extractionWired ? '' : ' (inert: extractor not wired)'}`,
    unread.length === 0 ? 'PASS' : 'FAIL', unread.slice(0, MAX_OFFENDERS).join('; '));

  // M-4: a document the pipeline can never REACH settles as NOT_YET_FILED and
  // stays there silently. That is the shape T-403's B-1 produced for every DRHP,
  // and nothing would have noticed it without this check.
  const staleUnfiled = rows.map(norm).map((r) => checkNotYetFiledAge(r, now)).filter(Boolean);
  for (const v of staleUnfiled) notify('m_not_yet_filed_age', 'P2', v, 'Document NOT_YET_FILED past its filing calendar', v);
  record('m_not_yet_filed_age', 'no document NOT_YET_FILED past its filing calendar (DRHP 14d / RHP 2d / Prospectus 3d / anchor 1d)',
    staleUnfiled.length === 0 ? 'PASS' : 'FAIL', staleUnfiled.slice(0, MAX_OFFENDERS).join('; '));

  // r6: an absence NOBODY OBSERVED. `m_not_yet_filed_age` above only notices
  // days later, once the filing calendar has run out; this reads the row's own
  // rung chain on the first night and fails when a NOT_YET_FILED for a type the
  // exchanges cannot serve has no answered rung behind it. Four rounds of T-403
  // Class 1 arrived through four different doors; this check does not care which.
  const unevidenced = rows.map(norm).map((r) => checkAbsenceWithoutEvidence(r)).filter(Boolean);
  for (const v of unevidenced)
    notify('m_absence_without_evidence', 'P2', v, 'Document NOT_YET_FILED with no rung that answered', v);
  record('m_absence_without_evidence',
    'no NOT_YET_FILED row whose rung chain contains zero answered rungs',
    unevidenced.length === 0 ? 'PASS' : 'FAIL', unevidenced.slice(0, MAX_OFFENDERS).join('; '));

  const failedExtractions = rows.map(norm).map(checkExtractFailed).filter(Boolean);
  record('m_extract_failed', 'no document stuck in EXTRACT_FAILED (WARN-level)',
    failedExtractions.length === 0 ? 'PASS' : 'WARN', failedExtractions.slice(0, MAX_OFFENDERS).join('; '));

  // m_extraction_stuck (round 5, #333 follow-up): m_extract_failed above is
  // WARN-only and blind to `documents.extraction_status` entirely (MANUAL_REVIEW,
  // or FAILED behind a HARD_FAILURE marker) — see checkExtractionStuck's header
  // comment. FAIL-level, joins `documents` to its sibling `document_fetch_state`
  // row (same ipo+doc_type) so all three stuck shapes are caught in one check.
  const extractionStuckRows = await q(`
    SELECT i.company_name, i.slug, i.status AS ipo_status, d.type AS doc_type,
           d.extraction_status, d.extraction_error, d.retry_count, d.updated_at AS doc_updated_at,
           fs.state AS fetch_state
      FROM documents d
      JOIN ipos i ON i.id = d.ipo_id
      LEFT JOIN document_fetch_state fs ON fs.ipo_id = d.ipo_id AND fs.doc_type = d.type
     WHERE i.${REAL_IPO}
       AND i.status IN ('UPCOMING','OPEN','CLOSED','LISTED')
       AND d.type IN ('DRHP','RHP','PROSPECTUS')
  `);
  const nowMs = Date.now();
  const extractionStuck = extractionStuckRows
    .map((r) => ({
      companyName: r.company_name,
      slug: r.slug,
      ipoStatus: r.ipo_status,
      docType: r.doc_type,
      extractionStatus: r.extraction_status,
      extractionError: r.extraction_error,
      retryCount: r.retry_count,
      fetchState: r.fetch_state,
      hoursSinceUpdate: r.doc_updated_at ? (nowMs - new Date(r.doc_updated_at).getTime()) / (1000 * 60 * 60) : null,
    }))
    .map(checkExtractionStuck)
    .filter(Boolean);
  for (const v of extractionStuck)
    notify('m_extraction_stuck', 'P1', v, 'Required document type stuck in extraction (MANUAL_REVIEW/EXTRACT_FAILED/HARD_FAILURE) past 48h', v);
  record('m_extraction_stuck',
    'no DRHP/RHP/PROSPECTUS stuck MANUAL_REVIEW, EXTRACT_FAILED, or FAILED+HARD_FAILURE for more than 48h on a live IPO',
    extractionStuck.length === 0 ? 'PASS' : 'FAIL', extractionStuck.slice(0, MAX_OFFENDERS).join('; '));

  const liveIpos = await q(`
    SELECT i.company_name, i.status, count(s.id)::int AS state_row_count
      FROM ipos i LEFT JOIN document_fetch_state s ON s.ipo_id = i.id
     WHERE i.${REAL_IPO} AND i.status IN ('UPCOMING','OPEN','CLOSED')
     GROUP BY i.id, i.company_name, i.status
  `);
  const forgotten = liveIpos
    .map((r) => checkLiveIpoHasStateRows({ companyName: r.company_name, status: r.status, stateRowCount: r.state_row_count }))
    .filter(Boolean);
  for (const v of forgotten) notify('m_live_ipo_has_state', 'P2', v, 'Live IPO has no document state rows', v);
  record('m_live_ipo_has_state', 'every UPCOMING/OPEN/CLOSED IPO has document_fetch_state rows',
    forgotten.length === 0 ? 'PASS' : 'FAIL', forgotten.slice(0, MAX_OFFENDERS).join('; '));

  // listed_rotation_stall (2026-09-06): the check above deliberately excludes
  // LISTED (STAGE_DOCUMENT_TYPES.LISTED === [] — nothing NEW becomes due), but
  // `dueDocTypesForStage` is cumulative, so a LISTED IPO still needed every
  // earlier-stage document already fetched. A LISTED IPO inside the 10-day
  // rotation window with `documents` on file but ZERO `document_fetch_state`
  // rows sorts first in the LISTED rotation order forever (NULLS FIRST on
  // MAX(last_attempt_at)) and starves every LISTED row behind it.
  const listedRotationCandidates = await q(`
    SELECT i.company_name, i.slug, i.status,
           EXTRACT(EPOCH FROM (now() - i.listing_date)) / 86400.0 AS days_since_listing,
           count(DISTINCT s.id)::int AS state_row_count,
           count(DISTINCT d.id)::int AS documents_row_count,
           count(DISTINCT s.id) FILTER (
             WHERE s.state NOT IN ('FOUND', 'NOT_APPLICABLE', 'SUPERSEDED')
               AND (s.next_retry_at IS NULL OR s.next_retry_at <= now())
           )::int AS incomplete_row_count,
           EXTRACT(EPOCH FROM (now() - MAX(s.last_attempt_at))) / 3600.0 AS hours_since_last_attempt
      FROM ipos i
      LEFT JOIN document_fetch_state s ON s.ipo_id = i.id
      LEFT JOIN documents d ON d.ipo_id = i.id
     WHERE i.${REAL_IPO} AND i.status = 'LISTED' AND i.listing_date IS NOT NULL
       AND i.listing_date >= now() - interval '${LISTED_ROTATION_WINDOW_DAYS} days'
     GROUP BY i.id, i.company_name, i.slug, i.status, i.listing_date
  `);
  const rotationStalled = listedRotationCandidates
    .map((r) => checkListedRotationStall({
      companyName: r.company_name,
      slug: r.slug,
      status: r.status,
      daysSinceListing: r.days_since_listing,
      stateRowCount: r.state_row_count,
      documentsRowCount: r.documents_row_count,
      incompleteRowCount: r.incomplete_row_count,
      hoursSinceLastAttempt: r.hours_since_last_attempt,
    }))
    .filter(Boolean);
  for (const v of rotationStalled)
    notify('listed_rotation_stall', 'P2', v, 'LISTED IPO stuck at the front of the document rotation', v);
  record('listed_rotation_stall',
    `no LISTED IPO inside the ${LISTED_ROTATION_WINDOW_DAYS}-day live window is stuck at the front of the rotation: documents on file with 0 fetch-state rows, or due rows with MAX(last_attempt_at) older than ${STALE_ROTATION_HOURS}h`,
    rotationStalled.length === 0 ? 'PASS' : 'FAIL', rotationStalled.slice(0, MAX_OFFENDERS).join('; '));

  // BRLM count vs the BSE payload (F17). We cannot re-fetch BSE from the audit
  // (read-only, and it would double the traffic), so the comparison is against
  // the count the scraper recorded at write time; a row with no recorded payload
  // count is skipped rather than assumed healthy.
  const brlm = await q(`
    SELECT company_name,
           coalesce(CASE WHEN jsonb_typeof(lead_managers) = 'array' THEN jsonb_array_length(lead_managers) END, 0)::int AS stored_count,
           bse_payload_lead_manager_count::int AS payload_count
      FROM ipos
     WHERE ${REAL_IPO} AND bse_payload_lead_manager_count IS NOT NULL
  `);
  const short = brlm
    .map((r) => checkLeadManagerCount({ companyName: r.company_name, storedLeadManagerCount: r.stored_count, bsePayloadLeadManagerCount: r.payload_count }))
    .filter(Boolean);
  for (const v of short) notify('m_brlm_count', 'P2', v, 'Fewer lead managers stored than BSE lists', v);
  record('m_brlm_count', `stored lead managers >= the BSE payload count (${brlm.length} row(s) with a recorded payload count)`,
    short.length === 0 ? 'PASS' : 'FAIL', short.slice(0, MAX_OFFENDERS).join('; '));

  // T-403 M6: does the stored type still agree with the classifier? Fixing the
  // classifier only helped documents discovered afterwards; nothing compared the
  // corpus against it, so a Prospectus stored as RHP stayed invisible.
  // The classifier itself is TypeScript and this audit runs as plain Node on the
  // box, so the rules are mirrored here — same convention as HIGH_VALUE_FIELDS.
  const REFINEMENTS = {
    RHP: ['PROSPECTUS'],
    ADDENDUM: ['CORRIGENDUM', 'PRICE_BAND_AD'],
    BASIS_OF_ALLOTMENT: ['BASIS_OF_ALLOTMENT_AD'],
  };
  const classifyUrlOrTitle = (url, title) => {
    const name = String(url || '').split(/[?#]/)[0].split('/').pop() || '';
    for (const text of [decodeURIComponent(name).toLowerCase(), String(title || '').toLowerCase()]) {
      if (!text) continue;
      if (text.includes('price band') || text.includes('pricebandad')) return 'PRICE_BAND_AD';
      if (text.includes('corrigendum')) return 'CORRIGENDUM';
      if (text.includes('basis of allot') || text.includes('allotment advert')) return 'BASIS_OF_ALLOTMENT_AD';
      if (text.includes('draft') || text.includes('drhp')) return 'DRHP';
      if (text.includes('red herring') || /rhp/.test(text)) return 'RHP';
      if (text.includes('prospectus')) return 'PROSPECTUS';
    }
    return null;
  };
  const docRows = await q(`SELECT d.id, d.url, d.title, d.type::text AS type FROM documents d`);
  const mistyped = docRows
    .map((r) => checkDocumentTypeMatchesClassifier(r, classifyUrlOrTitle, REFINEMENTS))
    .filter(Boolean);
  for (const v of mistyped) notify('m_document_type_classifier', 'P2', v, 'Stored document type disagrees with the classifier', v);
  record('m_document_type_classifier', 'documents.type agrees with the classifier for every stored row',
    mistyped.length === 0 ? 'PASS' : 'FAIL', mistyped.slice(0, MAX_OFFENDERS).join('; '));
}

// ---- (g): newest-row age per offering_type ------------------------------------
async function checkG() {
  const rows = await q(
    `SELECT offering_type AS "offeringType", MAX(created_at) AS newest
       FROM ipos GROUP BY offering_type`
  );
  const offenders = [];
  for (const r of rows) {
    const ageDays = r.newest ? Math.floor((Date.now() - new Date(r.newest).getTime()) / 86400000) : null;
    const violation = checkFreshnessPerType(r.offeringType, ageDays);
    if (violation) { offenders.push(violation); notify('g_freshness_per_type', 'P2', r.offeringType, `${r.offeringType} calendar is stale`, violation); }
  }
  record('g_freshness_per_type', 'newest row age per offering_type within its freshness ceiling', offenders.length === 0 ? 'PASS' : 'FAIL',
    offenders.length ? offenders.join('; ') : 'all fresh');
}

// ---- (h): pm2 env TZ + log size -----------------------------------------------
async function checkH() {
  let list;
  try {
    list = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10000 }));
  } catch (e) {
    record('h_pm2_env_tz', 'every pm2 process has TZ in its environment', 'UNVERIFIABLE', 'pm2 not reachable on this host (expected on a dev machine; runs for real on the box via cron)');
    record('h_pm2_log_size', 'every pm2 log file is under 100MB', 'UNVERIFIABLE', 'pm2 not reachable on this host');
    return;
  }
  const tzOffenders = [];
  const sizeOffenders = [];
  for (const proc of list) {
    const name = proc.name;
    const env = proc.pm2_env?.env || {};
    const v1 = checkPm2EnvHasTz(name, env);
    if (v1) { tzOffenders.push(v1); notify('h_pm2_env_tz', 'P1', name, `pm2 process "${name}" has no TZ`, v1); }
    for (const [label, p] of [['out', proc.pm2_env?.pm_out_log_path], ['err', proc.pm2_env?.pm_err_log_path]]) {
      if (!p || !existsSync(p)) continue;
      const size = statSync(p).size;
      const v2 = checkPm2LogSize(name, `${label}:${p}`, size);
      if (v2) { sizeOffenders.push(v2); notify('h_pm2_log_size', 'P2', `${name}-${label}`, `pm2 log oversized for "${name}"`, v2); }
    }
  }
  record('h_pm2_env_tz', 'every pm2 process has TZ in its environment', tzOffenders.length === 0 ? 'PASS' : 'FAIL', tzOffenders.join('; ') || 'all set');
  record('h_pm2_log_size', 'every pm2 log file is under 100MB', sizeOffenders.length === 0 ? 'PASS' : 'FAIL', sizeOffenders.join('; ') || 'all under ceiling');
}

// ---- (i): wire-or-retire — scheduler tree reachable from the prod entrypoint --
function checkI() {
  // Enumerate the scheduler-tree entrypoints DEFINED in the repo (not a hand
  // list — every .ts file directly under scraper/src/scheduler/ that exports
  // a class/service, i.e. is a candidate "definition" someone could wire up).
  const schedulerDir = join(REPO_ROOT, 'scraper', 'src', 'scheduler');
  const defined = readdirSync(schedulerDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `scraper/src/scheduler/${f}`);

  // A definition is REFERENCED if it is `import`-ed (a real code dependency,
  // not merely mentioned in a comment) by one of the three places that could
  // put it on the prod execution path: the scraper's own entrypoint, the pm2
  // ecosystem config, or the deploy script's pm2 start commands.
  const referencedSources = [
    join(REPO_ROOT, 'scraper', 'src', 'index.ts'),
    join(REPO_ROOT, 'ecosystem.config.js'),
    join(REPO_ROOT, 'scripts', 'deploy-linux.sh'),
  ].filter(existsSync).map((f) => readFileSync(f, 'utf8'));

  const referenced = [];
  for (const name of defined) {
    const base = name.replace('scraper/src/scheduler/', '').replace(/\.ts$/, '');
    const importRe = new RegExp(`import[^;]*from\\s+['"][^'"]*scheduler/${base}['"]`);
    const isReferenced = referencedSources.some((src) => importRe.test(src));
    if (isReferenced) referenced.push(name);
  }
  const unreferenced = findUnreferencedDefinitions(defined, referenced);
  for (const u of unreferenced) notify('i_wire_or_retire', 'P2', u, `Scheduler definition never wired to prod`, `${u} is defined but not \`import\`-ed by scraper/src/index.ts, ecosystem.config.js, or scripts/deploy-linux.sh — it is dead code in production (P2-8 class)`);
  record('i_wire_or_retire', `every scraper/src/scheduler/*.ts definition is imported by the prod entrypoint (${defined.length} enumerated)`,
    unreferenced.length === 0 ? 'PASS' : 'FAIL', unreferenced.length ? unreferenced.join(', ') + ' — never imported by prod' : 'all referenced');
}

// ---- (k): T-340 post-scrape step ledger -- every wired step must leave a row --
// The RUNTIME twin of (i) above. (i) proves a step is WIRED; (k) proves it
// actually RAN and worked. A cycle can exit 0 with statusUpdate skipped every
// time (ADMIN_API_TOKEN unset) or failing every time inside its non-fatal
// catch -- (i) sees nothing wrong, the exit code is 0, and statuses go stale
// with no alert. That is this check's entire reason to exist.
async function checkK() {
  const silenceName = `every post-scrape step in STEP_NAMES has >=1 ok row in ${STEP_LEDGER_WINDOW_HOURS}h`;
  const streakName = 'no post-scrape step has failed in 3+ consecutive cycles';

  // The expected-step list is DERIVED from the prod entrypoint, never typed
  // here -- a hand-typed copy is the i_wire_or_retire class itself.
  let stepNames;
  try {
    stepNames = parseStepNames(readFileSync(join(REPO_ROOT, 'scraper', 'src', 'index.ts'), 'utf8'));
  } catch (e) {
    record('k_step_ledger_silence', silenceName, 'UNVERIFIABLE', `cannot derive STEP_NAMES: ${e.message}`);
    record('k_step_consecutive_failures', streakName, 'UNVERIFIABLE', `cannot derive STEP_NAMES: ${e.message}`);
    return;
  }

  if (!(await tableExists('scraper_steps'))) {
    const detail = 'scraper_steps table not present (T-340 migration 0033 not applied on this DB) -- the audit is BLIND to step health, not green';
    record('k_step_ledger_silence', silenceName, 'UNVERIFIABLE', detail);
    record('k_step_consecutive_failures', streakName, 'UNVERIFIABLE', detail);
    return;
  }

  const rows = await q(
    `SELECT step, status, created_at
       FROM scraper_steps
      WHERE created_at > now() - interval '${STEP_LEDGER_WINDOW_HOURS} hours'
      ORDER BY created_at DESC`
  );

  // Zero rows at all is NOT 12 FAILs -- on the first night after deploy the
  // writer may not have run yet, and 12 spurious P1 pages would get the channel
  // muted (the noise lesson this file already learned). It is UNVERIFIABLE:
  // blind, still non-zero exit, still paged. A genuinely dead scraper is caught
  // by (g) freshness, which does not depend on this table.
  if (rows.length === 0) {
    const detail = `scraper_steps has zero rows in the last ${STEP_LEDGER_WINDOW_HOURS}h -- the ledger writer has not run (or the scraper is dead; (g) freshness is the independent signal for that)`;
    record('k_step_ledger_silence', silenceName, 'UNVERIFIABLE', detail);
    record('k_step_consecutive_failures', streakName, 'UNVERIFIABLE', detail);
    return;
  }

  const okCounts = new Map();
  const statusesByStep = new Map(); // newest-first, insertion order from the query
  for (const r of rows) {
    if (r.status === 'ok') okCounts.set(r.step, (okCounts.get(r.step) || 0) + 1);
    if (!statusesByStep.has(r.step)) statusesByStep.set(r.step, []);
    statusesByStep.get(r.step).push(r.status);
  }

  const silent = [];
  const streaks = [];
  for (const step of stepNames) {
    const silence = checkStepSilence(step, okCounts.get(step) || 0);
    if (silence) {
      silent.push(step);
      notify('k_step_ledger_silence', 'P1', step, 'Post-scrape step is silently dead', silence);
    }
    const streak = checkStepConsecutiveFailures(step, statusesByStep.get(step) || []);
    if (streak) {
      streaks.push(step);
      notify('k_step_consecutive_failures', 'P1', step, 'Post-scrape step failing every cycle', streak);
    }
  }

  record('k_step_ledger_silence', `${silenceName} (${stepNames.length} derived)`,
    silent.length === 0 ? 'PASS' : 'FAIL',
    silent.length ? `no ok row in ${STEP_LEDGER_WINDOW_HOURS}h: ${silent.join(', ')}` : 'all steps produced ok rows');
  record('k_step_consecutive_failures', streakName,
    streaks.length === 0 ? 'PASS' : 'FAIL',
    streaks.length ? `failing streak >=3: ${streaks.join(', ')}` : 'no failing streaks');
}

// ---- (m_cycle_overrun): cadence D-13 / cycle-overrun RCA -------------------
// Reads the SAME scraper_steps rows as (k) above -- one row per wake for
// step='primarySourceDiscovery' (the document cycle) -- and fails when a
// cycle ran longer than 25 minutes or two wakes' windows overlapped (see
// `checkCycleOverrun` in lib/document-state-checks.mjs for the arithmetic).
async function checkCycleOverrunAudit() {
  const name = 'no document cycle ran > 25min or overlapped another wake in 24h';

  if (!(await tableExists('scraper_steps'))) {
    record('m_cycle_overrun', name, 'UNVERIFIABLE', 'scraper_steps table not present (T-340 migration 0033 not applied)');
    return;
  }

  const rows = await q(
    `SELECT cycle_id AS "cycleId", created_at AS "createdAt", duration_ms AS "durationMs"
       FROM scraper_steps
      WHERE step = 'primarySourceDiscovery'
        AND created_at > now() - interval '${STEP_LEDGER_WINDOW_HOURS} hours'
      ORDER BY created_at ASC`
  );

  if (rows.length === 0) {
    record('m_cycle_overrun', name, 'UNVERIFIABLE', `no primarySourceDiscovery rows in the last ${STEP_LEDGER_WINDOW_HOURS}h`);
    return;
  }

  const violation = checkCycleOverrun(rows);
  if (violation) notify('m_cycle_overrun', 'P1', 'primarySourceDiscovery', 'Document cycle ran long or overlapped another wake', violation);
  record('m_cycle_overrun', name, violation === null ? 'PASS' : 'FAIL', violation ?? `${rows.length} cycle(s) checked, all within budget`);
}

// ---- (l): T-340 daily NSE status cross-check ---------------------------------
// Our OPEN/UPCOMING set has never been checked against anything outside our own
// pipeline. NSE's current-issue + upcoming feeds are the primary oracle for
// "is this issue actually open right now". Same header/cookie handshake as
// scraper/src/scrapers/nse-api-client.ts (NSE rejects a cold API call).
//
// NSE down => UNVERIFIABLE, never PASS. A check that silently goes green when
// its oracle is unreachable is the T-321 silent-pass class, and it is exactly
// what this audit exists to prevent.
const NSE_BASE = 'https://www.nseindia.com';
const NSE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function nseCookieJar() {
  const jar = new Map();
  const collect = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const [name] = pair.split('=');
      if (name) jar.set(name, pair);
    }
  };
  for (const url of [NSE_BASE, `${NSE_BASE}/market-data/all-upcoming-issues-ipo`]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': NSE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: NSE_BASE,
        ...(jar.size ? { Cookie: [...jar.values()].join('; ') } : {}),
      },
    }).finally(() => clearTimeout(t));
    collect(res);
  }
  if (jar.size === 0) throw new Error('NSE returned no cookies — bot wall or outage');
  return [...jar.values()].join('; ');
}

async function nseJson(path, cookie) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(`${NSE_BASE}${path}`, {
    signal: ctrl.signal,
    headers: {
      'User-Agent': NSE_UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${NSE_BASE}/market-data/all-upcoming-issues-ipo`,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookie,
    },
  }).finally(() => clearTimeout(t));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

// NSE's feeds have moved field names before; accept the known aliases and
// require SOMETHING usable rather than silently mapping every row to nulls
// (an all-null feed would make every key miss and manufacture false FAILs).
function normalizeNseFeed(payload) {
  const rows = Array.isArray(payload) ? payload : (payload?.data || []);
  return rows.map((r) => ({
    symbol: r.symbol || r.Symbol || r.symbolName || null,
    companyName: r.companyName || r.company || r.issuerName || r.name || null,
  })).filter((r) => r.symbol || r.companyName);
}

async function checkL() {
  const name = 'our OPEN/UPCOMING set agrees with NSE current-issue + upcoming feeds';
  let cookie, current, upcoming;
  try {
    cookie = await nseCookieJar();
    current = normalizeNseFeed(await nseJson('/api/ipo-current-issue', cookie));
    upcoming = normalizeNseFeed(await nseJson('/api/all-upcoming-issues?category=ipo', cookie));
  } catch (e) {
    record('l_nse_status_crosscheck', name, 'UNVERIFIABLE',
      `NSE oracle unreachable (${e.message}) — the check is BLIND tonight, not green (T-321 class)`);
    return;
  }

  // Both feeds empty is indistinguishable from "no IPO is open today", which is
  // a normal state — but it is ALSO what a silently-broken feed looks like, so
  // do not manufacture FAILs from it. Report blind, page, move on.
  if (current.length === 0 && upcoming.length === 0) {
    record('l_nse_status_crosscheck', name, 'UNVERIFIABLE',
      'both NSE feeds returned zero usable rows — indistinguishable from a broken feed, so not treated as "nothing is open"');
    return;
  }

  const ourRows = await q(
    `SELECT company_name AS "companyName", symbol, status, segment,
            listing_exchanges AS "listingExchanges"
       FROM ipos
      WHERE status IN ('OPEN', 'UPCOMING')`
  );

  const mismatches = crossCheckNseStatuses({ ourRows, nseCurrent: current, nseUpcoming: upcoming });
  for (const m of mismatches) {
    notify('l_nse_status_crosscheck', 'P1', m.key, 'Our IPO status disagrees with NSE', m.message);
  }
  record('l_nse_status_crosscheck',
    `${name} (${current.length} current, ${upcoming.length} upcoming from NSE; ${ourRows.length} live rows of ours)`,
    mismatches.length === 0 ? 'PASS' : 'FAIL',
    mismatches.length
      ? mismatches.slice(0, MAX_OFFENDERS).map((m) => m.message).join(' | ')
      : 'every in-scope MAINBOARD/NSE row agrees with NSE');
}

// ---- (j): assorted P3 gates ----------------------------------------------------
async function checkJ() {
  // sector population
  const [{ populated, total }] = await q(
    `SELECT count(*) FILTER (WHERE sector IS NOT NULL AND sector <> '')::int AS populated, count(*)::int AS total
       FROM ipos WHERE ${REAL_IPO}`
  );
  const sectorViolation = checkSectorPopulatedPct(populated, total);
  if (sectorViolation) notify('j_sector_populated', 'P2', 'aggregate', 'sector population below floor', sectorViolation);
  record('j_sector_populated', 'sector populated for a healthy fraction of real IPOs', sectorViolation ? 'FAIL' : 'PASS',
    sectorViolation || `${populated}/${total}`);

  // segment NOT NULL for offering_type=IPO — enumerated from the DB, not a hand list
  // Empty string counts, not just NULL — the round-7 P3-7 shape (checker finding).
  const nullSegRows = await q(`SELECT id, company_name, segment FROM ipos WHERE offering_type = 'IPO' AND (segment IS NULL OR btrim(segment::text) = '')`);
  const segOffenders = nullSegRows.map((r) => checkSegmentPopulatedForIpo({ offeringType: 'IPO', segment: r.segment, companyName: r.company_name })).filter(Boolean);
  for (const r of nullSegRows) notify('j_segment_not_null', 'P2', r.id, `IPO with a blank segment`, `"${r.company_name}" is offering_type=IPO with a ${r.segment == null ? 'NULL' : 'empty'} segment`);
  record('j_segment_not_null', 'every offering_type=IPO row has a non-blank segment', segOffenders.length === 0 ? 'PASS' : 'FAIL',
    segOffenders.length ? segOffenders.join('; ') : 'all populated');

  // cron script executable bit — enumerated from git-tracked scripts/*.sh that
  // this box's crontab actually invokes (README-documented entrypoints).
  const CRON_ENTRYPOINTS = ['scripts/vps-data-audit-cron.sh', 'scripts/vps-prod-verify-cron.sh'];
  const execEval = evaluateCronExecutable(CRON_ENTRYPOINTS, (paths) =>
    execFileSync('git', ['ls-files', '-s', ...paths], { cwd: REPO_ROOT, encoding: 'utf8' }));
  for (const o of execEval.offenders) notify('j_cron_executable', 'P2', o.path, `cron script not executable in git`, o.violation);
  record('j_cron_executable', 'every cron-invoked script has the executable bit set in git', execEval.status, execEval.detail);

  // dead-source retire-by — enumerated from scraper_logs sources, not a hand list
  if (await tableExists('scraper_logs')) {
    const sources = await q(`SELECT DISTINCT source FROM scraper_logs`);
    let retirementDoc = {};
    const retirementPath = join(REPO_ROOT, 'docs', 'reviews', 'dead-source-retirement.json');
    if (existsSync(retirementPath)) retirementDoc = JSON.parse(readFileSync(retirementPath, 'utf8'));
    const deadOffenders = [];
    for (const { source } of sources) {
      const recent = await q(`SELECT status, records_processed AS "recordsProcessed" FROM scraper_logs WHERE source = $1 ORDER BY created_at DESC LIMIT ${DEAD_SOURCE_MAX_DEGRADED_CYCLES}`, [source]);
      const allDegraded = recent.length >= DEAD_SOURCE_MAX_DEGRADED_CYCLES && recent.every((r) => r.status !== 'SUCCESS' || r.recordsProcessed === 0);
      const v = checkDeadSourceHasRetireBy(source, allDegraded ? DEAD_SOURCE_MAX_DEGRADED_CYCLES : 0, !!retirementDoc[source]);
      if (v) { deadOffenders.push(v); notify('j_dead_source_retire_by', 'P2', source, `Source dead with no retire-by decision`, v); }
    }
    record('j_dead_source_retire_by', 'every dead source (7+ degraded cycles) has a documented retire-by decision', deadOffenders.length === 0 ? 'PASS' : 'FAIL',
      deadOffenders.length ? deadOffenders.join('; ') : 'no undocumented dead sources');
  } else {
    record('j_dead_source_retire_by', 'every dead source has a documented retire-by decision', 'UNVERIFIABLE', 'scraper_logs table not present');
  }
}

// ---- (n): a merged fixes-live-bug PR that is not actually being served -------
// T-425, mechanism for registry class merged-fix-never-deployed-while-bug-live
// (#265; first occurrence T-327 — fix merged 26 Aug, not served until 28 Aug).
// The served SHA is read the SAME WAY the T-324 SHA-drift monitor reads it: a
// GET against {BASE_URL}/api/version (see .github/workflows/deploy-linux.yml
// "Verify /api/version reflects the deployed SHA"), then dated locally via
// `git log` (this checkout has full history — see actions/checkout fetch-depth
// 0 in that same workflow). gh failures and an unreachable/unknown served SHA
// are UNVERIFIABLE, never a silent PASS.
const FIX_LIVE_BUG_REPO = 'abhayla/IPODhan';

function getRepoSlug() {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: 5000 }).trim();
    const m = url.match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
    return m ? m[1] : FIX_LIVE_BUG_REPO;
  } catch { return FIX_LIVE_BUG_REPO; }
}

function fetchMergedFixLiveBugPRs(repo) {
  try {
    const raw = execFileSync('gh', ['pr', 'list', '--repo', repo, '--state', 'merged', '--label', 'fixes-live-bug', '--json', 'number,mergedAt,mergeCommit', '--limit', '100'], { encoding: 'utf8', timeout: 15000 });
    const prs = JSON.parse(raw);
    // mergeSha powers the T-425 m2 ancestry check below; mergeCommit can be
    // null/absent on very old gh CLI versions - the predicate falls back to
    // the time compare when it is.
    return prs.map((pr) => ({ number: pr.number, mergedAt: pr.mergedAt, mergeSha: pr.mergeCommit?.oid ?? null }));
  } catch (e) {
    console.log(`[m_fix_merged_not_served] gh pr list failed: ${e.message}`);
    return null;
  }
}

// T-425 m2: ground truth over the time-compare heuristic when both SHAs are
// actually present in this checkout (actions/checkout fetch-depth 0 in
// deploy-linux.yml gives the runner full history). `git cat-file -e` first,
// so a SHA missing locally falls back to the time compare instead of a
// misleading git error; `merge-base --is-ancestor` exit 0/1 is git's own
// documented ancestry answer.
function isAncestorLocal(mergeSha, servedSha) {
  if (!mergeSha || !servedSha) return null;
  try {
    execFileSync('git', ['cat-file', '-e', mergeSha], { cwd: REPO_ROOT, timeout: 5000 });
    execFileSync('git', ['cat-file', '-e', servedSha], { cwd: REPO_ROOT, timeout: 5000 });
  } catch {
    return null; // not both in the local checkout - fall back to time compare
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', mergeSha, servedSha], { cwd: REPO_ROOT, timeout: 5000 });
    return true; // exit 0: mergeSha IS an ancestor of servedSha -> served
  } catch (e) {
    if (e.status === 1) return false; // exit 1: git's documented "not an ancestor"
    return null; // any other error (e.g. unrelated histories) - fall back
  }
}

async function fetchServedSha(baseUrl) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${baseUrl}/api/version`, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const data = await res.json();
    const sha = data?.data?.sha;
    return sha && sha !== 'unknown' ? sha : null;
  } catch (e) {
    console.log(`[m_fix_merged_not_served] served-SHA fetch failed: ${e.message}`);
    return null;
  }
}

function getCommitTime(sha) {
  if (!sha) return null;
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', sha], { encoding: 'utf8', timeout: 5000, cwd: REPO_ROOT }).trim();
    return out || null;
  } catch (e) {
    console.log(`[m_fix_merged_not_served] could not date commit ${sha} from local git history: ${e.message}`);
    return null;
  }
}

async function checkN() {
  const repo = getRepoSlug();
  const mergedPRs = fetchMergedFixLiveBugPRs(repo);
  const servedSha = await fetchServedSha(BASE_URL);
  const servedCommitTime = getCommitTime(servedSha);

  const result = checkFixMergedNotServed({ mergedPRs, servedSha, servedCommitTime, isAncestor: isAncestorLocal });
  if (result.status === 'FAIL') {
    for (const o of result.offenders) notify('m_fix_merged_not_served', 'P1', o.number, `Merged fixes-live-bug PR #${o.number} not served for ${o.ageHours}h`, result.reason);
  }
  record('m_fix_merged_not_served', 'every merged fixes-live-bug PR is served within 24h', result.status, result.reason);
}

// ---- (o): a deploy-failure STATUS row that was never read back -----------
// T-425 review finding: the STATUS row scripts/deploy-status.mjs writes/clears
// is otherwise write-only - nothing ever reads it back, so a row left open
// (a slot that never redeploys, or a clear that itself failed) sits invisible
// on disk forever. This is that missing read.
function readDeployStatusMapForAudit() {
  if (!existsSync(DEPLOY_STATUS_FILE)) return {}; // no deploy has ever failed - a real PASS, not unreadable
  try {
    return JSON.parse(readFileSync(DEPLOY_STATUS_FILE, 'utf8'));
  } catch (e) {
    console.log(`[m_deploy_failure_open] could not read/parse ${DEPLOY_STATUS_FILE}: ${e.message}`);
    return null; // unreadable/corrupt - UNVERIFIABLE, never a silent PASS
  }
}

function checkO() {
  const statusMap = readDeployStatusMapForAudit();
  const result = checkDeployFailureOpen({ statusMap });
  if (result.status === 'FAIL') {
    for (const o of result.offenders) notify('m_deploy_failure_open', 'P1', o.slot, `Deploy-failure STATUS row for slot ${o.slot} open for ${o.ageHours}h`, result.reason);
  }
  record('m_deploy_failure_open', 'no deploy-failure STATUS row is open for more than 24h', result.status, result.reason);
}

async function sendNotifications(payloads) {
  const key = process.env.NOTIFIER_KEY_IPODHAN;
  const url = (process.env.NOTIFIER_URL || 'http://127.0.0.1:3300') + '/notify';
  if (!key) {
    console.log(`
[NOTIFY-SKIP] NOTIFIER_KEY_IPODHAN not set — ${payloads.length} pending digest(s) not sent (expected off the box)`);
    for (const pl of payloads) console.log(`  would page ${pl.severity} ${pl.dedupeKey}: ${pl.title}`);
    return;
  }
  for (const pl of payloads) {
    const { newCount, ...body } = pl; // newCount is local bookkeeping, not wire
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
    } catch (e) {
      console.log(`[NOTIFY-FAIL] ${pl.dedupeKey}: ${e.message}`);
    }
  }
  console.log(`
[NOTIFY] sent ${payloads.length} digest(s) to the Notifier gateway`);
}

// ---- (p): offer-document vs website provenance share (T-520) ----------------
// The site republished a website's transcription of the filing instead of the
// filing itself: on 2026-09-08 the offer documents supplied 557 of 6,602
// provenance rows (8.4%), and for the printed offer terms it was worse (issue
// size 4 vs 277, price band 2 vs 337, lot size 2 vs 209). T-520 re-ranked the
// matrix so DRHP outranks every website on those fields; this check makes the
// share a TRACKED number that must rise, not a one-off measurement.
const DOC_PRINTED_FIELDS = [
  'issueSize', 'faceValue', 'priceRangeMin', 'priceRangeMax', 'lotSize',
  'min_investment', 'issue_price', 'fresh_issue_size', 'offer_for_sale_size',
  'registrar', 'leadManagers', 'companyName',
];
// Measured baseline on prod 2026-09-08 (8.4% overall). The floor must only ever
// be RAISED; a drop below it means the document path stopped writing.
const DOC_PROVENANCE_MIN_PCT = 5;

async function checkP() {
  const name = `offer-document share of provenance rows on the ${DOC_PRINTED_FIELDS.length} printed offer-term fields is at or above ${DOC_PROVENANCE_MIN_PCT}%`;
  let rows;
  try {
    rows = await q(
      `SELECT field_name AS "fieldName",
              COUNT(*) FILTER (WHERE source = 'DRHP')::int AS "doc",
              COUNT(*) FILTER (WHERE source <> 'DRHP' AND source <> 'ADMIN')::int AS "web"
         FROM field_sources
        WHERE field_name = ANY($1)
        GROUP BY 1 ORDER BY 1`,
      [DOC_PRINTED_FIELDS]
    );
  } catch (e) {
    record('p_document_provenance_share', name, 'UNVERIFIABLE', `field_sources not readable: ${e.message}`);
    return;
  }

  const totals = rows.reduce((a, r) => ({ doc: a.doc + r.doc, web: a.web + r.web }), { doc: 0, web: 0 });
  const denom = totals.doc + totals.web;
  if (denom === 0) {
    record('p_document_provenance_share', name, 'UNVERIFIABLE', 'no provenance rows on any printed offer-term field');
    return;
  }
  const pct = (totals.doc * 100) / denom;
  const perField = rows
    .map((r) => `${r.fieldName} ${r.doc}doc/${r.web}web`)
    .join(', ');
  if (pct < DOC_PROVENANCE_MIN_PCT) {
    notify('p_document_provenance_share', 'P1', 'overall',
      `offer documents supply only ${pct.toFixed(1)}% of provenance on printed offer terms`, perField);
  }
  record('p_document_provenance_share', name, pct >= DOC_PROVENANCE_MIN_PCT ? 'PASS' : 'FAIL',
    `${totals.doc} document-sourced vs ${totals.web} website-sourced rows = ${pct.toFixed(1)}% — ${perField}`);
}

async function main() {
  await assertSessionTimezoneUtc();
  console.log(`
=== DETECTION-FLOOR AUDIT (T-335) — ${new Date().toISOString()} ===`);
  await checkA_B();
  await checkC();
  await checkD();
  await checkE();
  await checkE_unknownSlug404();
  await checkF();
  await checkG1_repeatedWarn();
  await checkG3_inertDetector();
  await checkG();
  await checkH();
  checkI();
  await checkK();
  await checkCycleOverrunAudit();
  await checkL();
  await checkJ();
  await checkM();
  await checkN();
  checkO();
  await checkP();

  const failed = results.filter((r) => r.status === 'FAIL');
  const unverifiable = results.filter((r) => r.status === 'UNVERIFIABLE');
  const summary = computeSummaryCounts(results);
  console.log(`
=== SUMMARY: ${summary.pass} PASS, ${summary.fail} FAIL, ${summary.unverifiable} UNVERIFIABLE, ${summary.skip} SKIP ===`);

  const previousState = readPreviousState();
  const payloads = buildRunPayloads({
    results, findingsByCheck, previousState, date: RUN_DATE, reportPath: REPORT_PATH,
  });

  // Persist tonight's failing row keys so tomorrow's digest can say what is NEW.
  const nextState = {};
  for (const [checkId, rows] of findingsByCheck) nextState[checkId] = rows.map((r) => r.rowKey);

  // NOT gated on failed.length any more: an all-UNVERIFIABLE night (data_conflicts
  // gone, pm2 gone, site down) used to exit 0 with nobody paged — the T-321
  // silent-pass class this whole mechanism exists to prevent (blocker 1).
  if (payloads.length && GATE) await sendNotifications(payloads);
  if (GATE) writeCurrentState(nextState);
  writeFindingsLatest({ results, findingsByCheck, runDate: RUN_DATE });
  await pool.end();

  if (!GATE) { console.log('(report mode; pass --gate to exit non-zero on FAIL or UNVERIFIABLE)'); process.exit(0); }
  const code = computeExitCode({ failCount: failed.length, unverifiableCount: unverifiable.length });
  if (code === EXIT_UNVERIFIABLE) console.log(`(exit ${code}: no FAIL, but ${unverifiable.length} check(s) UNVERIFIABLE — the audit was blind, not green)`);
  process.exit(code);
}

main().catch((e) => { console.error(e); process.exit(2); });
