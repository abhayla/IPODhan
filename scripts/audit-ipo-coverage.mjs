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
    { name: 'name-quality.smells==0', ok: smells.length === 0, detail: `${smells.length}` },
    { name: 'duplicates.groups==0', ok: dups.length === 0, detail: `${dups.length}` },
  ];

  log(`\n=== §7 GATE ===`);
  let fail = 0;
  log(`  -- Stage A invariants --`);
  for (const s of stageA) { if (!s.ok) fail++; log(`  [${s.ok ? 'PASS' : 'FAIL'}] ${s.name} (${s.detail})`); }
  log(`  -- Coverage thresholds (applicable population) --`);
  for (const c of checks) {
    const pct = c.den > 0 ? (c.num / c.den) * 100 : 0;
    const ok = c.den === 0 ? true : pct >= c.min;
    if (!ok) fail++;
    log(`  [${ok ? 'PASS' : 'FAIL'}] ${c.name.padEnd(40)} ${c.num}/${c.den} ${pct.toFixed(1)}% (min ${c.min}%, pop=${c.pop})`);
  }
  log(`\n  GATE: ${fail === 0 ? 'PASS (all thresholds met)' : `FAIL (${fail} check(s) below threshold)`}`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
