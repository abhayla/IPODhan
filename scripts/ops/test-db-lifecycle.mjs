#!/usr/bin/env node
// Ops tool: create/drop DISPOSABLE test databases for parallel implementation lanes.
// Owner approval: 2026-09-10 ~10:35 IST (ipodhan_test2 for a parallel lane, dropped by this
// tool when the lane finishes). Class: disposable test databases for parallel lanes
// (create/drop by tool, never by hand) — defect-fix-contract.md.
//
// Scope guard: refuses any --name that does not match ^ipodhan_test\d*$|^ipodhan_test_probe$,
// and refuses "ipodhan" / "ipodhan_staging" outright, so this tool can never touch a real
// database by typo.
//
// Usage (tunnel to the DB host must be open on localhost:15432, recipe
// docs/ops/prod-ops-recipes.md section 1):
//   node scripts/ops/test-db-lifecycle.mjs --name ipodhan_test2 --create            # dry run
//   node scripts/ops/test-db-lifecycle.mjs --name ipodhan_test2 --create --apply    # CREATE DATABASE, owner ipodhan_app
//   node scripts/ops/test-db-lifecycle.mjs --name ipodhan_test2 --drop              # dry run
//   node scripts/ops/test-db-lifecycle.mjs --name ipodhan_test2 --drop --apply      # terminate backends + DROP DATABASE
// Reads the superuser password from D:/Abhay/GLOBAL.env (DATABASE_PASSWORD, user DATABASE_USER=postgres).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Client } = require('pg'); // hoisted workspace dependency (root node_modules)

const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const APPLY = args.includes('--apply');
const CREATE = args.includes('--create');
const DROP = args.includes('--drop');
const name = getArg('--name');

if (!name) { console.error('usage: test-db-lifecycle.mjs --name <db> [--create|--drop] [--apply]'); process.exit(2); }
if (CREATE === DROP) { console.error('specify exactly one of --create or --drop'); process.exit(2); }

const ALLOWED = /^ipodhan_test\d*$|^ipodhan_test_probe$/;
const DENYLIST = new Set(['ipodhan', 'ipodhan_staging']);
if (DENYLIST.has(name)) { console.error(`refusing: "${name}" is a real database, never managed by this tool`); process.exit(1); }
if (!ALLOWED.test(name)) { console.error(`refusing: "${name}" does not match ${ALLOWED}`); process.exit(1); }

const env = Object.fromEntries(
  readFileSync('D:/Abhay/GLOBAL.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
);
const user = env.DATABASE_USER || 'postgres';
const password = env.DATABASE_PASSWORD;
if (!password) { console.error('DATABASE_PASSWORD missing in GLOBAL.env'); process.exit(2); }

// Maintenance connection: connect to `postgres`, never to the target db itself (you cannot
// DROP the database you are connected to).
const client = new Client({ host: 'localhost', port: 15432, user, password, database: 'postgres', options: '-c timezone=UTC' });
await client.connect();
const { rows: [{ db }] } = await client.query('select current_database() db');
if (db !== 'postgres') { console.error(`refusing: connected to ${db}, not the postgres maintenance database`); process.exit(1); }
console.log(`current_database(): ${db} (as ${user})`);

async function listTestDbs() {
  const { rows } = await client.query(
    `select datname, pg_get_userbyid(datdba) owner from pg_database
      where datname like 'ipodhan_test%' order by datname`
  );
  console.log('ipodhan_test% databases:');
  for (const r of rows) console.log(`  ${r.datname}\t${r.owner}`);
  return rows;
}

console.log('--- before ---');
await listTestDbs();

if (CREATE) {
  const { rows: exists } = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (exists.length) {
    console.log(`"${name}" already exists — nothing to create`);
  } else if (!APPLY) {
    console.log(`dry run: would CREATE DATABASE "${name}" OWNER ipodhan_app TEMPLATE template0 ENCODING 'UTF8'`);
  } else {
    await client.query(`CREATE DATABASE "${name}" OWNER ipodhan_app TEMPLATE template0 ENCODING 'UTF8'`);
    console.log(`APPLIED: created "${name}" owned by ipodhan_app`);
  }
}

if (DROP) {
  const { rows: exists } = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (!exists.length) {
    console.log(`"${name}" does not exist — nothing to drop`);
  } else if (!APPLY) {
    console.log(`dry run: would terminate backends on "${name}" then DROP DATABASE "${name}"`);
  } else {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [name]
    );
    await client.query(`DROP DATABASE "${name}"`);
    console.log(`APPLIED: dropped "${name}"`);
  }
}

console.log('--- after ---');
await listTestDbs();
await client.end();
