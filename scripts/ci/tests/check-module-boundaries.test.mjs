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

test('same-module import -> exit 0 (not an upward edge), and does not count as cross-module', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(
      root,
      'scraper/src/extraction/a.ts',
      "import { b } from './b';\nexport const a = () => b();\n"
    );
    writeFile(root, 'scraper/src/extraction/b.ts', 'export const b = () => 1;\n');
    // A real cross-module edge alongside the same-module one — same-module
    // edges can never violate (fromIdx === toIdx always) and no longer feed
    // the vacuous-gate floor, so a fixture with ONLY a same-module edge
    // would now legitimately trip the CROSS-MODULE floor below and no
    // longer exercise "same-module import is not a violation" at all.
    writeFile(
      root,
      'scraper/src/consolidation/writer.ts',
      "import { validate } from '../validation/check';\nexport const write = () => validate();\n"
    );
    writeFile(root, 'scraper/src/validation/check.ts', 'export const validate = () => true;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
      { glob: 'scraper/src/consolidation/**/*.ts', module: 'consolidation' },
      { glob: 'scraper/src/validation/**/*.ts', module: 'validation' },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /PASS/);
    assert.match(res.stdout, /BOTH-ENDPOINTS-MAPPED edges[^:]*: 2/);
    assert.match(res.stdout, /CROSS-MODULE edges[^:]*: 1/);
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
      "import { helper } from '../unmapped/helper';\nimport { fetchOne } from '../download/fetch';\nexport const a = () => helper() + fetchOne();\n"
    );
    // A real cross-module DOWNWARD edge (extraction -> download, lower in
    // the default layerOrder) so this fixture also has a non-zero
    // CROSS-MODULE count (otherwise the vacuous-gate guard would fire first
    // and this test would no longer exercise the "unmapped endpoint is
    // ignored" behavior at all — a same-module edge no longer suffices
    // here since it wouldn't count toward the CROSS-MODULE floor either).
    writeFile(root, 'scraper/src/download/fetch.ts', 'export const fetchOne = () => 1;\n');
    writeFile(root, 'scraper/src/unmapped/helper.ts', 'export const helper = () => 1;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
      { glob: 'scraper/src/download/**/*.ts', module: 'download' },
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

test('real repository -> evaluates dozens of CROSS-MODULE edges, not just a couple (the resolver + vacuous-gate regression guard)', () => {
  const res = spawnSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  const m = res.stdout.match(/CROSS-MODULE edges \(what this check can actually FAIL on\): (\d+)/);
  assert.ok(m, `expected a CROSS-MODULE line in stdout, got:\n${res.stdout}`);
  const count = Number(m[1]);
  // Threshold of 50 (real count is ~83) is deliberately below the true
  // value but far above what a broken resolver evaluates: with the `.js`
  // extension unresolved, scraper/src (437 `.js`-suffixed relative
  // specifiers) drops out of the graph almost entirely and this number
  // collapses to 2 — the exact CRITICAL finding this test guards against.
  assert.ok(
    count > 50,
    `real-repository run evaluated only ${count} cross-module edges (expected > 50, real count is ~83) — this collapses to 2 if the resolver stops following a '.js' specifier to its '.ts' source file (the CRITICAL finding), and 2 of 83 real cross-module edges evaluated (49 both-mapped edges, mostly same-module) was the MAJOR finding this also guards against.`
  );
});

test('a map whose entries evaluate zero cross-module edges -> exit 2, never a silent PASS', () => {
  const root = makeFixtureRoot();
  try {
    // Two disjoint islands that never import each other — the exact shape
    // of the defect: files ARE mapped (coverage looks fine) but no mapped
    // file imports another mapped file, so the check evaluates nothing.
    writeFile(root, 'scraper/src/extraction/a.ts', 'export const a = 1;\n');
    writeFile(root, 'scraper/src/read-side/b.ts', 'export const b = 1;\n');
    const mapPath = writeMap(
      root,
      [
        { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
        { glob: 'scraper/src/read-side/**/*.ts', module: 'read-side' },
      ],
      { coverageFloor: 2 }
    );
    const res = run(root, mapPath);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /zero cross-module import edges/);
  } finally {
    cleanup(root);
  }
});

test('a map with only SAME-MODULE edges -> exit 2 (the MAJOR fix: both-mapped > 0 no longer masks a zero cross-module load)', () => {
  const root = makeFixtureRoot();
  try {
    // Exactly the shape of the MAJOR finding: files import each other, so
    // BOTH-ENDPOINTS-MAPPED is non-zero (looks like coverage), but every
    // such edge stays inside one module, so the check can still never fail
    // on a real upward import. Old code guarded on bothMappedEdges.length
    // and would have PASSED here (47 same-module repositories/* edges did
    // exactly this in the real repo).
    writeFile(
      root,
      'scraper/src/extraction/a.ts',
      "import { b } from './b';\nexport const a = () => b();\n"
    );
    writeFile(root, 'scraper/src/extraction/b.ts', 'export const b = () => 1;\n');
    const mapPath = writeMap(
      root,
      [{ glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' }],
      { coverageFloor: 2 }
    );
    const res = run(root, mapPath);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /zero cross-module import edges/);
    assert.match(res.stderr, /1 both-endpoints-mapped edge\(s\) exist/);
  } finally {
    cleanup(root);
  }
});

test('resolveModule is first-match-wins: an earlier, narrower glob beats a later, broader one', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(
      root,
      'scraper/src/services/special-case.ts',
      "import { helper } from './helper';\nexport const x = () => helper();\n"
    );
    writeFile(root, 'scraper/src/services/helper.ts', 'export const helper = () => 1;\n');
    // First entry (narrow, exact file) claims special-case.ts as `download`;
    // the second, broader glob would claim the WHOLE directory (including
    // special-case.ts) as `discovery`. If resolveModule ever became
    // last-match-wins, special-case.ts would flip to `discovery` and
    // `download -> discovery` would become an upward edge under this order,
    // turning this fixture's exit 0 into exit 1.
    const mapPath = writeMap(
      root,
      [
        { glob: 'scraper/src/services/special-case.ts', module: 'download' },
        { glob: 'scraper/src/services/**/*.ts', module: 'discovery' },
      ],
      { coverageFloor: 2, layerOrder: ['discovery', 'download'] }
    );
    const res = run(root, mapPath);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /download: 1/);
    assert.match(res.stdout, /discovery: 1/);
  } finally {
    cleanup(root);
  }
});

function writeBaseline(root, edges) {
  const path = join(root, 'config', 'module-boundary-baseline.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ _comment: 'test fixture', edges }, null, 2));
  return path;
}

test('baseline: an unbaselined upward edge -> exit 1, named', () => {
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
    assert.match(res.stderr, /not in the baseline/);
  } finally {
    cleanup(root);
  }
});

test('baseline: a baselined upward edge -> exit 0, printed by identity every run', () => {
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
    writeBaseline(root, [
      {
        from: 'scraper/src/extraction/foo.ts',
        to: 'scraper/src/read-side/ipo-reader.ts',
        why: 'test fixture debt',
      },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /baselined upward edge/);
    assert.match(res.stdout, /foo\.ts/);
    assert.match(res.stdout, /ipo-reader\.ts/);
    assert.match(res.stdout, /test fixture debt/);
  } finally {
    cleanup(root);
  }
});

test('baseline: an entry that no longer exists in the graph -> exit 2 (shrink must be committed, never silent)', () => {
  const root = makeFixtureRoot();
  try {
    // The graph is now CLEAN (no upward edge at all) but the baseline still
    // lists one — this must fail loud, not silently accept the stale entry.
    // A second, clean, CROSS-MODULE mapped-to-mapped edge keeps CROSS-MODULE
    // edges > 0 so the vacuous-gate guard doesn't mask the staleness check
    // below (a same-module edge no longer suffices for this since it never
    // counts toward the CROSS-MODULE floor).
    writeFile(
      root,
      'scraper/src/extraction/foo.ts',
      "import { fetchOne } from '../download/fetch';\nexport const x = () => fetchOne();\n"
    );
    writeFile(root, 'scraper/src/download/fetch.ts', 'export const fetchOne = () => 1;\n');
    writeFile(root, 'scraper/src/read-side/ipo-reader.ts', 'export const getIpo = () => null;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
      { glob: 'scraper/src/download/**/*.ts', module: 'download' },
      { glob: 'scraper/src/read-side/**/*.ts', module: 'read-side' },
    ]);
    writeBaseline(root, [
      {
        from: 'scraper/src/extraction/foo.ts',
        to: 'scraper/src/read-side/ipo-reader.ts',
        why: 'no longer real — this entry should have been removed',
      },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /STALE/);
  } finally {
    cleanup(root);
  }
});

test('baseline: a fabricated entry that never existed in the graph -> exit 2 (baseline may only shrink, never grow silently)', () => {
  const root = makeFixtureRoot();
  try {
    // Clean tree, no real violation anywhere, yet the baseline claims one —
    // this must be refused exactly like a stale entry: it can only mean the
    // baseline grew without the graph backing it. A real clean CROSS-MODULE
    // edge keeps CROSS-MODULE edges > 0 so the vacuous-gate guard doesn't
    // fire first (a same-module edge no longer suffices for this).
    writeFile(
      root,
      'scraper/src/extraction/foo.ts',
      "import { fetchOne } from '../download/fetch';\nexport const x = () => fetchOne();\n"
    );
    writeFile(root, 'scraper/src/download/fetch.ts', 'export const fetchOne = () => 1;\n');
    const mapPath = writeMap(root, [
      { glob: 'scraper/src/extraction/**/*.ts', module: 'extraction' },
      { glob: 'scraper/src/download/**/*.ts', module: 'download' },
    ]);
    writeBaseline(root, [
      {
        from: 'scraper/src/extraction/does-not-exist.ts',
        to: 'scraper/src/read-side/also-fake.ts',
        why: 'fabricated — never a real edge',
      },
    ]);
    const res = run(root, mapPath);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stderr, /FAIL \(exit 2\)/);
    assert.match(res.stderr, /STALE/);
  } finally {
    cleanup(root);
  }
});
