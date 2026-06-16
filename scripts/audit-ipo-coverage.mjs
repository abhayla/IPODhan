// READ-ONLY audit: per-section data coverage across all IPOs, plus data-quality smells.
// Usage: node scripts/audit-ipo-coverage.mjs
// Loads web/.env.local for DB creds (same discrete-param path the app uses). No writes.
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
  const byStatus = await q(
    `SELECT status, segment, count(*)::int n FROM ipos GROUP BY status, segment ORDER BY status, segment`
  );
  log(`\n=== IPO INVENTORY (total ${total}) ===`);
  for (const r of byStatus) log(`  ${String(r.status).padEnd(9)} ${String(r.segment).padEnd(9)} ${r.n}`);

  log(`\n=== SECTION COVERAGE (distinct IPOs with >=1 row) ===`);
  log(`  ${'table'.padEnd(20)} ${'cover'.padStart(6)} ${'pct'.padStart(6)}   feeds`);
  for (const [t, feeds] of Object.entries(CHILD)) {
    try {
      const [{ c }] = await q(`SELECT count(DISTINCT ipo_id)::int c FROM ${t}`);
      const pct = ((c / total) * 100).toFixed(1);
      log(`  ${t.padEnd(20)} ${String(c).padStart(6)} ${(pct + '%').padStart(6)}   ${feeds}`);
    } catch (e) {
      log(`  ${t.padEnd(20)}  ERROR  ${e.message}`);
    }
  }

  // Core ipos column null-coverage (drives the always-rendered details table)
  const coreCols = [
    'price_range_min', 'price_range_max', 'lot_size', 'issue_size', 'face_value',
    'open_date', 'close_date', 'allotment_date', 'listing_date', 'registrar',
    'sector', 'industry', 'symbol', 'logo', 'description', 'objectives',
  ];
  log(`\n=== CORE ipos COLUMN FILL-RATE (non-null %) ===`);
  for (const col of coreCols) {
    try {
      const [{ filled }] = await q(
        `SELECT count(*)::int filled FROM ipos WHERE ${col} IS NOT NULL` +
        (['objectives'].includes(col) ? ` AND ${col}::text NOT IN ('[]','null','{}')` : ``)
      );
      const pct = ((filled / total) * 100).toFixed(1);
      log(`  ${col.padEnd(18)} ${String(filled).padStart(5)} / ${total}  ${pct}%`);
    } catch (e) {
      log(`  ${col.padEnd(18)} ERROR ${e.message}`);
    }
  }

  // Coverage for OPEN+CLOSED only (these MUST have live subscription/GMP)
  log(`\n=== OPEN+CLOSED coverage (these should have subscription+GMP) ===`);
  const activeTables = ['subscriptions', 'gmp_records', 'ipo_details', 'financial_data'];
  const [{ ac }] = await q(`SELECT count(*)::int ac FROM ipos WHERE status IN ('OPEN','CLOSED')`);
  for (const t of activeTables) {
    const [{ c }] = await q(
      `SELECT count(DISTINCT i.id)::int c FROM ipos i JOIN ${t} c ON c.ipo_id=i.id WHERE i.status IN ('OPEN','CLOSED')`
    );
    log(`  ${t.padEnd(18)} ${c}/${ac}  ${((c / ac) * 100).toFixed(1)}%`);
  }

  // Data-quality smells: corrupted company names (trailing status text)
  log(`\n=== NAME-QUALITY SMELLS (trailing status artifacts) ===`);
  const smells = await q(
    `SELECT company_name, status FROM ipos
     WHERE company_name ~ '\\.?\\s+(P|CT|C|O|U|L|Ltd\\.?\\s+[A-Z]{1,2})$'
        OR company_name ~ '\\s(CT|P|O|U)$'
     ORDER BY company_name LIMIT 40`
  );
  log(`  count(matched sample, max40): ${smells.length}`);
  for (const r of smells) log(`    [${r.status}] "${r.company_name}"`);

  // Possible duplicates by normalized name
  log(`\n=== POSSIBLE DUPLICATE IPOs (same normalized name) ===`);
  const dups = await q(
    `SELECT lower(regexp_replace(company_name,'[^a-z0-9]','','gi')) k,
            count(*)::int n, array_agg(company_name) names, array_agg(status) statuses
     FROM ipos GROUP BY k HAVING count(*) > 1 ORDER BY n DESC LIMIT 25`
  );
  log(`  duplicate groups: ${dups.length}`);
  for (const r of dups) log(`    x${r.n} ${JSON.stringify(r.names)} ${JSON.stringify(r.statuses)}`);

  await pool.end();
  log(`\n=== DONE ===`);
}

main().catch((e) => { console.error(e); process.exit(1); });
