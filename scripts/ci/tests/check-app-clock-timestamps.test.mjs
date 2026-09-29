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
      'db.update(t).set({ resolvedAt: sql`now()` });',
      '// app-clock-ok: response metadata, never stored',
      'const meta = { createdAt: new Date() };',
      'const x = { updatedAt: new Date() }; // app-clock-ok: redis score only',
      '// an example: detectedAt: new Date()',
    ].join('\n'),
    'scraper/src/services/z.ts': 'db.insert(t).values({ detectedAt: new Date() });\n',
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
  const found = findOffenders('f.ts', 'a({ stateChangedAt: new Date(), b: 1 });\nc({ lastManualEditAt: sql`now()` });');
  assert.deepEqual(found.map((o) => [o.line, o.column]), [[1, 'stateChangedAt']]);
  assert.equal(newOffenders(found, [{ key: keyOf(found[0]), count: 1 }]).length, 0);
  assert.equal(newOffenders(found, []).length, 1);
});

test('the real tree passes against the committed baseline', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
