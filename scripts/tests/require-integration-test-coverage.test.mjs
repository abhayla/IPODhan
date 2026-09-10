// Self-test for scripts/ci/require-integration-test-coverage.mjs (item 1 slice
// s11, issue #507). Every case builds a THROWAWAY fixture repo in a temp dir —
// a tree of fake integration test files, a fake pr-gate.yml, a fake exclusion
// file — so the gate's behaviour is pinned independently of what this repo
// happens to contain today. The last case runs it against the REAL tree.
//
// These cases are written to die under the three mutations the gate must not
// survive: an exclusion list that swallows everything, a hard-coded copy of the
// run list instead of parsing the workflow, and a missing file passing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, listIntegrationTests, parseWorkflowRunList } from '../ci/require-integration-test-coverage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function workflowYaml(runFiles, { jobName = 'scraper-document-integration', vitest = true } = {}) {
  const cmd = vitest
    ? ['npx vitest run -c vitest.integration.config.ts', ...runFiles.map((f) => `tests/integration/${f}`)]
    : ['echo nothing'];
  return [
    'name: PR Gate',
    'jobs:',
    '  gate:',
    '    runs-on: ubuntu-latest',
    `  ${jobName}:`,
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Run the document-state integration tests',
    '        run: >-',
    ...cmd.map((c) => `          ${c}`),
    '  another-job:',
    '    runs-on: ubuntu-latest',
    '',
  ].join('\n');
}

/** Builds a fixture repo and returns its root. */
function makeRepo({ files, runFiles, exclusions, workflow }) {
  const root = mkdtempSync(path.join(tmpdir(), 'itcov-'));
  const testsDir = path.join(root, 'scraper', 'tests', 'integration');
  mkdirSync(testsDir, { recursive: true });
  for (const f of files) {
    const full = path.join(testsDir, f);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '// fixture\n');
  }
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    path.join(root, '.github', 'workflows', 'pr-gate.yml'),
    workflow ?? workflowYaml(runFiles)
  );
  mkdirSync(path.join(root, 'scripts', 'ci'), { recursive: true });
  writeFileSync(
    path.join(root, 'scripts', 'ci', 'integration-test-exclusions.json'),
    JSON.stringify({ exclusions }, null, 2)
  );
  return root;
}

const GOOD_REASON = 'hits the live nseindia.com API from a blocked runner IP';

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
      files: ['a.integration.test.ts', 'b.integration.test.ts'],
      runFiles: ['a.integration.test.ts'],
      exclusions: [
        { file: 'tests/integration/b.integration.test.ts', kind: 'cannot-run-in-ci', reason: GOOD_REASON },
      ],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.deepEqual(problems, []);
    }
  );
});

// MUTATION (iii): "make a missing file pass".
test('a file in neither the run list nor the exclusions FAILS, and is named', () => {
  withRepo(
    {
      files: ['a.integration.test.ts', 'orphan.integration.test.ts'],
      runFiles: ['a.integration.test.ts'],
      exclusions: [],
    },
    (root) => {
      const { problems, unclassified } = analyze({ root });
      assert.deepEqual(unclassified, ['tests/integration/orphan.integration.test.ts']);
      assert.ok(
        problems.some((p) => p.includes('orphan.integration.test.ts') && p.includes('NO CI job')),
        `expected a problem naming the orphan file, got: ${JSON.stringify(problems)}`
      );
    }
  );
});

test('a test file NOT named *.integration.test.ts is still in the class', () => {
  withRepo(
    { files: ['phase-1-e2e.test.ts'], runFiles: [], exclusions: [] },
    (root) => {
      const { files, problems } = analyze({ root });
      assert.deepEqual(files, ['tests/integration/phase-1-e2e.test.ts']);
      assert.equal(problems.length, 1);
    }
  );
});

test('nested test files are in the class too', () => {
  withRepo(
    { files: [path.join('sub', 'nested.integration.test.ts')], runFiles: [], exclusions: [] },
    (root) => {
      assert.deepEqual(listIntegrationTests(root), ['tests/integration/sub/nested.integration.test.ts']);
    }
  );
});

// MUTATION (i): "make the exclusion list swallow everything".
test('a wildcard exclusion is refused, and does not cover anything', () => {
  withRepo(
    {
      files: ['a.integration.test.ts', 'b.integration.test.ts'],
      runFiles: [],
      exclusions: [{ file: 'tests/integration/*', kind: 'cannot-run-in-ci', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems, unclassified } = analyze({ root });
      assert.ok(
        problems.some((p) => p.includes('wildcards are not allowed')),
        `expected the wildcard entry to be refused, got: ${JSON.stringify(problems)}`
      );
      assert.deepEqual(unclassified, [
        'tests/integration/a.integration.test.ts',
        'tests/integration/b.integration.test.ts',
      ]);
    }
  );
});

test('an exclusion matching by prefix or basename covers nothing (exact paths only)', () => {
  withRepo(
    {
      files: ['a.integration.test.ts'],
      runFiles: [],
      exclusions: [
        { file: 'tests/integration/a', kind: 'cannot-run-in-ci', reason: GOOD_REASON },
        { file: 'tests/integration/', kind: 'cannot-run-in-ci', reason: GOOD_REASON },
      ],
    },
    (root) => {
      const { problems, unclassified } = analyze({ root });
      assert.deepEqual(unclassified, ['tests/integration/a.integration.test.ts']);
      assert.equal(problems.filter((p) => p.includes('stale entry')).length, 2);
    }
  );
});

test('an exclusion without a checkable reason is refused', () => {
  withRepo(
    {
      files: ['a.integration.test.ts'],
      runFiles: [],
      exclusions: [{ file: 'tests/integration/a.integration.test.ts', kind: 'cannot-run-in-ci', reason: 'flaky' }],
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
      files: ['a.integration.test.ts'],
      runFiles: [],
      exclusions: [{ file: 'tests/integration/a.integration.test.ts', kind: 'broken', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('requires a tracking issue')));
    }
  );
});

test('an unknown exclusion kind is refused', () => {
  withRepo(
    {
      files: ['a.integration.test.ts'],
      runFiles: [],
      exclusions: [{ file: 'tests/integration/a.integration.test.ts', kind: 'skip-for-now', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('"kind" must be one of')));
    }
  );
});

test('a stale exclusion for a deleted file is refused', () => {
  withRepo(
    {
      files: ['a.integration.test.ts'],
      runFiles: ['a.integration.test.ts'],
      exclusions: [{ file: 'tests/integration/gone.integration.test.ts', kind: 'cannot-run-in-ci', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('stale entry')));
    }
  );
});

// MUTATION (ii): "make it read a hard-coded list instead of parsing the
// workflow". A hard-coded list cannot see this fixture's run line at all, so
// both of the next two cases go red under that mutation.
test('the run list is read FROM the workflow — dropping a file there makes it unclassified', () => {
  withRepo(
    { files: ['a.integration.test.ts', 'b.integration.test.ts'], runFiles: ['a.integration.test.ts', 'b.integration.test.ts'], exclusions: [] },
    (root) => {
      assert.deepEqual(analyze({ root }).problems, []);
    }
  );
  withRepo(
    { files: ['a.integration.test.ts', 'b.integration.test.ts'], runFiles: ['a.integration.test.ts'], exclusions: [] },
    (root) => {
      const { problems, runList } = analyze({ root });
      assert.deepEqual(runList, ['tests/integration/a.integration.test.ts']);
      assert.ok(problems.some((p) => p.includes('b.integration.test.ts')));
    }
  );
});

test('a filename that appears only in a workflow COMMENT does not count as covered', () => {
  const workflow = workflowYaml(['a.integration.test.ts'])
    .replace(
      '      - name: Run the document-state integration tests',
      '      # tests/integration/b.integration.test.ts is mentioned here only\n      - name: Run the document-state integration tests'
    );
  withRepo(
    { files: ['a.integration.test.ts', 'b.integration.test.ts'], runFiles: ['a.integration.test.ts'], exclusions: [], workflow },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('b.integration.test.ts')));
    }
  );
});

test('a run list naming a file that does not exist is refused', () => {
  withRepo(
    { files: ['a.integration.test.ts'], runFiles: ['a.integration.test.ts', 'ghost.integration.test.ts'], exclusions: [] },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('ghost.integration.test.ts') && p.includes('does not exist')));
    }
  );
});

test('a file both excluded and in the run list is refused', () => {
  withRepo(
    {
      files: ['a.integration.test.ts'],
      runFiles: ['a.integration.test.ts'],
      exclusions: [{ file: 'tests/integration/a.integration.test.ts', kind: 'cannot-run-in-ci', reason: GOOD_REASON }],
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.ok(problems.some((p) => p.includes('pick one')));
    }
  );
});

test('a renamed job or a removed vitest step fails loudly instead of passing everything', () => {
  withRepo(
    { files: ['a.integration.test.ts'], runFiles: ['a.integration.test.ts'], exclusions: [], workflow: workflowYaml([], { jobName: 'renamed-job' }) },
    (root) => {
      assert.throws(() => analyze({ root }), /job "scraper-document-integration" not found/);
    }
  );
  withRepo(
    { files: ['a.integration.test.ts'], runFiles: [], exclusions: [], workflow: workflowYaml([], { vitest: false }) },
    (root) => {
      assert.throws(() => analyze({ root }), /no step running vitest.integration.config.ts/);
    }
  );
});

test('the REAL repository tree is fully classified', () => {
  const { problems, files } = analyze({ root: REPO_ROOT });
  assert.deepEqual(problems, [], `real tree has unclassified integration tests:\n${problems.join('\n')}`);
  assert.ok(files.length >= 19, `expected at least 19 integration test files, found ${files.length}`);
  // The real workflow must parse to a non-empty list — a parser that silently
  // returned [] would make every file look unclassified, not covered, but this
  // pins the positive direction too.
  assert.ok(parseWorkflowRunList(REPO_ROOT).length >= 13);
});
