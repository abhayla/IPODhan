// READ-ONLY substance-plausibility audit + machine gate: per-check domain-sanity of
// genuine IPO values (NOT populated-ness — that is audit-ipo-coverage.mjs's job).
// This is the machine-checkable companion mandated by
// .claude/rules/output-plausibility-verification.md — it catches "wrong-but-working"
// values (#41 absurd allotment dates, #42 name smells) that coverage's shape checks miss.
//
// Two modes:
//   node scripts/audit-substance-plausibility.mjs           → human report (no exit code)
//   node scripts/audit-substance-plausibility.mjs --gate    → report + gate (exit 1 if ANY check has a violation)
//
// SELECT-only. No writes. Loads web/.env.local for the tunnel connection (localhost:15432).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { SUBSTANCE_CHECKS } from './lib/substance-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', 'web', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const GATE = process.argv.includes('--gate');
const MAX_OFFENDERS = 5;

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
// Genuine-IPO population predicate — mirrors REAL_IPO in audit-ipo-coverage.mjs.
const REAL_IPO = `offering_type = 'IPO'`;

// Does a table exist in the public schema? Used to gate the optional GMP check.
async function tableExists(name) {
  const rows = await q(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  return rows[0]?.reg !== null && rows[0]?.reg !== undefined;
}

async function main() {
  const out = [];
  const log = (s) => { out.push(s); console.log(s); };

  const [{ realtotal }] = await q(`SELECT count(*)::int realtotal FROM ipos WHERE ${REAL_IPO}`);
  log(`\n=== SUBSTANCE-PLAUSIBILITY AUDIT (genuine IPOs: ${realtotal}) ===`);
  log(`  Read-only. Judges value SANITY, not populated-ness (see audit-ipo-coverage.mjs for coverage).`);

  // Pull every genuine IPO joined to its one-to-one listing_performance row.
  // listing_performance.issue_price is the authoritative per-share issue price;
  // price_range_max is the fallback proxy for the GMP-premium denominator.
  const rows = await q(
    `SELECT i.id, i.company_name, i.isin,
            i.open_date, i.close_date, i.allotment_date, i.listing_date,
            i.lot_size, i.price_range_min, i.price_range_max, i.issue_size,
            lp.listing_price, lp.listing_gain_percent,
            COALESCE(lp.issue_price, i.price_range_max) AS issue_price
       FROM ipos i
       LEFT JOIN listing_performance lp ON lp.ipo_id = i.id
      WHERE i.${REAL_IPO}`
  );

  // Attach the latest GMP value per IPO (only if the table exists).
  const hasGmp = await tableExists('gmp_records');
  const latestGmpByIpo = new Map();
  if (hasGmp) {
    const gmpRows = await q(
      `SELECT DISTINCT ON (g.ipo_id) g.ipo_id, g.gmp AS gmp_value
         FROM gmp_records g
         JOIN ipos i ON i.id = g.ipo_id AND i.${REAL_IPO}
        ORDER BY g.ipo_id, g.timestamp DESC`
    );
    for (const r of gmpRows) latestGmpByIpo.set(r.ipo_id, r.gmp_value);
    log(`  gmp_records table present — latest GMP attached for ${gmpRows.length} IPOs.`);
  } else {
    log(`  gmp_records table NOT present — GMP sanity check SKIPPED gracefully.`);
  }
  for (const row of rows) {
    row.gmp_value = latestGmpByIpo.has(row.id) ? latestGmpByIpo.get(row.id) : null;
  }

  // Run each pure predicate across all rows; collect counts + up to MAX_OFFENDERS names.
  log(`\n=== PER-CHECK RESULTS ===`);
  let totalViolations = 0;
  const failedChecks = [];
  for (const check of SUBSTANCE_CHECKS) {
    if (check.optional && check.key === 'gmp_sanity' && !hasGmp) {
      log(`  [SKIP] ${check.name.padEnd(48)} (gmp_records absent)`);
      continue;
    }
    let count = 0;
    const offenders = [];
    for (const row of rows) {
      const reason = check.predicate(row);
      if (reason !== null) {
        count++;
        if (offenders.length < MAX_OFFENDERS) {
          offenders.push(`"${row.company_name}" — ${reason}`);
        }
      }
    }
    totalViolations += count;
    if (count > 0) failedChecks.push(check.name);
    const flag = count === 0 ? 'PASS' : 'FAIL';
    log(`  [${flag}] ${check.name.padEnd(48)} violations: ${count}`);
    for (const o of offenders) log(`         - ${o}`);
  }

  if (!GATE) {
    await pool.end();
    log(`\n=== DONE (report mode; pass --gate for a thresholded exit code) ===`);
    log(`  total violations across all checks: ${totalViolations}`);
    return;
  }

  log(`\n=== GATE ===`);
  const fail = failedChecks.length;
  log(`  total violations: ${totalViolations} across ${fail} failing check(s)`);
  log(`  GATE: ${fail === 0 ? 'PASS (all substance checks clean)' : `FAIL (${fail} check(s) with violations: ${failedChecks.join(', ')})`}`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
