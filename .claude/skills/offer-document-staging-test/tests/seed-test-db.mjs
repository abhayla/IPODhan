#!/usr/bin/env node
// Lives under tests/ because it is test-database seeding (writes ipodhan_test only, refuses any other
// database), the same category the write ratchet exempts for test setup code.
// Copy ONE IPO's rows (its registrar and other FK parents, the ipos row, its documents rows) from
// ipodhan_staging (read only) into ipodhan_test (the laptop loop's database), then prove the copy is
// exact column by column. --reset first deletes that IPO's rows (and its receipts) from ipodhan_test.
//
// Usage (DB tunnel open; DATABASE_HOST/PORT/USER/PASSWORD set; DATABASE_NAME is ignored):
//   node seed-test-db.mjs <ipo-slug> [--reset]
// Three traps this handles (each bit on 2026-10-04): a `character` cast with no length truncates to one
// character (a sha256 became "7"); a raw Date parameter is sent in laptop-local time (timestamps moved
// 5h30); a `date` column comes back as local midnight (dates moved back a day).
import { createUtcPool, installUtcTimestampParsing } from '../../../../scripts/lib/pg-utc.mjs';
import { resolveDiscreteDbParams } from '../../../../scripts/lib/pg-connection-params.mjs';

installUtcTimestampParsing();
const slug = process.argv[2];
if (!slug || slug.startsWith('--')) throw new Error('usage: seed-test-db.mjs <ipo-slug> [--reset]');
const pool = (name) => createUtcPool({ ...resolveDiscreteDbParams({ ...process.env, DATABASE_NAME: name }), ssl: false, max: 1 });
const src = pool('ipodhan_staging');
const dst = pool('ipodhan_test');

function bind(col, v) {
  if (v === null || v === undefined) return v;
  if (col.data_type === 'jsonb' || col.data_type === 'json') return JSON.stringify(v);
  if (v instanceof Date) {
    if (col.data_type === 'date') {
      return [v.getFullYear(), String(v.getMonth() + 1).padStart(2, '0'), String(v.getDate()).padStart(2, '0')].join('-');
    }
    return v.toISOString();
  }
  return v;
}
function cast(col) {
  if (col.data_type === 'USER-DEFINED' || col.data_type === 'character') return col.udt_name;
  if (col.data_type === 'ARRAY') return `${col.udt_name.slice(1)}[]`;
  return col.data_type;
}

async function copy(table, where, params) {
  const cols = (await dst.query(
    `select column_name, data_type, udt_name from information_schema.columns
      where table_schema='public' and table_name=$1 order by ordinal_position`, [table])).rows;
  const rows = (await src.query(`select * from ${table} where ${where}`, params)).rows;
  let inserted = 0;
  for (const r of rows) {
    const use = cols.filter((c) => c.column_name in r);
    const res = await dst.query(
      `insert into ${table} (${use.map((c) => `"${c.column_name}"`).join(',')})
       values (${use.map((c, i) => `$${i + 1}::${cast(c)}`).join(',')}) on conflict do nothing`,
      use.map((c) => bind(c, r[c.column_name])));
    inserted += res.rowCount;
  }
  console.log(`${table}: source rows ${rows.length}, inserted ${inserted}`);
}

async function verify(table, where, params) {
  const q = `select * from ${table} where ${where} order by 1`;
  const a = (await src.query(q, params)).rows;
  const b = (await dst.query(q, params)).rows;
  const diff = new Set();
  const stagingOnly = new Set();
  a.forEach((r, i) => {
    for (const k of Object.keys(r)) {
      if (!b[i] || !(k in b[i])) { if (r[k] !== null) diff.add(k); else stagingOnly.add(k); continue; }
      if (JSON.stringify(r[k]) !== JSON.stringify(b[i][k])) diff.add(k);
    }
  });
  const ok = a.length === b.length && diff.size === 0;
  console.log(`verify ${table}: ${a.length} vs ${b.length} rows, ${ok ? 'identical' : 'DIFF ' + [...diff].join(',')}` +
    (stagingOnly.size ? ` (staging-only empty columns: ${[...stagingOnly].join(',')})` : ''));
  return ok;
}

try {
  if ((await dst.query('select current_database() d')).rows[0].d !== 'ipodhan_test') throw new Error('refusing: target is not ipodhan_test');
  const ipo = (await src.query('select * from ipos where slug=$1', [slug])).rows[0];
  if (!ipo) throw new Error(`no IPO with slug ${slug} on staging`);
  const fks = (await dst.query(
    `select kcu.column_name col, ccu.table_name parent, ccu.column_name pcol
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
       join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
      where tc.table_name = 'ipos' and tc.constraint_type = 'FOREIGN KEY'`)).rows;
  if (process.argv.includes('--reset')) {
    await dst.query('delete from document_field_receipts where document_id in (select id from documents where ipo_id=$1)', [ipo.id]);
    await dst.query('delete from documents where ipo_id=$1', [ipo.id]);
    await dst.query('delete from ipos where id=$1', [ipo.id]);
    console.log('reset: removed this IPO\'s documents, receipts and ipos row from ipodhan_test');
  }
  for (const fk of fks) if (ipo[fk.col] != null) await copy(fk.parent, `${fk.pcol}=$1`, [ipo[fk.col]]);
  await copy('ipos', 'id=$1', [ipo.id]);
  await copy('documents', 'ipo_id=$1', [ipo.id]);
  let ok = true;
  for (const fk of fks) if (ipo[fk.col] != null) ok = (await verify(fk.parent, `${fk.pcol}=$1`, [ipo[fk.col]])) && ok;
  ok = (await verify('ipos', 'id=$1', [ipo.id])) && ok;
  ok = (await verify('documents', 'ipo_id=$1', [ipo.id])) && ok;
  if (!ok) { console.error('ERR the copy is not exact; do not run the test on it'); process.exitCode = 1; }
} finally {
  await src.end();
  await dst.end();
}
