// Self-test for scripts/ci/require-scripts-test-coverage.mjs (issues #616,
// #681, #1158). Every case builds a THROWAWAY fixture repo in a temp dir — a
// tree of fake test files, a fake workflow, a fake exclusion file — so the
// gate's behaviour is pinned independently of what this repo happens to
// contain today. The last case runs it against the REAL tree.
//
// Red-first: written against a version of require-scripts-test-coverage.mjs
// that did not exist yet; every case below failed (module not found) before
// the checker was written, and the mutation-shaped cases (wildcard swallow,
// comment-only mention, hard-coded list) are written to die under exactly the
// mutations #616/#681 describe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, listScriptsTests, listWorkflowFiles, REF_RE } from '../ci/require-scripts-test-coverage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GOOD_REASON = 'needs the staging DB tunnel, which CI runners do not have';

function workflowYaml(runFiles, { dir = 'scripts/tests' } = {}) {
  const cmd = runFiles.length > 0 ? runFiles.map((f) => `node --test ${dir}/${f}`) : ['echo nothing'];
  return [
    'name: PR Gate',
    'jobs:',
    '  gate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Run the scripts tests',
    '        run: >-',
    ...cmd.map((c) => `          ${c}`),
    '',
  ].join('\n');
}

function makeRepo({ files, ciFiles = [], runFiles, exclusions, workflow }) {
  const root = mkdtempSync(path.join(tmpdir(), 'stcov-'));
  const testsDir = path.join(root, 'scripts', 'tests');
  mkdirSync(testsDir, { recursive: true });
  for (const f of files) writeFileSync(path.join(testsDir, f), '// fixture\n');
  const ciTestsDir = path.join(root, 'scripts', 'ci', 'tests');
  mkdirSync(ciTestsDir, { recursive: true });
  for (const f of ciFiles) writeFileSync(path.join(ciTestsDir, f), '// fixture\n');
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(path.join(root, '.github', 'workflows', 'pr-gate.yml'), workflow ?? workflowYaml(runFiles));
  writeFileSync(
    path.join(root, 'scripts', 'ci', 'scripts-test-exclusions.json'),
    JSON.stringify({ exclusions }, null, 2)
  );
  return root;
}

function withRepo(spec, fn) {
  const root = makeRepo(spec);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a fully classified tree passes', () => {
  withRepo(
    {
      files: ['a.test.mjs', 'b.test.mjs'],
      runFiles: ['a.test.mjs'],
      exclusions: [{ file: 'scripts/tests/b.test.mjs', kind: 'cannot-run-in-ci', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.deepEqual(problems, []);
    }
  );
});

test('a file in neither a workflow nor the exclusions FAILS, and is named', () => {
  withRepo({ files: ['a.test.mjs', 'orphan.test.mjs'], runFiles: ['a.test.mjs'], exclusions: [] }, (root) => {
    const { problems, unclassified } = analyze({ root });
    assert.deepEqual(unclassified, ['scripts/tests/orphan.test.mjs']);
    assert.ok(
      problems.some((p) => p.includes('orphan.test.mjs') && p.includes('NO CI workflow')),
      `expected a problem naming the orphan file, got: ${JSON.stringify(problems)}`
    );
  });
});

test('.test.ts and .test.sh files are in the class too', () => {
  withRepo({ files: ['a.test.ts', 'b.test.sh'], runFiles: [], exclusions: [] }, (root) => {
    const { files } = analyze({ root });
    assert.deepEqual(files, ['scripts/tests/a.test.ts', 'scripts/tests/b.test.sh']);
  });
});

test('scripts/ci/tests files are in the class too', () => {
  withRepo({ files: [], ciFiles: ['c.test.mjs'], runFiles: [], exclusions: [] }, (root) => {
    const { files, problems, unclassified } = analyze({ root });
    assert.deepEqual(files, ['scripts/ci/tests/c.test.mjs']);
    assert.deepEqual(unclassified, ['scripts/ci/tests/c.test.mjs']);
    assert.equal(problems.length, 1);
  });
});

test('a subdirectory (e.g. fixtures/) is not walked into', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stcov-'));
  try {
    const testsDir = path.join(root, 'scripts', 'tests');
    mkdirSync(path.join(testsDir, 'fixtures'), { recursive: true });
    writeFileSync(path.join(testsDir, 'fixtures', 'nested.test.mjs'), '// fixture\n');
    assert.deepEqual(listScriptsTests(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// MUTATION: "make the exclusion list swallow everything with a wildcard".
test('a wildcard exclusion is refused, and does not cover anything', () => {
  withRepo(
    {
      files: ['a.test.mjs', 'b.test.mjs'],
      runFiles: [],
      exclusions: [{ file: 'scripts/tests/*', kind: 'cannot-run-in-ci', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems, unclassified } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('wildcards are not allowed')));
      assert.deepEqual(unclassified, ['scripts/tests/a.test.mjs', 'scripts/tests/b.test.mjs']);
    }
  );
});

test('an exclusion without a checkable reason is refused', () => {
  withRepo(
    {
      files: ['a.test.mjs'],
      runFiles: [],
      exclusions: [{ file: 'scripts/tests/a.test.mjs', kind: 'cannot-run-in-ci', reason: 'flaky' }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('"reason" must be at least')));
    }
  );
});

test('kind "broken" without a tracking issue is refused', () => {
  withRepo(
    {
      files: ['a.test.mjs'],
      runFiles: [],
      exclusions: [{ file: 'scripts/tests/a.test.mjs', kind: 'broken', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('requires a tracking issue')));
    }
  );
});

test('a stale exclusion for a deleted file is refused', () => {
  withRepo(
    {
      files: ['a.test.mjs'],
      runFiles: ['a.test.mjs'],
      exclusions: [{ file: 'scripts/tests/gone.test.mjs', kind: 'cannot-run-in-ci', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('stale entry')));
    }
  );
});

// MUTATION: "make a filename mentioned only in a comment count as covered".
test('a filename that appears only in a workflow COMMENT does not count as wired', () => {
  const workflow = workflowYaml(['a.test.mjs']).replace(
    '      - name: Run the scripts tests',
    '      # scripts/tests/b.test.mjs is mentioned here only\n      - name: Run the scripts tests'
  );
  withRepo({ files: ['a.test.mjs', 'b.test.mjs'], runFiles: ['a.test.mjs'], exclusions: [], workflow }, (root) => {
    const { problems } = analyze({ root });
    assert.ok(problems.some((p) => p.includes('b.test.mjs')));
  });
});

test('a file both excluded and wired is refused', () => {
  withRepo(
    {
      files: ['a.test.mjs'],
      runFiles: ['a.test.mjs'],
      exclusions: [{ file: 'scripts/tests/a.test.mjs', kind: 'cannot-run-in-ci', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('pick one')));
    }
  );
});

test('a multi-line run: block wires every file it mentions', () => {
  const workflow = [
    'jobs:',
    '  gate:',
    '    steps:',
    '      - name: two files, one step',
    '        run: |',
    '          node --test scripts/tests/a.test.mjs',
    '          node --test scripts/tests/b.test.mjs',
    '',
  ].join('\n');
  withRepo({ files: ['a.test.mjs', 'b.test.mjs'], runFiles: [], exclusions: [], workflow }, (root) => {
    assert.deepEqual(analyze({ root }).problems, []);
  });
});

for (const longer of ['foo.test.mjs.bak', 'foo.test.mjsx']) {
  test(`a reference to ${longer} does NOT wire foo.test.mjs (anchored REF_RE, round-1 finding 2)`, () => {
    const workflow = [
      'jobs:',
      '  gate:',
      '    steps:',
      '      - name: runs a longer-named file only',
      `        run: node --test scripts/tests/${longer}`,
      '',
    ].join('\n');
    withRepo({ files: ['foo.test.mjs'], runFiles: [], exclusions: [], workflow }, (root) => {
      const { problems, wired } = analyze({ root });
      assert.ok(!wired.includes('scripts/tests/foo.test.mjs'), `wired: ${wired.join(', ')}`);
      assert.ok(problems.some((p) => p.startsWith('scripts/tests/foo.test.mjs runs in NO CI workflow')));
    });
  });
}

test('REF_RE matches an exact reference, a ./ prefix and a trailing period, never a longer name', () => {
  const hits = (t) => [...t.matchAll(REF_RE)].map((m) => m[0]);
  assert.deepEqual(hits('node --test scripts/tests/foo.test.mjs'), ['scripts/tests/foo.test.mjs']);
  assert.deepEqual(hits('node --test ./scripts/ci/tests/foo.test.ts'), ['scripts/ci/tests/foo.test.ts']);
  assert.deepEqual(hits('see scripts/tests/foo.test.sh.'), ['scripts/tests/foo.test.sh']);
  assert.deepEqual(hits('scripts/tests/foo.test.mjs.bak'), []);
  assert.deepEqual(hits('scripts/tests/foo.test.mjsx'), []);
  assert.deepEqual(hits('myscripts/tests/foo.test.mjs'), []);
});

test('the REAL repository tree is fully classified', () => {
  const { problems, files, wired } = analyze({ root: REPO_ROOT });
  assert.deepEqual(problems, [], `real tree has unclassified scripts-test files:\n${problems.join('\n')}`);
  assert.ok(files.length >= 100, `expected at least 100 scripts-test files, found ${files.length}`);
  assert.ok(wired.length >= 60, `expected at least 60 wired files, found ${wired.length}`);
  assert.ok(listWorkflowFiles(REPO_ROOT).length >= 3);
});
