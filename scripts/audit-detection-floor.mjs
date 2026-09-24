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
import { istDayIso } from './lib/ist-day.mjs';
import { mostRecentFieldPlanSlotBoundary, PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS, isConfigGapAtCapRow, isStalledGapRow, FIELD_PLAN_GAP_STALLED_DAYS } from './lib/field-plan-slot.mjs';
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
  summariseIssueSizeConsistency,
  checkNoUnresolvedConflictOnLiveIpo, HIGH_VALUE_FIELDS, LIVE_STATUSES,
  checkIssueSizeSegmentFloor, checkIssueSizeSharesConsistency,
  checkIssueSizeSourceCapability,
  checkLotBandSebiWindow, checkCorporateActionShape,
  classifyRouteResponse, classifyVerdictLeak, classifyConflictNoiseRatio, checkFreshnessPerType,
  checkPm2EnvHasTz, checkPm2LogSize, findUnreferencedDefinitions,
  checkSectorPopulatedPct, checkCronScriptExecutable, checkDeadSourceHasRetireBy,
  checkSegmentPopulatedForIpo, checkSegmentHasProvenance, DEAD_SOURCE_MAX_DEGRADED_CYCLES,
  findLiveCrossSourceDisagreements, ORACLE_COMPARABLE_FIELDS, normalizeCompanyKey,
  findLotDisagreements, findMinApplicationDisagreements,
  buildRunPayloads, evaluateCronExecutable,
  computeExitCode, EXIT_UNVERIFIABLE, computeSummaryCounts,
  parseStepNames, checkStepSilence, checkStepConsecutiveFailures,
  STEP_LEDGER_WINDOW_HOURS,
  crossCheckNseStatuses,
  findSameIpoTwoRows, checkIpoTitleInName, findCompanyTwoLiveRows, findNameBoundLiveRows, findUndecidedIdentityHolds,
  evaluateSourceKeyConflicts,
  findSettledFieldRewrites, SETTLED_FIELD_COLUMNS, policyWriterOnFromEnv, settledCurrentValueSql,
  findClosedIpoDoneWithoutWalk,
} from './lib/detection-floor-checks.mjs';
import { checkFixMergedNotServed, checkDeployFailureOpen } from './lib/fix-served-checks.mjs';
import { DEPLOY_STATUS_FILE } from './deploy-status.mjs';
import { checkPriceBand } from './lib/substance-checks.mjs';
import {
  checkPlanRankMatchesPolicy, checkWriteSourceInPolicy, checkManifestMatchesGenerator,
  lookupManifestRanks, ipoTypeKey, checkOverrideRow, validateOverrideRankSet,
} from './lib/pull-policy-checks.mjs';
import { collectRowKeyCoverage, ROW_KEYED_CHILD_TABLES } from './lib/row-key-coverage-checks.mjs';
import { extractShape, compareShape, partitionFixtures, loadHtmlFixtureEntries, summarizeCorpusShape, toPosixPath } from './lib/corpus-shape-checks.mjs';
import { findFixtureFiles } from './lib/fixture-provenance-checks.mjs';
import { collectNotApplicableDocuments, NOT_APPLICABLE_CHECK_NAME, EXTRACTABLE_DOC_TYPES_MIRROR } from './lib/not-applicable-documents.mjs';
import { adminQueueSize, formatAdminQueueBlock } from './ops/admin-queue-size.mjs';
import { behaviourConflictPredicate, UNRESOLVED_CONFLICT_COUNT_SQL, UNRESOLVED_CONFLICT_NOISE_SQL, CONFLICTS_INSERTED_24H_SQL } from './lib/conflict-reasons.mjs';

// The three filing-extractor types this specific stuck-detection query cares about
// (never the anchor report or PRICE_BAND_AD — this check is about `scripts/extract_filing.py`
// candidates going stuck, not every AUTO_PERSIST candidate). Derived from the same
// mirror `not-applicable-documents.mjs` keeps, so there is one list in the audit for
// "what does the filing extractor handle" instead of a second hand-copied literal.
const FILING_EXTRACTOR_STUCK_TYPES = EXTRACTABLE_DOC_TYPES_MIRROR.filter(
  (t) => t !== 'ANCHOR_ALLOCATION_REPORT' && t !== 'PRICE_BAND_AD'
);
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

// Item 10: checks that compare against the PREVIOUS run need to persist
// something other than a list of failing row keys, which is all `nextState`
// carries. Without this bag their delta branch reads `undefined` every night,
// never fires, and the check looks permanently healthy — a guard that cannot
// fail. Anything put here is merged into the state file at the end of the run.
const extraState = {};
// Item 8 slice 3a: the day the ratio reader was actually wired into the
// extractor. Documents extracted before it could not carry a ratio however
// healthy the pipeline was, so they are outside this check's population
// (their backfill is slice 3b).
const RATIO_WIRING_MERGED_AT = process.env.RATIO_WIRING_MERGED_AT || '2026-09-16';

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
const RUN_DATE = istDayIso();
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
          AND ${behaviourConflictPredicate('c')}
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
    `SELECT id, company_name, slug, status, segment, issue_size AS "issueSize", price_range_max AS "priceRangeMax",
            (SELECT s.shares_offered FROM subscriptions s WHERE s.ipo_id = i.id AND s.shares_offered IS NOT NULL
              ORDER BY s.timestamp DESC LIMIT 1) AS "sharesOffered",
            -- The RAW listing_performance.issue_price, so the floor message can
            -- test the share-count reading instead of asserting it. LATERAL, not
            -- a plain LEFT JOIN: a second listing_performance row for one IPO
            -- would multiply this query's rows and silently inflate the coverage
            -- denominator item 14 slice 4 added. Today staging has 255 rows over
            -- 255 distinct IPOs (zero duplicates), but that is a fact about
            -- today's data, not a constraint.
            lp.issue_price AS authoritative_issue_price
       FROM ipos i
       LEFT JOIN LATERAL (
         SELECT issue_price FROM listing_performance
          WHERE ipo_id = i.id
          ORDER BY id DESC
          LIMIT 1
       ) lp ON true
      WHERE ${REAL_IPO}`
  );
  const floorOffenders = [];
  const consistencyOffenders = [];
  for (const r of rows) {
    const v1 = checkIssueSizeSegmentFloor(r);
    if (v1) { floorOffenders.push(`"${r.company_name}" — ${v1}`); notify('c_issue_size_floor', 'P1', r.id, `issue_size below segment floor: ${r.company_name}`, v1); }
  }
  // Item 14 slice 4: coverage is part of the verdict. This check examined 24 of
  // 277 production rows (8.7%) while reporting a bare "0 violation(s)", and it
  // skipped the exact rows c_issue_size_floor was failing on.
  const consistency = summariseIssueSizeConsistency(rows);
  for (const { row, message } of consistency.violations) {
    consistencyOffenders.push(`"${row.company_name}" — ${message}`);
    notify('c_issue_size_consistency', 'P1', row.id, `issue_size inconsistent with shares x price: ${row.company_name}`, message);
  }
  record('c_issue_size_floor', 'issue_size >= segment-appropriate floor', floorOffenders.length === 0 ? 'PASS' : 'FAIL',
    `${floorOffenders.length} violation(s)` + (floorOffenders.length ? `: ${floorOffenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
  record('c_issue_size_consistency', 'issue_size (total incl. OFS) is within 0.75x-3.0x of shares_offered (net public offer) x price_range_max', consistency.status,
    consistency.detail + (consistencyOffenders.length ? `: ${consistencyOffenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
}

// ---- (c, source capability): current issueSize provenance vs field-manifest -
// capability (item 14, #728 class). Reads capability directly from
// field-manifest.json — never hard-codes BSE — so a future manifest edit
// (adding/removing a capable source for this field) changes this check's
// population without a code change.
let ISSUE_SIZE_MANIFEST_CAPABILITY;
let ISSUE_SIZE_MANIFEST_READ_ERROR;
function loadIssueSizeManifestCapability() {
  if (ISSUE_SIZE_MANIFEST_CAPABILITY !== undefined || ISSUE_SIZE_MANIFEST_READ_ERROR) return;
  try {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json'), 'utf8'));
    ISSUE_SIZE_MANIFEST_CAPABILITY = manifest?.fields?.['ipos.issue_size']?.capability ?? null;
    if (!ISSUE_SIZE_MANIFEST_CAPABILITY) ISSUE_SIZE_MANIFEST_READ_ERROR = 'field-manifest.json has no fields["ipos.issue_size"].capability entry';
  } catch (e) {
    ISSUE_SIZE_MANIFEST_READ_ERROR = e.message;
  }
}

async function checkC_issueSizeSourceCapability() {
  loadIssueSizeManifestCapability();
  const name = 'ipos.issue_size current provenance source is manifest-capable for ipos.issue_size (field-manifest.json)';
  if (ISSUE_SIZE_MANIFEST_READ_ERROR) {
    record('c_issue_size_noncapable_source', name, 'UNVERIFIABLE', `field-manifest.json not readable: ${ISSUE_SIZE_MANIFEST_READ_ERROR}`);
    return;
  }
  const rows = await q(
    `SELECT i.id, i.company_name, i.slug, i.status, i.segment, i.issue_size AS "issueSize",
            fs.source AS "issueSizeSource"
       FROM ipos i
       LEFT JOIN field_sources fs
         ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.row_key = '' AND fs.field_name = 'issueSize'
      WHERE ${REAL_IPO}`
  );
  const offenders = [];
  for (const r of rows) {
    const row = { source: r.issueSizeSource, issueSize: r.issueSize };
    const v = checkIssueSizeSourceCapability(row, ISSUE_SIZE_MANIFEST_CAPABILITY);
    if (v) {
      const identity = `${r.slug ?? r.id} (status=${r.status}, segment=${r.segment ?? 'NULL'})`;
      offenders.push(`${identity} — ${v}`);
      notify('c_issue_size_noncapable_source', 'P1', r.id, `issue_size sourced from a non-capable source: ${r.company_name}`, `${identity} — ${v}`);
    }
  }
  record('c_issue_size_noncapable_source', name, offenders.length === 0 ? 'PASS' : 'FAIL',
    `${offenders.length} of ${rows.length} IPO row(s) currently source issueSize from a source field-manifest.json ranks non-capable`
      + (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
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

// ---- (d, segment provenance): a non-NULL ipos.segment with no field_sources
// row for that field is a value with no record of who said it — exactly the
// class the binary-test write bug (lane C item 2 slice 3b) produced. The
// repair tool (scripts/repair-segment-provenance.ts) closes the EXISTING
// rows; this check is what stops the gap from silently reopening — measured
// missing on 2026-09-10 (no existing check asserts provenance PRESENCE; the
// checks above measure share and lineage, never absence).
async function checkD_segmentProvenance() {
  const rows = await q(
    `SELECT i.id, i.company_name AS "companyName", i.offering_type AS "offeringType", i.segment,
            EXISTS (
              SELECT 1 FROM field_sources fs
               WHERE fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.field_name = 'segment'
            ) AS "hasSegmentProvenance"
       FROM ipos i
      WHERE i.segment IS NOT NULL`
  );
  const offenders = [];
  for (const r of rows) {
    const v = checkSegmentHasProvenance(r);
    if (v) { offenders.push(v); notify('d_segment_provenance', 'P2', r.id, `ipos.segment set with no field_sources provenance row: ${r.companyName}`, v); }
  }
  record('d_segment_provenance', 'every ipos row with segment IS NOT NULL carries a field_sources row for segment',
    offenders.length === 0 ? 'PASS' : 'FAIL',
    `${offenders.length} row(s) with segment set but no recorded source` +
      (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
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
  // S7 OD-61 half (docs/design/s7-consensus-check-plan.md): reuses this SAME loop's
  // already-fetched response text -- see classifyVerdictLeak's own header comment for why a
  // second sweep is not built. Admin routes are excluded by the EXISTING publicRoutes filter
  // above (adminRoutes = startsWith('/api/admin/')), named here explicitly per the plan rather
  // than relying on that filter silently.
  const verdictLeakOffenders = [];
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
      const verdictCls = classifyVerdictLeak(path, text);
      if (verdictCls.fail) verdictLeakOffenders.push(`${path} — ${verdictCls.reasons.join('; ')}`);
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

  for (const o of verdictLeakOffenders) notify('e_verdict_leak_sweep', 'P1', o.split(' — ')[0], `Public API route leaks a consensus verdict: ${o.split(' — ')[0]}`, o);
  const verdictLeakStatus = verdictLeakOffenders.length > 0 ? 'FAIL' : unreachable > 0 ? 'UNVERIFIABLE' : 'PASS';
  record('e_verdict_leak_sweep',
    `every web/app/api/** public route (${publicRoutes.length} enumerated, ${adminRoutes.length} admin routes excluded by design — OD-61) carries no "verdict" or "witnesses" JSON key`,
    verdictLeakStatus,
    `${verdictLeakOffenders.length} leaking, ${unreachable} unreachable (of ${publicRoutes.length})` + (verdictLeakOffenders.length ? `: ${verdictLeakOffenders.slice(0, MAX_OFFENDERS).join(' | ')}` : ''));
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
  // OD-75 round 2 (PR #914): admin-only SOURCE_CHANGED_OWN_VALUE rows never count toward the backlog.
  const [{ total }] = await q(UNRESOLVED_CONFLICT_COUNT_SQL);
  const [{ noise }] = await q(UNRESOLVED_CONFLICT_NOISE_SQL);
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
  // OD-75 round 2: an admin-only self-change row is not evidence the detector is alive.
  const [{ inserted }] = await q(CONFLICTS_INSERTED_24H_SQL);
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

  // #861: `m_document_state` is declared in section "checks", so the coverage
  // floor counts it as live — but its ONLY record() call was the
  // table-missing branch above. On a healthy night, when the table exists,
  // this function records under m_blocked_all_age / m_found_not_extracted /
  // m_extraction_stuck and `m_document_state` emitted nothing at all.
  //
  // The wire-or-retire self-test could not see it: that test asks "does a
  // record() call exist for this id?", which is true. `check_roster` (item 10)
  // asks "did it report tonight?", which is the different question, and it
  // caught this on its first run.
  //
  // So the id now reports on BOTH paths. It is the population line for the
  // per-row checks below: how many rows this function examined at all.
  record('m_document_state', 'document_fetch_state rows examined this run',
    rows.length > 0 ? 'PASS' : 'UNVERIFIABLE',
    rows.length > 0
      ? `${rows.length} document_fetch_state row(s) examined for IPO-type offerings`
      : 'document_fetch_state has no rows for IPO-type offerings — the per-row checks below have nothing to examine, which is not the same as them passing');

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

  // #796: every check above reads FROM document_fetch_state, so it can only
  // grade a row that EXISTS — it measures the AGE or STATE of a record and is
  // structurally incapable of reporting its ABSENCE. The stage-gate deadlock
  // (#795, failure class `stage gate requires the value the gated work would
  // supply`) produces exactly that shape: an UPCOMING issue with no price band
  // never reaches PRE_OPEN, so PRICE_BAND_AD is never due, so no row is ever
  // created, so nothing above says a word — while the IPO walks to its open
  // date with a blank price band on the page.
  //
  // This check is therefore anchored on the ENTITY (`ipos`) with a NOT EXISTS,
  // not on the tracking table. Measured on staging 2026-09-19: of 20 live IPOs
  // opening within 7 days it flagged exactly 2 (Anand Seamless 09-22, Liqvd
  // Digital 09-23) and passed the other 18, so a PASS carries information.
  // P1, not P2: the window closes. An IPO opening on the 22nd cannot be fixed
  // on the 23rd.
  const missingBandTracking = await q(`
    SELECT i.company_name, i.open_date
      FROM ipos i
     WHERE i.offering_type = 'IPO'
       AND i.status IN ('UPCOMING', 'OPEN')
       AND i.open_date IS NOT NULL
       AND i.open_date <= (CURRENT_DATE + INTERVAL '7 days')
       AND NOT EXISTS (
         SELECT 1 FROM document_fetch_state s
          WHERE s.ipo_id = i.id AND s.doc_type = 'PRICE_BAND_AD'
       )
     ORDER BY i.open_date
  `);
  const untracked = missingBandTracking.map(
    (r) => `${r.company_name} (opens ${String(r.open_date).slice(0, 10)}): no PRICE_BAND_AD fetch-state row`
  );
  for (const v of untracked) {
    notify('m_upcoming_missing_price_band_tracking', 'P1', v, 'Live IPO has no PRICE_BAND_AD tracking row', v);
  }
  record('m_upcoming_missing_price_band_tracking',
    'every IPO opening within 7 days has a PRICE_BAND_AD fetch-state row',
    untracked.length === 0 ? 'PASS' : 'FAIL', untracked.slice(0, MAX_OFFENDERS).join('; '));

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
       AND d.type = ANY($1)
  `, [FILING_EXTRACTOR_STUCK_TYPES]);
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

  // Item 8 slice 3a (#610): does a completed prospectus-family extraction
  // actually YIELD the issuer's ratios, or does it come back empty in silence?
  //
  // `financial_ratios.py` shipped in #638 with zero importers - correct,
  // tested, and never called - so every extraction produced null ratios and
  // nothing anywhere said so. That is the class this check watches: not "the
  // ratio is wrong" but "the reader stopped running and no one noticed".
  //
  // PASS needs one of two things per document, never a bare count: a
  // current_ratio on the row, or a recorded reason for its absence in the E9
  // evidence (the extractor emits `ratio_note_not_in_document` /
  // `ratio_row_not_in_note` / `balance_sheet_inputs_absent:...`). An absence
  // with neither is the failure.
  //
  // Scoped to documents extracted AFTER the fix, because the backfill of
  // already-completed documents is slice 3b: judging pre-fix rows against a
  // post-fix behaviour would report a permanent FAIL that no night can clear.
  const ratioRows = await q(`
    SELECT i.company_name, d.id::text AS document_id, d.type::text AS doc_type,
           fd.current_ratio IS NOT NULL AS has_ratio,
           coalesce(s.evidence::text, '') AS step_evidence
      FROM documents d
      JOIN ipos i ON i.id = d.ipo_id
      LEFT JOIN financial_data fd ON fd.ipo_id = d.ipo_id
      LEFT JOIN ipo_pipeline_steps s ON s.ipo_id = d.ipo_id AND s.step_id = 'E9'
     WHERE i.${REAL_IPO}
       AND d.type::text IN ('RHP', 'DRHP', 'PROSPECTUS')
       AND d.extraction_status = 'COMPLETED'
       AND d.extracted_at IS NOT NULL
       AND d.extracted_at >= timestamp '${RATIO_WIRING_MERGED_AT}'
  `);
  const ratioSilent = ratioRows
    .filter((r) => !r.has_ratio && !/ratio_note_not_in_document|ratio_row_not_in_note|balance_sheet_inputs_absent/.test(r.step_evidence))
    .map((r) => `${r.company_name} (${r.doc_type} ${r.document_id.slice(0, 8)}): no current_ratio and no recorded reason`);
  for (const v of ratioSilent)
    notify('issuer_ratio_yield', 'P2', v, 'A completed filing extraction yielded no issuer ratio and named no cause', v);
  record('issuer_ratio_yield',
    `every COMPLETED RHP/DRHP/PROSPECTUS extracted since ${RATIO_WIRING_MERGED_AT} carries a current_ratio or a recorded reason for its absence (${ratioRows.length} document(s) in the population)`,
    ratioRows.length === 0
      ? 'UNVERIFIABLE'
      : (ratioSilent.length === 0 ? 'PASS' : 'FAIL'),
    ratioRows.length === 0
      ? `no prospectus-family document has completed extraction since ${RATIO_WIRING_MERGED_AT}`
      : ratioSilent.slice(0, MAX_OFFENDERS).join('; '));

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

// ---- #717 / OD-76: the closed-IPO job recorded DONE without a walk ----------
// §6.1 (OD-76): an IPO whose plan could not be generated, or whose walk asked
// nothing, is never DONE unless every plan row is settled (OD-73); OD-79 widens it to a walked
// IPO too: DONE with ANY unsettled plan row is flagged. "Walked" = at
// least one ipo_field_plan row with last_attempt_at set. The table arrives with migration 0050; a slot without
// it is UNVERIFIABLE. Reported by IPO name.
async function checkClosedIpoDoneWithoutWalk() {
  const name = 'no closed-IPO ledger row is DONE while its IPO has no plan or an unsettled plan row (OD-76, OD-79, #717)';
  const [{ present }] = await q(`SELECT to_regclass('public.closed_ipo_resourcing') IS NOT NULL AS present`);
  if (!present) {
    record('closed_ipo_done_without_walk', name, 'UNVERIFIABLE', 'closed_ipo_resourcing does not exist on this slot (migration 0050 not applied)');
    return;
  }
  const rows = await q(
    `SELECT r.ipo_id AS "ipoId", i.company_name AS "companyName", r.outcome::text AS outcome,
            (SELECT count(*)::int FROM ipo_field_plan p WHERE p.ipo_id = r.ipo_id) AS "planRows",
            (SELECT count(*)::int FROM ipo_field_plan p
              WHERE p.ipo_id = r.ipo_id AND p.last_attempt_at IS NOT NULL) AS "walkedRows",
            (SELECT count(*)::int FROM ipo_field_plan p
              WHERE p.ipo_id = r.ipo_id AND p.state::text NOT IN ('SUPPLIED', 'NOT_PRINTED', 'EXHAUSTED')) AS "unsettledRows"
       FROM closed_ipo_resourcing r JOIN ipos i ON i.id = r.ipo_id
      WHERE r.outcome = 'DONE'`
  );
  const bad = findClosedIpoDoneWithoutWalk(rows);
  for (const r of bad) {
    notify('closed_ipo_done_without_walk', 'P2', r.ipoId, 'closed-IPO job recorded DONE without walking the IPO',
      `${r.companyName}: DONE with ${r.planRows} plan row(s), ${r.unsettledRows} unsettled, ${r.walkedRows} ever asked`);
  }
  record('closed_ipo_done_without_walk', name, bad.length === 0 ? 'PASS' : 'FAIL',
    bad.length
      ? bad.slice(0, MAX_OFFENDERS).map((r) => `${r.companyName} (plan=${r.planRows} unsettled=${r.unsettledRows} walked=${r.walkedRows})`).join('; ')
      : `0 of ${rows.length} DONE row(s)`);
}

// ---- (i): identity — one IPO stored twice, or two offerings folded into ------
// one company. Step 1 of #903 (S1/S2/S3/S4/S7); implements
// docs/design/data-sourcing-pull-model.md §2.3.3.1's standing sweep (F-103)
// and §2.3.3.2's OD-34 name-bound reporting. Detection only — no
// matching/write-path change.
// ---- (s): OD-73 settled fields (#908) -------------------------------------------------
// docs/design/data-sourcing-pull-model.md §3.2 (OD-73, OD-65, OD-75): a settled `ipos` field is
// never re-stamped by an identical value and never rewritten by a source the WRITER would not let
// win. The rank is the writer's own (scraper/config/writer-source-ranking.json, generated from
// getSourcePriority/allowsSameSourceRefresh, under this slot's ENABLE_POLICY_WRITER) — never a
// second hand-kept order. Names every offending IPO and field.
const SETTLED_WINDOW_HOURS = 24;
async function checkSettledFieldRewrites() {
  const snapshot = JSON.parse(
    readFileSync(new URL('../scraper/config/writer-source-ranking.json', import.meta.url), 'utf8')
  );
  const policyWriterOn = policyWriterOnFromEnv(process.env);
  const rows = await q(
    `SELECT i.slug, i.segment::text AS segment, i.listing_exchanges AS "listingExchanges",
            fs.field_name AS "fieldName", fs.source::text AS source,
            fs.previous_source::text AS "previousSource", fs.previous_value AS "previousValue",
            fs.updated_at::text AS "updatedAt",
            ${settledCurrentValueSql()} AS "currentValue"
       FROM field_sources fs JOIN ipos i ON i.id = fs.ipo_id
      WHERE fs.table_name = 'ipos' AND fs.row_key = ''
        AND fs.field_name = ANY($1)
        AND fs.updated_at > (now() AT TIME ZONE 'UTC') - make_interval(hours => $2)`,
    [snapshot.fields, SETTLED_WINDOW_HOURS]
  );
  const findings = findSettledFieldRewrites(rows, snapshot, policyWriterOn);
  const byIpo = new Map();
  for (const f of findings) {
    if (!byIpo.has(f.slug)) byIpo.set(f.slug, []);
    byIpo.get(f.slug).push(f);
  }
  for (const [slug, fs] of byIpo) {
    notify('s_settled_field_rewritten', 'P2', slug, 'settled field re-stamped or rewritten (OD-73)',
      fs.map((f) => `${f.fieldName} ${f.kind} ${f.previousSource}->${f.source} (${f.previousValue} -> ${f.currentValue})`).join('; '));
  }
  const flagNote = `writer ranking with ENABLE_POLICY_WRITER=${policyWriterOn ? 'on' : 'off'}`;
  record('s_settled_field_rewritten',
    `no settled ipos field (${snapshot.fields.join('/')}) re-stamped with an identical value or rewritten by a source the writer ranks equal/lower in ${SETTLED_WINDOW_HOURS}h (§3.2 OD-73/OD-75)`,
    findings.length === 0 ? 'PASS' : 'FAIL',
    (findings.length
      ? `${byIpo.size} IPO(s): ` + [...byIpo.entries()].slice(0, MAX_OFFENDERS)
        .map(([slug, fs]) => `${slug} [${fs.map((f) => `${f.fieldName}:${f.kind}`).join(',')}]`).join('; ')
      : `0 of ${rows.length} settled-field provenance write(s) in ${SETTLED_WINDOW_HOURS}h break OD-73`) + ` (${flagNote})`);
}

async function checkIdentity() {
  const identityRows = await q(
    `SELECT id, slug, company_name AS "companyName", cin, isin, symbol,
            bse_scrip_code AS "bseScripCode", offering_type AS "offeringType",
            status, open_date::text AS "openDate"
       FROM ipos`
  );

  // i_same_ipo_two_rows (F-103 standing sweep + S1/S2/S7)
  const dupGroups = findSameIpoTwoRows(identityRows);
  for (const g of dupGroups) {
    const names = g.rows.map((r) => `${r.slug} ("${r.companyName}")`).join(' + ');
    notify('i_same_ipo_two_rows', 'P1', g.key, `IPO rows share ${g.keyType}`, `grouped by ${g.keyType}: ${names}`);
  }
  record('i_same_ipo_two_rows',
    'no IPO row shares an identifier (CIN/ISIN/symbol/BSE code), suffix-stripped slug, or name+open-date with another (§2.3.3.1 standing sweep)',
    dupGroups.length === 0 ? 'PASS' : 'FAIL',
    dupGroups.length
      ? dupGroups.slice(0, MAX_OFFENDERS).map((g) => `[${g.keyType}] ${g.rows.map((r) => r.slug).join('+')}`).join('; ')
      : `0 groups across ${identityRows.length} IPO row(s)`);

  // i_ipo_title_in_name (S3)
  const titleOffenders = identityRows.filter((r) => r.offeringType === 'IPO').map((r) => checkIpoTitleInName(r)).filter(Boolean);
  for (const r of identityRows) {
    const v = checkIpoTitleInName(r);
    if (v) notify('i_ipo_title_in_name', 'P2', r.id, 'Page title/status text stored in company_name or slug', v);
  }
  record('i_ipo_title_in_name', 'no IPO row carries page-title or page-status text in company_name/slug',
    titleOffenders.length === 0 ? 'PASS' : 'FAIL',
    titleOffenders.length ? titleOffenders.slice(0, MAX_OFFENDERS).join('; ') : `0 offenders across ${identityRows.length} IPO row(s)`);

  // i_company_two_live_rows (S4) — any offering_type, UPCOMING/OPEN/CLOSED
  const liveGroups = findCompanyTwoLiveRows(identityRows);
  for (const g of liveGroups) {
    const names = g.rows.map((r) => `${r.slug} [${r.offeringType}/${r.status}]`).join(' + ');
    notify('i_company_two_live_rows', 'P2', g.key, 'Same company has two live rows', names);
  }
  record('i_company_two_live_rows', 'no normalised company holds two or more live (UPCOMING/OPEN/CLOSED) rows — listed for review, never auto-merged',
    liveGroups.length === 0 ? 'PASS' : 'FAIL',
    liveGroups.length
      ? liveGroups.slice(0, MAX_OFFENDERS).map((g) => g.rows.map((r) => r.slug).join('+')).join('; ')
      : `0 groups across ${identityRows.length} row(s)`);

  // i_name_bound_live (OD-34): live IPO rows bound on nothing stronger than
  // the name — reported by name, per OD-34's own text, never as a count.
  const nameBound = findNameBoundLiveRows(identityRows);
  for (const r of nameBound) {
    notify('i_name_bound_live', 'P3', r.id, 'Live IPO row is name-bound (no CIN/symbol/ISIN)', `${r.slug} ("${r.companyName}") [${r.status}]`);
  }
  record('i_name_bound_live', 'every live (UPCOMING/OPEN) IPO row with no CIN/symbol/ISIN is reported by name (OD-34 name-bound flag)',
    nameBound.length === 0 ? 'PASS' : 'FAIL',
    nameBound.length ? nameBound.map((r) => r.slug).join(', ') : `0 name-bound live rows`);

  // i_identity_held (OD-68, PR #910 MAJOR-2): a record held for review is not
  // written anywhere else a human reads, so this is its consumer.
  const heldRows = await q(
    `SELECT action_type AS "actionType", new_value AS slug,
            details->'incoming'->>'companyName' AS "companyName",
            old_value AS candidates, "timestamp"::text AS at
       FROM audit_logs
      WHERE action_type IN ('IDENTITY_HELD_FOR_REVIEW', 'IDENTITY_HOLD_OVERRIDDEN')
        AND "timestamp" > now() - interval '30 days'`
  );
  const toIso = (r) => ({ ...r, at: `${String(r.at).replace(' ', 'T').slice(0, 19)}Z` });
  const undecided = findUndecidedIdentityHolds(
    heldRows.filter((r) => r.actionType === 'IDENTITY_HELD_FOR_REVIEW').map(toIso),
    heldRows.filter((r) => r.actionType === 'IDENTITY_HOLD_OVERRIDDEN').map(toIso),
  );
  for (const h of undecided) {
    notify('i_identity_held', 'P2', h.slug, 'Incoming IPO record held for review (OD-68)', `"${h.companyName}" [${h.slug}] vs ${h.candidates} - a same-name live row has a differing known open date or price band; decide: fix the row, or create via /admin (override)`);
  }
  record('i_identity_held', 'no incoming IPO record has been held for review (OD-68) in the last 2 days without a human decision',
    undecided.length === 0 ? 'PASS' : 'FAIL',
    undecided.length
      ? undecided.slice(0, MAX_OFFENDERS).map((h) => `"${h.companyName}" [${h.slug}] vs ${h.candidates}`).join('; ')
      : `0 undecided holds (${heldRows.length} hold/override row(s) in 30 days)`);
}

// Mirrors assert-migrations-applied.sh's exact decision (which is drizzle-kit migrate()'s own
// decision, node_modules/drizzle-kit/api.js): a migration counts as applied when
// MAX(created_at) in drizzle.__drizzle_migrations is >= that migration's journaled `when`. Reads
// meta/_journal.json for the 0053 entry's `when` rather than hand-copying the literal, so a
// re-numbered journal can't silently desync this from the migration it actually names.
// Returns true/false, or null when the journal entry or the DB read failed (state unknown —
// the caller must NOT treat null as "not applied", only as "cannot tell").
async function isMigration0053Applied() {
  let when0053;
  try {
    const journalPath = join(REPO_ROOT, 'web/drizzle/migrations/meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    const entry = journal.entries.find((e) => e.tag === '0053_ipo_source_keys');
    if (!entry) return null;
    when0053 = entry.when;
  } catch {
    return null;
  }
  try {
    const [{ maxCreatedAt }] = await q(
      `SELECT COALESCE(MAX(created_at), 0)::bigint AS "maxCreatedAt" FROM drizzle.__drizzle_migrations`
    );
    return Number(maxCreatedAt) >= Number(when0053);
  } catch {
    return null;
  }
}

// i_source_key_conflict (OD-85, docs/design/data-sourcing-pull-model.md §2.3.3.2 "Source record keys"):
// one IPO holding two ACTIVE keys of the same source and type (a supersede that never happened, or a
// merge that brought two relaunch numbers together), and keys DISPUTED by the CIN/ISIN re-check in the
// last 30 days — each is a wrong or unresolved bind a human has to read. Keys hitting two rows cannot
// exist in the table (plain unique index); a record whose keys hit two rows is refused at read time.
async function checkSourceKeyConflicts() {
  const DESC = 'no IPO holds two ACTIVE source keys of one source/type, and no key was DISPUTED in the last 30 days (OD-85)';
  let keys = [];
  let tableMissing = false;
  let readError = null;
  try {
    keys = await q(
      `SELECT i.slug, k.ipo_id AS "ipoId", k.source, k.key_type::text AS "keyType", k.key_value AS "value",
              k.state::text AS state, k.state_reason AS reason, k.state_changed_at AS "changedAt"
         FROM ipo_source_keys k JOIN ipos i ON i.id = k.ipo_id
        WHERE k.state = 'ACTIVE' OR (k.state = 'DISPUTED' AND k.state_changed_at > now() - interval '30 days')`
    );
  } catch (e) {
    if (e.code === '42P01') tableMissing = true;
    else readError = e.message;
  }
  const migration0053Applied = tableMissing ? await isMigration0053Applied() : null;
  const res = evaluateSourceKeyConflicts({ keys, tableMissing, readError, migration0053Applied });
  for (const r of res.doubleActive) notify('i_source_key_conflict', 'P2', r.slug, 'Two ACTIVE source keys of one source (OD-85)', `${r.slug}: ${r.source} ${r.keyType} ${r.values}`);
  for (const r of res.disputed) notify('i_source_key_conflict', 'P2', r.slug, 'Source key DISPUTED by the CIN/ISIN re-check (OD-85)', `${r.slug}: ${r.source} ${r.keyType} ${r.value} - ${r.reason}`);
  const detail = res.status === 'FAIL' ? res.detail.split('; ').slice(0, MAX_OFFENDERS).join('; ') : res.detail;
  record('i_source_key_conflict', DESC, res.status, detail);
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
// filing itself. T-520 round 1 measured the ALL-TIME share (557 of 6,602 rows,
// 8.4%) and gated on it — round-2 review (MAJOR 3) showed that number cannot
// fall: if the document path died tomorrow the numerator would simply freeze
// and the ratio would need the website denominator to roughly double, months
// away. This check therefore counts only rows WRITTEN IN THE LAST 14 DAYS, so a
// stall in the document path shows up within a day or two.
const DOC_PRINTED_FIELDS = [
  'issueSize', 'faceValue', 'priceRangeMin', 'priceRangeMax', 'lotSize',
  'min_investment', 'issue_price', 'fresh_issue_size', 'offer_for_sale_size',
  'registrar', 'leadManagers', 'companyName',
];
const DOC_PROVENANCE_WINDOW_DAYS = 14;
// Healthy today (staging, 2026-09-08, 14-day window): 10.2% of the writes (39 doc / 342 web)
// on these fields are document-sourced. The floor is deliberately below that so
// normal variation does not page, and only ever gets RAISED.
const DOC_PROVENANCE_MIN_PCT = 5;
// Below this many rows in the window the ratio is noise, not a signal.
const DOC_PROVENANCE_MIN_ROWS = 20;

async function checkP() {
  const name = `offer documents supply at least ${DOC_PROVENANCE_MIN_PCT}% of the provenance rows WRITTEN IN THE LAST ${DOC_PROVENANCE_WINDOW_DAYS} DAYS on the ${DOC_PRINTED_FIELDS.length} printed offer-term fields (healthy today: 10.2% measured on staging)`;
  let rows;
  try {
    rows = await q(
      `SELECT field_name AS "fieldName",
              COUNT(*) FILTER (WHERE source = 'DRHP')::int AS "doc",
              COUNT(*) FILTER (WHERE source <> 'DRHP' AND source <> 'ADMIN')::int AS "web"
         FROM field_sources
        WHERE field_name = ANY($1)
          AND updated_at >= NOW() - ($2 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      [DOC_PRINTED_FIELDS, String(DOC_PROVENANCE_WINDOW_DAYS)]
    );
  } catch (e) {
    record('p_document_provenance_share', name, 'UNVERIFIABLE', `field_sources not readable: ${e.message}`);
    return;
  }

  const totals = rows.reduce((a, r) => ({ doc: a.doc + r.doc, web: a.web + r.web }), { doc: 0, web: 0 });
  const denom = totals.doc + totals.web;
  if (denom < DOC_PROVENANCE_MIN_ROWS) {
    record('p_document_provenance_share', name, 'UNVERIFIABLE',
      `only ${denom} provenance row(s) written on the printed offer terms in the last ${DOC_PROVENANCE_WINDOW_DAYS} days — too few to judge the share (needs ${DOC_PROVENANCE_MIN_ROWS})`);
    return;
  }
  const pct = (totals.doc * 100) / denom;
  const perField = rows.map((r) => `${r.fieldName} ${r.doc}doc/${r.web}web`).join(', ');
  if (pct < DOC_PROVENANCE_MIN_PCT) {
    notify('p_document_provenance_share', 'P1', 'overall',
      `offer documents supplied only ${pct.toFixed(1)}% of the last ${DOC_PROVENANCE_WINDOW_DAYS} days of provenance on printed offer terms`, perField);
  }
  record('p_document_provenance_share', name, pct >= DOC_PROVENANCE_MIN_PCT ? 'PASS' : 'FAIL',
    `${totals.doc} document-sourced vs ${totals.web} website-sourced rows in the last ${DOC_PROVENANCE_WINDOW_DAYS} days = ${pct.toFixed(1)}% — ${perField}`);
}

// ---- (q): per-row provenance on the multi-row child tables (item 1 slice s8)
// field_sources.row_key defaults to '' — a writer that forgets to pass it
// writes FY2023's and FY2024's provenance to the SAME key, silently naming the
// wrong row. Only an independent read can see that. The all-'' state (today's
// state: no caller keys rows yet) reports UNVERIFIABLE, never PASS — see the
// header of scripts/lib/row-key-coverage-checks.mjs for the argument.
const ROW_KEY_COVERAGE_NAME =
  `every (ipo, child table) pair with MORE THAN ONE row in ${ROW_KEYED_CHILD_TABLES.join('/')} has a field_sources row for each of its row_keys`;

async function checkQ_rowKeyCoverage() {
  let result;
  try {
    result = await collectRowKeyCoverage(q);
  } catch (e) {
    record('q_field_sources_row_key_coverage', ROW_KEY_COVERAGE_NAME, 'UNVERIFIABLE',
      `child tables or field_sources not readable: ${e.message}`);
    return;
  }
  for (const offender of result.offenders) {
    notify('q_field_sources_row_key_coverage', 'P1', offender.slice(0, 120),
      'child rows with no per-row provenance', offender);
  }
  record('q_field_sources_row_key_coverage', ROW_KEY_COVERAGE_NAME, result.status,
    result.detail + (result.offenders.length ? `: ${result.offenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
}

// #654 — a provenance row that names a field whose parent value is NULL is a
// FALSE CLAIM: it says a source supplied a value that does not exist, and an
// audit reading field_sources reports the field as sourced and healthy. Two
// IPOs OPEN/UPCOMING on 2026-09-15 got no NSE documents because their symbol
// was missing while the ledger said CHITTORGARH supplied it.
//
// The query is GENERIC OVER COLUMNS on purpose: the first measurement of this
// class counted `symbol` alone and reported 61 rows against a real 650. It
// reads the column list from information_schema and checks every field_name
// present in field_sources, so a field a future scraper starts writing is
// covered without anyone remembering to add it here.
//
// NULL only, never falsiness: 0, false and '' are values a source genuinely
// supplied, and a row naming one of them is TRUE.
const PROVENANCE_PARENT_NAME =
  'no field_sources row names a field whose value on the parent row is NULL (a source cannot have supplied a value that does not exist)';

async function checkR_provenanceParentNotNull() {
  let result;
  try {
    const mod = await import('./lib/repair-invariants/provenance-parent-not-null.mjs');
    result = await mod.default(pool);
  } catch (e) {
    record('r_provenance_parent_not_null', PROVENANCE_PARENT_NAME, 'UNVERIFIABLE',
      `field_sources or its parent tables not readable: ${e.message}`);
    return;
  }
  const offenders = result.details
    .filter((d) => !d.unmapped && d.rows > 0)
    .map((d) => `${d.table}.${d.column}=${d.rows}`);
  for (const offender of offenders) {
    notify('r_provenance_parent_not_null', 'P1', offender.slice(0, 120),
      'provenance claims a value the parent row does not have', offender);
  }
  record('r_provenance_parent_not_null', PROVENANCE_PARENT_NAME,
    result.count === 0 ? 'PASS' : 'FAIL',
    result.count === 0
      ? 'no provenance row names a null parent field'
      : `${result.count} row(s): ${offenders.slice(0, MAX_OFFENDERS).join('; ')}`);
}

// ---- (S) item 3 slice S6: PULL-POLICY / PULL-WRITE-POLICY / PULL-PLAN-RANK --
//
// Three checks that compare what the pull-model system actually did against
// what the field-manifest policy says it should have done (docs/design/
// build-cards/item-03-s6-churn-stop-and-detection.md). Each reuses the SAME
// pure predicate the unit test exercises (scripts/lib/pull-policy-checks.mjs)
// — never a re-implementation here.

function checkS_pullPolicy() {
  let out = '';
  let exitCode = 0;
  try {
    out = execFileSync('node', [join(REPO_ROOT, 'scripts', 'generate-field-manifest.mjs'), '--check'], {
      encoding: 'utf8', cwd: REPO_ROOT,
    });
  } catch (e) {
    exitCode = typeof e.status === 'number' ? e.status : 1;
    out = (e.stdout || '') + (e.stderr || '');
  }
  const violation = checkManifestMatchesGenerator(() => ({ exitCode, output: out }));
  record('pull_policy', 'committed field-manifest.json equals what generate-field-manifest.mjs produces',
    violation ? 'FAIL' : 'PASS', violation || 'manifest matches the generator exactly');
}

async function checkS_pullWritePolicy() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json'), 'utf8'));
  } catch (e) {
    record('pull_write_policy', "last night's field_sources rows agree with the manifest policy", 'UNVERIFIABLE',
      `field-manifest.json not readable: ${e.message}`);
    return;
  }
  let rows;
  try {
    rows = await q(
      `SELECT fs.table_name AS "tableName", fs.row_key AS "rowKey", fs.field_name AS "fieldName",
              fs.source, i.segment, i.listing_exchanges AS "listingExchanges"
         FROM field_sources fs
         JOIN ipos i ON i.id = fs.ipo_id
        WHERE fs.updated_at >= now() - interval '24 hours'`
    );
  } catch (e) {
    record('pull_write_policy', "last night's field_sources rows agree with the manifest policy", 'UNVERIFIABLE',
      `field_sources not readable: ${e.message}`);
    return;
  }
  const offenders = [];
  for (const row of rows) {
    const type = ipoTypeKey(row.segment, row.listingExchanges);
    const ranks = lookupManifestRanks(manifest, row.tableName, row.fieldName, type);
    if (ranks === null) continue; // field not in the manifest at all — not this check's population
    const v = checkWriteSourceInPolicy(row, ranks);
    if (v) { offenders.push(v); notify('pull_write_policy', 'P2', `${row.tableName}.${row.fieldName}`, 'field_sources write disagrees with policy', v); }
  }
  record('pull_write_policy', `${rows.length} sampled field_sources row(s) from the last 24h agree with the manifest policy`,
    offenders.length === 0 ? 'PASS' : 'FAIL',
    `0 of ${rows.length} sampled field_sources rows disagree with policy` + (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
}

async function checkS_pullPlanRank() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json'), 'utf8'));
  } catch (e) {
    record('pull_plan_rank', 'plan rows agree with the manifest policy for their version', 'UNVERIFIABLE',
      `field-manifest.json not readable: ${e.message}`);
    return;
  }
  let rows;
  try {
    rows = await q(
      `SELECT p.table_name AS "tableName", p.row_key AS "rowKey", p.field_name AS "fieldName",
              p.rank1_source AS "rank1Source", p.rank2_source AS "rank2Source", p.rank3_source AS "rank3Source",
              p.manifest_version AS "manifestVersion", i.segment, i.listing_exchanges AS "listingExchanges"
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
        WHERE p.state <> 'SUPPLIED' AND p.manifest_version = $1`,
      [manifest.version]
    );
  } catch (e) {
    record('pull_plan_rank', 'plan rows agree with the manifest policy for their version', 'UNVERIFIABLE',
      `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  const offenders = [];
  for (const row of rows) {
    const type = ipoTypeKey(row.segment, row.listingExchanges);
    const ranks = lookupManifestRanks(manifest, row.tableName, row.fieldName, type);
    if (ranks === null) continue;
    const v = checkPlanRankMatchesPolicy(row, ranks);
    if (v) { offenders.push(v); notify('pull_plan_rank', 'P2', `${row.tableName}.${row.fieldName}`, 'plan row disagrees with policy', v); }
  }
  record('pull_plan_rank', `${rows.length} sampled non-terminal plan row(s) at manifestVersion=${manifest.version} agree with policy`,
    offenders.length === 0 ? 'PASS' : 'FAIL',
    `0 of ${rows.length} plan rows disagree with policy for their version` + (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
}

// #762 (S8): the RCA class this check closes is "the claim query stops
// reclaiming a whole non-terminal state and nothing notices" — exactly what
// happened when claimNextDueField shipped as state='PENDING' only: 12,480
// NOT_AVAILABLE_YET/CHECK_FAILED rows sat unclaimed on staging with zero
// PENDING rows anywhere, and no existing check (pull_write_policy,
// pull_plan_rank — both scoped to RANK correctness, never to whether a row
// is still being asked at all) would have caught it.
//
// review round 1 CRITICAL-1: the first cut used a flat `interval '7 hours'`
// ("~2 discovery slots") as the staleness threshold. Measured real slot
// gaps: [150, 180, 210, 900] minutes -- the 17:30 IST -> 08:30 IST overnight
// gap is 900 minutes (15h) on its own, so TWO consecutive slots can span
// 18.5h. A flat 7h threshold made every legitimately-waiting row look
// "stuck" from ~00:30 to ~08:30 IST every single night -- exactly when the
// nightly floor runs -- which is worse than useless: it cannot tell stuck
// from overnight, the one thing this check exists to do. Fixed by asking
// the SLOT question directly (the same predicate the claim query itself
// uses, via the SAME shared helper — see field-plan-slot.mjs's own header
// for why it is a second deliberate duplicate, not a copy of a copy): a row
// is "stuck" when it was ALREADY due at the slot boundary before last (two
// slot boundaries back) and is still sitting unclaimed now. One slot of lag
// is normal cadence (a cycle can run mid-slot); two slot boundaries passing
// with the row still unclaimed means the claim path did not pick it up.
//
// review round 1 F7: the first cut also filtered `last_attempt_at IS NOT
// NULL`, but the claim query (packages/shared's claimNextDueField) treats
// `last_attempt_at IS NULL` as reclaimable too (a row that reached
// NOT_AVAILABLE_YET/CHECK_FAILED with no last_attempt_at stamped -- possible
// from a hand-written repair or a future writer bug). That was the exact
// blind spot this check exists to close: a null-attempt row was reclaimable
// but invisible to the check. Fixed by treating NULL as "due since forever"
// (an unconditional match), never excluded.
//
// The SQL below is the same "stuck" definition as the pure, unit-tested
// isStuckReclaimRow predicate in field-plan-slot.mjs (F6 fix — that
// predicate is what scripts/tests/field-plan-slot.test.mjs exercises RED
// and GREEN without a database); kept as SQL here purely for performance
// (a table-wide client-side filter would defeat the point of the reclaim
// indexes this same PR adds). PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS is
// imported from that same module, which is the one place its value (kept
// equal to FIELD_PLAN_RECLAIM_MAX_ATTEMPTS in
// ipo-field-plan-repository.ts by hand, pinned by test) lives.
// #884: a plan row retired at the attempts cap by a CONFIGURATION cause — the
// manifest ranks a source whose adapter has no mapping for the field, a DOC rank
// with no documentType, or a source with no fetcher. recordOutcome no longer
// charges those (#884) and the repair tool gave the old ones back, so the healthy
// value is 0; a non-zero count means a new write path is charging config gaps
// again, or the repair was never applied to this slot. Named by IPO and field
// (signal-ownership R1). The cause predicate is the pinned mirror of the
// repository's own list (isConfigGapAtCapRow, field-plan-slot.mjs).
async function checkPullPlanConfigGapAtCap() {
  let rows;
  try {
    rows = await q(
      `SELECT p.id, i.slug, p.table_name AS "tableName", p.field_name AS "fieldName",
              p.state::text AS state, p.attempts, p.cause
         FROM ipo_field_plan p
         LEFT JOIN ipos i ON i.id = p.ipo_id
        WHERE p.state = 'CHECK_FAILED' AND p.attempts >= $1`,
      [PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS]
    );
  } catch (e) {
    record('pull_plan_config_gap_at_cap', 'no plan row is retired at the attempts cap by a configuration gap', 'UNVERIFIABLE',
      `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  const offenders = rows.filter(isConfigGapAtCapRow);
  for (const row of offenders) {
    notify('pull_plan_config_gap_at_cap', 'P2', `${row.slug ?? row.id}:${row.tableName}.${row.fieldName}`,
      'plan row retired at the attempts cap by a CONFIGURATION gap, not a real failure',
      `attempts=${row.attempts} cause=${row.cause}`);
  }
  const ipos = new Set(offenders.map((r) => r.slug ?? r.id));
  record('pull_plan_config_gap_at_cap', `${offenders.length} plan row(s) retired at the attempts cap by a configuration gap`,
    offenders.length === 0 ? 'PASS' : 'FAIL',
    `0 expected; found ${offenders.length} across ${ipos.size} IPO(s)` +
      (offenders.length ? ` (sample: ${offenders.slice(0, MAX_OFFENDERS).map((r) => `${r.slug ?? r.id}:${r.tableName}.${r.fieldName}`).join('; ')})` : ''));
}

// #884 review round 2 (MINOR): a gap-stamped plan row is re-asked only when its
// field's gap key changes, so a gap nobody fixes sits unchanged indefinitely and
// no other check sees it (it is neither capped nor stuck by the slot rule).
// Named by table.field with the IPO slugs it holds (signal-ownership R1), one
// notify per FIELD so thousands of rows on one unmapped field are one line.
// WARN, not FAIL: the known gaps are listed by the shrink-only baseline in
// manifest-rank-coverage-gaps.test.ts; this says which of them have been waiting.
async function checkPullPlanGapStalled() {
  const title = `no gap-stamped plan row has waited more than ${FIELD_PLAN_GAP_STALLED_DAYS} days for its gap key to change`;
  let rows;
  try {
    rows = await q(
      `SELECT p.id, i.slug, p.table_name AS "tableName", p.field_name AS "fieldName",
              p.state::text AS state, p.cause, p.last_attempt_at AS "lastAttemptAt"
         FROM ipo_field_plan p
         LEFT JOIN ipos i ON i.id = p.ipo_id
        WHERE p.state = 'CHECK_FAILED' AND left(p.cause, 9) = '[gap-key:'`
    );
  } catch (e) {
    record('pull_plan_gap_stalled', title, 'UNVERIFIABLE', `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  const now = new Date();
  const stalled = rows.filter((r) => isStalledGapRow(r, now));
  const byField = new Map();
  for (const r of stalled) {
    const key = `${r.tableName}.${r.fieldName}`;
    if (!byField.has(key)) byField.set(key, []);
    byField.get(key).push(r.slug ?? r.id);
  }
  const fields = [...byField.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [field, ipos] of fields) {
    notify('pull_plan_gap_stalled', 'P3', field, `gap-stamped plan rows waiting > ${FIELD_PLAN_GAP_STALLED_DAYS} days for a manifest/adapter/extractor/document change`,
      `${ipos.length} IPO(s): ${ipos.slice(0, MAX_OFFENDERS).join(', ')}${ipos.length > MAX_OFFENDERS ? ', ...' : ''}`);
  }
  record('pull_plan_gap_stalled', `${stalled.length} gap row(s) on ${fields.length} field(s) waiting > ${FIELD_PLAN_GAP_STALLED_DAYS} days`,
    stalled.length === 0 ? 'PASS' : 'WARN',
    `of ${rows.length} gap-stamped row(s)` +
      (fields.length ? ` (by field: ${fields.slice(0, MAX_OFFENDERS).map(([f, ipos]) => `${f}=${ipos.length} [${ipos.slice(0, 3).join(', ')}]`).join('; ')})` : ''));
}

async function checkS_pullPlanStuckReclaim() {
  const twoSlotsAgo = mostRecentFieldPlanSlotBoundary(
    mostRecentFieldPlanSlotBoundary(new Date())
  );
  let rows;
  try {
    rows = await q(
      `SELECT id, table_name AS "tableName", row_key AS "rowKey", field_name AS "fieldName",
              state, attempts, last_attempt_at AS "lastAttemptAt"
         FROM ipo_field_plan
        WHERE (
          (state = 'NOT_AVAILABLE_YET')
          OR (state = 'CHECK_FAILED' AND attempts < $1)
        )
          AND claimed_at IS NULL
          AND (last_attempt_at IS NULL OR last_attempt_at < $2::timestamptz)`,
      [PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS, twoSlotsAgo]
    );
  } catch (e) {
    record('pull_plan_stuck_reclaim', 'non-terminal plan rows are still being reclaimed (not stuck)', 'UNVERIFIABLE',
      `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  for (const row of rows) {
    notify('pull_plan_stuck_reclaim', 'P2', `${row.tableName}.${row.fieldName}:${row.id}`,
      'non-terminal plan row unclaimed for 2+ discovery slots — the claim query may have stopped reclaiming this state',
      `state=${row.state} attempts=${row.attempts} lastAttemptAt=${row.lastAttemptAt ?? 'null'}`);
  }
  record('pull_plan_stuck_reclaim', `${rows.length} non-terminal plan row(s) unclaimed for 2+ discovery slots`,
    rows.length === 0 ? 'PASS' : 'FAIL',
    `0 stuck rows expected; found ${rows.length}` + (rows.length ? ` (sample: ${rows.slice(0, MAX_OFFENDERS).map(r => `${r.tableName}.${r.fieldName}`).join('; ')})` : ''));
}

// ---- item 6 / F-161: PULL-DOC-NAY-WITH-OFFER-DOC -- a DOC-ranked plan row whose rank-1 answer was
// NOT_AVAILABLE_YET ("no document yet") although the IPO already held a COMPLETED offer document
// (RHP / DRHP / PROSPECTUS / PRICE_BAND_AD) extracted BEFORE that attempt. The DOC fetcher's
// documentType family held only PRICE_BAND_AD for price-band fields, so every SME IPO (no price-band
// ad at all) answered "not yet" forever: 984 staging rows on 23 IPOs, hidden for weeks because the
// state looks like an honest wait. Keyed on the recorded cause, not the state, so a row that a
// lower rank later SUPPLIED provisionally still counts (rank 1 is meant to reclaim it).
async function checkPullDocNayWithOfferDoc() {
  const title = 'no DOC-ranked plan row says "no document yet" while its IPO holds an extracted offer document';
  let rows;
  try {
    rows = await q(
      `SELECT i.slug, p.table_name AS "tableName", p.field_name AS "fieldName", p.state::text AS state
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
        WHERE p.rank1_source = 'DOC'
          AND left(p.cause, 27) = 'rank1:DOC:NOT_AVAILABLE_YET'
          AND EXISTS (SELECT 1 FROM documents d
                       WHERE d.ipo_id = p.ipo_id
                         AND d.extraction_status = 'COMPLETED'
                         AND d.is_active IS NOT FALSE
                         AND d.type IN ('RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD')
                         AND d.extracted_at IS NOT NULL
                         AND p.last_attempt_at > d.extracted_at)`
    );
  } catch (e) {
    record('pull_doc_nay_with_offer_doc', title, 'UNVERIFIABLE', `ipo_field_plan/documents not readable: ${e.message}`);
    return;
  }
  const byIpo = new Map();
  for (const r of rows) byIpo.set(r.slug, (byIpo.get(r.slug) ?? 0) + 1);
  const ipos = [...byIpo.entries()].sort((a, b) => b[1] - a[1]);
  for (const [slug, n] of ipos.slice(0, MAX_OFFENDERS)) {
    notify('pull_doc_nay_with_offer_doc', 'P2', slug, 'DOC rank answered "no document yet" after the offer document was extracted',
      `${n} plan row(s), e.g. ${rows.filter((r) => r.slug === slug).slice(0, 3).map((r) => `${r.tableName}.${r.fieldName}`).join(', ')}`);
  }
  record('pull_doc_nay_with_offer_doc', title, rows.length === 0 ? 'PASS' : 'FAIL',
    `0 expected; found ${rows.length} row(s) on ${ipos.length} IPO(s)` +
      (ipos.length ? ` (${ipos.slice(0, MAX_OFFENDERS).map(([s, n]) => `${s}=${n}`).join('; ')})` : ''));
}

// ---- (S) item 3 slice S4: PULL-OVERRIDES -- every active field_source_overrides row still holds
async function checkS_pullOverrides() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json'), 'utf8'));
  } catch (e) {
    record('pull_overrides', 'every active field_source_overrides row is unexpired-and-flagged and still valid', 'UNVERIFIABLE',
      `field-manifest.json not readable: ${e.message}`);
    return;
  }
  let rows;
  try {
    rows = await q(
      `SELECT id, table_name AS "tableName", field_name AS "fieldName", ipo_id AS "ipoId",
              rank1_source AS "rank1Source", rank2_source AS "rank2Source", rank3_source AS "rank3Source",
              reason, set_by AS "setBy", expires_at AS "expiresAt"
         FROM field_source_overrides
        WHERE expired_at IS NULL`
    );
  } catch (e) {
    // S4's central safety property: a database with no field_source_overrides table (prod, before
    // this slice's migration ships there) is "layer 2 not migrated here yet" -- a benign PASS, never
    // UNVERIFIABLE/FAIL. Any OTHER read failure (a real outage) is still reported UNVERIFIABLE.
    if (e.code === '42P01') {
      record('pull_overrides', 'every active field_source_overrides row is unexpired-and-flagged and still valid', 'PASS',
        'field_source_overrides table does not exist on this database -- layer 2 not migrated here yet.');
      return;
    }
    record('pull_overrides', 'every active field_source_overrides row is unexpired-and-flagged and still valid', 'UNVERIFIABLE',
      `field_source_overrides not readable: ${e.message}`);
    return;
  }
  const now = new Date();
  const offenders = [];
  const active = [];
  for (const row of rows) {
    const { violation, stillTimeActive } = checkOverrideRow(row, now, (candidate) =>
      validateOverrideRankSet(manifest, candidate.table, candidate.column, candidate.ranks)
    );
    if (stillTimeActive) active.push(row);
    if (violation) {
      offenders.push(violation);
      notify('pull_overrides', 'P2', `${row.tableName}.${row.fieldName}`, 'field_source_overrides row invalid or unflagged-expired', violation);
    }
  }
  const activeList = active
    .map((r) => `${r.id}:${r.tableName}.${r.fieldName}:ipo=${r.ipoId ?? '(all)'}:expiresAt=${new Date(r.expiresAt).toISOString()}`)
    .join('; ');
  record('pull_overrides', `${rows.length} non-administratively-expired override row(s), ${active.length} still time-active`,
    offenders.length === 0 ? 'PASS' : 'FAIL',
    (offenders.length === 0
      ? `0 violations. Active overrides: ${activeList || '(none)'}`
      : `${offenders.length} violation(s): ${offenders.slice(0, MAX_OFFENDERS).join('; ')}`));
}

async function checkNotApplicableDocuments() {
  let result;
  try {
    result = await collectNotApplicableDocuments(q);
  } catch (e) {
    record('not_applicable_documents_named', NOT_APPLICABLE_CHECK_NAME, 'UNVERIFIABLE',
      `documents not readable: ${e.message}`);
    return;
  }
  record('not_applicable_documents_named', NOT_APPLICABLE_CHECK_NAME, result.status, result.detail);
}




async function checkS_pullPlanOrigin() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json'), 'utf8'));
  } catch (e) {
    record('pull_plan_origin', 'current-version plan rows record which policy layer chose their ranks',
      'UNVERIFIABLE', `field-manifest.json not readable: ${e.message}`);
    return;
  }
  let rows;
  try {
    rows = await q(
      `SELECT i.slug, p.table_name AS "tableName", p.field_name AS "fieldName", p.state::text AS state
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
        WHERE p.manifest_version = $1
          AND p.state NOT IN ('EXHAUSTED')
          AND p.policy_origin IS NULL
        ORDER BY i.slug, p.table_name, p.field_name`,
      [manifest.version]
    );
  } catch (e) {
    record('pull_plan_origin', 'current-version plan rows record which policy layer chose their ranks',
      'UNVERIFIABLE', `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  for (const r of rows.slice(0, FINDINGS_MAX_ROWS_PER_CHECK)) {
    notify('pull_plan_origin', 'P2', `${r.slug}:${r.tableName}.${r.fieldName}`,
      'plan row at the current manifest version carries no policy_origin', `state=${r.state}`);
  }
  record('pull_plan_origin', 'current-version plan rows record which policy layer chose their ranks',
    rows.length === 0 ? 'PASS' : 'FAIL',
    rows.length === 0
      ? `0 row(s) at manifestVersion=${manifest.version} lack policy_origin`
      : `${rows.length} row(s) at manifestVersion=${manifest.version} lack policy_origin: ${rows.slice(0, MAX_OFFENDERS).map((r) => `${r.slug}:${r.tableName}.${r.fieldName}`).join('; ')}`);
}

async function checkS_pullAdmin() {
  // §2.7's guard: the walk may skip a field because an admin protected it. If
  // the plan says "skipped for admin" and no live protection row exists, the
  // field is being withheld for a reason that is no longer true -- a silent
  // freeze rather than a recorded decision.
  let rows;
  try {
    rows = await q(
      `SELECT i.slug, p.table_name AS "tableName", p.field_name AS "fieldName",
              coalesce(p.reason_code, '(none)') AS "reasonCode"
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
         LEFT JOIN field_protection_metadata f
                ON f.ipo_id = p.ipo_id
               AND f.table_name = p.table_name
               AND f.field_name = p.field_name
               AND f.is_protected = true
        WHERE p.reason_code = 'ADMIN_PROTECTED'
          AND f.id IS NULL
          AND i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')
        ORDER BY i.slug`
    );
  } catch (e) {
    record('pull_admin', 'fields skipped for admin reasons with no live protection row', 'UNVERIFIABLE',
      `ipo_field_plan/field_protection_metadata not readable: ${e.message}`);
    return;
  }
  for (const r of rows) {
    notify('pull_admin', 'P2', `${r.slug}:${r.tableName}.${r.fieldName}`,
      'field skipped as admin-protected but no live protection row exists', `reason=${r.reasonCode}`);
  }
  record('pull_admin', 'fields skipped for admin reasons with no live protection row',
    rows.length === 0 ? 'PASS' : 'FAIL',
    rows.length === 0
      ? '0 admin-skipped field(s) without a live protection row'
      : `${rows.length}: ${rows.slice(0, MAX_OFFENDERS).map((r) => `${r.slug}:${r.tableName}.${r.fieldName}`).join('; ')}`);
}


// PULL-NOOP: writes per cycle over fields re-asked per cycle. The class it
// catches is verification that REWRITES unchanged values -- a healthy-looking
// write rate that is entirely churn, and a provenance trail that buries the one
// real change in it (design §2.5.2).
//
// The threshold is stated as a RECOMMENDATION, not a measured number, per
// OD-18. The check reports the ratio and its parts every night; the first weeks
// of that output are what should replace 5% with something measured. A number
// typed here today would be a guess wearing a threshold's clothes.
const PULL_NOOP_RECOMMENDED_CEILING = 0.05;

async function checkS_pullNoop() {
  let row;
  try {
    [row] = await q(
      `SELECT
         (SELECT count(*) FROM ipo_field_plan
           WHERE last_attempt_at > now() - interval '24 hours')::int AS "reasked",
         (SELECT count(*) FROM field_sources
           WHERE updated_at > now() - interval '24 hours')::int AS "written",
         (SELECT count(*) FROM documents
           WHERE created_at > now() - interval '24 hours')::int AS "newDocuments"`
    );
  } catch (e) {
    record('pull_noop', 'writes per cycle over fields re-asked per cycle', 'UNVERIFIABLE',
      `ipo_field_plan/field_sources/documents not readable: ${e.message}`);
    return;
  }
  if (!row || row.reasked === 0) {
    // No re-asks means no denominator. A 0/0 ratio is not a healthy zero.
    record('pull_noop', 'writes per cycle over fields re-asked per cycle', 'UNVERIFIABLE',
      'no field was re-asked in the last 24h — nothing to measure (a walk that did not run is not a quiet walk)');
    return;
  }
  const ratio = row.written / row.reasked;
  const detail = `${row.written} write(s) / ${row.reasked} re-ask(s) = ${(ratio * 100).toFixed(1)}%`
    + `, ${row.newDocuments} new document(s) in the same window`;
  // A high ratio is only suspicious WITHOUT a matching document arrival: new
  // documents are exactly when legitimate rewriting happens.
  if (ratio > PULL_NOOP_RECOMMENDED_CEILING && row.newDocuments === 0) {
    notify('pull_noop', 'P2', 'cycle', 'write rate high with no new documents', detail);
    record('pull_noop', 'writes per cycle over fields re-asked per cycle', 'FAIL',
      `${detail} — above the RECOMMENDED ${(PULL_NOOP_RECOMMENDED_CEILING * 100).toFixed(0)}% ceiling with no document arrival to explain it (threshold is a recommendation per OD-18, not a measured number)`);
    return;
  }
  record('pull_noop', 'writes per cycle over fields re-asked per cycle', 'PASS', detail);
}


// E1-SOURCE: the ten E-1 (class T) fields are the exchange's to state -- open,
// close, listing, allotment, refund and credit dates, status, exchanges. A
// document may PRINT an intended date; only the exchange's own page says what
// it IS. So no E-1 field may ever carry a document-path source.
//
// It asserts the OUTCOME, not the declared intent: the manifest can say DOC is
// not capable for these fields, and that is a claim; this reads what actually
// landed in field_sources.
//
// field_sources.field_name is camelCase (`openDate`, not `open_date`) -- a
// snake_case filter here returns a silent empty result and passes for the
// wrong reason, which is a mistake this repository has made before.
const E1_DOCUMENT_SOURCES = ['DRHP', 'DOC'];

async function checkS_e1Source() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json'), 'utf8'));
  } catch (e) {
    record('e1_source', 'no E-1 (exchange-stated) field is written by the document path', 'UNVERIFIABLE',
      `field-manifest.json not readable: ${e.message}`);
    return;
  }
  const toCamel = (c) => c.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  const e1 = Object.entries(manifest.fields)
    .filter(([, v]) => v.class === 'T')
    .map(([k]) => {
      const [table, ...rest] = k.split('.');
      return { table, column: toCamel(rest.join('.')) };
    });
  if (e1.length === 0) {
    record('e1_source', 'no E-1 (exchange-stated) field is written by the document path', 'UNVERIFIABLE',
      'the manifest declares no class-T field — the population this check guards is empty, which is not a pass');
    return;
  }
  let rows;
  try {
    rows = await q(
      `SELECT i.slug, f.table_name AS "tableName", f.field_name AS "fieldName", f.source::text AS source
         FROM field_sources f
         JOIN ipos i ON i.id = f.ipo_id
        WHERE (f.table_name, f.field_name) IN (${e1.map((_, n) => `($${n * 2 + 1}, $${n * 2 + 2})`).join(', ')})
          AND f.source::text = ANY($${e1.length * 2 + 1})
        ORDER BY i.slug`,
      [...e1.flatMap((f) => [f.table, f.column]), E1_DOCUMENT_SOURCES]
    );
  } catch (e) {
    record('e1_source', 'no E-1 (exchange-stated) field is written by the document path', 'UNVERIFIABLE',
      `field_sources not readable: ${e.message}`);
    return;
  }
  for (const r of rows) {
    notify('e1_source', 'P1', `${r.slug}:${r.tableName}.${r.fieldName}`,
      'E-1 field written by the document path', `source=${r.source} — only the exchange states this field`);
  }
  record('e1_source', 'no E-1 (exchange-stated) field is written by the document path',
    rows.length === 0 ? 'PASS' : 'FAIL',
    rows.length === 0
      ? `0 of ${e1.length} E-1 field(s) carry a document source`
      : `${rows.length} E-1 write(s) from a document source: ${rows.slice(0, MAX_OFFENDERS).map((r) => `${r.slug}:${r.tableName}.${r.fieldName}=${r.source}`).join('; ')}`);
}


// PULL-PLAN: does each IPO carry the plan rows the manifest says it should?
// The class it catches is a whole IPO quietly under-planned -- fields that were
// never scheduled to be asked at all, which no per-row check can see because
// the row does not exist. Measured while writing this: plan rows per IPO on
// staging range from 4 to 190 across 78 IPOs.
//
// The expected count is NOT a constant. The manifest's `na` array lists the
// offering types each field does not apply to, so a RIGHTS issue legitimately
// carries fewer rows than a MAINBOARD IPO. Comparing against a flat 190 would
// fail every non-ordinary offering for being correct.
async function checkS_pullPlan() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'scraper', 'config', 'field-manifest.json'), 'utf8'));
  } catch (e) {
    record('pull_plan', 'each live IPO carries the plan rows its offering type calls for', 'UNVERIFIABLE',
      `field-manifest.json not readable: ${e.message}`);
    return;
  }
  const entries = Object.entries(manifest.fields);
  const expectedFor = (offeringType) =>
    entries.filter(([, v]) => !(v.na || []).includes(offeringType)).length;

  let rows;
  try {
    rows = await q(
      `SELECT i.slug, i.offering_type::text AS "offeringType", count(p.id)::int AS "planRows"
         FROM ipos i
         LEFT JOIN ipo_field_plan p ON p.ipo_id = i.id
        WHERE i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')
        GROUP BY i.slug, i.offering_type
        ORDER BY i.slug`
    );
  } catch (e) {
    record('pull_plan', 'each live IPO carries the plan rows its offering type calls for', 'UNVERIFIABLE',
      `ipos/ipo_field_plan not readable: ${e.message}`);
    return;
  }
  if (rows.length === 0) {
    record('pull_plan', 'each live IPO carries the plan rows its offering type calls for', 'UNVERIFIABLE',
      'no live IPO to measure — an empty population is not a clean plan');
    return;
  }
  const short = [];
  for (const r of rows) {
    const expected = expectedFor(r.offeringType);
    if (r.planRows < expected) {
      short.push(`${r.slug}(${r.offeringType}) ${r.planRows}/${expected}`);
      notify('pull_plan', 'P2', r.slug, 'IPO carries fewer plan rows than its offering type calls for',
        `${r.planRows} of ${expected} expected for ${r.offeringType}`);
    }
  }
  record('pull_plan', 'each live IPO carries the plan rows its offering type calls for',
    short.length === 0 ? 'PASS' : 'FAIL',
    short.length === 0
      ? `${rows.length} live IPO(s) all carry a full plan for their offering type`
      : `${short.length} of ${rows.length} live IPO(s) under-planned: ${short.slice(0, MAX_OFFENDERS).join('; ')}`);
}


// PULL-WRITE: a plan row marked SUPPLIED asserts that a value was written. If
// no field_sources row exists for that (ipo, table, field), the plan is
// claiming a success that never landed -- the worst shape in the loop, because
// every downstream reading treats SUPPLIED as settled and stops asking.
//
// field_sources.field_name is camelCase while ipo_field_plan.field_name is
// snake_case, so the join has to convert. A direct equality join returns zero
// rows and this check would report a clean PASS over an empty comparison.
async function checkS_pullWrite() {
  let planRows, writeRows;
  try {
    planRows = await q(
      `SELECT i.slug, p.table_name AS "tableName", p.field_name AS "fieldName", p.chosen_source::text AS "chosenSource"
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
        WHERE p.state = 'SUPPLIED'
          AND i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')`
    );
    writeRows = await q(
      `SELECT ipo_id AS "ipoId", table_name AS "tableName", field_name AS "fieldName" FROM field_sources`
    );
  } catch (e) {
    record('pull_write', 'every SUPPLIED plan row has a matching field_sources write', 'UNVERIFIABLE',
      `ipo_field_plan/field_sources not readable: ${e.message}`);
    return;
  }
  // ipo_field_plan.field_name is snake_case; field_sources.field_name is
  // camelCase. Comparing them directly in SQL returns zero matches and this
  // check reports a clean PASS over a comparison that never happened -- the
  // exact shape a silent empty result takes. The conversion is done here,
  // where it is visible, rather than buried in a regexp_replace.
  const toCamel = (c) => c.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
  const written = new Set(writeRows.map((w) => `${w.tableName}.${w.fieldName}`));
  const missing = planRows.filter((r) => !written.has(`${r.tableName}.${toCamel(r.fieldName)}`));

  for (const r of missing.slice(0, FINDINGS_MAX_ROWS_PER_CHECK)) {
    notify('pull_write', 'P1', `${r.slug}:${r.tableName}.${r.fieldName}`,
      'plan row says SUPPLIED but no field_sources write exists',
      `chosenSource=${r.chosenSource || '(none)'} — the loop will never re-ask this field`);
  }
  record('pull_write', 'every SUPPLIED plan row has a matching field_sources write',
    missing.length === 0 ? 'PASS' : 'FAIL',
    missing.length === 0
      ? `0 of ${planRows.length} SUPPLIED row(s) lack a write`
      : `${missing.length} of ${planRows.length} SUPPLIED row(s) with no write: ${missing.slice(0, MAX_OFFENDERS).map((r) => `${r.slug}:${r.tableName}.${r.fieldName}`).join('; ')}`);
}


// M-INCOMPLETE-PAGES-UNRETRIED (OD-55 lane B): when the 2-hour hung-process
// ceiling stops a document read part-way, the ledger row names the pages it
// never got to. Nothing watches whether those pages are ever read, and unlike
// m_extraction_stuck the document does NOT look stuck -- it looks finished.
//
// The spec insists the two outcomes are never folded together, because they
// need opposite actions:
//   PDF still retained  -> a retry can still be scheduled
//   PDF already purged  -> a permanent data gap to report, not a retry
// CORPUS-SHAPE (item 10, docs/design/data-sourcing-pull-model.md §4.5): per
// source, does the live page behind each HTML fixture still carry the LABELS
// its extractor keys on? Values are excluded on purpose — they are supposed to
// change; a label that disappears is a field about to stop extracting.
//
// Measured 2026-09-22 on origin/main: the corpus holds 11 HTML fixtures and
// ZERO of them carry a .meta.json, so none has a fetchable sourceUrl (all 11
// are grandfathered in config/fixture-provenance-baseline.json). This check
// therefore records UNVERIFIABLE today, NOT pass — it has measured nothing,
// and saying "every live page still matches" would be a claim it cannot make.
// It goes green on its own the moment a fixture is attributed through
// scripts/create-fixture-from-capture.mjs --source-url.
//
// Network: opt-in. The nightly floor runs it (CORPUS_SHAPE_FETCH unset =>
// fetch), CI does not (CORPUS_SHAPE_FETCH=0), so the PR gate never depends on
// a third-party site being up.
const CORPUS_SHAPE_FETCH = process.env.CORPUS_SHAPE_FETCH !== '0';
const CORPUS_SHAPE_TIMEOUT_MS = Number(process.env.CORPUS_SHAPE_TIMEOUT_MS ?? 20000);
// Same courtesy pacing as the ipowatch oracle above: one page at a time, with
// a gap, against sites that owe us nothing.
const CORPUS_SHAPE_DELAY_MS = Number(process.env.CORPUS_SHAPE_DELAY_MS ?? 400);
const CORPUS_SHAPE_HEADERS = {
  'User-Agent': 'IPODhan-detection-floor-audit/1.0 (+https://ipodhan.com; fixture shape check, see scripts/lib/corpus-shape-checks.mjs)',
  Accept: 'text/html',
};

async function checkS_corpusShape() {
  const CHECK_NAME = 'live page behind each fixture still carries the labels its extractor keys on';
  let entries;
  try {
    entries = loadHtmlFixtureEntries(findFixtureFiles(REPO_ROOT));
  } catch (e) {
    record('corpus_shape', CHECK_NAME, 'UNVERIFIABLE', `fixture corpus not readable: ${e.message}`);
    return;
  }

  const { checkable, unattributable } = partitionFixtures(entries);
  const results_ = [];

  if (checkable.length > 0 && CORPUS_SHAPE_FETCH) {
    for (const entry of checkable) {
      const rel = toPosixPath(relative(REPO_ROOT, entry.file));
      const sourceUrl = entry.meta.sourceUrl;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), CORPUS_SHAPE_TIMEOUT_MS);
        const res = await fetch(sourceUrl, { signal: ctrl.signal, headers: CORPUS_SHAPE_HEADERS })
          .finally(() => clearTimeout(t));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const liveHtml = await res.text();
        const diff = compareShape(
          extractShape(readFileSync(entry.file, 'utf8')),
          extractShape(liveHtml)
        );
        results_.push({ file: rel, sourceUrl, same: diff.same, movedLabels: diff.movedLabels });
        if (!diff.same) {
          notify('corpus_shape', 'P1', rel,
            'a label this fixture depends on is gone from its live page',
            `${sourceUrl}: label(s) moved: ${diff.movedLabels.join(', ')} — the extractor that keys on them will stop finding its value`);
        }
      } catch (e) {
        results_.push({ file: rel, sourceUrl, error: e.message });
      }
      await sleep(CORPUS_SHAPE_DELAY_MS);
    }
  } else if (checkable.length > 0) {
    record('corpus_shape', CHECK_NAME, 'UNVERIFIABLE',
      `${checkable.length} fixture(s) are checkable but CORPUS_SHAPE_FETCH=0 — no live page was fetched`);
    return;
  }

  const summary = summarizeCorpusShape({ checkable, unattributable, results: results_ });
  record('corpus_shape', CHECK_NAME, summary.status, summary.detail);
}

async function checkS_incompletePagesUnretried() {
  let rows;
  try {
    rows = await q(
      `SELECT i.slug, s.step_id AS "stepId", s.last_run_at AS "lastRunAt",
              jsonb_array_length(coalesce(s.evidence->'unreadPages', '[]'::jsonb))::int AS "unreadCount",
              (s.evidence->>'sha256') AS sha256
         FROM ipo_pipeline_steps s
         JOIN ipos i ON i.id = s.ipo_id
        WHERE jsonb_array_length(coalesce(s.evidence->'unreadPages', '[]'::jsonb)) > 0
        ORDER BY s.last_run_at DESC`
    );
  } catch (e) {
    record('m_incomplete_pages_unretried', 'documents stopped mid-read whose unread pages were never re-read',
      'UNVERIFIABLE', `ipo_pipeline_steps not readable: ${e.message}`);
    return;
  }
  if (rows.length === 0) {
    record('m_incomplete_pages_unretried', 'documents stopped mid-read whose unread pages were never re-read',
      'PASS', 'no ledger row carries a non-empty unreadPages array — the 2-hour ceiling has not cut a read short');
    return;
  }
  // Split by whether the bytes are still there, because the two need opposite
  // actions and folding them together loses the distinction the spec asks for.
  let retryable = 0, permanent = 0;
  for (const r of rows) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stillRetained = r.lastRunAt && new Date(r.lastRunAt).getTime() > sevenDaysAgo;
    if (stillRetained) retryable++; else permanent++;
    notify('m_incomplete_pages_unretried', 'P1', `${r.slug}:${r.stepId}`,
      stillRetained ? 'document stopped mid-read, PDF still retained — a retry is still possible'
                    : 'document stopped mid-read, PDF purged — permanent data gap',
      `${r.unreadCount} unread page(s), sha256=${(r.sha256 || '(none)').slice(0, 12)}`);
  }
  record('m_incomplete_pages_unretried', 'documents stopped mid-read whose unread pages were never re-read',
    'FAIL',
    `${rows.length} document(s) with unread pages: ${retryable} still retryable (PDF within the seven-day window), ${permanent} permanent gap(s) — these need opposite actions and are counted separately`);
}

async function checkS_pullWalk() {
  let rows;
  try {
    rows = await q(
      `SELECT i.slug,
              count(*)::int AS planned,
              count(*) FILTER (WHERE p.last_attempt_at > now() - interval '36 hours')::int AS "walkedRecently"
         FROM ipos i
         JOIN ipo_field_plan p ON p.ipo_id = i.id
        WHERE i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')
        GROUP BY i.slug
        ORDER BY i.slug`
    );
  } catch (e) {
    record('pull_walk', 'every live IPO was walked in the last 36 hours', 'UNVERIFIABLE',
      `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  // The design's own guard: "phase-1 count >= 1". A walk that reports 0 of 0
  // walked is not a healthy walk, it is an empty population, and printing PASS
  // for it is how a dead loop reads as fine.
  if (rows.length === 0) {
    record('pull_walk', 'every live IPO was walked in the last 36 hours', 'UNVERIFIABLE',
      'no live IPO carries a plan row — the population is empty, which is not the same as a clean walk');
    return;
  }
  const stale = rows.filter((r) => r.walkedRecently === 0);
  for (const r of stale) {
    notify('pull_walk', 'P2', r.slug, 'live IPO not walked in 36h', `${r.planned} planned field(s), 0 attempted recently`);
  }
  record('pull_walk', 'every live IPO was walked in the last 36 hours',
    stale.length === 0 ? 'PASS' : 'FAIL',
    stale.length === 0
      ? `${rows.length} of ${rows.length} live IPO(s) walked within 36h`
      : `${stale.length} of ${rows.length} live IPO(s) NOT walked in 36h: ${stale.slice(0, MAX_OFFENDERS).map((r) => r.slug).join(', ')}`);
}

async function checkS_pullType() {
  // The rank half of this design id is already covered by pull_plan_rank. What
  // that check cannot see is an IPO whose TYPE is unknown: `ipoTypeKey` needs a
  // segment, so a null segment means every rank it resolved was resolved for a
  // guessed type. That is the half this check owns.
  let rows;
  try {
    rows = await q(
      `SELECT i.slug, i.status::text AS status, count(p.id)::int AS "planRows"
         FROM ipos i
         LEFT JOIN ipo_field_plan p ON p.ipo_id = i.id
        WHERE i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')
          AND i.segment IS NULL
        GROUP BY i.slug, i.status
        ORDER BY i.slug`
    );
  } catch (e) {
    record('pull_type', 'live IPOs whose segment is null, so their plan ranks were resolved for a guessed type',
      'UNVERIFIABLE', `ipos/ipo_field_plan not readable: ${e.message}`);
    return;
  }
  for (const r of rows) {
    notify('pull_type', 'P2', r.slug, 'live IPO has a null segment', `${r.status}, ${r.planRows} plan row(s) resolved without a type`);
  }
  record('pull_type', 'live IPOs whose segment is null, so their plan ranks were resolved for a guessed type',
    rows.length === 0 ? 'PASS' : 'FAIL',
    rows.length === 0
      ? '0 live IPO(s) with a null segment'
      : `${rows.length} live IPO(s) with a null segment: ${rows.slice(0, MAX_OFFENDERS).map((r) => `${r.slug}(${r.planRows} rows)`).join('; ')}`);
}

// ---------------------------------------------------------------------------
// Item 10: PULL-YIELD / PULL-EXHAUST / PULL-EXCUSED.
//
// These three read `ipo_field_plan` directly and report what the walk is
// actually achieving. They were specified in design §4 and parked in
// `notCoveredByThisManifest` until a record() call landed; this is that call.
//
// Measured on staging 2026-09-20 while writing them, which is why the yield
// check reports a ratio AND its parts: 14,082 plan rows held 102 SUPPLIED
// (0.7%), 7,101 NOT_AVAILABLE_YET and 6,843 CHECK_FAILED. A check that printed
// only "yield is low" would have said nothing a reader could act on.

// §4 rule 1: a ratio whose denominator moved more than 5% overnight is
// UNVERIFIABLE, never PASS. The previous denominator comes from the audit's own
// state file, the same mechanism the other delta-aware checks use.
const PULL_YIELD_DENOMINATOR_DRIFT = 0.05;

async function checkS_pullYield() {
  let rows;
  try {
    rows = await q(
      `SELECT p.state::text AS state, count(*)::int AS n
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
        WHERE i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')
        GROUP BY 1`
    );
  } catch (e) {
    record('pull_yield', 'share of planned fields the walk has supplied', 'UNVERIFIABLE',
      `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (total === 0) {
    // A zero denominator is not a pass. Nothing was planned, so nothing can be
    // measured -- exactly the shape §4 rule 1 exists to stop reading as green.
    record('pull_yield', 'share of planned fields the walk has supplied', 'UNVERIFIABLE',
      'no plan rows for live IPOs — nothing to measure (a zero yield from an empty plan is not a failing yield)');
    return;
  }

  const prev = readPreviousState()['pull_yield_denominator'];
  if (typeof prev === 'number' && prev > 0) {
    const drift = Math.abs(total - prev) / prev;
    if (drift > PULL_YIELD_DENOMINATOR_DRIFT) {
      record('pull_yield', 'share of planned fields the walk has supplied', 'UNVERIFIABLE',
        `denominator moved ${(drift * 100).toFixed(1)}% overnight (${prev} -> ${total}); a ratio over a moving denominator is not evidence (§4 rule 1)`);
      return;
    }
  }

  extraState['pull_yield_denominator'] = total;
  const supplied = by.SUPPLIED || 0;
  const pct = ((supplied / total) * 100).toFixed(1);
  const parts = ['SUPPLIED', 'NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED', 'PENDING', 'NOT_PRINTED']
    .filter((k) => by[k]).map((k) => `${k}=${by[k]}`).join(' ');
  record('pull_yield', 'share of planned fields the walk has supplied',
    supplied > 0 ? 'PASS' : 'FAIL',
    `${supplied}/${total} supplied (${pct}%) — ${parts}`);
}

async function checkS_pullExhaust() {
  let rows;
  try {
    rows = await q(
      `SELECT i.slug, p.table_name AS "tableName", p.field_name AS "fieldName",
              coalesce(p.reason_code, '(none)') AS "reasonCode"
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
        WHERE p.state = 'EXHAUSTED'
          AND i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')
        ORDER BY i.slug, p.table_name, p.field_name`
    );
  } catch (e) {
    record('pull_exhaust', 'EXHAUSTED rows on live IPOs, by identity', 'UNVERIFIABLE',
      `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  // signal-ownership R1: a count is not a reading. Every EXHAUSTED row is named.
  for (const r of rows.slice(0, FINDINGS_MAX_ROWS_PER_CHECK)) {
    notify('pull_exhaust', 'P2', `${r.slug}:${r.tableName}.${r.fieldName}`,
      'field retired as EXHAUSTED on a live IPO', `reason=${r.reasonCode}`);
  }
  const ids = rows.slice(0, MAX_OFFENDERS).map((r) => `${r.slug}:${r.tableName}.${r.fieldName}(${r.reasonCode})`);
  record('pull_exhaust', 'EXHAUSTED rows on live IPOs, by identity',
    rows.length === 0 ? 'PASS' : 'FAIL',
    rows.length === 0 ? '0 EXHAUSTED rows on live IPOs'
      : `${rows.length} EXHAUSTED row(s) on live IPOs: ${ids.join('; ')}${rows.length > MAX_OFFENDERS ? ` (+${rows.length - MAX_OFFENDERS} more)` : ''}`);
}

async function checkS_pullExcused() {
  let rows;
  try {
    rows = await q(
      `SELECT coalesce(p.chosen_document_type, '(none)') AS "docType",
              p.table_name AS "tableName", count(*)::int AS n
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
        WHERE p.state = 'NOT_PRINTED'
          AND i.${REAL_IPO} AND i.status IN ('${LIVE_STATUSES.join("','")}')
        GROUP BY 1, 2
        ORDER BY n DESC`
    );
  } catch (e) {
    record('pull_excused', 'NOT_PRINTED set per document type, NEW vs yesterday', 'UNVERIFIABLE',
      `ipo_field_plan not readable: ${e.message}`);
    return;
  }
  // The design's point: a mis-resolved document type shows up as a GROWING
  // excused set, so the reading is the delta, not the level.
  const current = Object.fromEntries(rows.map((r) => [`${r.docType}:${r.tableName}`, r.n]));
  const previous = readPreviousState()['pull_excused_by_type'] || {};
  const grew = Object.entries(current)
    .filter(([k, n]) => n > (previous[k] || 0))
    .map(([k, n]) => `${k} ${previous[k] || 0}->${n}`);
  for (const g of grew) notify('pull_excused', 'P2', g.split(' ')[0], 'excused (NOT_PRINTED) set grew', g);
  extraState['pull_excused_by_type'] = current;
  const total = rows.reduce((a, r) => a + r.n, 0);
  record('pull_excused', 'NOT_PRINTED set per document type, NEW vs yesterday',
    grew.length === 0 ? 'PASS' : 'FAIL',
    grew.length === 0
      ? `${total} NOT_PRINTED row(s) across ${rows.length} (type, table) pair(s); none grew since the previous run`
      : `${grew.length} pair(s) grew: ${grew.slice(0, MAX_OFFENDERS).join('; ')}`);
}

async function main() {
  await assertSessionTimezoneUtc();
  console.log(`
=== DETECTION-FLOOR AUDIT (T-335) — ${new Date().toISOString()} ===`);
  await checkA_B();
  await checkC();
  await checkC_issueSizeSourceCapability();
  await checkD();
  await checkD_segmentProvenance();
  await checkE();
  await checkE_unknownSlug404();
  await checkF();
  await checkG1_repeatedWarn();
  await checkG3_inertDetector();
  await checkG();
  await checkH();
  checkI();
  await checkIdentity();
  await checkSourceKeyConflicts();
  await checkSettledFieldRewrites();
  await checkClosedIpoDoneWithoutWalk();
  await checkK();
  await checkCycleOverrunAudit();
  await checkL();
  await checkJ();
  await checkM();
  await checkN();
  checkO();
  await checkP();
  await checkQ_rowKeyCoverage();
  await checkR_provenanceParentNotNull();
  await checkNotApplicableDocuments();
  checkS_pullPolicy();
  await checkS_pullWritePolicy();
  await checkS_pullPlanRank();
  await checkS_pullPlanStuckReclaim();
  await checkPullDocNayWithOfferDoc();
  await checkPullPlanConfigGapAtCap();
  await checkPullPlanGapStalled();
  await checkS_pullOverrides();
  await checkS_pullYield();
  await checkS_pullExhaust();
  await checkS_pullExcused();
  await checkS_pullWalk();
  await checkS_pullType();
  await checkS_pullPlanOrigin();
  await checkS_pullAdmin();
  await checkS_pullNoop();
  await checkS_e1Source();
  await checkS_pullPlan();
  await checkS_pullWrite();
  await checkS_incompletePagesUnretried();
  await checkS_corpusShape();

  // item 35: the admin queue's open size, resolved to IPOs (signal-ownership.md R1), printed
  // where floor-delta.mjs (the existing same-day diffing consumer) already reads this
  // output — a growth in the queue then surfaces as a NEW line rather than a number someone
  // has to compare by hand. Read-only; never gates the audit's own PASS/FAIL/exit code.
  try {
    const queue = await adminQueueSize(pool);
    console.log('\n' + formatAdminQueueBlock(queue));
  } catch (err) {
    console.error(`ADMIN-QUEUE: could not read (${err.message}) — not fatal to the audit`);
  }

  // CHECK-ROSTER (item 10) runs LAST, on purpose: it asks whether every check
  // the manifest claims to run actually reported tonight. The class it closes is
  // the nastiest one in this file -- a check that THREW leaves no line, and the
  // delta consumer parses only PASS and FAIL, so a crashed check reads exactly
  // like a check with no findings. Silence is not success.
  try {
    const rosterManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'reviews', 'detection-checks.json'), 'utf8'));
    const declared = rosterManifest.checks
      .filter((c) => !c.auditScript || c.auditScript === rosterManifest.auditScript)
      .map((c) => c.id);
    // 'check_roster' itself has not recorded yet at this point -- it is the line
    // being built. Counting itself as missing would make this check permanently
    // FAIL for a reason that says nothing about the roster.
    const reported = new Set(results.map((r) => r.id)).add('check_roster');
    const missing = declared.filter((id) => !reported.has(id));
    for (const id of missing) {
      notify('check_roster', 'P1', id, 'declared check produced no line tonight',
        'it crashed, or it was never called — either way its silence is not a pass');
    }
    record('check_roster', 'every check this manifest declares reported tonight',
      missing.length === 0 ? 'PASS' : 'FAIL',
      missing.length === 0
        ? `${declared.length} declared check(s) all reported`
        : `${missing.length} of ${declared.length} declared check(s) produced NO line: ${missing.slice(0, MAX_OFFENDERS).join(', ')}`);
  } catch (e) {
    record('check_roster', 'every check this manifest declares reported tonight', 'UNVERIFIABLE',
      `detection-checks.json not readable: ${e.message}`);
  }

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
  Object.assign(nextState, extraState);

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
