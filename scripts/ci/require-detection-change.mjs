#!/usr/bin/env node
// Recurrence-loop part 1: refuse a scraper/persister fix PR that adds no
// detection check and carries no explicit "why not" declaration. See
// docs/reviews/failure-classes.md for the registry this gate protects.
//
// Usage:
//   node scripts/ci/require-detection-change.mjs [baseRef] [headRef]
// Env:
//   BASE_REF, HEAD_REF   override the git refs to diff (default:
//                        origin/main...HEAD in CI, HEAD~1...HEAD locally)
//   GH_PR_NUMBER         when set, the PR body is pulled via `gh pr view`
//                        and checked for the declaration line as well as
//                        the commit messages in range.
//   GH_TOKEN             passed through to `gh` for API auth.

import { execFileSync } from 'node:child_process';

const TRIGGER_GLOBS = [
  /^scraper\/src\/services\//,
  /^scraper\/src\/scrapers\//,
  /^scraper\/src\/config\/field-priority-matrix\.ts$/,
  /^scraper\/scripts\/.*\.py$/,
];

const TEST_PATH_HINT = /(^|\/)(tests?|__tests__)\//i;
const TEST_FILE_HINT = /\.(test|spec)\.(mjs|ts|tsx|js|py)$/i;
const PYTEST_FILE_HINT = /(^|\/)(test_[^/]*|conftest)\.py$/i;

const EXEMPT_GLOBS = [
  /^scripts\/lib\/substance-checks\.mjs$/,
  /^scripts\/audit-.*\.mjs$/,
  /^scraper\/src\/utils\/data-validation\.ts$/,
  // T-487: a new/changed per-entry file counts as a detection change on its
  // own — no need to wait for the generated aggregate to be regenerated too.
  /^docs\/reviews\/detection-checks\/[^/]+\.json$/,
  /^docs\/reviews\/failure-classes\/[^/]+\.json$/,
];

const REGISTRY_FILE = 'docs/reviews/failure-classes.md';

// A "No detection change: <reason>" declaration must be a real sentence, not
// a padded placeholder — require at least 4 whitespace-separated words that
// each contain a letter (rejects `xxxxxxxxxxxxxxxxxxxxxx`, which satisfies a
// bare length check but explains nothing).
const DECLARATION_LINE_RE = /^No detection change: (.+)$/m;
function hasRealDeclaration(text) {
  const match = DECLARATION_LINE_RE.exec(text);
  if (!match) return false;
  const words = match[1].trim().split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  return words.length >= 4;
}

function sh(args, opts = {}) {
  return execFileSync(args[0], args.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function tryGitRange(base, head) {
  try {
    return sh(['git', 'fetch', '--quiet', 'origin', base.replace(/^origin\//, '')]);
  } catch {
    return null;
  }
}

function resolveRefs(argv, env) {
  const base = argv[0] || env.BASE_REF || 'origin/main';
  const head = argv[1] || env.HEAD_REF || 'HEAD';
  return { base, head };
}

function getChangedFiles(base, head) {
  const range = `${base}...${head}`;
  try {
    const out = sh(['git', 'diff', '--name-only', range]);
    return out ? out.split('\n').filter(Boolean) : [];
  } catch (e) {
    // Fallback for shallow/local checkouts where the triple-dot merge-base
    // range can't be resolved (e.g. base ref not fetched locally).
    try {
      const out = sh(['git', 'diff', '--name-only', `${base}..${head}`]);
      return out ? out.split('\n').filter(Boolean) : [];
    } catch (e2) {
      console.error(
        `require-detection-change: FAIL — could not diff ${base} vs ${head} (git range unresolvable; is the base ref fetched?)`
      );
      process.exit(1);
    }
  }
}

function getCommitMessages(base, head) {
  const range = `${base}...${head}`;
  try {
    return sh(['git', 'log', '--format=%B', range]);
  } catch {
    try {
      return sh(['git', 'log', '--format=%B', `${base}..${head}`]);
    } catch {
      return '';
    }
  }
}

function getPrBody(prNumber) {
  try {
    const json = sh(['gh', 'pr', 'view', String(prNumber), '--json', 'body']);
    const parsed = JSON.parse(json);
    return parsed.body || '';
  } catch (e) {
    // Non-fatal: fall back to commit messages only. `gh` may be unauthenticated
    // in a local run, or the PR may not exist yet.
    return '';
  }
}

// A registry-only edit only counts as a detection change if the diff ADDS or
// CHANGES a `docs/reviews/failure-classes.md` table row whose detection_check
// column names a real, non-empty check (not `none`/`unguarded`) — merely
// touching the registry file (e.g. adding an `unguarded` row) is not a
// detection change, it is an honest admission that one doesn't exist yet.
function getRegistryRowChange(base, head) {
  let diff;
  try {
    diff = sh(['git', 'diff', `${base}...${head}`, '--', REGISTRY_FILE]);
  } catch {
    try {
      diff = sh(['git', 'diff', `${base}..${head}`, '--', REGISTRY_FILE]);
    } catch {
      return false;
    }
  }
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const content = line.slice(1);
    if (!/^\s*\|.*\|\s*$/.test(content)) continue;
    const cells = content
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 7) continue;
    const detectionCheck = cells[5].toLowerCase();
    if (!detectionCheck) continue;
    if (/^-+$/.test(detectionCheck)) continue; // markdown table separator row
    if (detectionCheck === 'detection_check') continue; // header row
    if (detectionCheck === 'none' || detectionCheck === 'unguarded') continue;
    return true;
  }
  return false;
}

function classify(files) {
  const triggering = files.filter((f) => TRIGGER_GLOBS.some((re) => re.test(f)));
  const triggeringNonTest = triggering.filter(
    (f) => !TEST_PATH_HINT.test(f) && !TEST_FILE_HINT.test(f) && !PYTEST_FILE_HINT.test(f)
  );
  const exemptTouched = files.filter((f) => EXEMPT_GLOBS.some((re) => re.test(f)));
  return { triggeringNonTest, exemptTouched };
}

function main() {
  const argv = process.argv.slice(2);
  const env = process.env;
  const { base, head } = resolveRefs(argv, env);

  tryGitRange(base, head);

  const files = getChangedFiles(base, head);
  const { triggeringNonTest, exemptTouched } = classify(files);

  if (triggeringNonTest.length === 0) {
    console.log(
      'require-detection-change: PASS — no non-test scraper/persister files in the trigger globs changed'
    );
    process.exit(0);
  }

  if (exemptTouched.length > 0) {
    console.log(
      `require-detection-change: PASS — detection change present (${exemptTouched.join(', ')})`
    );
    process.exit(0);
  }

  if (files.includes(REGISTRY_FILE) && getRegistryRowChange(base, head)) {
    console.log(
      `require-detection-change: PASS — detection change present (${REGISTRY_FILE} row names a real check)`
    );
    process.exit(0);
  }

  let text = getCommitMessages(base, head);
  if (env.GH_PR_NUMBER) {
    text += '\n' + getPrBody(env.GH_PR_NUMBER);
  }

  if (hasRealDeclaration(text)) {
    console.log(
      'require-detection-change: PASS — no detection-check file touched, but a valid ' +
        '"No detection change: ..." declaration was found'
    );
    process.exit(0);
  }

  console.error('require-detection-change: FAIL');
  console.error('');
  console.error(
    'This PR changes scraper/persister logic but touches no detection check, and carries'
  );
  console.error('no declaration explaining why not (recurrence-loop gate, docs/reviews/failure-classes.md).');
  console.error('');
  console.error('Files that triggered the gate:');
  for (const f of triggeringNonTest) console.error(`  - ${f}`);
  console.error('');
  console.error('To pass, either:');
  console.error(
    '  1) add or change a detection check in scripts/lib/substance-checks.mjs, ' +
      'scripts/audit-*.mjs, scraper/src/utils/data-validation.ts, or add a row to ' +
      'docs/reviews/failure-classes.md; OR'
  );
  console.error(
    '  2) add a line matching `^No detection change: <reason, 20+ chars>$` to the PR body ' +
      'or a commit message in this range, explaining why this fix needs no new/changed check.'
  );
  process.exit(1);
}

main();
