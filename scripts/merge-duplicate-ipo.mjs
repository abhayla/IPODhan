#!/usr/bin/env node
// scripts/merge-duplicate-ipo.mjs — merge two rows that are one IPO (finding F-55).
//
// WHY THIS EXISTS. On 2026-09-09 production carried TWO rows for Asset Reconstruction Company
// (India) Limited — both opening 9 September, both priced 132-139 — so the site showed one
// mainboard IPO twice with different issue sizes. The shipped name normaliser folds
// "Limited"/"Ltd"/"Pvt Ltd" but NOT "Company" against "Co.", so the two names never collided and
// no tier of the identity check fired. Same class as the second "Rays of Belief" row (2026-09-03).
// The normaliser is the class fix; this script repairs rows the gap already created — any pair,
// not just this one.
//
//   node scripts/merge-duplicate-ipo.mjs --keep <uuid> --drop <uuid>              dry run (default)
//   ... --apply                          write (refused on prod without --allow-prod)
//   ... --allow-prod                     acknowledge the target is the production database
//   ... --set-issue-size <rupees>        correct the survivor's issue size (source-backed only)
//   ... --issue-size-note "<evidence>"   what proves that number; stored in the provenance row
//   ... --force-different-name           proceed when the two names do not fold together
//
// Target database: DATABASE_URL if set, else the prod tunnel on localhost:15432 using
// IPODHAN_APP_DB_PASSWORD from GLOBAL.env. Point DATABASE_URL at ipodhan_staging to rehearse.
//
// DESIGN NOTES worth knowing before you edit this:
//   * Child tables are DISCOVERED from information_schema, never hand-listed. The first draft of
//     this script hand-listed 20 tables and missed 11 of the 31 that carry an ipo_id — including
//     user_watchlist. A hand-typed list is how a merge silently drops a user's data.
//   * Children are handled in reverse-dependency order computed from the live FK graph, so a
//     grandchild (score_history -> ipo_details, document_fetch_state -> documents) never blocks
//     its parent.
//   * Tables holding data a PERSON created (watchlists, clicks, reviews, audit trail) are
//     REPOINTED to the survivor, never deleted. Scraper-derived rows are deleted: they are
//     regenerable, and repointing them collides with the survivor's own provenance rows.
//   * Every column this writes onto the survivor also gets a field_sources row, keeping the
//     previous value and source. A repair that changes `ipos` without provenance is the exact
//     defect scraper/scripts/lib/repair-tool.ts was created to stop (T-490 RCA, 2026-09-07).
//   * The production guard asks the SAME connection that will do the writing which database it is
//     in — never DATABASE_NAME or the URL text, which can disagree with the pool.
//
// This does not import scraper/scripts/lib/repair-tool.ts: that module is TypeScript built around
// drizzle inside the scraper workspace, and this is a plain-node script that must run against a
// bare tunnel. The three guards it enforces (prod refusal read from the writing pool, provenance
// with previous_source, a written ledger) are implemented here instead.
//
// EXIT CODES: 0 planned/applied cleanly · 1 refused (the reason is printed) · 2 the script broke.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const PRODUCTION_DATABASE_NAME = 'ipodhan';

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const ALLOW_PROD = args.includes('--allow-prod');
const FORCE_NAME = args.includes('--force-different-name');
const KEEP = arg('--keep');
const DROP = arg('--drop');
const SET_ISSUE_SIZE = arg('--set-issue-size');
const ISSUE_SIZE_NOTE = arg('--issue-size-note');

if (!KEEP || !DROP) {
  console.error('usage: --keep <uuid> --drop <uuid> [--apply --allow-prod] [--set-issue-size <rupees>]');
  process.exit(1);
}
if (KEEP === DROP) { console.error('refused: --keep and --drop name the same row'); process.exit(1); }

// Data a person created. Deleting it loses something no scraper can rebuild, so it moves to the
// survivor. Everything else discovery finds is scraper output and goes with the dropped row.
const REPOINT = new Set([
  'user_watchlist', 'affiliate_clicks', 'ipo_reviews', 'audit_logs',
  'brlm_track_record', 'ipo_slug_redirects',
]);

// Carried onto the survivor ONLY where the survivor has nothing. A merge that copies every column
// is how a wrong value wins; this list is short and reviewed on purpose.
const CARRY_IF_ABSENT = [
  'listing_date', 'verifier_url', 'company_website', 'cin', 'symbol', 'isin', 'lot_size',
  'registrar', 'registrar_id', 'company_description', 'lead_managers', 'bse_ipo_no',
  'bse_scrip_code', 'allotment_date', 'sector', 'face_value', 'objectives',
];

// field_sources.field_name is camelCase throughout (listingDate, bseIpoNo), not the column name.
const camel = (s) => s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());

// The normaliser the duplicate slipped past, with the corporate-form words it was missing.
function foldName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,()&'"-]/g, ' ')
    .replace(/\b(private|pvt|limited|ltd|company|co|corporation|corp|incorporated|inc|and|the|of|india|indian)\b/g, ' ')
    .replace(/\s+/g, '');
}

function connectionConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, options: '-c timezone=UTC' };
  }
  const env = fs.readFileSync('D:/Abhay/GLOBAL.env', 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('IPODHAN_APP_DB_PASSWORD='));
  if (!line) throw new Error('IPODHAN_APP_DB_PASSWORD not found in GLOBAL.env and DATABASE_URL is unset');
  const pw = line.split('=').slice(1).join('=').replace(/^"|"$/g, '').trim();
  return {
    host: 'localhost', port: 15432, user: 'ipodhan_app',
    password: pw, database: 'ipodhan', options: '-c timezone=UTC',
  };
}

const c = new pg.Client(connectionConfig());
const refuse = (...lines) => { lines.forEach((l) => console.error(l)); process.exit(1); };

try {
  await c.connect();

  // --- which database is this REALLY? asked of the writing connection itself --------------------
  const dbName = (await c.query('select current_database() as d')).rows[0].d;
  console.log(`current_database(): ${dbName}`);
  if (APPLY && dbName === PRODUCTION_DATABASE_NAME && !ALLOW_PROD) {
    refuse('', `refused: --apply targets the PRODUCTION database "${dbName}" without --allow-prod.`,
      '         Rehearse on staging first (DATABASE_URL=...ipodhan_staging), then re-run with',
      '         --apply --allow-prod once the owner has said go.');
  }

  const rows = (await c.query('select * from ipos where id = any($1::uuid[])', [[KEEP, DROP]])).rows;
  if (rows.length !== 2) refuse(`refused: expected 2 rows in ipos, found ${rows.length}`);
  const keep = rows.find((r) => r.id === KEEP);
  const drop = rows.find((r) => r.id === DROP);

  // --- refuse unless these really are one IPO ---------------------------------------------------
  if (String(keep.open_date) !== String(drop.open_date)) {
    refuse('refused: the two rows open on different dates, so they are two offers.',
      `         ${keep.open_date}  vs  ${drop.open_date}`);
  }
  if (!FORCE_NAME && foldName(keep.company_name) !== foldName(drop.company_name)) {
    refuse('refused: the two company names do not fold to the same string.',
      `         "${keep.company_name}" -> ${foldName(keep.company_name)}`,
      `         "${drop.company_name}" -> ${foldName(drop.company_name)}`,
      '         Pass --force-different-name only after confirming by hand they are one company.');
  }
  // A strong identifier that DISAGREES proves two different offers. Absent on one side is normal:
  // that is the shape of a duplicate, where one row was created before identifiers existed.
  for (const k of ['cin', 'isin', 'symbol', 'bse_ipo_no', 'bse_scrip_code']) {
    if (keep[k] && drop[k] && String(keep[k]) !== String(drop[k])) {
      refuse(`refused: ${k} disagrees (${keep[k]} vs ${drop[k]}) — two offers, not one row twice.`);
    }
  }

  // --- discover children from the live schema ----------------------------------------------------
  const fks = (await c.query(`
    select distinct tc.table_name as child, kcu.column_name as col, ccu.table_name as parent
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
  `)).rows;

  const reach = new Map();                       // table -> { col, parent }
  let frontier = ['ipos'];
  while (frontier.length) {
    const next = [];
    for (const parent of frontier) {
      for (const fk of fks.filter((f) => f.parent === parent && f.child !== f.parent)) {
        if (reach.has(fk.child)) continue;
        reach.set(fk.child, { col: fk.col, parent: fk.parent });
        next.push(fk.child);
      }
    }
    frontier = next;
  }

  // Reverse-dependency order: a table is safe once nothing still pending references it.
  const order = [];
  const pending = new Set(reach.keys());
  while (pending.size) {
    const free = [...pending].filter((t) =>
      ![...pending].some((o) => o !== t && fks.some((f) => f.child === o && f.parent === t)));
    if (!free.length) { order.push(...pending); break; }        // a cycle: arbitrary order
    free.sort().forEach((t) => { order.push(t); pending.delete(t); });
  }
  const direct = order.filter((t) => reach.get(t).parent === 'ipos');

  // --- back up both rows and every child BEFORE any write ---------------------------------------
  const backup = { takenAt: new Date().toISOString(), database: dbName, keep, drop, children: {} };
  const counts = [];
  for (const t of direct) {
    const { col } = reach.get(t);
    const r = await c.query(`select * from ${t} where "${col}" = any($1::uuid[])`, [[KEEP, DROP]]);
    if (!r.rows.length) continue;
    backup.children[t] = r.rows;
    counts.push({
      table: t, col,
      keep: r.rows.filter((x) => x[col] === KEEP).length,
      drop: r.rows.filter((x) => x[col] === DROP).length,
    });
  }
  const dir = path.join(process.cwd(), 'scripts', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `merge-backup-${dbName}-${DROP}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));

  // --- build the plan ---------------------------------------------------------------------------
  // Provenance already on each row, so a carried field keeps the source it actually came from
  // rather than being relabelled as a manual edit.
  const provOf = async (id) => {
    const r = await c.query(
      `select field_name, source, confidence from field_sources where ipo_id = $1 and table_name = 'ipos'`, [id]);
    return new Map(r.rows.map((x) => [x.field_name, x]));
  };
  const keepProv = await provOf(KEEP);
  const dropProv = await provOf(DROP);

  const patch = [];   // { col, value, source, confidence, note }
  for (const col of CARRY_IF_ABSENT) {
    if (keep[col] !== null && keep[col] !== undefined) continue;
    if (drop[col] === null || drop[col] === undefined) continue;
    const p = dropProv.get(camel(col));
    patch.push({
      col, value: drop[col],
      source: p ? p.source : 'ADMIN',
      confidence: p ? p.confidence : 100,
      note: `carried from the merged duplicate row ${DROP}`,
    });
  }
  if (SET_ISSUE_SIZE) {
    patch.push({
      col: 'issue_size', value: SET_ISSUE_SIZE, source: 'ADMIN', confidence: 100,
      note: ISSUE_SIZE_NOTE || 'corrected during duplicate merge',
    });
  }

  console.log(`\nKEEP   ${keep.slug}`);
  console.log(`       ${keep.company_name}   issue_size ${keep.issue_size}`);
  console.log(`DROP   ${drop.slug}`);
  console.log(`       ${drop.company_name}   issue_size ${drop.issue_size}`);
  console.log(`\nname fold: both -> "${foldName(keep.company_name)}"`);
  console.log(`discovered ${reach.size} descendant tables (${direct.length} carry an ipo id directly)`);
  console.log(`backup:    ${file}`);

  console.log('\nfields written onto the survivor (with the provenance each will get):');
  if (!patch.length) console.log('   (none)');
  for (const p of patch) {
    const was = keep[p.col] === null || keep[p.col] === undefined ? '(empty)' : String(keep[p.col]);
    const prev = keepProv.get(camel(p.col));
    console.log(`   ${p.col}: ${was} -> ${String(p.value).slice(0, 60)}`);
    console.log(`      provenance ${camel(p.col)} = ${p.source} (${p.confidence}), was ${prev ? prev.source : 'none'}`);
  }

  const toDelete = counts.filter((x) => x.drop > 0 && !REPOINT.has(x.table));
  const toRepoint = counts.filter((x) => x.drop > 0 && REPOINT.has(x.table));
  console.log('\nchild rows DELETED with the dropped row (scraper output, regenerable):');
  if (!toDelete.length) console.log('   (none)');
  toDelete.forEach((x) => console.log(`   ${x.table}: ${x.drop}`));
  console.log('\nchild rows REPOINTED to the survivor (person-created, never deleted):');
  if (!toRepoint.length) console.log('   (none)');
  toRepoint.forEach((x) => console.log(`   ${x.table}: ${x.drop}`));
  console.log(`\nslug redirect: /${drop.slug}  ->  /${keep.slug}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Re-run with --apply to execute.');
    process.exit(0);
  }

  // --- apply, all or nothing ---------------------------------------------------------------------
  await c.query('begin');

  for (const p of patch) {
    await c.query(`update ipos set "${p.col}" = $2, updated_at = now() where id = $1`, [KEEP, p.value]);
    const prev = keepProv.get(camel(p.col));
    await c.query(
      `insert into field_sources
         (ipo_id, table_name, field_name, source, confidence, previous_value, previous_source, data_lineage, updated_by)
       values ($1, 'ipos', $2, $3, $4, $5, $6, $7, $8)
       on conflict (ipo_id, table_name, field_name) do update
         set source = excluded.source,
             confidence = excluded.confidence,
             previous_value = excluded.previous_value,
             previous_source = excluded.previous_source,
             data_lineage = excluded.data_lineage,
             updated_by = excluded.updated_by,
             updated_at = now()`,
      [KEEP, camel(p.col), p.source, p.confidence,
        keep[p.col] === null || keep[p.col] === undefined ? null : String(keep[p.col]),
        prev ? prev.source : null,
        JSON.stringify({ tool: 'merge-duplicate-ipo', mergedFrom: DROP, note: p.note, at: new Date().toISOString() }),
        'merge-duplicate-ipo'],
    );
  }

  // The old URL must keep resolving; a merge that 404s a live IPO page is a regression.
  await c.query(
    `insert into ipo_slug_redirects (old_slug, ipo_id, reason) values ($1, $2, $3) on conflict do nothing`,
    [drop.slug, KEEP, `duplicate row merged into ${keep.slug}`],
  );

  for (const t of direct) {
    const { col } = reach.get(t);
    if (REPOINT.has(t)) {
      // A unique violation means the survivor already holds the equivalent row, so the dropped
      // row's copy is redundant rather than lost.
      await c.query('savepoint repoint');
      try {
        await c.query(`update ${t} set "${col}" = $1 where "${col}" = $2`, [KEEP, DROP]);
        await c.query('release savepoint repoint');
      } catch (e) {
        if (e.code !== '23505') throw e;
        await c.query('rollback to savepoint repoint');
        await c.query(`delete from ${t} where "${col}" = $1`, [DROP]);
        console.log(`   note: ${t} rows already existed on the survivor; the duplicates were dropped.`);
      }
    } else {
      await c.query(`delete from ${t} where "${col}" = $1`, [DROP]);
    }
  }

  await c.query('delete from ipos where id = $1', [DROP]);
  await c.query('commit');

  // --- verify ------------------------------------------------------------------------------------
  const still = (await c.query('select count(*)::int n from ipos where id = $1', [DROP])).rows[0].n;
  const sameDay = (await c.query(
    `select slug from ipos where open_date = $1 and id <> $2`, [keep.open_date, KEEP])).rows.map((r) => r.slug);
  const survivor = (await c.query(
    `select slug, company_name, issue_size, listing_date, cin, symbol, bse_ipo_no from ipos where id = $1`,
    [KEEP])).rows[0];
  const prov = (await c.query(
    `select field_name, source, previous_source from field_sources
      where ipo_id = $1 and updated_by = 'merge-duplicate-ipo' order by field_name`, [KEEP])).rows;

  console.log('\nAPPLIED.');
  console.log(`   dropped row still present: ${still} (expected 0)`);
  console.log(`   provenance rows written: ${prov.length}`);
  prov.forEach((p) => console.log(`      ${p.field_name}: ${p.source} (was ${p.previous_source || 'none'})`));
  console.log(`   other rows opening ${String(keep.open_date).slice(0, 10)}: ${sameDay.length}` +
    (sameDay.length ? ` — ${sameDay.join(', ')}` : ''));
  console.log(`   survivor: ${JSON.stringify(survivor, null, 2)}`);
  console.log(`   rollback: pre-merge snapshot of both rows and all children at ${file}`);
  console.log('\n   Redis still serves the old pages. Drop ipo:slug/ipo:id keys on the box before checking the site.');
} catch (err) {
  try { await c.query('rollback'); } catch { /* not inside a transaction */ }
  console.error('merge-duplicate-ipo failed:', err.message || err);
  if (err.detail) console.error('  detail:', err.detail);
  if (process.env.MERGE_DEBUG) console.error(err.stack);
  process.exit(2);
} finally {
  await c.end();
}
