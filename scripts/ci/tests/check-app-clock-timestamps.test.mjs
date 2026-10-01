// Self-test for scripts/ci/check-app-clock-timestamps.mjs (class mixed-clock-ordering, F-210).
// Mutation-proof: a planted `detectedAt: new Date()` in a scanned tree turns the check red and names
// file:line; the sql`now()` form, a marked line, a baselined line and an unscanned tree stay green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOffenders, newOffenders, keyOf } from '../check-app-clock-timestamps.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-app-clock-timestamps.mjs');
const REPO_ROOT = join(__dirname, '..', '..', '..');

function tree(files, baseline = []) {
  const root = mkdtempSync(join(tmpdir(), 'app-clock-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const bl = join(root, 'baseline.json');
  writeFileSync(bl, JSON.stringify(baseline));
  return { root, bl };
}

function run(root, bl) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root, '--baseline-file', bl], { encoding: 'utf8' });
}

const REPO = 'packages/shared/src/repositories/x-repository.ts';

test('RED: a planted detectedAt: new Date() fails and names file:line', () => {
  const { root, bl } = tree({ [REPO]: "const a = 1;\ndb.insert(t).values({ detectedAt: new Date() });\n" });
  try {
    const r = run(root, bl);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`${REPO.replace(/\./g, '\\.')}:2`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('RED: a planted timestamp: new Date().toISOString() in web admin routes fails', () => {
  const { root, bl } = tree({ 'web/app/api/admin/y/route.ts': 'return json({ timestamp: new Date().toISOString() });\n' });
  try {
    assert.equal(run(root, bl).status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GREEN: sql`now()`, a marked line, a comment and an unscanned tree pass', () => {
  const { root, bl } = tree({
    [REPO]: [
      "import { sql } from 'drizzle-orm';",
      'db.update(t).set({ resolvedAt: sql`now()` });',
      '// app-clock-ok: response metadata, never stored',
      'const meta = { createdAt: new Date() };',
      'const x = { updatedAt: new Date() }; // app-clock-ok: redis score only',
      '// an example: detectedAt: new Date()',
    ].join('\n'),
    'docs/examples/z.ts': 'db.insert(t).values({ detectedAt: new Date() });\n',
  });
  try {
    const r = run(root, bl);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS: 0 new offenders/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the baseline covers exactly its count; one more identical line fails', () => {
  const line = 'db.update(t).set({ updatedAt: new Date() });';
  const baseline = [{ key: `${REPO} :: ${line}`, count: 1, reason: 'bookkeeping only, no ordering consumer' }];
  const one = tree({ [REPO]: `${line}\n` }, baseline);
  const two = tree({ [REPO]: `${line}\n${line}\n` }, baseline);
  try {
    assert.equal(run(one.root, one.bl).status, 0);
    const r = run(two.root, two.bl);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`${REPO.replace(/\./g, '\\.')}:2`));
  } finally {
    rmSync(one.root, { recursive: true, force: true });
    rmSync(two.root, { recursive: true, force: true });
  }
});

test('a baseline entry without a reason fails', () => {
  const line = 'db.update(t).set({ updatedAt: new Date() });';
  const { root, bl } = tree({ [REPO]: `${line}\n` }, [{ key: `${REPO} :: ${line}`, count: 1, reason: 'TODO' }]);
  try {
    const r = run(root, bl);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no reason/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findOffenders / newOffenders units', () => {
  const found = findOffenders('f.ts', "import { sql } from 'drizzle-orm';\na({ stateChangedAt: new Date(), b: 1 });\nc({ lastManualEditAt: sql`now()` });");
  assert.deepEqual(found.map((o) => [o.line, o.column]), [[2, 'stateChangedAt']]);
  assert.equal(newOffenders(found, [{ key: keyOf(found[0]), count: 1 }]).length, 0);
  assert.equal(newOffenders(found, []).length, 1);
});

test('the real tree passes against the committed baseline', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// #1312 item 2: the scan covers web/lib and scraper/src, and an app-clock value reached through a variable.
for (const rel of ['web/lib/repositories/w-repository.ts', 'scraper/src/services/s.ts']) {
  test(`RED (#1312): a planted resolvedAt: new Date() in ${rel.split('/').slice(0, 2).join('/')} fails`, () => {
    const { root, bl } = tree({ [rel]: 'db.update(t).set({ resolvedAt: new Date() });\n' });
    try {
      const r = run(root, bl);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /resolvedAt/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('RED (#1312): const now = new Date(); then fooAt: now fails, and so does const fooAt = new Date()', () => {
  const viaVar = tree({ [REPO]: 'const now = new Date();\nawait db.update(t).set({ resolvedAt: now });\n' });
  const named = tree({ [REPO]: 'const detectedAt = new Date();\nawait db.insert(t).values({ detectedAt });\n' });
  try {
    const r = run(viaVar.root, viaVar.bl);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`${REPO.replace(/\./g, '\.')}:2`));
    assert.equal(run(named.root, named.bl).status, 1);
  } finally {
    rmSync(viaVar.root, { recursive: true, force: true });
    rmSync(named.root, { recursive: true, force: true });
  }
});

test('RED (#1312 item 3): a baseline count above the occurrences found fails (partial shrink and gone entries)', () => {
  const line = 'db.update(t).set({ updatedAt: new Date() });';
  const reason = 'bookkeeping only, no ordering consumer';
  const partial = tree({ [REPO]: `${line}\n` }, [{ key: `${REPO} :: ${line}`, count: 2, reason }]);
  const gone = tree({ [REPO]: 'const a = 1;\n' }, [{ key: `${REPO} :: ${line}`, count: 1, reason }]);
  try {
    const r = run(partial.root, partial.bl);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /exceeds/);
    assert.equal(run(gone.root, gone.bl).status, 1);
  } finally {
    rmSync(partial.root, { recursive: true, force: true });
    rmSync(gone.root, { recursive: true, force: true });
  }
});

// #1312 round 2 (AST re-approach): every shape the round-1 regex missed, plus the unresolved rule.
const WEB = 'web/lib/repositories/probe-repository.ts';
const MISSED_SHAPES = {
  'alias of Date (const D = Date; new D())': 'const D = Date;\nexport const f = () => ({ createdAt: new D() });\n',
  'alias via globalThis.Date': 'const D = globalThis.Date;\nexport const f = () => ({ createdAt: new D() });\n',
  'Date.now()': 'export const f = () => ({ updatedAt: Date.now() });\n',
  'performance.now() based date': 'export const f = () => ({ seenAt: new Date(performance.timeOrigin + performance.now()) });\n',
  'local helper returning a Date': 'function mk() { return new Date(); }\nexport const f = () => ({ resolvedAt: mk() });\n',
  'local arrow helper chained through a variable': 'const mk = () => new Date();\nconst t = mk();\nexport const f = () => ({ resolvedAt: t });\n',
  'new Date(Date.now())': 'export const f = () => ({ doneAt: new Date(Date.now()) });\n',
  'clock variable under a non-At key': 'const now2 = new Date();\nexport const f = () => ({ foo: now2 });\n',
  'shorthand { createdAt }': 'export function f() {\n  const stamp = new Date();\n  const createdAt = stamp;\n  return { createdAt };\n}\n',
  'xAt: clockVar.toISOString()': 'const clockVar = new Date();\nexport const f = () => ({ doneAt: clockVar.toISOString() });\n',
  'property assignment obj.fooAt = clock': 'export function f(o) { o.syncedAt = new Date(); }\n',
  'parameter default': 'export function f(createdAt = new Date()) { return createdAt; }\n',
  'Date.now through an alias function': 'const nowFn = Date.now;\nexport const f = () => ({ doneAt: nowFn() });\n',
};
for (const [name, body] of Object.entries(MISSED_SHAPES)) {
  test(`RED (#1312 r2): ${name} is caught`, () => {
    const found = findOffenders(WEB, body);
    assert.ok(found.length >= 1, `not caught: ${body}`);
    assert.equal(found[0].kind, 'clock');
    const { root, bl } = tree({ [WEB]: body });
    try {
      const r = run(root, bl);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /probe-repository\.ts:\d+/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('RED (#1312 r2): a sink value the scan cannot resolve fails closed as kind unresolved', () => {
  const importedCall = "import { mk } from './clock-helper';\nexport const f = () => ({ resolvedAt: mk() });\n";
  const computed = 'export const f = (m, k) => ({ resolvedAt: m[k] });\n';
  const unknownFn = 'export const f = (get) => ({ resolvedAt: get() });\n';
  for (const body of [importedCall, computed, unknownFn]) {
    const found = findOffenders(WEB, body);
    assert.deepEqual(found.map((o) => o.kind), ['unresolved'], body);
    const { root, bl } = tree({ [WEB]: body });
    try {
      const r = run(root, bl);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /\[unresolved\]/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('GREEN (#1312 r2): database clock, literals, plain data and a db-clock helper imported by source pass', () => {
  const body = [
    "import { sql } from 'drizzle-orm';",
    "import { timestamp } from 'drizzle-orm/pg-core';",
    "import { readDatabaseNow } from '@ipodhan/shared/db/database-clock';",
    'export async function f(tx, row, patch) {',
    '  const at = await readDatabaseNow(tx);',
    '  const col = { updatedAt: timestamp(\'updated_at\').defaultNow() };',
    '  const t0 = Date.now();',
    '  return { resolvedAt: sql`now()`, doneAt: at, createdAt: row.createdAt, seenAt: new Date(row.seen), when: null, startedAtText: \'x\', t0, patchedAt: patch.at, col };',
    '}',
  ].join('\n');
  assert.deepEqual(findOffenders(WEB, body), []);
});

test('RED (#1312 r2): a helper named readDatabaseNow imported from anywhere else is NOT trusted (allow-list is by import source)', () => {
  const body = "import { readDatabaseNow } from './my-own-clock';\nexport const f = (tx) => ({ resolvedAt: readDatabaseNow(tx) });\n";
  assert.deepEqual(findOffenders(WEB, body).map((o) => o.kind), ['unresolved']);
});

test('the marker still silences an AST finding on the key line or the line above', () => {
  const body = '// app-clock-ok: response field only\nexport const a = () => ({ createdAt: new Date() });\nexport const b = () => ({ doneAt: Date.now() }); // app-clock-ok: log only\n';
  assert.deepEqual(findOffenders(WEB, body), []);
});
