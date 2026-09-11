// Unit guards for the merge-if-current gate (scripts/ops/lib/merge-freshness.mjs).
//
// Incident this suite exists for: on 2026-09-11 PR #588 was merged on a stale
// green. Both freshness clauses had fired, but the check and the `gh pr merge`
// were typed into the SAME shell command, so the clause output printed AFTER
// the merge decision was already committed. The fix is an exit code, not a
// habit. Every clause below is mutation-proved (table in the PR body):
// deleting or weakening any single clause turns one of these red.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMergeability,
  classifyChecks,
  importSpecifiers,
  resolveSpecifier,
  evaluateStaleness,
  GENERATED_AGGREGATES,
  EXIT,
} from '../ops/lib/merge-freshness.mjs';

// ---------------------------------------------------------------------------
// Step 1 - mergeability, checked FIRST.
// A CONFLICTING PR produces no `pull_request` CI run at all, which is
// indistinguishable from queue latency if you look at CI first.
// ---------------------------------------------------------------------------

test('mergeability: a clean, mergeable, open PR passes', () => {
  const v = classifyMergeability({
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  });
  assert.equal(v.ok, true, v.reason);
});

test('mergeability: CONFLICTING is refused and the message says it suppresses CI', () => {
  const v = classifyMergeability({
    state: 'OPEN', isDraft: false, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY',
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /conflict/i);
  assert.match(v.reason, /pull_request|suppress|never runs|does not run|no CI/i);
});

test('mergeability: DIRTY mergeStateStatus is refused even when mergeable reads MERGEABLE', () => {
  const v = classifyMergeability({
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'DIRTY',
  });
  assert.equal(v.ok, false);
});

test('mergeability: UNKNOWN mergeable is refused - GitHub has not finished computing it', () => {
  const v = classifyMergeability({
    state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN',
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /UNKNOWN|not yet computed|still computing/i);
});

test('mergeability: a draft PR is refused', () => {
  const v = classifyMergeability({
    state: 'OPEN', isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'DRAFT',
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /draft/i);
});

test('mergeability: a non-OPEN PR is refused', () => {
  const v = classifyMergeability({
    state: 'CLOSED', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /CLOSED|not open/i);
});

// ---------------------------------------------------------------------------
// Step 2 - every check the PR actually has must be a genuine pass.
// "No failures" is not a pass; an absent check is not a pass; a CANCELLED
// re-run is not a pass (that exact mislabel happened on the night of the
// incident).
// ---------------------------------------------------------------------------

const checkRun = (name, status, conclusion) => ({
  __typename: 'CheckRun', name, status, conclusion,
});

test('checks: all COMPLETED/SUCCESS passes', () => {
  const v = classifyChecks([
    checkRun('pr-gate', 'COMPLETED', 'SUCCESS'),
    checkRun('detection-change-gate', 'COMPLETED', 'SUCCESS'),
  ]);
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.passes.length, 2);
});

test('checks: a CANCELLED run is NOT a pass', () => {
  const v = classifyChecks([
    checkRun('pr-gate', 'COMPLETED', 'SUCCESS'),
    checkRun('detection-change-gate', 'COMPLETED', 'CANCELLED'),
  ]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.failures.map((f) => f.name), ['detection-change-gate']);
  assert.match(v.reason, /CANCELLED/);
});

test('checks: a run that never started (QUEUED / IN_PROGRESS) is NOT a pass', () => {
  const queued = classifyChecks([checkRun('pr-gate', 'QUEUED', null)]);
  assert.equal(queued.ok, false);
  assert.deepEqual(queued.pending.map((p) => p.name), ['pr-gate']);

  const running = classifyChecks([checkRun('pr-gate', 'IN_PROGRESS', null)]);
  assert.equal(running.ok, false);
  assert.deepEqual(running.pending.map((p) => p.name), ['pr-gate']);
});

test('checks: FAILURE / TIMED_OUT / ACTION_REQUIRED / STARTUP_FAILURE are all refused', () => {
  for (const conclusion of ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']) {
    const v = classifyChecks([checkRun('pr-gate', 'COMPLETED', conclusion)]);
    assert.equal(v.ok, false, conclusion + ' must not pass');
  }
});

test('checks: an EMPTY rollup is refused - an absent check is not a pass', () => {
  assert.equal(classifyChecks([]).ok, false);
  assert.equal(classifyChecks(null).ok, false);
  assert.match(classifyChecks([]).reason, /no checks|absent/i);
});

test('checks: SKIPPED is allowed (path-gated job) but bucketed separately, never as a pass', () => {
  const v = classifyChecks([
    checkRun('pr-gate', 'COMPLETED', 'SUCCESS'),
    checkRun('e2e', 'COMPLETED', 'SKIPPED'),
  ]);
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(v.skipped.map((s) => s.name), ['e2e']);
  assert.deepEqual(v.passes.map((s) => s.name), ['pr-gate'], 'a SKIPPED job must not be counted as a pass');
});

test('checks: SKIPPED alone is refused - nothing actually ran', () => {
  const v = classifyChecks([checkRun('e2e', 'COMPLETED', 'SKIPPED')]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /genuine|nothing|SUCCESS/i);
});

test('checks: legacy StatusContext entries are classified too (PENDING is not a pass)', () => {
  const pending = classifyChecks([{ __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' }]);
  assert.equal(pending.ok, false);
  const success = classifyChecks([{ __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS' }]);
  assert.equal(success.ok, true, success.reason);
});

// ---------------------------------------------------------------------------
// Step 3, import half - real TypeScript parse, never a hand-rolled scanner.
// ---------------------------------------------------------------------------

test('importSpecifiers: reads real import declarations, ignoring regex literals, template strings and comments', () => {
  const src = [
    "// import './commented-out.ts';",
    "/* import './block-commented.ts'; */",
    "const re = /import '.\\/regex-literal.ts'/;",
    "const tpl = `import './template-string.ts'`;",
    "import { a } from './real-a.ts';",
    "import type { B } from './real-b';",
    "export { c } from './real-c';",
    "const d = await import('./real-d.js');",
    "require('./real-e.cjs');",
  ].join('\n');
  const specs = importSpecifiers(src, 'scraper/src/x.ts');
  assert.ok(specs.includes('./real-a.ts'), 'static import missed');
  assert.ok(specs.includes('./real-b'), 'type import missed');
  assert.ok(specs.includes('./real-c'), 're-export missed');
  assert.ok(specs.includes('./real-d.js'), 'dynamic import missed');
  assert.ok(specs.includes('./real-e.cjs'), 'require() missed');
  for (const ghost of ['./commented-out.ts', './block-commented.ts', './regex-literal.ts', './template-string.ts']) {
    assert.ok(!specs.includes(ghost), 'a hand-rolled-scanner artefact leaked through: ' + ghost);
  }
});

test('resolveSpecifier: relative specifier yields the .ts candidate (ESM .js -> .ts convention)', () => {
  const cands = resolveSpecifier('./persister.js', 'scraper/src/services/a.ts');
  assert.ok(cands.includes('scraper/src/services/persister.ts'), cands.join(','));
  assert.ok(cands.includes('scraper/src/services/persister.js'));
});

test('resolveSpecifier: extensionless relative specifier tries index files too', () => {
  const cands = resolveSpecifier('../config', 'scraper/src/services/a.ts');
  assert.ok(cands.includes('scraper/src/config.ts'), cands.join(','));
  assert.ok(cands.includes('scraper/src/config/index.ts'), cands.join(','));
});

test('resolveSpecifier: the repo aliases resolve (@ipodhan/shared is the one that has burned us)', () => {
  assert.ok(resolveSpecifier('@ipodhan/shared/db/schema', 'web/lib/x.ts')
    .includes('packages/shared/src/db/schema.ts'));
  assert.ok(resolveSpecifier('@scraper/config/feature-flags', 'scraper/src/x.ts')
    .includes('scraper/src/config/feature-flags.ts'));
  assert.ok(resolveSpecifier('@/lib/db', 'web/app/page.tsx')
    .includes('web/lib/db.ts'));
});

test('resolveSpecifier: a bare npm specifier resolves to nothing (documented gap, not a crash)', () => {
  assert.deepEqual(resolveSpecifier('node:fs', 'scraper/src/x.ts'), []);
  assert.deepEqual(resolveSpecifier('drizzle-orm', 'scraper/src/x.ts'), []);
});

// ---------------------------------------------------------------------------
// Step 3/4 - the freshness clauses themselves.
// ---------------------------------------------------------------------------

const noImports = () => [];

test('clause 0: nothing moved on main -> no re-run required', () => {
  const v = evaluateStaleness({ moved: [], branchChanged: ['scraper/src/a.ts'], importsOf: noImports });
  assert.equal(v.required, false, JSON.stringify(v.clauses));
});

test('clause 1: a workflow file moved on main requires a re-run', () => {
  const v = evaluateStaleness({
    moved: ['.github/workflows/pr-gate.yml'],
    branchChanged: ['web/app/page.tsx'],
    importsOf: noImports,
  });
  assert.equal(v.required, true);
  assert.ok(v.clauses.some((c) => c.id === 'clause-1' && c.fired), JSON.stringify(v.clauses));
});

test('clause 1: scripts/ci/ counts too, not just .github/workflows/', () => {
  const v = evaluateStaleness({
    moved: ['scripts/ci/require-detection-change.mjs'],
    branchChanged: ['web/app/page.tsx'],
    importsOf: noImports,
  });
  assert.equal(v.required, true);
  assert.ok(v.clauses.some((c) => c.id === 'clause-1' && c.fired));
});

test('clause 1 does NOT fire on an unrelated path', () => {
  const v = evaluateStaleness({
    moved: ['docs/ops/prod-ops-recipes.md'],
    branchChanged: ['web/app/page.tsx'],
    importsOf: noImports,
  });
  assert.equal(v.clauses.find((c) => c.id === 'clause-1').fired, false);
});

test('clause 2a: direct overlap between what main moved and what the branch changed', () => {
  const v = evaluateStaleness({
    moved: ['scraper/src/services/persister.ts', 'docs/x.md'],
    branchChanged: ['scraper/src/services/persister.ts'],
    importsOf: noImports,
  });
  assert.equal(v.required, true);
  const c2 = v.clauses.find((c) => c.id === 'clause-2');
  assert.equal(c2.fired, true);
  assert.deepEqual(c2.overlap, ['scraper/src/services/persister.ts']);
});

test('clause 2b: main moved a file the branch FIRST-LEVEL IMPORTS -> fires', () => {
  const v = evaluateStaleness({
    moved: ['scraper/src/services/persister.ts'],
    branchChanged: ['scraper/src/services/consolidator.ts'],
    importsOf: (p) => (p === 'scraper/src/services/consolidator.ts' ? ['./persister.js'] : []),
  });
  assert.equal(v.required, true, JSON.stringify(v.clauses));
  const c2 = v.clauses.find((c) => c.id === 'clause-2');
  assert.equal(c2.fired, true);
  assert.ok(c2.importEdges.some((e) =>
    e.from === 'scraper/src/services/consolidator.ts' && e.to === 'scraper/src/services/persister.ts'));
});

test('clause 2b: a SECOND-level import does not fire (the rule is first-level, and the output says so)', () => {
  const v = evaluateStaleness({
    moved: ['scraper/src/services/deep.ts'],
    branchChanged: ['scraper/src/services/consolidator.ts'],
    importsOf: (p) => (p === 'scraper/src/services/consolidator.ts' ? ['./persister.js'] : ['./deep.js']),
  });
  assert.equal(v.clauses.find((c) => c.id === 'clause-2').fired, false);
});

test('clause 2b is skippable, and skipping is recorded as reduced coverage, not as a pass', () => {
  const v = evaluateStaleness({
    moved: ['scraper/src/services/persister.ts'],
    branchChanged: ['scraper/src/services/consolidator.ts'],
    importsOf: (p) => (p === 'scraper/src/services/consolidator.ts' ? ['./persister.js'] : []),
    scanImports: false,
  });
  assert.equal(v.clauses.find((c) => c.id === 'clause-2').fired, false);
  assert.equal(v.importScanSkipped, true);
});

test('clause 4: a generated aggregate contested by BOTH sides requires a re-run', () => {
  assert.ok(GENERATED_AGGREGATES.includes('docs/reviews/detection-checks.json'));
  const v = evaluateStaleness({
    moved: ['docs/reviews/detection-checks.json'],
    branchChanged: ['docs/reviews/detection-checks.json'],
    importsOf: noImports,
  });
  assert.equal(v.required, true);
  assert.ok(v.clauses.some((c) => c.id === 'clause-4' && c.fired), JSON.stringify(v.clauses));
});

test('clause 4 does NOT fire when only main touched the aggregate', () => {
  const v = evaluateStaleness({
    moved: ['docs/reviews/detection-checks.json'],
    branchChanged: ['web/app/page.tsx'],
    importsOf: noImports,
  });
  assert.equal(v.clauses.find((c) => c.id === 'clause-4').fired, false);
});

test('EXIT codes are distinct so a caller can tell WHY it refused', () => {
  const seen = new Set(Object.values(EXIT));
  assert.equal(seen.size, Object.keys(EXIT).length);
  assert.equal(EXIT.PASS, 0);
});

test('checks: an UNRECOGNISED conclusion from a future API is refused, not assumed a pass (fail-closed)', () => {
  const v = classifyChecks([checkRun('pr-gate', 'COMPLETED', 'SOME_NEW_STATE_2027')]);
  assert.equal(v.ok, false);
  assert.match(v.failures[0].note, /refused rather than assumed/);
});

test('checks: CANCELLED is bucketed as a FAILURE, never as the allowed skipped bucket', () => {
  const v = classifyChecks([
    checkRun('pr-gate', 'COMPLETED', 'SUCCESS'),
    checkRun('e2e', 'COMPLETED', 'CANCELLED'),
  ]);
  assert.deepEqual(v.skipped, [], 'a cancelled run must never land in the allowed bucket');
  assert.deepEqual(v.failures.map((f) => f.name), ['e2e']);
});
