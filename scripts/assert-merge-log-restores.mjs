#!/usr/bin/env node
// scripts/assert-merge-log-restores.mjs — item 19 / #807: the real-data proof that a
// merge can be undone.
//
// WHY THIS IS COMMITTED AND NOT A SCRATCH FILE. The unit tests for the merge log drive
// a FAKE db, and a fake can be wrong in the same direction as the code: the fake
// identifies the merge-log insert by its PAYLOAD (`'dropRow' in values`), so a renamed
// column, a jsonb serialisation problem or a NOT NULL violation would still pass all of
// them. The only check that can catch that class is a real merge against real Postgres
// with the row read back — and the PR #888 review pointed out that if that script is
// gitignored, it cannot run in CI, cannot be re-run by a reviewer, and cannot be re-run
// by the next person who changes this code. So it lives here.
//
// WHAT IT PROVES. A merge is irreversible without this log: `mergeDuplicateInto` deletes
// the dropped `ipos` row and nothing else keeps its columns (`ipo_slug_redirects` keeps
// only the slug; `field_sources` records only columns the survivor TOOK). This script
// plants two rows, merges them through the REAL repository, and reconstructs the deleted
// row from the log alone, column by column.
//
// WHAT IT DOES NOT PROVE. The snapshot covers every column `schema.ts` DECLARES, not
// every column the live table has. Measured 2026-09-22: ipodhan_staging carries six
// undeclared columns (price_band_low, price_band_high, exchange, gmp, gmp_percentage,
// gmp_updated_at), all 0/379 non-null; ipodhan_test carries `category`. Those are listed
// in UNDECLARED_IN_SCHEMA below and reported, not silently tolerated — if a column leaves
// that list, or an undeclared column becomes non-null, this script says so.
//
// WRITES. It INSERTs two rows, merges them, and deletes everything it created. It
// REFUSES to run against a database whose name is not explicitly allowed, so it can
// never be pointed at production by accident.
//
// Usage:
//   DATABASE_URL=postgresql://…/ipodhan_test node scripts/assert-merge-log-restores.mjs
//   node scripts/assert-merge-log-restores.mjs --allow-db ipodhan_staging
//
// Exit: 0 every check passed · 1 a check failed · 2 refused (wrong database, no creds).

import { randomUUID } from 'node:crypto';
import { createUtcPool, installUtcTimestampParsing } from './lib/pg-utc.mjs';

// Only ever these, unless --allow-db names another. `ipodhan` (production) is NOT here
// and must never be added: this script writes.
const DEFAULT_ALLOWED_DBS = ['ipodhan_test', 'ipodhan_staging'];

// Columns present in a live `ipos` table that packages/shared/src/db/schema.ts does not
// declare, so the ORM-driven snapshot cannot carry them. Measured, not guessed.
const UNDECLARED_IN_SCHEMA = new Set([
  'category',
  'price_band_low',
  'price_band_high',
  'exchange',
  'gmp',
  'gmp_percentage',
  'gmp_updated_at',
]);

function parseArgs(argv) {
  const args = { allowDb: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow-db') args.allowDb = argv[++i];
  }
  return args;
}

function buildPool() {
  return createUtcPool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan_test',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          ssl: false,
          max: 3,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 3 }
  );
}

let failed = false;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed = true;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
    console.error('refused: set DATABASE_URL (or DATABASE_HOST + DATABASE_PASSWORD) first.');
    return 2;
  }

  const pool = buildPool();
  installUtcTimestampParsing();

  const allowed = new Set(args.allowDb ? [args.allowDb] : DEFAULT_ALLOWED_DBS);
  const dbName = (await pool.query('SELECT current_database() AS d')).rows[0].d;
  if (!allowed.has(dbName)) {
    console.error(
      `refused: this script WRITES, and "${dbName}" is not in the allow-list ` +
        `[${[...allowed].join(', ')}]. Pass --allow-db to widen it deliberately.`
    );
    await pool.end();
    return 2;
  }
  console.log(`database: ${dbName}\n`);

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const schema = await import('@ipodhan/shared/db/schema');
  const { IPORepository } = await import('@ipodhan/shared/repositories/ipo-repository');
  const db = drizzle(pool, { schema });
  const noRedis = { get: async () => null, set: async () => undefined, del: async () => 0, keys: async () => [] };

  const KEEP = randomUUID();
  const DROP = randomUUID();
  const stamp = Date.now();
  const keepSlug = `merge-log-proof-keep-${stamp}`;
  const dropSlug = `merge-log-proof-drop-${stamp}`;

  const repo = new IPORepository(db, noRedis);

  try {
    // Two rows a merge would legitimately fold together. `face_value` and `symbol` are set
    // on the DROPPED row only, so they exist nowhere but the snapshot after the merge.
    //
    // Planted through `IPORepository.create`, NOT raw SQL. The write ratchet (T-316) refuses
    // a new file that writes `ipos` directly, and it is right to: this script is the one
    // place that would otherwise prove the log works while bypassing the write path the log
    // is supposed to sit inside. Going through the repository also means the planted rows
    // are shaped the way real rows are.
    await repo.create({
      id: KEEP, companyName: 'Merge Log Proof Ltd', slug: keepSlug,
      status: 'UPCOMING', segment: 'MAINBOARD',
    });
    await repo.create({
      id: DROP, companyName: 'Merge Log Proof Limited', slug: dropSlug,
      status: 'UPCOMING', segment: 'MAINBOARD',
      faceValue: 10, symbol: `MLP${stamp % 100000}`,
    });
    const before = (await pool.query('SELECT * FROM ipos WHERE id = $1', [DROP])).rows[0];
    console.log(`planted: keep=${keepSlug} drop=${dropSlug}`);
    console.log(`dropped row before merge: face_value=${before.face_value} symbol=${before.symbol}\n`);

    const result = await repo.mergeDuplicateInto(KEEP, DROP, {
      apply: true,
      forceDifferentName: true,
      mergedBy: 'assert-merge-log-restores.mjs',
    });
    console.log(`merge applied=${result.applied}\n`);

    const gone = await pool.query('SELECT id FROM ipos WHERE id = $1', [DROP]);
    check('the dropped ipos row is DELETED (so the log is the only record)', gone.rows.length === 0);

    const logs = await pool.query('SELECT * FROM ipo_merge_log WHERE drop_ipo_id = $1', [DROP]);
    check('exactly one merge-log row was written', logs.rows.length === 1, `got ${logs.rows.length}`);
    if (logs.rows.length !== 1) throw new Error('no log row — nothing further to prove');
    const log = logs.rows[0];

    check('it names both ids', log.keep_ipo_id === KEEP && log.drop_ipo_id === DROP);
    check('it names both slugs', log.keep_slug === keepSlug && log.drop_slug === dropSlug);
    check('it records WHO ran the merge, from the caller',
      log.merged_by === 'assert-merge-log-restores.mjs', log.merged_by);
    check('unmerged_at is NULL (the merge is still in force)', log.unmerged_at === null);
    check('child-row counts are recorded, split deleted vs repointed',
      Array.isArray(log.deleted_child_counts) && Array.isArray(log.repointed_child_counts));

    // The point of the table: can the deleted row be reconstructed?
    const snap = log.drop_row;
    const camel = (k) => k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
    const snapGet = (k) => (k in snap ? snap[k] : snap[camel(k)]);
    const beforeKeys = Object.keys(before);
    const missing = beforeKeys.filter((k) => !(k in snap) && !(camel(k) in snap));

    check(`the snapshot carries every DECLARED column (${beforeKeys.length} live columns)`,
      missing.every((m) => UNDECLARED_IN_SCHEMA.has(m)),
      missing.length ? 'missing, all known-undeclared: ' + missing.join(', ') : 'none missing');

    // An undeclared column that starts holding data turns a latent gap into real loss.
    const populatedUndeclared = missing.filter((m) => before[m] !== null && before[m] !== undefined);
    check('no UNDECLARED column holds a value (that would be silent loss)',
      populatedUndeclared.length === 0,
      populatedUndeclared.length ? 'populated: ' + populatedUndeclared.join(', ') : '');

    check('face_value survives (a column the survivor did NOT carry)',
      String(snapGet('face_value')) === String(before.face_value),
      `snapshot=${snapGet('face_value')} before=${before.face_value}`);
    check('symbol survives', String(snapGet('symbol')) === String(before.symbol),
      `snapshot=${snapGet('symbol')} before=${before.symbol}`);

    const diffs = beforeKeys.filter((k) => {
      if (k === 'updated_at' || k === 'created_at') return false;
      if (UNDECLARED_IN_SCHEMA.has(k)) return false;
      const a = before[k];
      const b = snapGet(k);
      if (a === null || a === undefined) return !(b === null || b === undefined);
      return String(a) !== String(b) && String(a) !== String(b).replace(/T|\.000Z|Z/g, ' ').trim();
    });
    check('every non-timestamp declared column round-trips byte-for-byte', diffs.length === 0,
      diffs.length ? 'differ: ' + diffs.map((k) => `${k}(${before[k]}!=${snapGet(k)})`).join(', ') : '');

    // Timestamps become ISO strings in jsonb (drizzle's jsonb mapToDriverValue is
    // JSON.stringify, and pg returns Date objects). Lossless for VALUE, but the TYPE
    // changes — an unmerge must bind the string, never re-wrap it as a Date, or it walks
    // into the 5h30m class ist-timezone.md documents. Asserted so the restore path is
    // written knowing it.
    const tsKeys = beforeKeys.filter((k) => before[k] instanceof Date && !UNDECLARED_IN_SCHEMA.has(k));
    const badTs = tsKeys.filter((k) => snapGet(k) !== null && typeof snapGet(k) !== 'string');
    check(`timestamp columns are stored as ISO STRINGS in the snapshot (${tsKeys.length} checked)`,
      badTs.length === 0, badTs.length ? 'not strings: ' + badTs.join(', ') : '');

    const redir = await pool.query('SELECT * FROM ipo_slug_redirects WHERE old_slug = $1', [dropSlug]);
    check('the slug redirect is still written too (the log ADDS to it)', redir.rows.length === 1);

    console.log('\n' + (failed ? '*** SOME CHECKS FAILED ***' : 'ALL CHECKS PASSED'));
  } finally {
    // Remove only what this script created.
    await pool.query('DELETE FROM ipo_merge_log WHERE drop_ipo_id = $1', [DROP]).catch(() => {});
    await pool.query('DELETE FROM ipo_slug_redirects WHERE old_slug = $1', [dropSlug]).catch(() => {});
    // Cleanup through the repository as well — same reason as the plant.
    await repo.delete(KEEP).catch(() => {});
    await repo.delete(DROP).catch(() => {});
    await pool.end();
  }
  return failed ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error('ERROR:', e?.stack || e?.message || e); process.exitCode = 1; });
