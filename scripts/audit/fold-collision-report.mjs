#!/usr/bin/env node
// repair-tool-exempt: 2026-09-10 read-only report over ipos.company_name, never writes
//
// Item 12 slice A (12-S3). The zero-false-merge instrument for the company-identity fold.
//
// WHY THIS EXISTS. Two names folding to the same key are treated as the SAME
// COMPANY by the duplicate-row repair class, which deletes one of the rows. So a
// fold that errs wide destroys real data. A unit test proves the fold on names
// someone thought of; only a run over every real company name proves it on the
// names that actually exist.
//
// WHAT IT DOES. Reads `ipos.company_name` from the named databases, folds each
// name, and prints every group where MORE THAN ONE DISTINCT name folds together
// — BY NAME, never as a count (signal-ownership R1: a count is not a reading).
// Each printed group is a claim that those names are one company; a reviewer
// confirms or rejects each one. Groups of one are silent: they are the norm.
//
// This slice does not CHANGE the fold — it extracts it to one module — so this
// run establishes the BASELINE that a later fold change is diffed against.
//
// READ-ONLY BY CONSTRUCTION: every connection sets default_transaction_read_only
// and the script proves it before running a query. It never writes, and it takes
// discrete DATABASE_* parts, never a DATABASE_URL.
//
// Usage:
//   node scripts/audit/fold-collision-report.mjs                 # every configured db
//   node scripts/audit/fold-collision-report.mjs --db ipodhan    # one db
//   node scripts/audit/fold-collision-report.mjs --json          # machine-readable

import pg from 'pg';

// A bare `date` must come back as the 'YYYY-MM-DD' string the server sent. node-pg's
// default parser builds a Date at LOCAL midnight, which on an IST machine prints the
// day BEFORE the real one (F-104). 1082 is the `date` OID.
pg.types.setTypeParser(1082, (v) => v);
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = join(__dirname, '..', '..', 'packages', 'shared', 'src', 'utils', 'company-identity-fold.ts');

const { foldCompanyIdentity } = await import(pathToFileURL(ssotPath).href);
if (typeof foldCompanyIdentity !== 'function') {
  console.error('FATAL: could not load foldCompanyIdentity from the SSOT — refusing to report against a guessed fold.');
  process.exit(2);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dbArgIndex = args.indexOf('--db');
const explicitDb = dbArgIndex !== -1 ? args[dbArgIndex + 1] : null;
const DATABASES = explicitDb ? [explicitDb] : ['ipodhan', 'ipodhan_staging'];

function poolFor(database) {
  const host = process.env.DATABASE_HOST ?? 'localhost';
  const port = Number(process.env.DATABASE_PORT ?? 15432);
  const user = process.env.DATABASE_USER ?? 'ipodhan_app';
  const password = process.env.DATABASE_PASSWORD;
  if (!password) {
    console.error('FATAL: DATABASE_PASSWORD is not set. Export it inline for this command; never write it to a file.');
    process.exit(2);
  }
  return new pg.Pool({
    host, port, user, password, database, max: 2,
    options: '-c timezone=UTC -c default_transaction_read_only=on',
    statement_timeout: 60_000,
  });
}

const report = [];

for (const database of DATABASES) {
  const pool = poolFor(database);
  try {
    const c = await pool.connect();
    try {
      const { rows: ro } = await c.query('show transaction_read_only');
      if (ro[0]?.transaction_read_only !== 'on') {
        console.error(`FATAL: ${database} connection is not read-only — refusing to run.`);
        process.exit(2);
      }
    } finally { c.release(); }

    const { rows } = await pool.query(
      `SELECT id, slug, company_name, status, open_date FROM ipos WHERE company_name IS NOT NULL`,
    );

    const groups = new Map();
    for (const r of rows) {
      const key = foldCompanyIdentity(r.company_name);
      if (!key) continue; // a nameless row is a different defect, not a fold collision
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    const collisions = [];
    for (const [key, members] of groups) {
      const distinctNames = [...new Set(members.map((m) => m.company_name))];
      if (distinctNames.length < 2) continue; // same name twice is a duplicate row, not a fold question
      collisions.push({
        key,
        names: distinctNames,
        rows: members.map((m) => ({ slug: m.slug, status: m.status, openDate: m.open_date, name: m.company_name })),
      });
    }
    collisions.sort((a, b) => b.names.length - a.names.length || a.key.localeCompare(b.key));
    report.push({ database, totalRows: rows.length, distinctFolds: groups.size, collisionGroups: collisions });
  } finally {
    await pool.end();
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of report) {
    console.log(`\n=== ${r.database}: ${r.totalRows} named rows, ${r.distinctFolds} distinct identities`);
    if (!r.collisionGroups.length) {
      console.log('  no fold group contains more than one distinct name.');
      continue;
    }
    console.log(`  ${r.collisionGroups.length} fold group(s) contain more than one distinct name.`);
    console.log('  Each group below is a CLAIM that these names are one company. Confirm or reject each.\n');
    for (const g of r.collisionGroups) {
      console.log(`  [${g.key}]`);
      for (const row of g.rows) {
        console.log(`     ${String(row.status).padEnd(9)} ${String(row.openDate ?? '-').padEnd(12)} ${row.name}   (${row.slug})`);
      }
      console.log('');
    }
  }
}
