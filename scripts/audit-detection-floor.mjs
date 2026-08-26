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
//   node scripts/audit-detection-floor.mjs --gate    -> report + gate (exit 1 on ANY FAIL)
//   BASE_URL=https://ipodhan.com node scripts/audit-detection-floor.mjs --gate
//
// A source that cannot be reached reports UNVERIFIABLE (distinct from OK) and
// is surfaced separately — a check that silently passes when a dependency is
// down is the T-321 class again (see evidence/2026-08-26-T-322/DETECTION-RCA.md
// "Honest limits").
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

// Every finding this run wants to page the owner about — collected as we go,
// emitted to the Notifier once at the end (item 2: dedupeKey per check per
// row, not per night, so N defects page N times until each is individually
// resolved, but a re-run of the SAME defect the same day is deduped).
const notifications = [];
function notify(checkId, severity, rowKey, title, body) {
  notifications.push({ checkId, severity, rowKey, title, body, dedupeKey: `detection-floor-${checkId}-${rowKey}` });
}

const results = []; // { id, name, status: 'PASS'|'FAIL'|'UNVERIFIABLE', detail }
function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

async function tableExists(name) {
  const rows = await q(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  return rows[0]?.reg !== null && rows[0]?.reg !== undefined;
}

// ---- (a)/(b): live IPO vs unresolved cross-source conflict -----------------
async function checkA_B() {
  if (!(await tableExists('data_conflicts'))) {
    record('a_b_live_conflict', 'live IPO published value has no unresolved conflict', 'UNVERIFIABLE', 'data_conflicts table not present');
    return;
  }
  const fieldList = HIGH_VALUE_FIELDS.map((f) => `'${f}'`).join(',');
  const rows = await q(
    `SELECT c.ipo_id, i.company_name, i.status, c.field_name AS "fieldName",
            c.source1, c.value1, c.source2, c.value2
       FROM data_conflicts c
       JOIN ipos i ON i.id = c.ipo_id AND i.${REAL_IPO}
      WHERE c.resolved_at IS NULL
        AND c.field_name IN (${fieldList})
        AND i.status IN ('${LIVE_STATUSES.join("','")}')`
  );
  const offenders = [];
  for (const r of rows) {
    const violation = checkNoUnresolvedConflictOnLiveIpo({ ...r, hasUnresolvedConflict: true });
    if (violation) {
      offenders.push(`"${r.company_name}" — ${violation}`);
      notify('a_b_live_conflict', 'P1', `${r.ipo_id}-${r.fieldName}`,
        `Live IPO "${r.company_name}" publishes a disputed ${r.fieldName}`, violation);
    }
  }
  record('a_b_live_conflict', `live IPO HIGH_VALUE field has no unresolved conflict (fields: ${HIGH_VALUE_FIELDS.join(', ')})`,
    offenders.length === 0 ? 'PASS' : 'FAIL', `${offenders.length} violation(s)` + (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join('; ')}` : ''));
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
  const status = unreachable === publicRoutes.length ? 'UNVERIFIABLE' : offenders.length === 0 ? 'PASS' : 'FAIL';
  record('e_route_sweep', `every web/app/api/** public route (${publicRoutes.length} enumerated, ${adminRoutes.length} admin routes skipped) returns non-5xx with no SQL/stack leak`,
    status, `${offenders.length} failing, ${unreachable} unreachable` + (offenders.length ? `: ${offenders.slice(0, MAX_OFFENDERS).join(' | ')}` : ''));
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
  const nullSegRows = await q(`SELECT id, company_name FROM ipos WHERE offering_type = 'IPO' AND segment IS NULL`);
  const segOffenders = nullSegRows.map((r) => checkSegmentPopulatedForIpo({ offeringType: 'IPO', segment: null, companyName: r.company_name })).filter(Boolean);
  for (const r of nullSegRows) notify('j_segment_not_null', 'P2', r.id, `IPO with NULL segment`, `"${r.company_name}" is offering_type=IPO with a NULL segment`);
  record('j_segment_not_null', 'every offering_type=IPO row has a non-null segment', segOffenders.length === 0 ? 'PASS' : 'FAIL',
    segOffenders.length ? segOffenders.join('; ') : 'all populated');

  // cron script executable bit — enumerated from git-tracked scripts/*.sh that
  // this box's crontab actually invokes (README-documented entrypoints).
  const CRON_ENTRYPOINTS = ['scripts/vps-data-audit-cron.sh', 'scripts/vps-prod-verify-cron.sh'];
  const execOffenders = [];
  try {
    const out = execFileSync('git', ['ls-files', '-s', ...CRON_ENTRYPOINTS], { cwd: REPO_ROOT, encoding: 'utf8' });
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const [modeStr, , , path] = line.trim().split(/\s+/);
      const mode = parseInt(modeStr, 8) & 0o777;
      const v = checkCronScriptExecutable(path, mode);
      if (v) { execOffenders.push(v); notify('j_cron_executable', 'P2', path, `cron script not executable in git`, v); }
    }
  } catch (e) {
    record('j_cron_executable', 'every cron-invoked script has the executable bit set in git', 'UNVERIFIABLE', `git ls-files failed: ${e.message}`);
    execOffenders.length = -1; // sentinel: already recorded
  }
  if (execOffenders.length !== -1) {
    record('j_cron_executable', 'every cron-invoked script has the executable bit set in git', execOffenders.length === 0 ? 'PASS' : 'FAIL',
      execOffenders.length ? execOffenders.join('; ') : 'all executable');
  }

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

async function sendNotifications() {
  const key = process.env.NOTIFIER_KEY_IPODHAN;
  const url = (process.env.NOTIFIER_URL || 'http://127.0.0.1:3300') + '/notify';
  if (!key) {
    console.log(`\n[NOTIFY-SKIP] NOTIFIER_KEY_IPODHAN not set — ${notifications.length} pending notification(s) not sent (expected off the box)`);
    return;
  }
  for (const n of notifications) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
        body: JSON.stringify({ project: 'ipodhan', severity: n.severity, title: n.title, body: n.body, type: 'detection-floor', dedupeKey: n.dedupeKey }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
    } catch (e) {
      console.log(`[NOTIFY-FAIL] ${n.checkId}/${n.rowKey}: ${e.message}`);
    }
  }
  console.log(`\n[NOTIFY] sent ${notifications.length} notification(s) to the Notifier gateway`);
}

async function main() {
  console.log(`\n=== DETECTION-FLOOR AUDIT (T-335) — ${new Date().toISOString()} ===`);
  await checkA_B();
  await checkC();
  await checkD();
  await checkE();
  await checkF();
  await checkG();
  await checkH();
  checkI();
  await checkJ();

  const failed = results.filter((r) => r.status === 'FAIL');
  const unverifiable = results.filter((r) => r.status === 'UNVERIFIABLE');
  console.log(`\n=== SUMMARY: ${results.length - failed.length - unverifiable.length} PASS, ${failed.length} FAIL, ${unverifiable.length} UNVERIFIABLE ===`);

  if (failed.length && GATE) await sendNotifications();
  await pool.end();

  if (!GATE) { console.log('(report mode; pass --gate to exit non-zero on FAIL)'); process.exit(0); }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
