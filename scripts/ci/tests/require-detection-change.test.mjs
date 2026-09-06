import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'require-detection-change.mjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'require-detection-change-'));
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  return dir;
}

function commitFile(dir, relPath, content, message) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  git(dir, ['add', relPath]);
  git(dir, ['commit', '--quiet', '-m', message]);
}

function runGate(dir, baseRef, headRef, env = {}) {
  const result = spawnSync('node', [SCRIPT, baseRef, headRef], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return result;
}

function baseSetup(dir) {
  commitFile(dir, 'README.md', '# repo\n', 'chore: init');
  git(dir, ['branch', 'base-marker']); // marks the point BEFORE the PR's commits
}

test('scraper change + check change -> pass', () => {
  const dir = initRepo();
  try {
    baseSetup(dir);
    commitFile(
      dir,
      'scraper/src/services/foo.ts',
      'export const x = 1;\n',
      'fix(scraper): tweak foo'
    );
    commitFile(
      dir,
      'scripts/lib/substance-checks.mjs',
      'export const y = 1;\n',
      'test(checks): add check'
    );
    const res = runGate(dir, 'base-marker', 'HEAD');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scraper change + declaration line -> pass', () => {
  const dir = initRepo();
  try {
    baseSetup(dir);
    commitFile(
      dir,
      'scraper/src/scrapers/bar-v2.ts',
      'export const z = 1;\n',
      'fix(scraper): tweak bar\n\nNo detection change: pure refactor, no behavior or value change at all.'
    );
    const res = runGate(dir, 'base-marker', 'HEAD');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scraper change alone -> fail naming files', () => {
  const dir = initRepo();
  try {
    baseSetup(dir);
    commitFile(
      dir,
      'scraper/src/services/data-persister.ts',
      'export const w = 1;\n',
      'fix(scraper): change persister'
    );
    const res = runGate(dir, 'base-marker', 'HEAD');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL/);
    assert.match(res.stderr, /data-persister\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('docs-only -> pass', () => {
  const dir = initRepo();
  try {
    baseSetup(dir);
    commitFile(dir, 'docs/notes.md', '# notes\n', 'docs: add notes');
    const res = runGate(dir, 'base-marker', 'HEAD');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('test-only -> pass', () => {
  const dir = initRepo();
  try {
    baseSetup(dir);
    commitFile(
      dir,
      'scraper/src/services/foo.test.ts',
      'export const t = 1;\n',
      'test(scraper): add test'
    );
    const res = runGate(dir, 'base-marker', 'HEAD');
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('python script change alone -> fail', () => {
  const dir = initRepo();
  try {
    baseSetup(dir);
    commitFile(
      dir,
      'scraper/scripts/extract_filing.py',
      '# change\n',
      'fix(scraper): tweak extractor'
    );
    const res = runGate(dir, 'base-marker', 'HEAD');
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL/);
    assert.match(res.stderr, /extract_filing\.py/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
