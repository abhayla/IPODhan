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
import pg from 'pg';
import {
  checkNoUnresolvedConflictOnLiveIpo, HIGH_VALUE_FIELDS, LIVE_STATUSES,
  checkIssueSizeSegmentFloor, checkIssueSizeSharesConsistency,
  checkLotBandSebiWindow, checkCorporateActionShape,
  classifyRouteResponse, classifyConflictNoiseRatio, checkFreshnessPerType,
  checkPm2EnvHasTz, checkPm2LogSize, findUnreferencedDefinitions,
  checkSectorPopulatedPct, checkCronScriptExecutable, checkDeadSourceHasRetireBy,
  checkSegmentPopulatedForIpo, DEAD_SOURCE_MAX_DEGRADED_CYCLES,
  findLiveCrossSourceDisagreements, ORACLE_COMPARABLE_FIELDS,
  buildRunPayloads, evaluateCronExecutable,
  computeExitCode, EXIT_UNVERIFIABLE,
  parseStepNames, checkStepSilence, checkStepConsecutiveFailures,
  STEP_LEDGER_WINDOW_HOURS,
  crossCheckNseStatuses,
} from './lib/detection-floor-checks.mjs';

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
const BASE_URL = (process.env.BASE_URL || 'https://ipodhan.com').replace(/\/$/, '');
const MAX_OFFENDERS = 8;

const pool = new pg.Pool(
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
const RUN_DATE = new Date().toISOString().slice(0, 10);
const REPORT_PATH = join(STATE_DIR, `run-${RUN_DATE}.log`);

function readPreviousState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeCurrentState(state) {
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e) { console.log(`[STATE-WARN] could not persist ${STATE_FILE}: ${e.message} — every row will look "new" next run`); }
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
// The PRIMARY signal is now this audit's OWN live fetch of the non-NSE oracle
// (Chittorgarh's public IPO report — the same endpoint the scraper uses),
// compared against what `ipos` publishes. `data_conflicts` is a SECONDARY
// signal only. A failed oracle fetch is UNVERIFIABLE, which pages (blocker 1) —
// never a silent PASS.
const ORACLE_REPORT_URL = (() => {
  const year = new Date().getFullYear();
  const range = `${year}-${(year + 1) % 100}`;
  // perPage is pinned to 10 because the endpoint rejects any other value with
  // "Invalid API Call" (measured 2026-08-26: 25/50/100/200 all fail) and returns
  // the whole report regardless — same call shape as
  // scraper/src/scrapers/chittorgarh-scraper.ts.
  return `https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/${year}/${range}/0/all/0?search=&v=15-11`;
})();

async function fetchOracleRows() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(ORACLE_REPORT_URL, {
    signal: ctrl.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json',
      Referer: 'https://www.chittorgarh.com/',
    },
  }).finally(() => clearTimeout(t));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rows = data?.reportTableData;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`oracle returned no rows (${JSON.stringify(data).slice(0, 120)})`);
  }
  return rows.map((r) => ({
    companyName: String(r['Company'] || '').replace(/<[^>]+>/g, ' ').trim(),
    values: {
      openDate: r['~Issue_Open_Date'] || r['Opening Date'] || null,
      closeDate: r['~IssueCloseDate'] || r['Closing Date'] || null,
    },
  }));
}

async function checkA_B() {
  const name = `live IPO open/close dates agree with the independent non-NSE oracle (fields: ${ORACLE_COMPARABLE_FIELDS.join(', ')})`;

  const ipoRows = (await q(
    `SELECT id, company_name AS "companyName", status,
            open_date AS "openDate", close_date AS "closeDate"
       FROM ipos
      WHERE ${REAL_IPO} AND status IN ('${LIVE_STATUSES.join("','")}')`
  )).map((r) => ({
    id: r.id, companyName: r.companyName, status: r.status,
    values: { openDate: r.openDate, closeDate: r.closeDate },
  }));

  let oracleRows;
  try {
    oracleRows = await fetchOracleRows();
  } catch (e) {
    record('a_b_live_conflict', name, 'UNVERIFIABLE',
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

  const violations = findLiveCrossSourceDisagreements({ ipoRows, oracleRows, conflictRows });
  for (const v of violations) {
    notify('a_b_live_conflict', 'P1', `${v.ipoId}-${v.fieldName}`,
      `Live IPO "${v.companyName}" publishes a disputed ${v.fieldName}`, v.message);
  }
  const primary = violations.filter((v) => v.signal === 'oracle').length;
  const detail = `${violations.length} violation(s) (${primary} from this audit's own live oracle comparison over `
    + `${oracleRows.length} oracle rows vs ${ipoRows.length} live IPOs, ${violations.length - primary} `
    + `data_conflicts-only${conflictSignalAvailable ? '' : '; data_conflicts absent'})`
    + (violations.length ? `: ${violations.slice(0, MAX_OFFENDERS).map((v) => v.message).join('; ')}` : '');
  record('a_b_live_conflict', name, violations.length === 0 ? 'PASS' : 'FAIL', detail);
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
  record('c_issue_size_consistency', 'issue_size agrees with shares_offered x price_range_max (+/-25%)', consistencyOffenders.length === 0 ? 'PASS' : 'FAIL',
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

// ---- (f): conflict noise ratio ------------------------------------------------
async function checkF() {
  if (!(await tableExists('data_conflicts'))) {
    record('f_conflict_noise_ratio', 'unresolved data_conflicts noise ratio < 5%', 'UNVERIFIABLE', 'data_conflicts table not present');
    return;
  }
  const [{ total }] = await q(`SELECT count(*)::int total FROM data_conflicts WHERE resolved_at IS NULL`);
  const [{ noise }] = await q(`SELECT count(*)::int noise FROM data_conflicts WHERE resolved_at IS NULL AND (value2 IS NULL OR value2 = '' OR value1 = value2)`);
  const cls = classifyConflictNoiseRatio(total, noise);
  if (cls.fail) notify('f_conflict_noise_ratio', 'P2', 'aggregate', 'data_conflicts noise ratio too high', `${noise}/${total} (${(cls.ratio * 100).toFixed(1)}%) unresolved conflicts are noise (empty value2 or value1==value2)`);
  record('f_conflict_noise_ratio', 'unresolved data_conflicts noise ratio < 5%', cls.fail ? 'FAIL' : 'PASS', `${noise}/${total} = ${(cls.ratio * 100).toFixed(1)}%`);
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

async function main() {
  console.log(`
=== DETECTION-FLOOR AUDIT (T-335) — ${new Date().toISOString()} ===`);
  await checkA_B();
  await checkC();
  await checkD();
  await checkE();
  await checkF();
  await checkG();
  await checkH();
  checkI();
  await checkK();
  await checkL();
  await checkJ();

  const failed = results.filter((r) => r.status === 'FAIL');
  const unverifiable = results.filter((r) => r.status === 'UNVERIFIABLE');
  console.log(`
=== SUMMARY: ${results.length - failed.length - unverifiable.length} PASS, ${failed.length} FAIL, ${unverifiable.length} UNVERIFIABLE ===`);

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
  await pool.end();

  if (!GATE) { console.log('(report mode; pass --gate to exit non-zero on FAIL or UNVERIFIABLE)'); process.exit(0); }
  const code = computeExitCode({ failCount: failed.length, unverifiableCount: unverifiable.length });
  if (code === EXIT_UNVERIFIABLE) console.log(`(exit ${code}: no FAIL, but ${unverifiable.length} check(s) UNVERIFIABLE — the audit was blind, not green)`);
  process.exit(code);
}

main().catch((e) => { console.error(e); process.exit(2); });
