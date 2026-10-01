// Self-test for scripts/tests/lib/hermetic-git.{mjs,sh} (#1063). Removing or
// weakening either guard turns a case here red: the cases are exactly the dirs
// that once let fixture git write into the real repository (2026-09-25, #1037).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv, assertHermeticRepo } from './lib/hermetic-git.mjs';

scrubGitEnv();
const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, '..', '..');
const SH_LIB = join(HERE, 'lib', 'hermetic-git.sh');

const REFUSED_DIRS = {
  'empty string': '',
  'dot (the caller cwd)': '.',
  'relative path': 'scripts',
  'the host repository root': HOST,
  'a dir inside the host repository': join(HOST, 'scripts', 'tests'),
  'a dir that does not exist': join(tmpdir(), 'hermetic-git-does-not-exist-1063'),
};

for (const [label, dir] of Object.entries(REFUSED_DIRS)) {
  test(`mjs guard refuses ${label}`, () => {
    assert.throws(() => assertHermeticRepo(dir), /hermetic-git: REFUSED/);
  });
  test(`sh guard refuses ${label}`, () => {
    const r = spawnSync('bash', ['-c', `. "$1"; assert_hermetic_repo "$2"; echo reached`, 'x', SH_LIB, dir], {
      cwd: HOST, encoding: 'utf8',
    });
    assert.equal(r.status, 97, `exit ${r.status}; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /hermetic-git: REFUSED/);
    assert.doesNotMatch(r.stdout, /reached/);
  });
}

test('both guards accept a fresh temp dir before and after git init', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermetic-git-ok-'));
  try {
    assertHermeticRepo(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    assertHermeticRepo(dir);
    const r = spawnSync('bash', ['-c', `. "$1"; assert_hermetic_repo "$2" && echo ok`, 'x', SH_LIB, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both guards refuse a temp subdir that git resolves to an enclosing fixture repo', () => {
  const outer = mkdtempSync(join(tmpdir(), 'hermetic-git-outer-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: outer });
    const inner = join(outer, 'inner');
    mkdirSync(inner);
    mkdirSync(join(inner, '.git')); // looks initialised, but git resolves to outer
    assert.throws(() => assertHermeticRepo(inner), /REFUSED/);
    const r = spawnSync('bash', ['-c', `. "$1"; assert_hermetic_repo "$2"`, 'x', SH_LIB, inner], { encoding: 'utf8' });
    assert.equal(r.status, 97, r.stderr);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test('both guards refuse while GIT_DIR is exported (the 2026-09-25 hook route)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermetic-git-env-'));
  try {
    process.env.GIT_DIR = join(HOST, '.git');
    assert.throws(() => assertHermeticRepo(dir), /GIT_DIR is set/);
    const r = spawnSync('bash', ['-c', `. "$1"; assert_hermetic_repo "$2"`, 'x', SH_LIB, dir], { encoding: 'utf8', env: process.env });
    assert.equal(r.status, 97, r.stderr);
  } finally {
    delete process.env.GIT_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
