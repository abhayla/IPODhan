#!/usr/bin/env node
// local-pr-gate.mjs — runs .github/workflows/pr-gate.yml's OWN steps on this
// machine, for the trees a branch touched, before the push (run-discipline B3,
// issues #1037 / #1063).
//
// WHY: a CI round costs ~15 min and a rebase. Measured misses that only CI
// caught: a hard-coded count in scraper/tests/unit/pipeline-stages/fixtures/
// stage-0/expected-schema.json broke CI for a migration PR (#1377, the 7th
// "hardcoded counts break far from the change" round); four PRs pushed
// integration tests missing from pr-gate.yml's list. Both are steps pr-gate.yml
// already runs; nothing ran them before the push.
//
// TRUST (round 3): the steps are read from pr-gate.yml AS MERGED ON origin/main
// (`git show refs/remotes/origin/main:...`, after a bounded fetch), never from
// the branch's working copy. A step the branch adds, changes or removes (run,
// env, working-directory, if, or the job/workflow settings that reach it) is
// listed "changed in this branch: CI-only" and not run. A branch cannot get a new
// command run through pr-gate.yml, the gate files or the allow-listed npm
// scripts: when it changes any of those, the whole run is CI-only. A branch's own
// repo scripts called by main's steps do run (that is the gate's purpose).
// origin/main unreadable = refuse. The
// allow-list below is the second layer, against honest mistakes in main's steps.
//
// HOW (structural, not a hand-copied list): the steps are READ FROM pr-gate.yml
// at run time. A step with a `run:` runs locally, verbatim, in its
// working-directory with its env, ONLY IF every command line in it starts with
// an allowed program form (scripts/ci/local-gate-shell-allowlist.mjs: node,
// npx of a listed tool, npm run of a listed script, repo scripts, python tests,
// cd, shell builtins). The table below can instead classify a step as setup
// (installs, toolchain), CI-only (needs a service container, a secret, or the
// runner) or heavy (opt-in with --full). Everything else is UNCLASSIFIED: any
// other command, any unknown ${{ }} expression, and any `if:` or `env:` at
// workflow, job or step level that the gate does not model. The gate then
// REFUSES to run, and scripts/tests/local-pr-gate.test.mjs fails in CI, so
// pr-gate.yml cannot gain a step or condition this gate silently runs or
// ignores. (Round 1 used a deny-list; an allow-list fails closed on dangers
// nobody listed: git config, gh, curl, ssh.)
//
// Usage:
//   npm run gate:local                 # gate merge-base(origin/main)..HEAD
//   node scripts/ci/local-pr-gate.mjs --plan          # print the plan, run nothing
//   node scripts/ci/local-pr-gate.mjs --base <sha>    # explicit base
//   node scripts/ci/local-pr-gate.mjs --full          # also run heavy steps (next build)
//   node scripts/ci/local-pr-gate.mjs --keep-going    # run every step, report all failures
//   node scripts/ci/local-pr-gate.mjs --files a,b     # pretend these paths changed (plan/test)
//   node scripts/ci/local-pr-gate.mjs --only <regex>  # run only matching planned steps (re-run one failure)
// Skip from the optional pre-push hook: LOCAL_PR_GATE_SKIP=1 git push
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { unclassifiedCommands, envProblem, NPM_SCRIPTS } from './local-gate-shell-allowlist.mjs';

const require = createRequire(import.meta.url);
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'pr-gate.yml');

// ---- trees -----------------------------------------------------------------
// A step runs locally only when the push touched a tree it reads. Trees are
// wider than the obvious owner on purpose: a migration under web/drizzle/
// changes the scraper's stage-0 expected-schema counts (#1377), and a root
// package.json/lockfile change can break anything.
const ROOT_PKG = String.raw`package(-lock)?\.json$|tsconfig[^/]*\.json$`;
export const TREES = {
  any: /./,
  web: new RegExp(String.raw`^(web/|packages/shared/|${ROOT_PKG})`),
  scraper: new RegExp(String.raw`^(scraper/|packages/shared/|web/drizzle/|${ROOT_PKG})`),
  webOrScraper: new RegExp(String.raw`^(web/|scraper/|packages/shared/|${ROOT_PKG})`),
  shared: new RegExp(String.raw`^(packages/shared/|${ROOT_PKG})`),
  python: /^(scraper\/scripts\/|scraper\/.*\.py$|scraper\/config\/)/,
  hooks: /^\.claude\/hooks\//,
  // ~15 min of bash suites (measured 2026-10-01): only for deploy/ops/shell changes.
  deploy: /^(scripts\/(deploy|ops)\/|scripts\/[^/]*\.sh$|scripts\/tests\/[^/]*\.sh$|scripts\/tests\/lib\/|\.github\/workflows\/deploy|ecosystem\.config|scraper\/config\/|deploy\/)/,
};

// ---- classification ----------------------------------------------------------
// Keyed "<job id> :: <step name>". mode:
//   setup   — toolchain / install; the developer's checkout already has it
//   ci-only — cannot run here (service container, secret, runner-only state)
//   heavy   — runs only with --full (printed, never silently skipped)
//   local   — runs when its run block passes the shell allow-list; `tree`
//             narrows it, `cmd` replaces a run block that must not run verbatim
//             here (the replacement is allow-listed too)
const NPM_CI_SETUP = { mode: 'setup', reason: 'npm ci: the checkout already has node_modules (never reinstall a junctioned worktree)' };
export const STEP_TABLE = {
  'gate :: Install dependencies': NPM_CI_SETUP,
  'gate :: Build shared package': { mode: 'local', tree: 'webOrScraper' },
  'gate :: Scraper import smoke (real ESM runtime)': { mode: 'local', tree: 'scraper' },
  'gate :: Run lint': { mode: 'local', tree: 'web' },
  'gate :: Run type-check': { mode: 'local', tree: 'web' },
  'gate :: Run unit tests': { mode: 'local', tree: 'web' },
  'gate :: Type-check scraper scripts (T-433 MAJOR-4 - scraper/tsconfig.json only ever covered src/**)': { mode: 'local', tree: 'scraper' },
  'gate :: Type-check scraper/src against a fresh shared build, shrink-only baseline (#890)': { mode: 'local', tree: 'scraper' },
  'gate :: Run shared package unit tests (T-433 MAJOR-5 - packages/shared test files had no runner)': { mode: 'local', tree: 'shared' },
  'gate :: Run TZ-explicit case driver (issue #478)': { mode: 'local', tree: 'scraper' },
  'gate :: Run scraper unit test suite (full, T-301)': { mode: 'local', tree: 'scraper' },
  'gate :: Run pipeline stage harness (test ladder, issue #258)': { mode: 'local', tree: 'scraper' },

  'python-tests :: Install test dependencies': { mode: 'setup', reason: 'pip install: install scraper/scripts/requirements-test.txt once yourself' },
  'python-tests :: Run scraper python extractor test suite': { mode: 'local', tree: 'python' },
  'python-tests :: Board-owed-guard hook self-tests (project-level, 2026-09-25)': {
    mode: 'local', tree: 'hooks',
    // CI writes a throwaway identity into the runner's GLOBAL git config; never
    // touch the developer's. The fixtures only need some identity, which a
    // developer machine already has.
    cmd: 'python .claude/hooks/tests/board-owed-guard.test.py',
  },
  'python-tests :: DB-tunnel SessionEnd hook self-tests (project-level, 2026-09-25)': { mode: 'local', tree: 'hooks' },
  // YAML reads ' #1080)' in this step's name as a comment, so its name ends at 'PR'.
  'python-tests :: DB-tunnel script self-tests (round 2, PR': { mode: 'local', tree: 'hooks' },

  'web-build :: Check whether web/** or packages/shared/** changed': { mode: 'setup', reason: 'path filter: the local gate applies the web tree itself' },
  'web-build :: Install dependencies': NPM_CI_SETUP,
  'web-build :: Build shared package': { mode: 'local', tree: 'web' },
  'web-build :: Shared .js-suffixed imports resolve under webpack too (fast pre-check)': { mode: 'local', tree: 'web' },
  'web-build :: next build': { mode: 'heavy', tree: 'web', reason: 'next build (~5 min, 6 GB heap): run with --full' },
};
// Steps whose result depends on the OS, not on the change: on a Windows
// checkout they fail on CRLF line endings or Linux-only tools, while CI's
// ubuntu runner is green. On those platforms they are LISTED, never run, so a
// red local run always means the change. Measured 2026-10-01 on Windows 11 /
// Git Bash (the full proof run in PR #1037's successor).
export const LINUX_ONLY = {
  'gate :: VPS runtime preflight self-test (T-406)': 'asserts /etc/timezone, timedatectl and python3 on PATH, which exist on the VPS and the ubuntu runner only',
  'gate :: main-gate.yml structural self-test (#616/#681)': 'asserts LF line endings; a core.autocrlf Windows checkout has CRLF',
  'deploy-script-tests :: Run config-only deploy release-link test suite (item 3 S5, symlink-only on Linux)': 'needs real symlinks, which Git Bash on Windows copies',
};
// Whole jobs that cannot run here.
export const JOB_TABLE = {
  'scraper-document-integration': { mode: 'ci-only', reason: 'needs the postgres service container (DB-backed integration tests)' },
  'deploy-script-tests': { tree: 'deploy' },
};
// The only step `if:` the gate understands: the web-build path filter, which
// it replaces with the web tree.
export const KNOWN_IFS = { "steps.filter.outputs.run == 'true'": 'web' };

// Workflow- and job-level `if:` conditions the gate understands. None: a job
// that only runs on push/schedule/label would otherwise run every step here.
export const KNOWN_JOB_IFS = {};

// ---- ${{ }} expressions ------------------------------------------------------
export function expressionValues(ctx) {
  return {
    'github.event.pull_request.base.sha': ctx.base,
    'github.event.pull_request.head.sha': ctx.head,
    'github.base_ref': 'main',
    'github.event.pull_request.base.ref': 'main',
    'github.token': '',
    'github.event.pull_request.number': ctx.prNumber || '',
  };
}
// Non-greedy up to the closing `}}`, so a nested `format('{0}', x)` is one expression.
const EXPR_RE = /\$\{\{([\s\S]*?)\}\}/g;
export function substitute(text, ctx) {
  const vals = expressionValues(ctx);
  const unknown = [];
  const out = String(text).replace(EXPR_RE, (m, raw) => {
    const e = raw.trim();
    if (Object.prototype.hasOwnProperty.call(vals, e)) return vals[e];
    unknown.push(e);
    return m;
  });
  if (!unknown.length && /\$\{\{/.test(out)) unknown.push('unparsed ${{');
  return { out, unknown };
}

// ---- workflow --------------------------------------------------------------
export function loadSteps(workflowPath = WORKFLOW) {
  return parseWorkflow(readFileSync(workflowPath, 'utf8'));
}

// Everything that decides what a step does, for comparing the branch's copy of a
// step with main's. Workflow env/defaults/if and the job's own settings are part
// of every step's fingerprint, because they reach every step.
function fingerprint(wf, job, st) {
  const jobRest = { ...(job || {}) };
  delete jobRest.steps;
  return JSON.stringify({ wf: { env: wf.env, defaults: wf.defaults, if: wf.if }, job: jobRest, step: st });
}

export function parseWorkflow(text) {
  const YAML = require('yaml');
  const wf = YAML.parse(String(text).replace(/\r\n/g, '\n')) || {};
  const steps = [];
  // Workflow-level conditions and defaults apply to every job.
  const wfProblems = [];
  if (wf.defaults) wfProblems.push('workflow-level defaults');
  if (wf.if) wfProblems.push(`workflow-level if: ${wf.if}`);
  if (wfProblems.length) steps.push({ jobId: '(workflow)', name: '(workflow)', fp: fingerprint(wf, null, null), problem: `${wfProblems.join(', ')}: the local gate does not model them` });
  for (const [jobId, job] of Object.entries(wf.jobs || {})) {
    const unmodelled = [];
    if (job.defaults || job.container || job.strategy) unmodelled.push('defaults/container/strategy');
    if (job.if !== undefined && !KNOWN_JOB_IFS[job.if]) unmodelled.push(`job-level if: ${job.if}`);
    if (job['continue-on-error'] !== undefined) unmodelled.push('continue-on-error');
    if (unmodelled.length) steps.push({ jobId, name: '(job)', fp: fingerprint(wf, job, null), problem: `job ${jobId} uses ${unmodelled.join(', ')}, which the local gate does not model` });
    // Workflow and job env reach every step; a step's own env wins.
    const inherited = { ...(wf.env || {}), ...(job.env || {}) };
    (job.steps || []).forEach((st, index) => {
      steps.push({
        jobId, index, hasServices: Boolean(job.services), fp: fingerprint(wf, job, st),
        name: st.name || st.uses || `step ${index + 1}`,
        uses: st.uses, run: st.run, if: st.if, shell: st.shell,
        continueOnError: st['continue-on-error'],
        env: { ...inherited, ...(st.env || {}) }, workdir: st['working-directory'] || '.',
      });
    });
  }
  return { wf, steps };
}

export function safeWorkdir(wd) {
  const s = String(wd ?? '');
  if (!s || /^([/\\~]|[A-Za-z]:)/.test(s) || /[$`{}*?]/.test(s)) return false;
  return !s.split(/[/\\]/).some((seg) => seg === '..' || seg.toLowerCase() === '.git');
}

// One decision per step. `problem` set = the gate cannot handle the step: the
// gate fails closed on it and the drift test fails in CI.
export function classify(step, ctx = { base: 'BASE', head: 'HEAD' }) {
  const key = `${step.jobId} :: ${step.name}`;
  const job = JOB_TABLE[step.jobId] || {};
  const entry = STEP_TABLE[key];
  if (step.problem) {
    // A job that never runs here (ci-only) cannot misbehave here, whatever its conditions.
    if (job.mode === 'ci-only') return { key, mode: 'ci-only', reason: job.reason };
    return { key, mode: 'error', problem: step.problem };
  }
  if (step.continueOnError !== undefined && step.run && job.mode !== 'ci-only') {
    return { key, mode: 'error', problem: 'continue-on-error: the step passes in CI when it fails, which the local gate does not model' };
  }
  if (!step.run) return { key, mode: 'setup', reason: `uses: ${step.uses}` };
  if (job.mode === 'ci-only') return { key, mode: 'ci-only', reason: job.reason };
  if (step.hasServices) {
    return { key, mode: 'error', problem: `job ${step.jobId} has service containers; classify the job in JOB_TABLE` };
  }
  if (entry && (entry.mode === 'setup' || entry.mode === 'ci-only')) return { key, mode: entry.mode, reason: entry.reason };
  let tree = entry?.tree || job.tree || 'any';
  if (step.if) {
    const t = KNOWN_IFS[step.if];
    if (!t) return { key, mode: 'error', problem: `unknown step if: ${step.if}` };
    if (!entry?.tree) tree = t;
  }
  if (step.shell) return { key, mode: 'error', problem: `custom shell: ${step.shell}` };
  if (!safeWorkdir(step.workdir)) {
    return { key, mode: 'error', problem: `working-directory ${step.workdir} is not a repo-relative path without .. or a .git segment` };
  }
  const raw = entry?.cmd || step.run;
  const { out: cmd, unknown } = substitute(raw, ctx);
  const env = {};
  const envProblems = [];
  for (const [k, v] of Object.entries(step.env)) {
    const s = substitute(String(v), ctx);
    unknown.push(...s.unknown);
    env[k] = s.out;
    const bad = s.unknown.length ? null : envProblem(k, s.out);
    if (bad) envProblems.push(bad);
  }
  if (unknown.length) {
    const secret = unknown.find((u) => /^secrets\./.test(u));
    return { key, mode: 'error', problem: secret ? `needs ${secret}; classify it ci-only` : `unknown expression(s): ${unknown.join(', ')}` };
  }
  if (LINUX_ONLY[key] && (ctx.platform || process.platform) !== 'linux') {
    return { key, mode: 'ci-only', reason: `Linux-only here: ${LINUX_ONLY[key]}` };
  }
  if (envProblems.length) return { key, mode: 'error', problem: `env not safe to apply locally: ${envProblems.join('; ')}` };
  const offenders = unclassifiedCommands(cmd);
  if (offenders.length) {
    const o = offenders[0];
    return { key, mode: 'error', problem: `unclassified command in run block, line ${o.line}: \`${o.text}\` - ${o.reason}${offenders.length > 1 ? ` (+${offenders.length - 1} more)` : ''}` };
  }
  return { key, mode: entry?.mode === 'heavy' ? 'heavy' : 'local', tree, cmd, env, workdir: step.workdir, reason: entry?.reason };
}

// pr-gate.yml's own `on.pull_request.paths` (ordered, later wins, "!" negates):
// a push whose every file is excluded does not run pr-gate.yml in CI either.
export function globToRegex(glob) {
  if (/[?[\]{}]/.test(glob)) throw new Error(`local-pr-gate: unsupported glob token in '${glob}'`);
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob.startsWith('**/', i)) { re += '(?:.*/)?'; i += 2; continue; }
    if (glob.startsWith('**', i)) { re += '.*'; i += 1; continue; }
    if (glob[i] === '*') { re += '[^/]*'; continue; }
    re += glob[i].replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export function ciWouldRun(files, wf) {
  const pats = wf?.on?.pull_request?.paths;
  if (!pats) return files.length > 0;
  const rules = pats.map((p) => (p.startsWith('!') ? { neg: true, re: globToRegex(p.slice(1)) } : { neg: false, re: globToRegex(p) }));
  return files.some((f) => {
    let inc = false;
    for (const r of rules) if (r.re.test(f)) inc = !r.neg;
    return inc;
  });
}

// Round 3 trust model: the steps that RUN come from the reviewed workflow on
// origin/main (`trustedText`), never from the branch's working copy. A step the
// branch adds, changes or removes (any part of it, or the job/workflow settings
// that reach it) is LISTED as changed and not run. The gate files and the
// allow-listed npm scripts are compared with origin/main the same way (see
// gateFileChanges); any difference makes every step CI-only. A branch's own repo
// scripts called by main's unchanged steps do run (that is the gate's purpose).
const stepKey = (s) => `${s.jobId} :: ${s.name}`;
function keyed(steps) {
  const seen = new Map();
  const out = new Map();
  for (const s of steps) {
    const k = stepKey(s);
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    out.set(n ? `${k} #${n + 1}` : k, s);
  }
  return out;
}
export const CHANGED_REASON = 'changed in this branch: CI-only (not run locally)';

// Branch-owned files that decide what the local gate runs. Each is compared with
// origin/main; a difference means the branch could steer what runs here.
export const GATE_FILES = ['scripts/ci/local-pr-gate.mjs', 'scripts/ci/local-gate-shell-allowlist.mjs', '.husky/pre-push'];
export const PACKAGE_JSONS = ['package.json', 'web/package.json', 'scraper/package.json', 'packages/shared/package.json'];
const toLf = (t) => (typeof t === 'string' ? t.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)) : t);
const scriptsOf = (text) => {
  try { return JSON.parse(text).scripts || {}; } catch { return null; }
};
// readMain(path) -> text, or null when the path does not exist on main; it throws
// when main is unreadable (the caller refuses). readBranch(path) -> text or null.
export function gateFileChanges({ readMain, readBranch }) {
  const out = [];
  for (const path of GATE_FILES) {
    const m = readMain(path);
    const b = readBranch(path);
    if (toLf(m) !== toLf(b)) out.push({ path, why: 'differs from origin/main' });
  }
  for (const path of PACKAGE_JSONS) {
    const mt = readMain(path);
    const bt = readBranch(path);
    if (mt === null && bt === null) continue;
    const ms = mt === null ? null : scriptsOf(mt);
    const bs = bt === null ? null : scriptsOf(bt);
    if (!ms || !bs) { out.push({ path, why: 'added, removed or unparseable vs origin/main' }); continue; }
    const diff = [...NPM_SCRIPTS].filter((n) => ms[n] !== bs[n]);
    if (diff.length) out.push({ path, why: `allow-listed npm script(s) differ from origin/main: ${diff.join(', ')}` });
  }
  return out;
}

export function buildPlan({ files, ctx, trustedText, workflowPath = WORKFLOW, full = false, gateChanged = [] }) {
  if (typeof trustedText !== 'string' || !trustedText.trim()) {
    throw new Error('local-pr-gate: no trusted (origin/main) pr-gate.yml text; refusing to plan from the branch copy');
  }
  const { wf, steps: mainSteps } = parseWorkflow(trustedText);
  const branch = keyed(loadSteps(workflowPath).steps);
  const main = keyed(mainSteps);
  const runs = ciWouldRun(files, wf);
  const plan = [];
  if (gateChanged.length) {
    const named = gateChanged.map((g) => `${g.path} (${g.why})`).join('; ');
    const reason = `gate-defining file changed in this branch: ${named}; CI-only (not run locally)`;
    for (const k of new Set([...branch.keys(), ...main.keys()])) plan.push({ key: k, mode: 'gate-changed', action: 'ci-only', reason });
    return { plan, ciRuns: runs, gateChanged };
  }
  const seen = new Set();
  for (const k of branch.keys()) {
    if (!main.has(k)) plan.push({ key: k, mode: 'changed', action: 'ci-only', reason: `${CHANGED_REASON} (new step)` });
  }
  for (const [k, step] of main) {
    const b = branch.get(k);
    if (!b || b.fp !== step.fp) {
      plan.push({ key: k, mode: 'changed', action: 'ci-only', reason: b ? CHANGED_REASON : `${CHANGED_REASON} (removed in this branch)` });
      continue;
    }
    const c = classify(step, ctx);
    if (c.mode === 'local' || c.mode === 'heavy') {
      const touched = files.some((f) => TREES[c.tree].test(f));
      if (!runs || !touched) { plan.push({ ...c, action: 'skip', why: runs ? `tree '${c.tree}' not touched` : 'pr-gate.yml does not run for these paths' }); continue; }
      if (c.mode === 'heavy' && !full) { plan.push({ ...c, action: 'skip', why: c.reason }); continue; }
      const sig = `${c.workdir}\0${c.cmd}\0${JSON.stringify(c.env)}`;
      if (seen.has(sig)) { plan.push({ ...c, action: 'skip', why: 'same command already in this plan' }); continue; }
      seen.add(sig);
      plan.push({ ...c, action: 'run' });
    } else if (c.mode === 'error') {
      plan.push({ ...c, action: 'error' });
    } else {
      plan.push({ ...c, action: c.mode });
    }
  }
  return { plan, ciRuns: runs };
}

// ---- git -------------------------------------------------------------------
// git exports GIT_DIR into hooks (from a linked worktree: .git/worktrees/<n>);
// a fixture test inheriting it wrote into the real repo on 2026-09-25 (#1037).
const GIT_LOCAL_ENV = ['GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR'];
// CI has no database, Redis or tunnel. A developer shell often has them; a
// unit test that silently reaches the dev DB is not a CI mirror.
const CI_ABSENT_ENV = /^(DATABASE_URL|STAGE0_DATABASE_URL|TEST_DATABASE_URL|REDIS_URL|REDIS_HOST|REDIS_PORT|REDIS_PASSWORD|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)$/;
export function childEnv(stepEnv) {
  const env = { ...process.env };
  for (const k of GIT_LOCAL_ENV) delete env[k];
  for (const k of Object.keys(env)) if (CI_ABSENT_ENV.test(k)) delete env[k];
  env.CI = 'true';
  for (const [k, v] of Object.entries(stepEnv || {})) {
    if (v === '') delete env[k]; else env[k] = v; // e.g. GH_TOKEN: gh falls back to its own login
  }
  return env;
}

function git(args) {
  const env = { ...process.env };
  for (const k of GIT_LOCAL_ENV) delete env[k];
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseArgs(argv) {
  const a = { plan: false, full: false, keepGoing: false, base: null, files: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--plan') a.plan = true;
    else if (x === '--full') a.full = true;
    else if (x === '--keep-going') a.keepGoing = true;
    else if (x === '--base') a.base = argv[++i];
    else if (x === '--files') a.files = argv[++i].split(',').filter(Boolean);
    else if (x === '--only') a.only = new RegExp(argv[++i], 'i');
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

// The reviewed workflow: pr-gate.yml as merged on origin/main. Fetched first
// (bounded, never prompting); a failed fetch falls back to the local
// refs/remotes/origin/main, which is still merged content. Unreadable = throw,
// and main() refuses (fail closed).
export const TRUSTED_REF = 'refs/remotes/origin/main';
export function readTrustedWorkflow() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const k of GIT_LOCAL_ENV) delete env[k];
  const f = spawnSync('git', ['fetch', '--quiet', '--no-tags', 'origin', 'main'], { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 30000 });
  if (f.status !== 0) console.log(`local-pr-gate: WARNING - git fetch origin main failed (${f.error ? f.error.code || f.error.message : `exit ${f.status}`}); using the local ${TRUSTED_REF}.`);
  return git(['show', `${TRUSTED_REF}:.github/workflows/pr-gate.yml`]);
}

function fmtSecs(ms) { return `${(ms / 1000).toFixed(1)}s`; }

function readMainPath(path) {
  try { return git(['show', `${TRUSTED_REF}:${path}`]); } catch (e) {
    if (/exists on disk, but not in|does not exist in|path .* does not exist/i.test(String(e.stderr || e.message))) return null;
    throw e;
  }
}
function readBranchPath(path) {
  try { return readFileSync(join(REPO_ROOT, path), 'utf8'); } catch { return null; }
}

export function main(argv = process.argv.slice(2), { readTrusted = readTrustedWorkflow, readMain = readMainPath, readBranch = readBranchPath } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('usage: node scripts/ci/local-pr-gate.mjs [--plan] [--full] [--keep-going] [--base <ref>] [--files a,b] [--only <regex>]');
    return 0;
  }
  const head = git(['rev-parse', 'HEAD']);
  let base = args.base ? git(['rev-parse', args.base]) : null;
  if (!base) {
    try { base = git(['merge-base', 'refs/remotes/origin/main', 'HEAD']); } catch {
      console.error('local-pr-gate: cannot find merge-base with refs/remotes/origin/main; run `git fetch origin main` or pass --base');
      return 2;
    }
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty && !args.files) console.log('local-pr-gate: WARNING - uncommitted tracked changes; steps run on the working tree, the changed-file list comes from commits.');
  const files = args.files || git(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean);
  let prNumber = '';
  if (!args.plan && !args.files) {
    const r = spawnSync('gh', ['pr', 'view', '--json', 'number', '-q', '.number'], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (r.status === 0) prNumber = r.stdout.trim();
  }
  const ctx = { base, head, prNumber };
  let trustedText;
  try {
    trustedText = readTrusted();
    if (typeof trustedText !== 'string' || !trustedText.trim()) throw new Error('empty');
  } catch (e) {
    console.error(`local-pr-gate: REFUSED - cannot read pr-gate.yml from ${TRUSTED_REF} (${String(e.message || e).split(/\r?\n/)[0]}). The gate runs only reviewed, merged steps; run 'git fetch origin main'.`);
    return 2;
  }
  let gateChanged;
  try {
    gateChanged = gateFileChanges({ readMain, readBranch });
  } catch (e) {
    console.error(`local-pr-gate: REFUSED - cannot read the gate files from ${TRUSTED_REF} (${String(e.message || e).split(/\r?\n/)[0]}). Run 'git fetch origin main'.`);
    return 2;
  }
  if (gateChanged.length) console.log(`local-pr-gate: this branch changes gate-defining file(s): ${gateChanged.map((g) => `${g.path} (${g.why})`).join('; ')}. A branch cannot steer what runs here, so every step is CI-only; CI runs them on the PR.`);
  const { plan, ciRuns } = buildPlan({ files, ctx, trustedText, full: args.full, gateChanged });

  console.log(`local-pr-gate: ${files.length} changed file(s) in ${base.slice(0, 8)}..${head.slice(0, 8)} (runs the steps of pr-gate.yml as merged on origin/main)`);
  if (!ciRuns) console.log('local-pr-gate: every changed path is excluded by pr-gate.yml `paths:` (docs-only); CI will not run it either.');
  const errors = plan.filter((p) => p.action === 'error');
  const toRun = plan.filter((p) => p.action === 'run' && (!args.only || args.only.test(p.key)));
  if (args.only) console.log(`local-pr-gate: --only ${args.only} keeps ${toRun.length} of ${plan.filter((p) => p.action === 'run').length} planned step(s); this is NOT a full gate run.`);
  const changed = plan.filter((p) => p.mode === 'changed');
  const ciOnly = plan.filter((p) => p.action === 'ci-only' && p.mode !== 'changed');
  const heavy = plan.filter((p) => p.action === 'skip' && p.mode === 'heavy' && ciRuns && files.some((f) => TREES[p.tree].test(f)));
  const treeSkips = plan.filter((p) => p.action === 'skip' && p.mode !== 'heavy');

  console.log(`  run here: ${toRun.length}   CI-only: ${ciOnly.length}   changed in branch (CI-only): ${changed.length}   heavy (--full): ${heavy.length}   tree not touched: ${treeSkips.length}   setup: ${plan.filter((p) => p.action === 'setup').length}`);
  for (const p of ciOnly) console.log(`  CI-only  ${p.key} — ${p.reason}`);
  for (const p of changed) console.log(`  CHANGED  ${p.key} — ${p.reason}`);
  for (const p of heavy) console.log(`  NOT RUN  ${p.key} — ${p.why}`);
  if (errors.length) {
    console.error('\nlocal-pr-gate: REFUSED — pr-gate.yml has step(s) this gate can neither run nor classify:');
    for (const e of errors) console.error(`  ${e.key}: ${e.problem}`);
    console.error('Classify each in STEP_TABLE / JOB_TABLE of scripts/ci/local-pr-gate.mjs.');
    return 3;
  }
  if (args.plan) {
    for (const p of plan) console.log(`  [${p.action}] ${p.key}${p.why ? ` (${p.why})` : ''}`);
    return 0;
  }
  if (!toRun.length) { console.log('local-pr-gate: nothing to run for these paths.'); return 0; }

  const logDir = join(REPO_ROOT, '.local-gate', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(logDir, { recursive: true });
  const t0 = Date.now();
  const failed = [];
  toRun.forEach((p, i) => {
    const log = join(logDir, `${String(i + 1).padStart(3, '0')}.log`);
    const s = Date.now();
    process.stdout.write(`[${i + 1}/${toRun.length}] ${p.key} ... `);
    if (failed.length && !args.keepGoing) { console.log('not run (an earlier step failed)'); return; }
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', p.cmd], {
      cwd: join(REPO_ROOT, p.workdir), env: childEnv(p.env), encoding: 'utf8', maxBuffer: 1 << 28,
    });
    writeFileSync(log, `$ (cd ${p.workdir} && ${p.cmd})\n\n${r.stdout || ''}\n${r.stderr || ''}\n${r.error ? String(r.error) : ''}`);
    const ok = r.status === 0;
    console.log(`${ok ? 'PASS' : `FAIL (exit ${r.status})`} ${fmtSecs(Date.now() - s)}`);
    if (!ok) {
      failed.push({ p, log });
      const tail = readFileSync(log, 'utf8').split('\n').slice(-40).join('\n');
      console.log(`---- ${p.key}: last 40 lines (full log ${log}) ----\n${tail}\n----`);
    }
  });
  const total = fmtSecs(Date.now() - t0);
  if (failed.length) {
    console.log(`\nlocal-pr-gate: RED — ${failed.length} step(s) failed in ${total}:`);
    for (const f of failed) console.log(`  ${f.p.key}\n    (cd ${f.p.workdir} && ${f.p.cmd.trim().split('\n').join(' ; ')})\n    log: ${f.log}`);
    return 1;
  }
  console.log(`\nlocal-pr-gate: GREEN — ${toRun.length} step(s) passed in ${total}. CI-only steps above still run on the PR.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
