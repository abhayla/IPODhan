// Self-test for scripts/check-staged-secrets.js --range mode (CI backstop,
// .github/workflows/secret-scan.yml). Builds a throwaway git repo, commits a
// base, then a head with an added line, and asserts the scanner's exit code
// over that range. Staged mode is covered separately by
// scripts/tests/check-staged-secrets.test.sh; this file proves range mode
// shares the same RULES via scripts/lib/secret-rules.js and behaves the same
// way on the added-lines diff of a commit range instead of the index.
//
// The "secret" values below are invented for this test and were never real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCANNER = join(import.meta.dirname, '..', 'check-staged-secrets.js');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-range-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'range-test@test.local']);
  git(['config', 'user.name', 'range-test']);
  git(['config', 'core.autocrlf', 'false']);
  writeFileSync(join(dir, 'base.txt'), 'base content\n');
  git(['add', 'base.txt']);
  git(['commit', '--quiet', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']).trim();
  return { dir, git, base };
}

function commitLine(dir, git, filename, line) {
  writeFileSync(join(dir, filename), `${line}\n`);
  git(['add', filename]);
  git(['commit', '--quiet', '-m', `add ${filename}`]);
  return git(['rev-parse', 'HEAD']).trim();
}

function runRange(dir, range) {
  try {
    execSync(`node "${SCANNER}" --range ${range}`, { cwd: dir, encoding: 'utf8' });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

test('range mode flags a fake credential added between base and head', () => {
  const { dir, git, base } = makeRepo();
  try {
    commitLine(dir, git, 'creds.env', 'DB_PASSWORD=Zq8vT2mNp4xy');
    const exit = runRange(dir, `${base}..HEAD`);
    assert.equal(exit, 1, 'expected the scanner to block on a fake credential');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('range mode passes a placeholder value', () => {
  const { dir, git, base } = makeRepo();
  try {
    commitLine(dir, git, 'docs.md', 'DATABASE_URL=postgresql://user:<db-password>@host:5432/db');
    const exit = runRange(dir, `${base}..HEAD`);
    assert.equal(exit, 0, 'expected the scanner to allow a documented placeholder');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('range mode honors secret-scan:allow', () => {
  const { dir, git, base } = makeRepo();
  try {
    commitLine(dir, git, 'seed.ts', "DB_PASSWORD=Zq8vT2mNp4xy  // secret-scan:allow");
    const exit = runRange(dir, `${base}..HEAD`);
    assert.equal(exit, 0, 'expected secret-scan:allow to exempt the line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('range mode accepts three-dot merge-base ranges (what CI passes)', () => {
  const { dir, git, base } = makeRepo();
  try {
    commitLine(dir, git, 'creds.env', 'DB_PASSWORD=Zq8vT2mNp4xy');
    const exit = runRange(dir, `${base}...HEAD`);
    assert.equal(exit, 1, 'expected the scanner to block over a three-dot range too');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staged mode is unchanged: default invocation still scans the index', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'staged.txt'), 'DB_PASSWORD=Zq8vT2mNp4xy\n');
    git(['add', 'staged.txt']);
    let exit = 0;
    try {
      execSync(`node "${SCANNER}"`, { cwd: dir, encoding: 'utf8' });
    } catch (err) {
      exit = err.status ?? 1;
    }
    assert.equal(exit, 1, 'expected default (staged) mode to still block on a fake credential');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
