// Pure decision logic for the merge gate (scripts/ops/merge-if-current.mjs).
//
// Why this file exists: on 2026-09-11 PR #588 was merged on a stale green.
// The freshness check HAD been run - but in the same shell command as the
// `gh pr merge`, so its output printed after the decision was already taken.
// A habit ("always run them separately") fails the first time someone is
// tired at 5am. An exit code does not. Everything here is side-effect free so
// every clause can be mutation-tested without touching git, gh or the network.
//
// Tests: scripts/tests/merge-freshness.test.mjs (unit)
//        scripts/tests/merge-if-current-cli.test.mjs (real git repo, end to end)

import { createRequire } from 'node:module';

/** Distinct exit codes so a caller can tell WHY the gate refused. */
export const EXIT = {
  PASS: 0,
  USAGE: 1,
  NOT_MERGEABLE: 2,
  CHECKS_NOT_GREEN: 3,
  STALE: 4,
  INTERNAL: 5,
};

/**
 * Generated aggregates: files that are BUILT from per-entry sources
 * (.claude/rules/recurrence-detection-gate.md, T-487). If main moved one and
 * the branch also changed it, a textually clean git merge can still be
 * semantically stale - the merged aggregate may not equal what
 * `node scripts/build-detection-registry.mjs` would regenerate.
 */
export const GENERATED_AGGREGATES = [
  'docs/reviews/detection-checks.json',
  'docs/reviews/failure-classes.md',
];

/** Paths whose movement on main invalidates ANY green, regardless of overlap. */
export const CI_DEFINING_PREFIXES = ['.github/workflows/', 'scripts/ci/'];

// ---------------------------------------------------------------------------
// Step 1 - mergeability
// ---------------------------------------------------------------------------

/**
 * Checked FIRST, deliberately. A CONFLICTING / DIRTY pull request produces no
 * `pull_request` check run at all, and "no check runs" is indistinguishable
 * from "the queue is slow" if you look at CI before you look at this.
 */
export function classifyMergeability({ state, isDraft, mergeable, mergeStateStatus }) {
  const evidence = { state, isDraft: Boolean(isDraft), mergeable, mergeStateStatus };

  if (state !== 'OPEN') {
    return { ok: false, evidence, reason: `PR state is ${state}, not OPEN - nothing to merge.` };
  }
  if (isDraft || mergeStateStatus === 'DRAFT') {
    return { ok: false, evidence, reason: 'PR is a draft - mark it ready for review first.' };
  }
  if (mergeable === 'CONFLICTING' || mergeStateStatus === 'DIRTY') {
    return {
      ok: false,
      evidence,
      reason:
        `PR conflicts with its base (mergeable=${mergeable}, mergeStateStatus=${mergeStateStatus}). ` +
        'GitHub produces NO pull_request check run for a conflicting PR, so any green you see ' +
        'is from an older head - it is not evidence about this one. Rebase, push, let CI re-run.',
    };
  }
  if (mergeable !== 'MERGEABLE' || mergeStateStatus === 'UNKNOWN') {
    return {
      ok: false,
      evidence,
      reason:
        `Mergeability is UNKNOWN (mergeable=${mergeable}, mergeStateStatus=${mergeStateStatus}). ` +
        'GitHub has not finished computing it - wait a few seconds and re-run this gate. ' +
        'UNKNOWN is not a pass.',
    };
  }
  return { ok: true, evidence, reason: `mergeable=${mergeable}, mergeStateStatus=${mergeStateStatus}` };
}

// ---------------------------------------------------------------------------
// Step 2 - checks
// ---------------------------------------------------------------------------

const FAILING_CONCLUSIONS = new Set([
  'FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE',
]);
// SKIPPED / NEUTRAL are the legitimate "did not run because its paths were
// untouched" shape. They are ALLOWED but never counted as passes - a PR whose
// every check is SKIPPED has proved nothing.
const NON_RUN_CONCLUSIONS = new Set(['SKIPPED', 'NEUTRAL']);

function entryName(e) {
  return e.name || e.context || '(unnamed check)';
}

/**
 * "No failures" is not a pass. An absent check is not a pass. A CANCELLED
 * re-run is not a pass (that exact mislabel was accepted as evidence on the
 * night of the incident). Every check the PR ACTUALLY HAS must be a genuine
 * SUCCESS, and at least one must have genuinely run.
 */
export function classifyChecks(rollup) {
  const entries = Array.isArray(rollup) ? rollup : [];
  const passes = [];
  const failures = [];
  const pending = [];
  const skipped = [];

  if (entries.length === 0) {
    return {
      ok: false, passes, failures, pending, skipped,
      reason:
        'The PR has no checks at all. An absent check is not a pass - either CI never ' +
        'triggered for this head (see the mergeability verdict above) or the workflow ' +
        'triggers do not cover it. Investigate before merging.',
    };
  }

  for (const e of entries) {
    const name = entryName(e);
    if (e.__typename === 'StatusContext' || (!e.status && e.state)) {
      const st = e.state;
      const row = { name, kind: 'StatusContext', state: st };
      if (st === 'SUCCESS') passes.push(row);
      else if (st === 'PENDING' || st === 'EXPECTED') pending.push(row);
      else failures.push(row);
      continue;
    }
    const row = { name, kind: 'CheckRun', status: e.status, conclusion: e.conclusion };
    if (e.status !== 'COMPLETED') {
      // QUEUED / IN_PROGRESS / WAITING / PENDING / REQUESTED - it has not run yet.
      pending.push(row);
    } else if (e.conclusion === 'SUCCESS') {
      passes.push(row);
    } else if (NON_RUN_CONCLUSIONS.has(e.conclusion)) {
      skipped.push(row);
    } else if (FAILING_CONCLUSIONS.has(e.conclusion) || e.conclusion == null) {
      failures.push(row);
    } else {
      // Unknown conclusion from a future GitHub API: refuse, do not guess.
      failures.push({ ...row, note: 'unrecognised conclusion - refused rather than assumed' });
    }
  }

  const problems = [];
  if (failures.length) {
    problems.push('not-a-pass: ' + failures.map((f) => `${f.name} [${f.conclusion ?? f.state}]`).join(', '));
  }
  if (pending.length) {
    problems.push('never ran / still running: ' + pending.map((p) => `${p.name} [${p.status ?? p.state}]`).join(', '));
  }
  if (!problems.length && passes.length === 0) {
    problems.push(
      'nothing genuinely ran - every check is SKIPPED/NEUTRAL, so there is no SUCCESS to stand on'
    );
  }

  return {
    ok: problems.length === 0,
    passes, failures, pending, skipped,
    reason: problems.length ? problems.join(' | ') : `${passes.length} genuine SUCCESS, ${skipped.length} skipped`,
  };
}

// ---------------------------------------------------------------------------
// Step 3, import half - a REAL TypeScript parse
// ---------------------------------------------------------------------------

let tsCache;
/** Returns the typescript module, or null when it cannot be resolved. */
export function loadTypeScript() {
  if (tsCache !== undefined) return tsCache;
  // Test seam, fail-closed ONLY: forces the "typescript is unavailable" branch
  // so scripts/tests/merge-if-current-cli.test.mjs can prove the gate REFUSES
  // to run rather than silently narrowing clause 2. It can never make the gate
  // more permissive - the only thing it can cause is exit 5.
  if (process.env.MERGE_IF_CURRENT_NO_TS === "1") { tsCache = null; return tsCache; }
  try {
    const require = createRequire(import.meta.url);
    tsCache = require('typescript');
  } catch {
    tsCache = null;
  }
  return tsCache;
}

/**
 * First-level module specifiers imported by `sourceText`.
 *
 * Deliberately NOT a hand-rolled scanner: a regex sweep for `from '...'`
 * misses nothing but INVENTS plenty - it matches inside comments, template
 * strings and regex literals. This repo has already been burned by a
 * hand-written comment stripper that silently deleted code
 * (lessons.md, 2026-09-11). ts.createSourceFile is the real grammar.
 */
export function importSpecifiers(sourceText, filePath) {
  const ts = loadTypeScript();
  if (!ts) {
    const err = new Error('typescript is not resolvable - cannot parse imports');
    err.code = 'ENO_TYPESCRIPT';
    throw err;
  }
  const kind = /\.(tsx|jsx)$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, kind);
  const out = [];

  const push = (node) => {
    if (node && ts.isStringLiteral(node)) out.push(node.text);
  };

  const walk = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      push(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) &&
               node.moduleReference && ts.isExternalModuleReference(node.moduleReference)) {
      push(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && node.arguments.length > 0) push(node.arguments[0]);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

/** tsconfig `paths` aliases actually configured in this repo. */
const ALIASES = [
  { prefix: '@ipodhan/shared/', to: 'packages/shared/src/' },
  { prefix: '@ipodhan/shared', exact: true, to: 'packages/shared/src/index' },
  { prefix: '@shared/', to: 'packages/shared/src/' },
  { prefix: '@scraper/', to: 'scraper/src/' },
  { prefix: '@web/', to: 'web/' },
  // `@/*` is web-local; only applied to files under web/.
  { prefix: '@/', to: 'web/', onlyUnder: 'web/' },
];

const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function normalise(p) {
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function candidatesForBase(base) {
  const out = [];
  // ESM TypeScript writes `./x.js` for a file that is on disk as `./x.ts`.
  const m = base.match(/\.(js|jsx|mjs|cjs)$/);
  if (m) {
    const stem = base.slice(0, -m[0].length);
    const swap = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }[m[0]];
    for (const ext of swap) out.push(stem + ext);
    out.push(base);
    return out;
  }
  if (SOURCE_EXTS.some((e) => base.endsWith(e))) {
    out.push(base);
    return out;
  }
  for (const ext of SOURCE_EXTS) out.push(base + ext);
  for (const ext of SOURCE_EXTS) out.push(base + '/index' + ext);
  return out;
}

/**
 * Repo-relative paths a specifier could denote. Returns [] for bare npm
 * specifiers - a documented gap, not a crash: a change inside node_modules is
 * not something a base-branch diff can move.
 */
export function resolveSpecifier(specifier, fromPath) {
  if (typeof specifier !== 'string' || specifier.length === 0) return [];
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return candidatesForBase(normalise(dir + '/' + specifier));
  }
  for (const alias of ALIASES) {
    if (alias.onlyUnder && !fromPath.startsWith(alias.onlyUnder)) continue;
    if (alias.exact) {
      if (specifier === alias.prefix) return candidatesForBase(alias.to);
      continue;
    }
    if (specifier.startsWith(alias.prefix)) {
      return candidatesForBase(alias.to + specifier.slice(alias.prefix.length));
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Step 3/4 - the freshness clauses
// ---------------------------------------------------------------------------

const SCANNABLE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Decide whether the PR's green is still evidence about the merge that would
 * happen now.
 *
 * @param {string[]} moved          files changed in BASE..origin/main
 * @param {string[]} branchChanged  files changed in BASE..<head>
 * @param {(p:string)=>string[]} importsOf  first-level specifiers of a branch file
 * @param {boolean} [scanImports=true]  false = the import half was NOT evaluated
 */
export function evaluateStaleness({ moved, branchChanged, importsOf, scanImports = true }) {
  const movedSet = new Set(moved);
  const branchSet = new Set(branchChanged);

  const ciTouched = moved.filter((p) => CI_DEFINING_PREFIXES.some((pre) => p.startsWith(pre)));
  const clause1 = {
    id: 'clause-1',
    fired: ciTouched.length > 0,
    title: 'main moved a file that DEFINES CI (.github/workflows/ or scripts/ci/)',
    paths: ciTouched,
    why: 'The green on this PR was produced by the OLD pipeline definition. It says nothing about what the new one would do.',
  };

  const overlap = branchChanged.filter((p) => movedSet.has(p)).sort();
  const importEdges = [];
  if (scanImports) {
    for (const file of branchChanged) {
      if (!SCANNABLE.test(file)) continue;
      let specs;
      try {
        specs = importsOf(file) || [];
      } catch {
        continue; // unreadable/unparsable file: recorded by the caller, not silently a pass
      }
      for (const spec of specs) {
        for (const cand of resolveSpecifier(spec, file)) {
          if (movedSet.has(cand)) {
            importEdges.push({ from: file, to: cand, specifier: spec });
            break;
          }
        }
      }
    }
  }
  const clause2 = {
    id: 'clause-2',
    fired: overlap.length > 0 || importEdges.length > 0,
    title: 'main moved a file the branch also changes, or first-level imports',
    overlap,
    importEdges,
    why: 'The branch was tested against the OLD content of a file it depends on. git can merge that cleanly and still change behaviour.',
    note: scanImports
      ? 'import half: first-level only (a transitive dependency two hops away does NOT fire this clause)'
      : 'IMPORT HALF NOT EVALUATED - direct overlap only. Coverage is REDUCED.',
  };

  const contested = GENERATED_AGGREGATES.filter((p) => movedSet.has(p) && branchSet.has(p)).sort();
  const clause4 = {
    id: 'clause-4',
    fired: contested.length > 0,
    title: 'main and the branch both changed a GENERATED aggregate',
    paths: contested,
    why: 'A textually clean git merge of a generated file can still be semantically stale - the merged text may not equal what the generator would produce. Only a rebase + re-run lets `build-detection-registry.mjs --check` speak about the merged state.',
  };

  const clauses = [clause1, clause2, clause4];
  return {
    required: clauses.some((c) => c.fired),
    clauses,
    importScanSkipped: !scanImports,
    movedCount: moved.length,
    branchChangedCount: branchChanged.length,
  };
}
