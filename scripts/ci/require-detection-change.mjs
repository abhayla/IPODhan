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

const EXEMPT_GLOBS = [
  /^scripts\/lib\/substance-checks\.mjs$/,
  /^scripts\/audit-.*\.mjs$/,
  /^scraper\/src\/utils\/data-validation\.ts$/,
  /^docs\/reviews\/failure-classes\.md$/,
];

const DECLARATION_RE = /^No detection change: .{20,}$/m;

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
      throw new Error(
        `require-detection-change: could not diff ${range} (${e.message}); ` +
          `and fallback ${base}..${head} also failed (${e2.message})`
      );
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

function classify(files) {
  const triggering = files.filter((f) => TRIGGER_GLOBS.some((re) => re.test(f)));
  const triggeringNonTest = triggering.filter(
    (f) => !TEST_PATH_HINT.test(f) && !TEST_FILE_HINT.test(f)
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

  let text = getCommitMessages(base, head);
  if (env.GH_PR_NUMBER) {
    text += '\n' + getPrBody(env.GH_PR_NUMBER);
  }

  if (DECLARATION_RE.test(text)) {
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
