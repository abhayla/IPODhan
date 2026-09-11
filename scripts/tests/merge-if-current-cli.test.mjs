// End-to-end guards for scripts/ops/merge-if-current.mjs.
//
// The unit suite covers the clause logic. This one drives the real CLI against
// a REAL temporary git repository in which a stale-green scenario is actually
// constructed (main moves a file the branch imports), and asserts the process
// EXIT CODE - because the exit code is the whole mechanism. No live PR is ever
// touched: PR metadata is injected with --pr-json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'ops', 'merge-if-current.mjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(repo, rel, body) {
  const abs = path.join(repo, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

const CONSOLIDATOR = [
  "import { persist } from './persister.js';",
  "export const run = () => persist();",
].join('\n');

/**
 * Builds a repo with a base commit, a `feature` branch off it, and whatever
 * `mainMoves` does on main afterwards. Returns { repo, head }.
 */
function buildRepo(mainMoves, branchEdits) {
  const repo = mkdtempSync(path.join(tmpdir(), 'merge-if-current-'));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);

  write(repo, 'scraper/src/services/persister.ts', 'export const persist = () => 1;\n');
  write(repo, 'scraper/src/services/consolidator.ts', CONSOLIDATOR);
  write(repo, '.github/workflows/pr-gate.yml', 'name: pr-gate\n');
  write(repo, 'docs/reviews/detection-checks.json', '{"checks":[]}\n');
  write(repo, 'web/app/page.tsx', 'export default () => null;\n');
  write(repo, 'docs/x.md', 'base\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'base']);

  git(repo, ['checkout', '--quiet', '-b', 'feature']);
  branchEdits(repo);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'branch work']);
  const head = git(repo, ['rev-parse', 'HEAD']);

  git(repo, ['checkout', '--quiet', 'main']);
  mainMoves(repo);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'main moves on']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', git(repo, ['rev-parse', 'HEAD'])]);

  return { repo, head };
}

function prJson(repo, overrides = {}) {
  const payload = {
    number: 588,
    title: 'a pull request',
    url: 'https://example.invalid/pr/588',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    headRefOid: 'deadbeef',
    headRefName: 'feature',
    baseRefName: 'main',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'pr-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
    ...overrides,
  };
  const file = path.join(repo, 'pr.json');
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

function run(repo, args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return {
      code: err.status,
      stdout: (err.stdout ?? '').toString(),
      stderr: (err.stderr ?? '').toString(),
    };
  }
}

const touchDocs = (repo) => write(repo, 'docs/x.md', 'main moved on\n');
const editConsolidator = (repo) =>
  write(repo, 'scraper/src/services/consolidator.ts', CONSOLIDATOR + '\n// branch change\n');

// ---------------------------------------------------------------------------

test('THE INCIDENT: main moved a file the branch only IMPORTS -> exit 4, clause-2 names the edge', (t) => {
  const { repo, head } = buildRepo(
    (r) => write(r, 'scraper/src/services/persister.ts', 'export const persist = () => 2;\n'),
    editConsolidator
  );
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const r = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch']);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /FIRED\s+clause-2/);
  assert.match(r.stdout, /import: scraper\/src\/services\/consolidator\.ts -> scraper\/src\/services\/persister\.ts/);
  assert.doesNotMatch(r.stdout, /gh pr merge/, 'a refusal must not print a copy-pasteable merge command');
});

test('a genuinely current PR passes (exit 0) and prints the chained merge command', (t) => {
  const { repo, head } = buildRepo(touchDocs, editConsolidator);
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const r = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS - every clause clear/);
  assert.match(r.stdout, /merge-if-current\.mjs 588 && gh pr merge 588/);
});

test('clause 1: main moved a workflow file -> exit 4 even with zero file overlap', (t) => {
  const { repo, head } = buildRepo(
    (r) => write(r, '.github/workflows/pr-gate.yml', 'name: pr-gate\n# changed\n'),
    (r) => write(r, 'web/app/page.tsx', 'export default () => 1;\n')
  );
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const r = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch']);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /FIRED\s+clause-1/);
});

test('clause 4: both sides changed the generated aggregate -> exit 4', (t) => {
  const { repo, head } = buildRepo(
    (r) => write(r, 'docs/reviews/detection-checks.json', '{"checks":["main"]}\n'),
    (r) => write(r, 'docs/reviews/detection-checks.json', '{"checks":["branch"]}\n')
  );
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const r = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch']);
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /FIRED\s+clause-4/);
});

test('ORDERING: a CONFLICTING PR exits 2 at step 1 and never reaches the check or freshness steps', (t) => {
  const { repo, head } = buildRepo(touchDocs, editConsolidator);
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const file = prJson(repo, { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  const r = run(repo, ['--repo', repo, '--pr-json', file, '--head', head, '--no-fetch']);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /pull_request/, 'the refusal must explain that CI never ran for a conflicting PR');
  assert.doesNotMatch(r.stdout, /STEP 2/, 'must not evaluate checks after a mergeability refusal');
  assert.doesNotMatch(r.stdout, /STEP 3\/4/);
});

test('ORDERING: a CANCELLED check exits 3 and never reaches the freshness step', (t) => {
  const { repo, head } = buildRepo(touchDocs, editConsolidator);
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const file = prJson(repo, {
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'pr-gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'detection-change-gate', status: 'COMPLETED', conclusion: 'CANCELLED' },
    ],
  });
  const r = run(repo, ['--repo', repo, '--pr-json', file, '--head', head, '--no-fetch']);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /CANCELLED/);
  assert.doesNotMatch(r.stdout, /STEP 3\/4/);
});

test('an empty check rollup exits 3 - an absent check is not a pass', (t) => {
  const { repo, head } = buildRepo(touchDocs, editConsolidator);
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const file = prJson(repo, { statusCheckRollup: [] });
  const r = run(repo, ['--repo', repo, '--pr-json', file, '--head', head, '--no-fetch']);
  assert.equal(r.code, 3, r.stdout + r.stderr);
});

test('--force without --reason is a usage error (exit 1), and a short reason is too', (t) => {
  const { repo, head } = buildRepo(
    (r) => write(r, 'scraper/src/services/persister.ts', 'export const persist = () => 2;\n'),
    editConsolidator
  );
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const file = prJson(repo);

  const bare = run(repo, ['--repo', repo, '--pr-json', file, '--head', head, '--no-fetch', '--force']);
  assert.equal(bare.code, 1, bare.stdout);

  const short = run(repo, ['--repo', repo, '--pr-json', file, '--head', head, '--no-fetch',
    '--force', '--reason', 'because']);
  assert.equal(short.code, 1, short.stdout);
});

test('--force with a 20+ character reason passes, but prints the fired clause AND echoes the reason', (t) => {
  const { repo, head } = buildRepo(
    (r) => write(r, 'scraper/src/services/persister.ts', 'export const persist = () => 2;\n'),
    editConsolidator
  );
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const reason = 'release train is frozen, owner approved on the 22:10 call';
  const r = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch',
    '--force', '--reason', reason]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /FORCED PAST/);
  assert.match(r.stdout, /FIRED\s+clause-2/, 'a forced pass must still show which clause fired');
  assert.ok(r.stdout.includes(reason), 'the reason must be echoed into the record');
});

test('--no-import-scan narrows clause 2 and says so loudly instead of claiming full coverage', (t) => {
  const { repo, head } = buildRepo(
    (r) => write(r, 'scraper/src/services/persister.ts', 'export const persist = () => 2;\n'),
    editConsolidator
  );
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const r = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch',
    '--no-import-scan']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /IMPORT HALF NOT EVALUATED/);
  assert.match(r.stdout, /REDUCED coverage/);
});

test('test mode announces itself so an injected payload is never mistaken for a live gate', (t) => {
  const { repo, head } = buildRepo(touchDocs, editConsolidator);
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const r = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch']);
  assert.match(r.stdout, /\[TEST MODE\]/);
});

test('no PR number is a usage error, not a silent pass', (t) => {
  const { repo } = buildRepo(touchDocs, editConsolidator);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  assert.equal(run(repo, ['--repo', repo]).code, 1);
});

test('when typescript is unresolvable the gate REFUSES to run (exit 5), it does not silently narrow', (t) => {
  const { repo, head } = buildRepo(touchDocs, editConsolidator);
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const args = [SCRIPT, '--repo', repo, '--pr-json', prJson(repo), '--head', head, '--no-fetch'];
  const env = { ...process.env, MERGE_IF_CURRENT_NO_TS: '1' };

  let code = 0; let stderr = '';
  try {
    execFileSync('node', args, { cwd: repo, encoding: 'utf8', env });
  } catch (err) {
    code = err.status; stderr = (err.stderr ?? '').toString();
  }
  assert.equal(code, 5, 'a gate that cannot evaluate a clause must refuse, not pass');
  assert.match(stderr, /not resolvable/);
  assert.match(stderr, /--no-import-scan/, 'the refusal must name the explicit reduced-coverage opt-out');

  // ...and the explicit opt-out then works, with the loud banner.
  const opted = run(repo, ['--repo', repo, '--pr-json', prJson(repo), '--head', head,
    '--no-fetch', '--no-import-scan']);
  assert.equal(opted.code, 0, opted.stdout);
  assert.match(opted.stdout, /IMPORT HALF NOT EVALUATED/);
});
