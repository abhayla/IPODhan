// docs/design/check-dod.mjs used to hard-code
// `process.chdir('D:/Abhay/Ventures/IPODhan-IPODhan-pullmodel-delta')` — a worktree that no
// longer exists, so the script threw ENOENT before its first assertion in EVERY checkout,
// including main (build item 33). This test drives the real script as a subprocess (never a
// re-implementation of its root-resolution logic) from a temporary directory that is
// deliberately NOT an IPODhan checkout, proving both the refusal and the two ways to point it
// at a real one agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'docs', 'design', 'check-dod.mjs');

function run(args, cwd) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('the script source contains no process.chdir( with a hard-coded path literal', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  // A later "temporary" chdir back to a literal path is exactly the regression this guards
  // against; chdir(root) where root is computed from argv/cwd is fine and expected.
  assert.doesNotMatch(src, /process\.chdir\(\s*['"]/, 'a literal path must never be chdir-ed to again');
});

test('run with no argument from a directory that is NOT a checkout refuses with exit 2 and names the directory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'check-dod-not-a-checkout-'));
  try {
    const result = run([], tmp);
    assert.equal(result.code, 2);
    assert.match(result.out, /is not an IPODhan checkout/);
    assert.ok(result.out.includes(tmp) || result.out.toLowerCase().includes(tmp.toLowerCase()), 'refusal must name the directory it refused');
    assert.doesNotMatch(result.out, /at Object\.<anonymous>|ENOENT/, 'must print a message, not a raw stack trace/ENOENT');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('run with the repo root as argv[2] from that same non-checkout directory produces a real report', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'check-dod-not-a-checkout-'));
  try {
    const result = run([REPO_ROOT], tmp);
    assert.match(result.out, /Definition of Done: \d+ met, \d+ not met, of \d+\./);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('run with no argument from the repo root produces the same report as the argv-path run', () => {
  const cwdResult = run([], REPO_ROOT);
  const argResult = run([REPO_ROOT], REPO_ROOT);
  assert.match(cwdResult.out, /Definition of Done: \d+ met, \d+ not met, of \d+\./);
  assert.equal(cwdResult.out, argResult.out, 'the cwd-default path and the explicit-argument path must agree');
  assert.equal(cwdResult.code, argResult.code);
});
