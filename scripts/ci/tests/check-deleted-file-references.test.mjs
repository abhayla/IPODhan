// Self-test for check-deleted-file-references.mjs (#1193, class
// deleted-file-still-referenced-by-ci). Mutation-proof by construction: it
// drives the real checker against a TEMP GIT REPO fixture, red before the
// reference is fixed, green after — never a re-implementation of the logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-deleted-file-references.mjs');

function sh(cwd, args) {
  return execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'deleted-file-refs-fixture-'));
  sh(root, ['git', 'init', '--quiet', '-b', 'main']);
  sh(root, ['git', 'config', 'user.email', 'test@example.com']);
  sh(root, ['git', 'config', 'user.name', 'Test']);
  return root;
}

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commitAll(root, message) {
  sh(root, ['git', 'add', '-A']);
  sh(root, ['git', 'commit', '--quiet', '-m', message]);
}

function runCheck(root, base, head) {
  return spawnSync('node', [SCRIPT, base, head], { cwd: root, encoding: 'utf8' });
}

test('flags a deleted file still imported by a test (red)', () => {
  const root = makeRepo();
  try {
    writeFile(root, 'src/helper-module.ts', 'export const helper = 1;\n');
    writeFile(
      root,
      'src/consumer.test.mjs',
      "import { helper } from './helper-module.ts';\nconsole.log(helper);\n"
    );
    commitAll(root, 'base');
    sh(root, ['git', 'branch', '--quiet', 'base']);

    rmSync(join(root, 'src', 'helper-module.ts'));
    commitAll(root, 'delete helper-module.ts, still referenced by consumer.test.mjs');

    const result = runCheck(root, 'base', 'HEAD');
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /src\/helper-module\.ts/);
    assert.match(result.stderr, /src\/consumer\.test\.mjs:1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a hardcoded basename reference (no extension) is caught', () => {
  const root = makeRepo();
  try {
    writeFile(root, 'scraper/scripts/backfill-ipo-reviews.ts', 'export {};\n');
    writeFile(
      root,
      'scripts/ci/tests/consumer.test.mjs',
      "const target = 'scraper/scripts/backfill-ipo-reviews.ts';\nconsole.log(target);\n"
    );
    commitAll(root, 'base');
    sh(root, ['git', 'branch', '--quiet', 'base']);

    rmSync(join(root, 'scraper', 'scripts', 'backfill-ipo-reviews.ts'));
    commitAll(root, 'delete backfill-ipo-reviews.ts');

    const result = runCheck(root, 'base', 'HEAD');
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /backfill-ipo-reviews\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a docs-only mention passes (green)', () => {
  const root = makeRepo();
  try {
    writeFile(root, 'src/old-route.ts', 'export const x = 1;\n');
    writeFile(root, 'docs/notes.md', 'We retired src/old-route.ts last week.\n');
    commitAll(root, 'base');
    sh(root, ['git', 'branch', '--quiet', 'base']);

    rmSync(join(root, 'src', 'old-route.ts'));
    commitAll(root, 'delete old-route.ts (docs still mention it)');

    const result = runCheck(root, 'base', 'HEAD');
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a clean deletion with no references passes (green)', () => {
  const root = makeRepo();
  try {
    writeFile(root, 'src/orphan.ts', 'export const x = 1;\n');
    writeFile(root, 'src/unrelated.ts', 'export const y = 2;\n');
    commitAll(root, 'base');
    sh(root, ['git', 'branch', '--quiet', 'base']);

    rmSync(join(root, 'src', 'orphan.ts'));
    commitAll(root, 'delete orphan.ts, nothing references it');

    const result = runCheck(root, 'base', 'HEAD');
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a prose sentence naming the basename in English (not path/quote-bearing) passes', () => {
  const root = makeRepo();
  try {
    writeFile(root, 'src/widget.ts', 'export const w = 1;\n');
    writeFile(
      root,
      'src/README.txt',
      'The widget component used to live here but was removed.\n'
    );
    commitAll(root, 'base');
    sh(root, ['git', 'branch', '--quiet', 'base']);

    rmSync(join(root, 'src', 'widget.ts'));
    commitAll(root, 'delete widget.ts');

    const result = runCheck(root, 'base', 'HEAD');
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no files deleted in range exits 0', () => {
  const root = makeRepo();
  try {
    writeFile(root, 'src/a.ts', 'export const a = 1;\n');
    commitAll(root, 'base');
    sh(root, ['git', 'branch', '--quiet', 'base']);

    writeFile(root, 'src/b.ts', 'export const b = 2;\n');
    commitAll(root, 'add only, no deletion');

    const result = runCheck(root, 'base', 'HEAD');
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /no files deleted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
