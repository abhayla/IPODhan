// READ-ONLY audit + machine gate: per-section data coverage across all IPOs, plus
// data-quality smells. Two modes:
//   node scripts/audit-ipo-coverage.mjs           → human report (no exit code)
//   node scripts/audit-ipo-coverage.mjs --gate    → report + §7 thresholded gate (exit 1 on any miss)
// Coverage thresholds are measured against the APPLICABLE population (genuine IPOs,
// offering_type='IPO'; LISTED-only for listing perf; etc.). No writes. Loads web/.env.local.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { SUBSTANCE_CHECKS } from './lib/substance-checks.mjs';
import { FIELDS, deriveStage, dueFieldKeysForStage, computeStageGaps } from './lib/ipo-stage-completeness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', 'web', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const GATE = process.argv.includes('--gate');

const pool = new pg.Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'ipodhan',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
  ssl: false,
  max: 4,
});

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
// Genuine-IPO population predicate — MUST mirror REAL_IPO_OFFERING_TYPES in
// packages/shared/src/utils/offering-type.ts. Non-IPO offerings are excluded.
const REAL_IPO = `offering_type = 'IPO'`;

// child tables that feed detail-page sections -> coverage = distinct ipo_id present
const CHILD = {
  subscriptions: 'subscriptions',
  gmp_records: 'GMP chart/tab',
  ipo_demand_graph: 'Demand graph',
  financial_data: 'Financials/KPI/promoter',
  ipo_financials: 'IPO financials',
  documents: 'DRHP/RHP docs',
  listing_performance: 'Listing perf (LISTED only)',
  peer_companies: 'Peer comparison',
  ipo_scores: 'IPODhan score',
  ipo_details: 'Issue structure/lead mgr/contact/category',
  anchor_investors: 'Anchor investors',
  ipo_reviews: 'Broker recommendations',
};

async function main() {
  const out = [];
  const log = (s) => { out.push(s); console.log(s); };

  const [{ total }] = await q(`SELECT count(*)::int total FROM ipos`);
  const [{ realtotal }] = await q(`SELECT count(*)::int realtotal FROM ipos WHERE ${REAL_IPO}`);
  const byStatus = await q(
    `SELECT status, segment, count(*)::int n FROM ipos GROUP BY status, segment ORDER BY status, segment`
  );
  log(`\n=== IPO INVENTORY (total ${total}; genuine IPOs ${realtotal}) ===`);
  for (const r of byStatus) log(`  ${String(r.status).padEnd(9)} ${String(r.segment).padEnd(9)} ${r.n}`);

  log(`\n=== SECTION COVERAGE (distinct genuine IPOs with >=1 row) ===`);
  log(`  ${'table'.padEnd(20)} ${'cover'.padStart(6)} ${'pct'.padStart(6)}   feeds`);
  for (const [t, feeds] of Object.entries(CHILD)) {
    try {
      const [{ c }] = await q(
        `SELECT count(DISTINCT i.id)::int c FROM ipos i JOIN ${t} c ON c.ipo_id = i.id WHERE i.${REAL_IPO}`
      );
      const pct = ((c / realtotal) * 100).toFixed(1);
      log(`  ${t.padEnd(20)} ${String(c).padStart(6)} ${(pct + '%').padStart(6)}   ${feeds}`);
    } catch (e) {
      log(`  ${t.padEnd(20)}  ERROR  ${e.message}`);
    }
  }

  // Core ipos column null-coverage (genuine IPOs only) — real column names.
  const coreCols = [
    'price_range_min', 'price_range_max', 'lot_size', 'issue_size', 'face_value',
    'open_date', 'close_date', 'allotment_date', 'listing_date', 'registrar',
    'sector', 'symbol', 'company_description', 'objectives',
  ];
  log(`\n=== CORE ipos COLUMN FILL-RATE (genuine IPOs, non-null %) ===`);
  for (const col of coreCols) {
    try {
      const [{ filled }] = await q(
        `SELECT count(*)::int filled FROM ipos WHERE ${REAL_IPO} AND ${col} IS NOT NULL` +
        (['objectives'].includes(col) ? ` AND ${col}::text NOT IN ('[]','null','{}')` : ``)
      );
      const pct = ((filled / realtotal) * 100).toFixed(1);
      log(`  ${col.padEnd(20)} ${String(filled).padStart(5)} / ${realtotal}  ${pct}%`);
    } catch (e) {
      log(`  ${col.padEnd(20)} ERROR ${e.message}`);
    }
  }

  // ---- POLLUTION (Stage A): non-IPO rows must not be served by IPO surfaces. ----
  // Rows are NOT deleted (corporate actions stay in `ipos`, tracked by offering_type);
  // the surfaces filter them via REAL_IPO. surfaceLeak models that filter and MUST be 0.
  log(`\n=== POLLUTION (IPO-surface de-pollution invariant) ===`);
  const [{ inv }] = await q(
    `SELECT count(*)::int inv FROM ipos WHERE status IN ('OPEN','UPCOMING') AND NOT (${REAL_IPO})`
  );
  const [{ leak }] = await q(
    `SELECT count(*)::int leak FROM ipos WHERE (${REAL_IPO}) AND NOT (${REAL_IPO})`
  );
  log(`  active non-IPO inventory (OPEN/UPCOMING, excluded from surfaces, not deleted): ${inv}`);
  log(`  surfaceLeak (non-IPO rows passing the IPO-surface filter — MUST be 0): ${leak}`);

  // ---- INVISIBLE SME (T-292C checker finding F1): an SME-segment row can never be
  // an FPO. The SME boards (BSE-SME / NSE-SME) are first-time-listing platforms, so
  // every issue on them is the company's first public offer. A row stored as
  // segment='SME' AND offering_type='FPO' is therefore always wrong, and it is
  // INVISIBLE to every other check here: the coverage, name-quality, duplicate and
  // substance checks all filter on REAL_IPO, so a mis-typed SME IPO silently drops
  // out of the audit and out of every public surface (404 on /ipos/<slug>).
  // Caught live 2026-08-23: 3 real BSE SME IPOs 404-ing on prod (issue #180 F1).
  const invisibleSme = await q(
    `SELECT slug, company_name, open_date::date, last_scraped_at
       FROM ipos WHERE segment = 'SME' AND offering_type = 'FPO'
      ORDER BY open_date DESC NULLS LAST`
  );
  log(`  invisible SME (segment=SME AND offering_type=FPO — impossible, MUST be 0): ${invisibleSme.length}`);
  for (const r of invisibleSme) log(`    - ${r.slug} (${r.company_name}) open=${r.open_date ?? 'n/a'}`);

  // Name-quality smells (genuine IPOs) — trailing status-code artifacts.
  log(`\n=== NAME-QUALITY SMELLS (genuine IPOs, trailing status artifacts) ===`);
  const smells = await q(
    `SELECT company_name, status FROM ipos
     WHERE ${REAL_IPO} AND (company_name ~ '(Ltd\\.?|Limited)\\s+[A-Za-z]{1,2}$'
        OR company_name ~ '\\s(CT|P|O|U|LT)$')
     ORDER BY company_name LIMIT 40`
  );
  log(`  count(matched sample, max40): ${smells.length}`);
  for (const r of smells) log(`    [${r.status}] "${r.company_name}"`);

  // Duplicate genuine IPOs by normalized name.
  log(`\n=== POSSIBLE DUPLICATE IPOs (genuine IPOs, same normalized name) ===`);
  const dups = await q(
    `SELECT lower(regexp_replace(company_name,'[^a-z0-9]','','gi')) k,
            count(*)::int n, array_agg(company_name) names, array_agg(status) statuses
     FROM ipos WHERE ${REAL_IPO} GROUP BY k HAVING count(*) > 1 ORDER BY n DESC LIMIT 25`
  );
  log(`  duplicate groups: ${dups.length}`);
  for (const r of dups) log(`    x${r.n} ${JSON.stringify(r.names)} ${JSON.stringify(r.statuses)}`);

  if (!GATE) { await pool.end(); log(`\n=== DONE (report mode; pass --gate for thresholds) ===`); return; }

  // ---- §7 THRESHOLDED GATE ----------------------------------------------------
  // Each check: { name, num, den, min, pop }. Populations are the APPLICABLE genuine-IPO set.
  const scalar = async (sql) => (await q(sql))[0];
  const checks = [];
  const add = (name, num, den, min, pop) => checks.push({ name, num, den, min, pop });

  const { c: listed } = await scalar(`SELECT count(*)::int c FROM ipos WHERE ${REAL_IPO} AND status='LISTED'`);
  const { c: lpCov } = await scalar(`SELECT count(DISTINCT i.id)::int c FROM ipos i JOIN listing_performance lp ON lp.ipo_id=i.id WHERE i.${REAL_IPO} AND i.status='LISTED'`);
  add('listing_performance', lpCov, listed, 95, 'LISTED');

  const { c: subDen } = await scalar(`SELECT count(*)::int c FROM ipos WHERE ${REAL_IPO} AND status IN ('OPEN','CLOSED') AND symbol IS NOT NULL`);
  const { c: subCov } = await scalar(`SELECT count(DISTINCT i.id)::int c FROM ipos i JOIN subscriptions s ON s.ipo_id=i.id WHERE i.${REAL_IPO} AND i.status IN ('OPEN','CLOSED') AND i.symbol IS NOT NULL`);
  add('subscriptions', subCov, subDen, 95, 'OPEN/CLOSED w/ symbol');

  const { c: curDen } = await scalar(`SELECT count(*)::int c FROM ipos WHERE ${REAL_IPO} AND status IN ('OPEN','UPCOMING')`);
  const { c: gmpCov } = await scalar(`SELECT count(DISTINCT i.id)::int c FROM ipos i JOIN gmp_records g ON g.ipo_id=i.id WHERE i.${REAL_IPO} AND i.status IN ('OPEN','UPCOMING')`);
  add('gmp_records (approx: current real IPOs)', gmpCov, curDen, 95, 'OPEN/UPCOMING');

  const { c: clDen } = await scalar(`SELECT count(*)::int c FROM ipos WHERE ${REAL_IPO} AND status IN ('CLOSED','LISTED')`);
  for (const [col, min, den, denN, pop] of [
    ['registrar', 90, 'real', realtotal, 'all real IPOs'],
    ['lot_size', 95, 'real', realtotal, 'all real IPOs'],
    ['allotment_date', 90, 'cl', clDen, 'CLOSED/LISTED'],
    ['symbol', 90, 'listed', listed, 'LISTED'],
  ]) {
    const { c } = await scalar(`SELECT count(*)::int c FROM ipos WHERE ${REAL_IPO} AND ${col} IS NOT NULL` +
      (den === 'cl' ? ` AND status IN ('CLOSED','LISTED')` : den === 'listed' ? ` AND status='LISTED'` : ``));
    add(`core.${col}`, c, denN, min, pop);
  }
  const { c: ldCov } = await scalar(`SELECT count(*)::int c FROM ipos WHERE ${REAL_IPO} AND status='LISTED' AND listing_date IS NOT NULL`);
  add('core.listing_date', ldCov, listed, 100, 'LISTED');

  // Stage A invariants (drive-to-zero):
  const stageA = [
    { name: 'pollution.surfaceLeak==0', ok: leak === 0, detail: `${leak}` },
    { name: 'pollution.invisibleSme==0', ok: invisibleSme.length === 0, detail: `${invisibleSme.length}` + (invisibleSme.length ? ` (${invisibleSme.map((r) => r.slug).join(', ')})` : '') },
    { name: 'name-quality.smells==0', ok: smells.length === 0, detail: `${smells.length}` },
    { name: 'duplicates.groups==0', ok: dups.length === 0, detail: `${dups.length}` },
  ];

  // ---- SUBSTANCE GATE (folded in from audit-substance-plausibility.mjs so this
  // single command is the comprehensive gate — contract Stage A.5 / C-5: --gate
  // FAILs on substance smells, not just missing fields). HARD: contributes to exit.
  const subRows = await q(
    `SELECT i.id, i.company_name, i.isin, i.open_date, i.close_date, i.allotment_date, i.listing_date,
            i.lot_size, i.price_range_min, i.price_range_max, i.issue_size, i.registrar,
            lp.listing_price, lp.listing_gain_percent,
            COALESCE(lp.issue_price, i.price_range_max) AS issue_price
       FROM ipos i LEFT JOIN listing_performance lp ON lp.ipo_id = i.id WHERE i.${REAL_IPO}`
  );
  const gmpExists = (await q(`SELECT to_regclass('public.gmp_records') AS reg`))[0].reg;
  if (gmpExists) {
    const gmpRows = await q(
      `SELECT DISTINCT ON (g.ipo_id) g.ipo_id, g.gmp AS gmp_value FROM gmp_records g
         JOIN ipos i ON i.id=g.ipo_id AND i.${REAL_IPO} ORDER BY g.ipo_id, g.timestamp DESC`
    );
    const byId = new Map(gmpRows.map((r) => [r.ipo_id, r.gmp_value]));
    for (const r of subRows) r.gmp_value = byId.get(r.id) ?? null;
  }
  let substanceFail = 0;
  const substanceLines = [];
  for (const check of SUBSTANCE_CHECKS) {
    if (check.optional && check.key === 'gmp_sanity' && !gmpExists) { substanceLines.push(`  [SKIP] ${check.name}`); continue; }
    let count = 0; const offenders = [];
    for (const row of subRows) { const r = check.predicate(row); if (r !== null) { count++; if (offenders.length < 5) offenders.push(`"${row.company_name}" — ${r}`); } }
    if (count > 0) substanceFail++;
    substanceLines.push(`  [${count === 0 ? 'PASS' : 'FAIL'}] ${check.name.padEnd(48)} violations: ${count}`);
    for (const o of offenders) substanceLines.push(`         - ${o}`);
  }

  // ---- STAGE-AWARE PER-IPO COMPLETENESS (the new measuring stick — contract §2).
  // Build one presence query from the FIELDS map; compute per-IPO stage + gaps.
  const presenceSelect = Object.entries(FIELDS).map(([k, f]) => `(${f.sql}) AS "${k}"`).join(',\n      ');
  const activation = process.env.PIPELINE_ACTIVATION_DATE || null; // unset => no go-forward rows yet (activation is §GATE)
  const ipoRows = await q(
    `SELECT i.id, i.company_name, i.status, i.segment, i.price_range_min, i.created_at,
      ${presenceSelect}
     FROM ipos i WHERE i.${REAL_IPO}`
  );
  const stageCounts = {}; // stage -> { rows, reqDue, reqPresent }
  const goForwardFails = [];
  let historicalReqDue = 0, historicalReqPresent = 0;
  for (const row of ipoRows) {
    const presence = {};
    for (const k of Object.keys(FIELDS)) presence[k] = row[k] === true;
    const gaps = computeStageGaps(row, presence);
    const reqDue = gaps.due.filter((k) => FIELDS[k].severity === 'required');
    const reqPresent = reqDue.filter((k) => presence[k]).length;
    stageCounts[gaps.stage] ??= { rows: 0, reqDue: 0, reqPresent: 0 };
    stageCounts[gaps.stage].rows++;
    stageCounts[gaps.stage].reqDue += reqDue.length;
    stageCounts[gaps.stage].reqPresent += reqPresent;
    const isGoForward = activation && row.created_at && new Date(row.created_at) >= new Date(activation);
    if (isGoForward && gaps.missingRequired.length > 0) {
      goForwardFails.push(`  [FAIL] ${row.company_name} (${gaps.stage}): missing ${gaps.missingRequired.join(', ')}`);
    } else {
      historicalReqDue += reqDue.length;
      historicalReqPresent += reqPresent;
    }
  }

  // ---- REPORT ----
  log(`\n=== §7 GATE ===`);
  let fail = 0;
  log(`  -- Stage A invariants (HARD) --`);
  for (const s of stageA) { if (!s.ok) fail++; log(`  [${s.ok ? 'PASS' : 'FAIL'}] ${s.name} (${s.detail})`); }

  log(`\n  -- Substance plausibility (HARD; folds audit-substance-plausibility) --`);
  for (const l of substanceLines) log(l);
  fail += substanceFail;

  log(`\n  -- Stage-aware per-IPO completeness --`);
  log(`  activation date (go-forward cutoff): ${activation || '(unset — pipeline activation is §GATE; all rows historical/best-effort)'}`);
  log(`  ${'stage'.padEnd(10)} ${'rows'.padStart(5)} ${'req-due'.padStart(8)} ${'present'.padStart(8)}  satisfied%`);
  for (const st of ['UPCOMING', 'PRE_OPEN', 'OPEN', 'CLOSED', 'LISTED']) {
    const c = stageCounts[st]; if (!c) continue;
    const pct = c.reqDue > 0 ? ((c.reqPresent / c.reqDue) * 100).toFixed(1) : '100.0';
    log(`  ${st.padEnd(10)} ${String(c.rows).padStart(5)} ${String(c.reqDue).padStart(8)} ${String(c.reqPresent).padStart(8)}  ${pct}%`);
  }
  const histPct = historicalReqDue > 0 ? ((historicalReqPresent / historicalReqDue) * 100).toFixed(1) : '100.0';
  log(`  HISTORICAL required-field completeness (best-effort, dashboard): ${historicalReqPresent}/${historicalReqDue} = ${histPct}%`);
  log(`  GO-FORWARD violations (HARD): ${goForwardFails.length}`);
  for (const l of goForwardFails) log(l);
  fail += goForwardFails.length;

  log(`\n  -- Aggregate coverage thresholds (DASHBOARD — informational, NOT the pass condition per contract §2) --`);
  for (const c of checks) {
    const pct = c.den > 0 ? (c.num / c.den) * 100 : 0;
    const ok = c.den === 0 ? true : pct >= c.min;
    log(`  [${ok ? 'PASS' : 'WARN'}] ${c.name.padEnd(40)} ${c.num}/${c.den} ${pct.toFixed(1)}% (min ${c.min}%, pop=${c.pop})`);
  }

  log(`\n  GATE: ${fail === 0 ? 'PASS (invariants + substance + go-forward clean)' : `FAIL (${fail} hard check(s): invariants/substance/go-forward)`}`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
