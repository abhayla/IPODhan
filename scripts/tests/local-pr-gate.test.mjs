// Drift guard + mapping test for scripts/ci/local-pr-gate.mjs (#1037, #1063).
//
// The guarantee under test: every step of .github/workflows/pr-gate.yml is
// either RUN by the local gate or LISTED (setup / CI-only / heavy) with a
// reason. A step the gate can neither run verbatim nor finds in its table must
// turn this test red in CI, so pr-gate.yml cannot grow a step the local gate
// silently ignores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WORKFLOW, STEP_TABLE, JOB_TABLE, loadSteps, classify, buildPlan, ciWouldRun, childEnv,
} from '../ci/local-pr-gate.mjs';

const CTX = { base: 'b'.repeat(40), head: 'h'.repeat(40), prNumber: '' };

test('every pr-gate.yml step is run or classified (no unclassifiable step)', () => {
  const { steps } = loadSteps();
  assert.ok(steps.length > 100, `parsed only ${steps.length} steps; the parser is not reading pr-gate.yml`);
  const errors = steps.map((s) => classify(s, CTX)).filter((c) => c.mode === 'error');
  assert.deepEqual(errors.map((e) => `${e.key}: ${e.problem}`), []);
});

test('every table entry names a step or job that still exists (no stale classification)', () => {
  const { wf, steps } = loadSteps();
  const keys = new Set(steps.map((s) => `${s.jobId} :: ${s.name}`));
  assert.deepEqual(Object.keys(STEP_TABLE).filter((k) => !keys.has(k)), []);
  assert.deepEqual(Object.keys(JOB_TABLE).filter((j) => !wf.jobs[j]), []);
});

test('step names are unique per job (the table key would be ambiguous otherwise)', () => {
  const { steps } = loadSteps();
  const seen = new Map();
  for (const s of steps) {
    const k = `${s.jobId} :: ${s.name}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([k]) => k), []);
});

// --- mutations of a COPY of the real workflow --------------------------------
function withMutatedWorkflow(mutate, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'local-pr-gate-wf-'));
  try {
    const p = join(dir, 'pr-gate.yml');
    writeFileSync(p, mutate(readFileSync(WORKFLOW, 'utf8')));
    return fn(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const addStep = (yml, stepYaml) => yml.replace(/\n {2}python-tests:\n/, `\n${stepYaml}\n  python-tests:\n`);
const errorsOf = (p) => loadSteps(p).steps.map((s) => classify(s, CTX)).filter((c) => c.mode === 'error');

const UNRUNNABLE = {
  'a step needing a secret': `      - name: Drift probe secret\n        env:\n          TOKEN: \${{ secrets.SOME_TOKEN }}\n        run: node scripts/x.mjs`,
  'a step with an unknown expression': `      - name: Drift probe expr\n        run: node scripts/x.mjs \${{ github.event.pull_request.title }}`,
  'a step that installs packages': `      - name: Drift probe install\n        run: npm ci --ignore-scripts`,
  'a step that edits global git config': `      - name: Drift probe git\n        run: git config --global user.name CI`,
  'a step writing GITHUB_OUTPUT': `      - name: Drift probe output\n        run: echo x=1 >> "$GITHUB_OUTPUT"`,
  'a step with an unknown if': `      - name: Drift probe if\n        if: github.actor == 'x'\n        run: node scripts/x.mjs`,
};
for (const [label, stepYaml] of Object.entries(UNRUNNABLE)) {
  test(`drift: pr-gate.yml gaining ${label} turns this test red`, () => {
    withMutatedWorkflow((y) => addStep(y, stepYaml), (p) => {
      const errs = errorsOf(p);
      assert.equal(errs.length, 1, JSON.stringify(errs));
      assert.match(errs[0].key, /Drift probe/);
    });
  });
}

test('drift: a new job with a service container turns this test red', () => {
  const job = `  drift-db-job:\n    runs-on: ubuntu-latest\n    services:\n      postgres:\n        image: postgres:16\n    steps:\n      - name: Drift DB step\n        run: node scripts/x.mjs\n`;
  withMutatedWorkflow((y) => y.replace(/\n {2}python-tests:\n/, `\n${job}  python-tests:\n`), (p) => {
    const errs = errorsOf(p);
    assert.equal(errs.length, 1, JSON.stringify(errs));
    assert.match(errs[0].problem, /service containers/);
  });
});

test('drift: a new plain step is RUN locally with no table edit (structural default)', () => {
  const stepYaml = `      - name: Drift probe plain\n        run: node --test scripts/tests/some-new.test.mjs`;
  withMutatedWorkflow((y) => addStep(y, stepYaml), (p) => {
    const { plan } = buildPlan({ files: ['scripts/ops/x.mjs'], ctx: CTX, workflowPath: p });
    const probe = plan.find((x) => /Drift probe plain/.test(x.key));
    assert.equal(probe.action, 'run');
    assert.equal(probe.cmd, 'node --test scripts/tests/some-new.test.mjs');
  });
});

test('the gate fails closed: an unclassifiable step is an error entry in the plan', () => {
  withMutatedWorkflow((y) => addStep(y, UNRUNNABLE['a step needing a secret']), (p) => {
    const { plan } = buildPlan({ files: ['web/app/page.tsx'], ctx: CTX, workflowPath: p });
    assert.ok(plan.some((x) => x.action === 'error' && /secrets\.SOME_TOKEN/.test(x.problem)));
  });
});

// --- tree mapping on the real workflow ---------------------------------------
const runKeys = (files) => buildPlan({ files, ctx: CTX }).plan.filter((p) => p.action === 'run').map((p) => p.key);
const has = (keys, re) => keys.some((k) => re.test(k));

test('a migration-only change runs the scraper suite and stage harness (#1377 class)', () => {
  const keys = runKeys(['web/drizzle/migrations/0099_probe.sql', 'web/drizzle/migrations/meta/_journal.json']);
  assert.ok(has(keys, /Run scraper unit test suite/));
  assert.ok(has(keys, /Run pipeline stage harness/));
});

test('a web-only change runs web lint, type-check and unit tests but not the scraper suite', () => {
  const keys = runKeys(['web/app/page.tsx']);
  for (const re of [/gate :: Run lint/, /gate :: Run type-check/, /gate :: Run unit tests/]) assert.ok(has(keys, re), String(re));
  assert.ok(!has(keys, /Run scraper unit test suite/));
});

test('a scripts-only change still runs the integration-coverage and detection-change gates', () => {
  const keys = runKeys(['scripts/ops/foo.mjs']);
  assert.ok(has(keys, /Every scraper integration test is run by CI/));
  assert.ok(has(keys, /Run detection-change gate/));
  assert.ok(!has(keys, /Run unit tests/));
});

test('next build is heavy: listed, not run, unless --full', () => {
  const plan = buildPlan({ files: ['web/app/page.tsx'], ctx: CTX }).plan;
  assert.equal(plan.find((p) => p.key === 'web-build :: next build').action, 'skip');
  const full = buildPlan({ files: ['web/app/page.tsx'], ctx: CTX, full: true }).plan;
  assert.equal(full.find((p) => p.key === 'web-build :: next build').action, 'run');
});

test('CI-only steps are listed with a reason, never silently dropped', () => {
  const plan = buildPlan({ files: ['scraper/src/x.ts'], ctx: CTX }).plan;
  const ciOnly = plan.filter((p) => p.action === 'ci-only');
  assert.ok(ciOnly.length >= 5);
  for (const c of ciOnly) assert.ok(c.reason && c.reason.length > 10, c.key);
});

test('docs-only paths follow pr-gate.yml `paths:` (CI skips them, so does the gate)', () => {
  const { wf } = loadSteps();
  assert.equal(ciWouldRun(['docs/design/x.md', 'README.md'], wf), false);
  assert.equal(ciWouldRun(['docs/reviews/failure-classes/x.json'], wf), true);
  assert.equal(ciWouldRun(['web/README.md', 'web/app/x.ts'], wf), true);
  assert.equal(runKeys(['docs/design/x.md']).length, 0);
});

test('substituted expressions: base sha and base ref reach the command', () => {
  const plan = buildPlan({ files: ['scripts/ops/x.mjs'], ctx: CTX }).plan;
  const det = plan.find((p) => p.key === 'detection-change-gate :: Run detection-change gate');
  assert.equal(det.cmd.trim(), 'node scripts/ci/require-detection-change.mjs origin/main HEAD');
  const trace = plan.find((p) => p.key === 'gate :: Design traceability (OD-52)');
  assert.ok(trace.cmd.includes(CTX.base));
});

test('child env drops git repo-local vars and DB/Redis vars CI never has (#1037 incident)', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { GIT_DIR: '/x/.git/worktrees/y', GIT_INDEX_FILE: '/x/i', DATABASE_URL: 'postgres://u@h/db', REDIS_HOST: 'h' });
    const env = childEnv({ GH_TOKEN: '', FOO: 'bar' });
    for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'DATABASE_URL', 'REDIS_HOST', 'GH_TOKEN']) assert.equal(env[k], undefined, k);
    assert.equal(env.FOO, 'bar');
    assert.equal(env.CI, 'true');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
