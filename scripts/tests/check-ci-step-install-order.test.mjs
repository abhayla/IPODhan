// Self-test for scripts/ci/check-ci-step-install-order.mjs (T-570, registry
// class ci-step-imports-package-before-install). Each case builds a throwaway
// fixture repo (a workflow plus the files it runs) in a temp dir, so the gate's
// behaviour is pinned independently of this repo's contents. The last case runs
// it against the REAL tree.
//
// Red-first: the four brief cases (pre-install pg via a local module, builtins
// and relative only, pg after npm ci, a no-install job reaching typescript)
// were run against mutants of the checker — isBuiltin always true, install
// never detected, relative imports never followed — and each mutant turns at
// least one case red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyze,
  importSpecifiers,
  nodeInvocationTargets,
  parseWorkflowJobs,
} from '../ci/check-ci-step-install-order.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function withRepo(files, fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'cisio-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const wf = (steps) =>
  ['name: Fixture', 'on: pull_request', 'jobs:', '  gate:', '    runs-on: ubuntu-latest', '    steps:', ...steps, ''].join('\n');
const WF = '.github/workflows/pr-gate.yml';
const checkout = ['      - uses: actions/checkout@v4'];
const install = ['      - name: Install dependencies', '        run: npm ci'];
const step = (name, run) => [`      - name: ${name}`, `        run: ${run}`];

const PG_VIA_LOCAL = {
  'scripts/tests/uses-db.test.mjs':
    "import { test } from 'node:test';\nimport { makePool } from '../lib/db.mjs';\ntest('x', () => {});\n",
  'scripts/lib/db.mjs': "import pg from 'pg';\nimport { join } from 'node:path';\nexport const makePool = () => new pg.Pool();\n",
};

test('RED: a pre-install step whose test imports a local module that imports pg fails, naming step, file and chain', () => {
  withRepo(
    { ...PG_VIA_LOCAL, [WF]: wf([...checkout, ...step('db self-test', 'node --test scripts/tests/uses-db.test.mjs'), ...install]) },
    (root) => {
      const { problems } = analyze({ root });
      assert.equal(problems.length, 1, problems.join('\n'));
      const p = problems[0];
      assert.match(p, /job "gate" step 2 "db self-test"/);
      assert.match(p, /scripts\/tests\/uses-db\.test\.mjs reaches npm package 'pg'/);
      assert.match(p, /import chain: scripts\/tests\/uses-db\.test\.mjs -> scripts\/lib\/db\.mjs -> 'pg'/);
    }
  );
});

test('GREEN: a pre-install step with builtins and relative-only imports passes', () => {
  withRepo(
    {
      'scripts/tests/pure.test.mjs':
        "import { test } from 'node:test';\nimport assert from 'assert/strict';\nimport { f } from '../lib/pure.mjs';\nexport * from '../lib/more.mjs';\ntest('x', () => assert.ok(f));\n",
      'scripts/lib/pure.mjs': "import { readFileSync } from 'fs/promises';\nexport const f = 1;\n",
      'scripts/lib/more.mjs': "const { join } = require('node:path');\nexport const g = await import('node:os');\n",
      [WF]: wf([...checkout, ...step('pure', 'node --test scripts/tests/pure.test.mjs'), ...install]),
    },
    (root) => {
      const { problems, checked } = analyze({ root });
      assert.deepEqual(problems, []);
      assert.equal(checked.length, 1);
    }
  );
});

test('GREEN: the same pg-importing test placed after npm ci passes', () => {
  withRepo(
    { ...PG_VIA_LOCAL, [WF]: wf([...checkout, ...install, ...step('db self-test', 'node --test scripts/tests/uses-db.test.mjs')]) },
    (root) => {
      const { problems, checked } = analyze({ root });
      assert.deepEqual(problems, []);
      assert.equal(checked.length, 0, 'post-install steps are not walked');
    }
  );
});

test('RED: a job with no install step that reaches typescript fails', () => {
  withRepo(
    {
      'scripts/ci/checker.mjs': "import ts from 'typescript';\nexport default ts;\n",
      [WF]: wf([...checkout, ...step('checker', 'node scripts/ci/checker.mjs')]),
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.equal(problems.length, 1, problems.join('\n'));
      assert.match(problems[0], /scripts\/ci\/checker\.mjs reaches npm package 'typescript'/);
      assert.match(problems[0], /step 2 "checker"/);
    }
  );
});

test('an install in the SAME step, before the node call, counts; one after it does not', () => {
  withRepo(
    { ...PG_VIA_LOCAL, [WF]: wf([...checkout, ...step('both', "'npm ci && node --test scripts/tests/uses-db.test.mjs'")]) },
    (root) => assert.deepEqual(analyze({ root }).problems, [])
  );
  withRepo(
    { ...PG_VIA_LOCAL, [WF]: wf([...checkout, ...step('both', "'node --test scripts/tests/uses-db.test.mjs && npm ci'")]) },
    (root) => assert.equal(analyze({ root }).problems.length, 1)
  );
});

test('npm install -g is not a dependency install', () => {
  withRepo(
    { ...PG_VIA_LOCAL, [WF]: wf([...checkout, ...step('global', 'npm install -g @lhci/cli'), ...step('t', 'node --test scripts/tests/uses-db.test.mjs')]) },
    (root) => assert.equal(analyze({ root }).problems.length, 1)
  );
});

test('node --test with several files (block scalar) names the offending one', () => {
  withRepo(
    {
      ...PG_VIA_LOCAL,
      'scripts/tests/ok.test.mjs': "import 'node:test';\n",
      [WF]: wf([
        ...checkout,
        '      - name: batch',
        '        run: |',
        '          # a comment naming scripts/tests/nothing.test.mjs is ignored',
        '          node --test \\',
        '            scripts/tests/ok.test.mjs \\',
        '            scripts/tests/uses-db.test.mjs',
      ]),
    },
    (root) => {
      const { problems, checked } = analyze({ root });
      assert.equal(checked.length, 2);
      assert.equal(problems.length, 1);
      assert.match(problems[0], /uses-db\.test\.mjs reaches npm package 'pg'/);
    }
  );
});

test('a .js specifier resolves to a .ts file, which is followed; `import type` is erased', () => {
  withRepo(
    {
      'scripts/a.ts': "import type { Pool } from 'pg';\nimport { b } from './b.js';\nexport const a: number = b;\n",
      'scripts/b.ts': "import { z } from 'zod';\nexport const b = 1;\n",
      [WF]: wf([...checkout, ...step('ts', 'node --experimental-strip-types scripts/a.ts')]),
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.equal(problems.length, 1, problems.join('\n'));
      assert.match(problems[0], /scripts\/a\.ts -> scripts\/b\.ts -> 'zod'/);
    }
  );
});

test('literal dynamic import() and require() reach packages; scoped names are reported whole', () => {
  withRepo(
    {
      'scripts/dyn.mjs': "export async function f() { return (await import('pg')).default; }\n",
      'scripts/req.cjs': "const x = require('@ipodhan/shared/db');\nmodule.exports = x;\n",
      [WF]: wf([...checkout, ...step('dyn', 'node scripts/dyn.mjs'), ...step('req', 'node scripts/req.cjs')]),
    },
    (root) => {
      const text = analyze({ root }).problems.join('\n');
      assert.match(text, /scripts\/dyn\.mjs reaches npm package 'pg'/);
      assert.match(text, /scripts\/req\.cjs reaches npm package '@ipodhan\/shared'/);
    }
  );
});

test('imports inside template literals, strings, comments and regex literals are NOT runtime imports', () => {
  const src = [
    "import { test } from 'node:test';",
    'const fixture = `',
    "import { gte } from 'drizzle-orm';",
    "const pg = require('pg');",
    '`;',
    "const s = \"require('dotenv').config()\";",
    "// import x from 'lodash';",
    "/* await import('chalk') */",
    "const re = /import('yaml')/;",
    "const t = `${await import('node:os')}`;",
    '',
  ].join('\n');
  assert.deepEqual(importSpecifiers(src), ['node:test', 'node:os']);
});

test('working-directory and `cd` set the directory a script path resolves against', () => {
  withRepo(
    {
      'scraper/scripts/x.mjs': "import pg from 'pg';\n",
      [WF]: wf([
        ...checkout,
        '      - name: wd',
        '        working-directory: ./scraper',
        '        run: node scripts/x.mjs',
        ...step('cd', "'cd scraper && node scripts/x.mjs'"),
      ]),
    },
    (root) => {
      const { problems } = analyze({ root });
      assert.equal(problems.length, 2, problems.join('\n'));
      assert.ok(problems.every((p) => p.includes("scraper/scripts/x.mjs reaches npm package 'pg'")));
    }
  );
});

test('a pre-install `--import tsx` preload and a missing script both fail', () => {
  withRepo(
    {
      'scripts/a.mjs': "import 'node:fs';\n",
      [WF]: wf([...checkout, ...step('tsx', 'node --import tsx scripts/a.mjs'), ...step('gone', 'node scripts/missing.mjs')]),
    },
    (root) => {
      const text = analyze({ root }).problems.join('\n');
      assert.match(text, /preloads package 'tsx'/);
      assert.match(text, /runs scripts\/missing\.mjs, which does not exist/);
    }
  );
});

test('an unresolvable relative import fails with its chain', () => {
  withRepo(
    { 'scripts/a.mjs': "import { x } from './nope.mjs';\n", [WF]: wf([...checkout, ...step('a', 'node scripts/a.mjs')]) },
    (root) => assert.match(analyze({ root }).problems.join('\n'), /unresolvable relative import '\.\/nope\.mjs'/)
  );
});

test('nodeInvocationTargets: plain script takes one file, --test takes all, -e takes none', () => {
  assert.deepEqual(nodeInvocationTargets(['node', 'a.mjs', 'b.mjs']).roots, ['a.mjs']);
  assert.deepEqual(nodeInvocationTargets(['node', '--test', 'a.mjs', 'b.mjs']).roots, ['a.mjs', 'b.mjs']);
  assert.deepEqual(nodeInvocationTargets(['node', '-e', "require('pg')"]).roots, []);
  assert.equal(nodeInvocationTargets(['npm', 'test']), null);
});

test('parseWorkflowJobs keeps job boundaries and step order', () => {
  const jobs = parseWorkflowJobs(
    ['jobs:', '  a:', '    steps:', '      - run: npm ci', '      - name: x', '        run: node x.mjs', '  b:', '    steps:', '      - run: node y.mjs', ''].join('\n')
  );
  assert.deepEqual(jobs.map((j) => [j.id, j.steps.map((s) => s.run)]), [['a', ['npm ci', 'node x.mjs']], ['b', ['node y.mjs']]]);
});

test('the REAL repository workflows pass', () => {
  const { problems, checked } = analyze({ root: REPO_ROOT });
  assert.deepEqual(problems, [], problems.join('\n'));
  assert.ok(checked.length >= 50, `expected at least 50 pre-install node invocations, found ${checked.length}`);
});
