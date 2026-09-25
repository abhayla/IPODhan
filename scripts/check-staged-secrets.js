#!/usr/bin/env node
/**
 * Secret scan — blocks a commit or a PR whose ADDED lines contain
 * credential-shaped content. Deterministic gate behind GitHub issue #1
 * (leaked VPS Postgres password). Append `secret-scan:allow` to a line
 * to deliberately exempt it (e.g. documented dummy values).
 *
 * Two modes, same RULES (scripts/lib/secret-rules.js):
 *   node scripts/check-staged-secrets.js            staged diff (default; .husky/pre-commit)
 *   node scripts/check-staged-secrets.js --range A..B   added lines in A..B (CI backstop, secret-scan.yml)
 *
 * Output never prints the matched value — only the file and the rule name.
 */
const { execSync } = require('child_process');
const { scanAddedLines } = require('./lib/secret-rules');

function parseRangeArg(argv) {
  const flagIdx = argv.indexOf('--range');
  if (flagIdx === -1) return null;
  const value = argv[flagIdx + 1];
  if (!value) {
    console.error('--range requires a value, e.g. --range origin/main...HEAD');
    process.exit(2);
  }
  return value;
}

function getDiff(range) {
  if (range) {
    // Accept both "A..B" and "A...B" (three-dot merge-base diff, what CI uses
    // against a PR's base ref) — pass straight through to `git diff`, which
    // understands both spellings itself.
    return execSync(`git diff --unified=0 --no-color ${range}`, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  }
  return execSync('git diff --cached --unified=0 --no-color', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function main() {
  const range = parseRangeArg(process.argv.slice(2));
  const diff = getDiff(range);
  const hits = scanAddedLines(diff);

  if (hits.length) {
    const scope = range ? `range ${range}` : 'staged changes';
    console.error(`\nSECRET SCAN FAILED — ${range ? 'PR' : 'commit'} blocked. Suspected credentials in ${scope}:`);
    for (const h of hits) console.error(`  - ${h.file}: ${h.rule}`);
    console.error(
      '\nMove the value to an env var (.env is gitignored). For a deliberate dummy value,\nappend `secret-scan:allow` to the line. Never commit real credentials — see issue #1.'
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
