// #1150: self-test for scripts/ci/require-db-writer-guard.mjs.
//
// Imports the REAL classifier, so weakening any one rule (a DB source pattern,
// a write shape, a fail-closed branch, the baseline's shrink-only check) turns
// a named case red before the lint can silently stop catching the class.
//
//   node --test scripts/ci/tests/require-db-writer-guard.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyDbWriterFile,
  evaluate,
  isDbSource,
  makeReachResolver,
} from '../require-db-writer-guard.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'db-writer-guard-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const reachOf = makeReachResolver();

/** Classify an in-memory script placed at <tmp>/scripts/<name>. */
function classify(source, name = 'some-script.ts') {
  return classifyDbWriterFile(path.join(tmp, 'scripts', name), source, reachOf);
}

const GUARD = `import { openRepairDb } from './lib/repair-tool.js';\n`;

test('RED: a pg Pool script running raw UPDATE text, under a name the filename lint never matched', () => {
  const r = classify(`import { Pool } from 'pg';
const pool = new Pool();
await pool.query('UPDATE ipos SET offering_type = $1 WHERE id = $2', ['IPO', 1]);
`, 'reclassify-corporate-actions.ts');
  assert.equal(r.verdict, 'violation');
  assert.equal(r.kind, 'direct-write');
});

test('RED: drizzle db from the @ipodhan/shared barrel with a .insert( call', () => {
  const r = classify(`import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
await db.insert(schema.registrars).values({ name: 'x' });
`);
  assert.equal(r.verdict, 'violation');
});

test('RED: the DB source is matched by import SOURCE, not by identifier text (renamed binding)', () => {
  const r = classify(`import { db as handle } from '@ipodhan/shared/db';
await handle.update(t).set({ a: 1 });
`);
  assert.equal(r.verdict, 'violation');
});

test('GREEN: the same writer passes once it opens the DB through openRepairDb()', () => {
  const r = classify(`${GUARD}import { db } from '@ipodhan/shared';
await openRepairDb(db, { apply: true, allowProd: false, toolName: 'x' });
await db.insert(t).values({});
`);
  assert.equal(r.verdict, 'ok');
});

test('RED: importing openRepairDb without CALLING it is not a guard', () => {
  const r = classify(`${GUARD}import { db } from '@ipodhan/shared';
await db.delete(t);
`);
  assert.equal(r.verdict, 'violation');
});

test('GREEN: a dated exemption with a reason is accepted', () => {
  const r = classify(`// repair-tool-exempt: 2026-10-01 local fixture loader, never prod
import { db } from '@ipodhan/shared';
await db.insert(t).values({});
`);
  assert.equal(r.verdict, 'exempt');
});

test('GREEN: a DB script that only SELECTs is db-read-only', () => {
  const r = classify(`import { db } from '@ipodhan/shared';
const rows = await db.select().from(t);
await db.execute(sql\`SELECT count(*) FROM ipos\`);
`);
  assert.equal(r.verdict, 'db-read-only');
});

test('GREEN: Map/Set/createHash/URLSearchParams receivers are provably not a DB handle', () => {
  const r = classify(`import { db } from '@ipodhan/shared';
import { createHash } from 'node:crypto';
const seen = new Map();
seen.delete('a');
createHash('sha256').update('x');
const h = createHash('md5'); h.update('y');
const u = new URL('http://x'); u.searchParams.delete('k');
`);
  assert.equal(r.verdict, 'db-read-only');
});

test('RED (fail closed): a name bound to a Map in one place and a parameter in another is ambiguous', () => {
  const r = classify(`import { db } from '@ipodhan/shared';
const m = new Map();
function f(m) { return m.delete(x); }
`);
  assert.equal(r.verdict, 'violation');
});

test('RED (fail closed): a computed method name on a receiver cannot be resolved', () => {
  assert.equal(classify(`import { db } from '@ipodhan/shared';\nconst k = 'ins' + 'ert';\nawait db[k](t);\n`).verdict, 'violation');
  assert.equal(classify(`import { db } from '@ipodhan/shared';\nawait db['update'](t);\n`).verdict, 'violation');
});

test('RED (fail closed): .execute()/.query() with a non-literal SQL argument is unresolved', () => {
  const r = classify(`import { db } from '@ipodhan/shared';
const stmt = build();
await db.execute(stmt);
`);
  assert.equal(r.verdict, 'violation');
});

test('RED: raw DML inside a sql`` tagged template and a lowercase string are both writes', () => {
  assert.equal(classify(`import { db } from '@ipodhan/shared';\nawait db.execute(sql\`DELETE FROM documents WHERE ipo_id = \${id}\`);\n`).verdict, 'violation');
  assert.equal(classify(`import pg from 'pg';\nconst c = new pg.Client();\nawait c.query('update ipos set x = 1');\n`).verdict, 'violation');
  assert.equal(classify(`import pg from 'pg';\nawait c.query('ALTER TABLE ipos ADD COLUMN y int');\n`).verdict, 'violation');
});

test('RED (fail closed): a dynamic import with a non-literal specifier counts as DB reach', () => {
  const r = classify(`const mod = await import(process.env.DB_MODULE);
await mod.db.insert(t).values({});
`);
  assert.equal(r.verdict, 'violation');
});

test('RED: a dynamic import("pg") and require("pg") are DB reach like a static import', () => {
  assert.equal(classify(`const { Pool } = await import('pg');\nawait new Pool().query('INSERT INTO t VALUES (1)');\n`).verdict, 'violation');
  assert.equal(classify(`const { Pool } = require('pg');\nawait new Pool().query('INSERT INTO t VALUES (1)');\n`).verdict, 'violation');
});

test('GREEN: a type-only import from pg brings no runtime client', () => {
  const r = classify(`import type { Pool } from 'pg';\nconst m = { insert: (x) => x };\nm.insert(1);\n`);
  assert.equal(r.verdict, 'not-db');
});

test('GREEN: a script with no DB reach is not-db even with an .insert( call', () => {
  assert.equal(classify(`const arr = { insert() {} };\narr.insert(1);\n`).verdict, 'not-db');
});

test('RED: INDIRECT — a relative module that transitively reaches a DB client is a possible writer', () => {
  mkdirSync(path.join(tmp, 'services'), { recursive: true });
  writeFileSync(path.join(tmp, 'services', 'inner.ts'), `import { Pool } from 'pg';\nexport const p = new Pool();\n`);
  writeFileSync(path.join(tmp, 'services', 'persister.ts'), `import { p } from './inner.js';\nexport function persist() { return p; }\n`);
  writeFileSync(path.join(tmp, 'services', 'pure.ts'), `export const add = (a, b) => a + b;\n`);
  const r = classify(`import { persist } from '../services/persister.js';\npersist();\n`);
  assert.equal(r.verdict, 'violation');
  assert.equal(r.kind, 'indirect');
  assert.match(r.evidence, /persister\.js -> \.\/inner\.js -> pg/);
  assert.equal(classify(`import { add } from '../services/pure.js';\nadd(1, 2);\n`).verdict, 'not-db');
});

test('RED (fail closed): an unresolvable relative import counts as a possible writer', () => {
  const r = classify(`import { x } from '../services/does-not-exist.js';\nx();\n`);
  assert.equal(r.verdict, 'violation');
  assert.match(r.evidence, /unresolved relative import/);
});

test('isDbSource: client sources match; schema/types and unrelated packages do not', () => {
  for (const s of ['pg', 'postgres', 'drizzle-orm/node-postgres', '@ipodhan/shared', '@ipodhan/shared/db', '../../../packages/shared/src/db/index', '../db']) {
    assert.equal(isDbSource(s), true, s);
  }
  for (const s of ['@ipodhan/shared/db/schema', 'drizzle-orm', 'node:fs', '../services/document-classifier.js']) {
    assert.equal(isDbSource(s), false, s);
  }
});

test('baseline: a listed violation is suppressed; an unlisted one is reported', () => {
  const results = new Map([
    ['a.ts', { verdict: 'violation', evidence: 'writes' }],
    ['b.ts', { verdict: 'violation', evidence: 'writes' }],
  ]);
  const out = evaluate(results, { entries: [{ file: 'a.ts', reason: 'legacy one-off, superseded by a guarded tool' }] });
  assert.deepEqual(out.baselined, ['a.ts']);
  assert.equal(out.violations.length, 1);
  assert.match(out.violations[0], /^b\.ts/);
});

test('baseline is shrink-only: an entry whose file is now guarded or gone fails', () => {
  const results = new Map([['a.ts', { verdict: 'ok' }]]);
  const out = evaluate(results, {
    entries: [
      { file: 'a.ts', reason: 'legacy one-off, superseded by a guarded tool' },
      { file: 'gone.ts', reason: 'legacy one-off, superseded by a guarded tool' },
    ],
  });
  assert.equal(out.stale.length, 2);
});

test('baseline entries must carry a reason', () => {
  const results = new Map([['a.ts', { verdict: 'violation', evidence: 'writes' }]]);
  const out = evaluate(results, { entries: [{ file: 'a.ts', reason: 'x' }] });
  assert.equal(out.violations.length, 1);
  assert.match(out.violations[0], /no reason/);
});
