#!/usr/bin/env node
// One-time, owner-run: hand every object inside the EXISTING test database
// (ipodhan_test) to the app role, so the implementation loop can migrate it
// itself before each requirement's integration tests.
//
// Why: ipodhan_test is already owned by ipodhan_app, but the `drizzle`
// migrations schema (and tables created by an earlier superuser migration)
// still belong to postgres, so `drizzle-kit migrate` as ipodhan_app fails with
// 42501 "permission denied for schema drizzle" (seen 2026-09-09, PR #433).
//
// Scope guard: connects ONLY to ipodhan_test and refuses any other database
// name. Touches no production or staging object. Idempotent: re-running when
// nothing is owned by postgres changes nothing.
//
// Usage (tunnel to the DB host must be open on localhost:15432, recipe
// docs/ops/prod-ops-recipes.md section 1):
//   node scripts/ops/reassign-test-db-ownership.mjs            # dry run: lists what would move
//   node scripts/ops/reassign-test-db-ownership.mjs --apply    # performs REASSIGN OWNED BY postgres TO ipodhan_app
// Reads the superuser password from D:/Abhay/GLOBAL.env (DATABASE_PASSWORD, user DATABASE_USER=postgres).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg'); // hoisted workspace dependency (root node_modules)

const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(
  readFileSync('D:/Abhay/GLOBAL.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
);
const user = env.DATABASE_USER || 'postgres';
const password = env.DATABASE_PASSWORD;
if (!password) { console.error('DATABASE_PASSWORD missing in GLOBAL.env'); process.exit(2); }

const client = new Client({ host: 'localhost', port: 15432, user, password, database: 'ipodhan_test', options: '-c timezone=UTC' });
await client.connect();
const { rows: [{ db }] } = await client.query('select current_database() db');
if (db !== 'ipodhan_test') { console.error(`refusing: connected to ${db}, not ipodhan_test`); process.exit(1); }
console.log(`current_database(): ${db} (as ${user})`);

const before = await client.query(`
  select 'schema' kind, nspname name, pg_get_userbyid(nspowner) owner from pg_namespace
   where nspname not like 'pg\\_%' and nspname <> 'information_schema'
  union all
  select 'table', schemaname||'.'||tablename, tableowner from pg_tables where schemaname not in ('pg_catalog','information_schema')
  union all
  select 'sequence', sequence_schema||'.'||sequence_name, (select pg_get_userbyid(relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=sequence_schema and c.relname=sequence_name)
    from information_schema.sequences
  order by 1,2`);
const owned = before.rows.filter((r) => r.owner === 'postgres');
console.log(`objects owned by postgres inside ipodhan_test: ${owned.length}`);
for (const r of owned) console.log(`  ${r.kind}\t${r.name}`);

if (!APPLY) { console.log('dry run only; re-run with --apply to reassign'); await client.end(); process.exit(0); }
// REASSIGN OWNED BY postgres is refused (2BP01) because the superuser also owns the
// system catalogs; alter each listed user object explicitly instead.
const q = (ident) => ident.split('.').map((p) => '"' + p.replace(/"/g, '""') + '"').join('.');
await client.query('begin');
for (const r of owned) {
  if (r.kind === 'sequence') continue; // identity/serial sequences follow their table's owner (0A000 if altered directly)
  const kind = r.kind === 'schema' ? 'SCHEMA' : 'TABLE';
  await client.query(`alter ${kind} ${q(r.name)} owner to ipodhan_app`);
}
await client.query('commit');
const after = await client.query(`select count(*)::int n from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' and pg_get_userbyid(nspowner) = 'postgres'`);
console.log(`APPLIED. schemas still owned by postgres: ${after.rows[0].n} (expect 0)`);
await client.end();
