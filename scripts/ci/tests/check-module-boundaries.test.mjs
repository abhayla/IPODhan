// implements: R-142, R-143, R-144
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'check-module-boundaries.mjs');
const REPO_ROOT = join(__dirname, '..', '..', '..');

function makeFixtureRoot() {
  // Fixtures live in a temp dir OUTSIDE the repo so the real check never
  // picks up this test file's own source as a "real" source file.
  return mkdtempSync(join(tmpdir(), 'module-boundaries-fixture-'));
}

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writeMap(root, entries, opts = {}) {
  const map = {
    _why: 'test fixture',
    layerOrder: opts.layerOrder || [
      'discovery',
      'download',
      'extraction',
      'validation',
      'consolidation',
      'plan',
      'walk',
      'verification',
      're-read',
      'read-side',
    ],
    coverageFloor: opts.coverageFloor ?? 0,
    entries,
  };
  writeFile(root, 'scripts/ci/module-map.json', JSON.stringify(map, null, 2));
  return join(root, 'scripts/ci/module-map.json');
}

function run(root, mapPath) {
  return spawnSync(
    'node',
    [SCRIPT, '--root', root, '--map', mapPath || join(root, 'scripts/ci/module-map.json')],
    { encoding: 'utf8' }
  );
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test('upward import (extraction -> read-side) -> exit 1, names both files and both modules', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(
      root,
      'scraper/src/extraction/foo.ts',
      "import { getIpo } from '../read-side/ipo-reader';\nexport const x = 1;\n"
    );
    writeFile(root, 'scraper/src/read-side/ipo-reader.ts', 'export const getIpo = () => null;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
      { glob: 'scraper/src/read-side/**/*.ts', module: 'read-side' },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL/);
    assert.match(res.stderr, /foo\.ts/);
    assert.match(res.stderr, /ipo-reader\.ts/);
    assert.match(res.stderr, /extraction/);
    assert.match(res.stderr, /read-side/);
  } finally {
    cleanup(root);
  }
});

test('clean tree (only downward/same-layer imports) -> exit 0', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(
      root,
      'scraper/src/consolidation/writer.ts',
      "import { validate } from '../validation/check';\nexport const write = () => validate();\n"
    );
    writeFile(root, 'scraper/src/validation/check.ts', 'export const validate = () => true;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/consolidation/**/*.ts', module: 'consolidation' },
      { glob: 'scraper/src/validation/**/*.ts', module: 'validation' },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
  } finally {
    cleanup(root);
  }
});

test('same-module import -> exit 0 (not an upward edge)', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(
      root,
      'scraper/src/extraction/a.ts',
      "import { b } from './b';\nexport const a = () => b();\n"
    );
    writeFile(root, 'scraper/src/extraction/b.ts', 'export const b = () => 1;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
  } finally {
    cleanup(root);
  }
});

test('import of an unmapped file -> ignored, exit 0', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(
      root,
      'scraper/src/extraction/a.ts',
      "import { helper } from '../unmapped/helper';\nexport const a = () => helper();\n"
    );
    writeFile(root, 'scraper/src/unmapped/helper.ts', 'export const helper = () => 1;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
  } finally {
    cleanup(root);
  }
});

test('map missing -> exit 2', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(root, 'scraper/src/extraction/a.ts', 'export const a = 1;\n');
    const res = run(root, join(root, 'scripts/ci/module-map.json'));
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /module map/i);
  } finally {
    cleanup(root);
  }
});

test('map with zero globs -> exit 2', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(root, 'scraper/src/extraction/a.ts', 'export const a = 1;\n');
    const mapPath = writeMap(root, []);
    const res = run(root, mapPath);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /zero glob entries/);
  } finally {
    cleanup(root);
  }
});

test('mapped-file count below coverageFloor -> exit 2', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(root, 'scraper/src/extraction/a.ts', 'export const a = 1;\n');
    const mapPath = writeMap(
      root,
      [{ glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' }],
      { coverageFloor: 5 }
    );
    const res = run(root, mapPath);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /coverage/i);
    assert.match(res.stderr, /coverageFloor=5/);
  } finally {
    cleanup(root);
  }
});

test('zero source files scanned -> exit 2', () => {
  const root = makeFixtureRoot();
  try {
    // No scan-root directories created at all.
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /zero source files scanned/);
  } finally {
    cleanup(root);
  }
});

test('the layer order itself decides the verdict (same edge, order reversed -> PASS flips to FAIL)', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(
      root,
      'scraper/src/consolidation/writer.ts',
      "import { validate } from '../validation/check';\nexport const write = () => validate();\n"
    );
    writeFile(root, 'scraper/src/validation/check.ts', 'export const validate = () => true;\n');
    const entries = [
      { glob: 'scraper/src/consolidation/**/*.ts', module: 'consolidation' },
      { glob: 'scraper/src/validation/**/*.ts', module: 'validation' },
    ];

    // As shipped (validation below consolidation): downward import -> PASS.
    const passMap = writeMap(root, entries, {
      coverageFloor: 2,
      layerOrder: ['validation', 'consolidation'],
    });
    const passRes = run(root, passMap);
    assert.equal(passRes.status, 0, passRes.stdout + passRes.stderr);

    // Layers swapped (validation above consolidation): the SAME edge is now
    // upward -> FAIL. If this doesn't flip, the check ignores layerOrder.
    const failMap = writeMap(root, entries, {
      coverageFloor: 2,
      layerOrder: ['consolidation', 'validation'],
    });
    const failRes = run(root, failMap);
    assert.equal(failRes.status, 1, failRes.stdout + failRes.stderr);
    assert.match(failRes.stderr, /consolidation is below validation/);
  } finally {
    cleanup(root);
  }
});

test('real repository -> exits 0 or 1, never 2 (proves it can parse the real tree)', () => {
  const res = spawnSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(res.status, 2, res.stdout + res.stderr);
  assert.ok(
    res.status === 0 || res.status === 1,
    `expected exit 0 or 1, got ${res.status}: ${res.stdout}\n${res.stderr}`
  );
  assert.match(res.stdout, /coverage summary/);
});
