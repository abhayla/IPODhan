// scripts/tests/check-stage3-dod.test.mjs — drives the REAL scripts/check-stage3-dod.mjs as a
// subprocess against a temp fixture cards dir (same idiom as check-migration-journal.test.mjs /
// check-build-cards-isignored.test.mjs: exercise the real script, never a re-implementation).
//
// Run: node --test scripts/tests/check-stage3-dod.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-stage3-dod.mjs');

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-dod-test-'));
  const cardText = `# Item 99 / slice T0 — fixture card

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| T0-1 | \`true\` | exit 0 | local |
| T0-2 | \`false\` | exit 1 | local |
| T0-3 | \`echo hello\` | line: \`hello\` | local |
| T0-4 | \`printf 'a\\nb7\\n'\` | regex: \`^b[0-9]\` | local |
| T0-5 | \`echo x \\| grep x\` | exit 0 | local |
| T0-6 | \`echo unreached\` | line: \`unreached\` | staging |
| T0-7 | \`echo nope\` | line: \`this-never-appears\` | local |
`;
  fs.writeFileSync(path.join(tmpDir, 'item-99-st0-fixture.md'), cardText, 'utf8');
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args, extraEnv = {}) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('all local rows: exit 1 with FAIL present (T0-7 fails, T0-6 skipped without --staging)', () => {
  const { code, stdout } = run(['--slice', 'T0', '--cards', tmpDir]);
  assert.equal(code, 1);
  assert.match(stdout, /PASS T0-1 exit=0/);
  assert.match(stdout, /PASS T0-2 exit=1/);
  assert.match(stdout, /PASS T0-3/);
  assert.match(stdout, /PASS T0-4/);
  assert.match(stdout, /PASS T0-5 exit=0/);
  assert.match(stdout, /SKIP T0-6 env=staging/);
  assert.match(stdout, /FAIL T0-7/);
  assert.match(stdout, /T0: 5 PASS, 1 FAIL, 1 SKIP of 7/);
});

test('--staging runs the staging row too (no longer SKIP), still exit 1 overall (T0-7 fails)', () => {
  const { code, stdout } = run(['--slice', 'T0', '--cards', tmpDir, '--staging']);
  assert.equal(code, 1);
  assert.doesNotMatch(stdout, /SKIP T0-6/);
  assert.match(stdout, /PASS T0-6 exit=0/);
  assert.match(stdout, /T0: 6 PASS, 1 FAIL, 0 SKIP of 7/);
});

test('a slice with every row passing/skipping cleanly (no FAIL) but a SKIP present exits 2', () => {
  const onlyPassAndSkip = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-dod-test2-'));
  try {
    const cardText = `# fixture

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| T1-1 | \`true\` | exit 0 | local |
| T1-2 | \`echo skip-me\` | line: \`skip-me\` | staging |
`;
    fs.writeFileSync(path.join(onlyPassAndSkip, 'item-98-st1-fixture.md'), cardText, 'utf8');
    const { code, stdout } = run(['--slice', 'T1', '--cards', onlyPassAndSkip]);
    assert.equal(code, 2);
    assert.match(stdout, /PASS T1-1/);
    assert.match(stdout, /SKIP T1-2 env=staging/);
  } finally {
    fs.rmSync(onlyPassAndSkip, { recursive: true, force: true });
  }
});

test('a slice with every row passing exits 0', () => {
  const allPass = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-dod-test3-'));
  try {
    const cardText = `# fixture

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| T2-1 | \`true\` | exit 0 | local |
| T2-2 | \`echo ok\` | line: \`ok\` | local |
`;
    fs.writeFileSync(path.join(allPass, 'item-97-st2-fixture.md'), cardText, 'utf8');
    const { code, stdout } = run(['--slice', 'T2', '--cards', allPass]);
    assert.equal(code, 0);
    assert.match(stdout, /T2: 2 PASS, 0 FAIL, 0 SKIP of 2/);
  } finally {
    fs.rmSync(allPass, { recursive: true, force: true });
  }
});

// --- --sql mode: refuses before connecting ---

test('--sql refuses a non-SELECT statement before connecting, even with an unreachable DATABASE_URL', () => {
  const { code, stdout, stderr } = run(
    ['--sql', 'delete from x', '--expect-db', 'ipodhan_test'],
    { DATABASE_URL: 'postgresql://nouser:nopass@127.0.0.1:1/nonexistent_unreachable_host_db' }
  );
  assert.equal(code, 1);
  const combined = stdout + stderr;
  assert.match(combined, /must start with SELECT/);
  assert.doesNotMatch(combined, /ECONNREFUSED|ENOTFOUND|connect/i);
});

test('--sql refuses --expect-db ipodhan (production) before connecting', () => {
  const { code, stdout, stderr } = run(
    ['--sql', 'select 1', '--expect-db', 'ipodhan'],
    { DATABASE_URL: 'postgresql://nouser:nopass@127.0.0.1:1/nonexistent_unreachable_host_db' }
  );
  assert.equal(code, 1);
  const combined = stdout + stderr;
  assert.match(combined, /ipodhan.*refused|refused.*ipodhan/i);
  assert.doesNotMatch(combined, /ECONNREFUSED|ENOTFOUND|connect/i);
});

// --- issue #821: a malformed expect cell in an UNRELATED card must not block the requested slice ---
// The real regression: item-03-s1b's own S1b-3 row ("writer: exit 1; matrix: `1`") and item-03-s1d's
// own S1d-2 row ("exit 1 (was exit 0, count 8, on `origin/main`)") both fail parseExpect's strict
// `^exit\s+(\d+)$` grammar. Before the fix, main() parses EVERY card up front and FATALs (exit 3) on
// the first malformed row it hits, regardless of which --slice was asked for.

test('a malformed expect cell in an UNRELATED card does not block --slice for a different, well-formed slice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-dod-test-821-'));
  try {
    const goodCard = [
      '# Item 99 / slice S9 -- fixture, well-formed',
      '',
      '### Definition of Done',
      '',
      '| id | command | expect | env |',
      '|---|---|---|---|',
      '| S9-1 | `true` | exit 0 | local |',
      '',
    ].join('\n');
    // Same shape as the real S1b-3 row: an expect cell that is not `exit N`, not `line: ...`,
    // not `regex: ...` -- a free-text cell with an escaped pipe and backtick-quoted spans.
    const badCard = [
      '# Item 03 / slice S1b -- fixture, malformed expect cell (unrelated to S9)',
      '',
      '### Definition of Done',
      '',
      '| id | command | expect | env |',
      '|---|---|---|---|',
      '| S1b-3 | `true` | writer: exit 1\\; matrix: `1` | local |',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'item-99-s9-fixture.md'), goodCard, 'utf8');
    fs.writeFileSync(path.join(dir, 'item-03-s1b-fixture.md'), badCard, 'utf8');

    const { code, stdout } = run(['--slice', 'S9', '--cards', dir]);
    assert.equal(code, 0, `expected slice S9 to run cleanly; got code ${code}, stdout:\n${stdout}`);
    assert.match(stdout, /PASS S9-1/);
    assert.doesNotMatch(stdout, /FATAL/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed expect cell in the REQUESTED slice fails that row legibly, naming the card and id -- no FATAL crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage3-dod-test-821b-'));
  try {
    const badCard = [
      '# Item 03 / slice S1d -- fixture, malformed expect cell in the requested slice',
      '',
      '### Definition of Done',
      '',
      '| id | command | expect | env |',
      '|---|---|---|---|',
      '| S1d-2 | `true` | exit 1 (was exit 0, count 8, on `origin/main`) | local |',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'item-03-s1d-fixture.md'), badCard, 'utf8');

    const { code, stdout, stderr } = run(['--slice', 'S1d', '--cards', dir]);
    const combined = stdout + stderr;
    // Must not be the old un-catchable process.exit(3) FATAL crash.
    assert.notEqual(code, 3, `expected the malformed row to fail as a row, not crash the whole run; stdout:\n${stdout}\nstderr:\n${stderr}`);
    assert.match(combined, /S1d-2/);
    assert.match(combined, /item-03-s1d-fixture\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
