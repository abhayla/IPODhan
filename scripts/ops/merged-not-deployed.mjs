#!/usr/bin/env node
// T-498 — merged-not-deployed register (.claude/rules/signal-ownership.md R5:
// "fixed on main is not fixed"; docs/reviews/rca-2026-09-07-missed-live-defects.md
// §5 item 3).
//
// A fix commit on origin/main is not a fixed bug in production until it is
// reachable from the latest `prod-*` tag. The 2026-09-07 RCA found a spawn-
// timeout fix that sat merged for 23 hours while prod kept looping on the bug
// it fixed, because nothing named the gap between "merged" and "deployed".
// This script IS that name: it lists every fix/feat commit on origin/main
// that is not yet reachable from the latest prod-* tag, with its issue
// number(s) and days-since-merge, so the tick and the deploy brief can print
// "fixed on main, still failing on prod: N".
//
// Usage:
//   node scripts/ops/merged-not-deployed.mjs             -> full table
//   node scripts/ops/merged-not-deployed.mjs --brief      -> compact one-liner + short list (deploy brief)
//   node scripts/ops/merged-not-deployed.mjs --json        -> machine-readable
//   node scripts/ops/merged-not-deployed.mjs --repo <path> -> run against a different git repo (tests)
//
// Exit code: always 0 (this is an informational register, not a gate).
// Its first stdout line is always "fixed on main, still failing on prod: N".
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

// Matches "fix(...)" / "feat(...)" at the start of a subject, or an "#NNN"
// issue reference anywhere in it — either is enough to count as a fix commit
// worth tracking to prod.
const FIX_SUBJECT_RE = /^(fix|feat)\(/i;
// Non-global copy for existence checks (a global regex's .test() mutates
// lastIndex across calls, which silently breaks every other call in a loop).
const ISSUE_REF_TEST_RE = /#(\d+)/;
const ISSUE_REF_MATCH_RE = /#(\d+)/g;

export function latestProdTag(repo) {
  const tags = git(repo, ['tag', '--sort=-creatordate', '--list', 'prod-*'])
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  return tags[0] || null;
}

export function collectMergedNotDeployed(repo, { tag, ref = 'origin/main' } = {}) {
  const prodTag = tag || latestProdTag(repo);
  if (!prodTag) {
    return { prodTag: null, ref, commits: [] };
  }

  const range = `${prodTag}..${ref}`;
  // %x1f (unit separator) keeps subjects containing "|" from breaking the parse.
  const raw = git(repo, ['log', `--format=%H%x1f%cI%x1f%s`, range]);
  const now = Date.now();

  const commits = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, committedAt, subject] = line.split('\x1f');
      return { sha, committedAt, subject };
    })
    .filter(({ subject }) => FIX_SUBJECT_RE.test(subject) || ISSUE_REF_TEST_RE.test(subject))
    .map(({ sha, committedAt, subject }) => {
      const issues = [...subject.matchAll(ISSUE_REF_MATCH_RE)].map((m) => m[1]);
      const committedMs = Date.parse(committedAt);
      const daysSinceMerge = Number.isNaN(committedMs)
        ? null
        : Math.floor((now - committedMs) / 86_400_000);
      return {
        sha: sha.slice(0, 8),
        subject: subject.length > 60 ? `${subject.slice(0, 57)}...` : subject,
        issues,
        daysSinceMerge,
      };
    });

  return { prodTag, ref, commits };
}

function formatTable({ prodTag, ref, commits }) {
  const headline = `fixed on main, still failing on prod: ${commits.length}`;
  if (!prodTag) {
    return [headline, `(no prod-* tag found — cannot compute the gap against ${ref})`].join('\n');
  }
  if (commits.length === 0) {
    return [headline, `(${ref} is fully reachable from ${prodTag} for fix/feat commits)`].join('\n');
  }
  const rows = commits.map((c) => {
    const issues = c.issues.length ? c.issues.map((i) => `#${i}`).join(',') : '-';
    const days = c.daysSinceMerge === null ? '?' : c.daysSinceMerge;
    return `${c.sha}  ${String(days).padStart(4)}d  ${issues.padEnd(10)}  ${c.subject}`;
  });
  return [
    headline,
    `since ${prodTag}, on ${ref}:`,
    'sha       days  issues      subject',
    ...rows,
  ].join('\n');
}

function formatBrief({ prodTag, commits }) {
  const headline = `fixed on main, still failing on prod: ${commits.length}`;
  if (!prodTag || commits.length === 0) return headline;
  const top = commits
    .slice(0, 5)
    .map((c) => `${c.sha} (${c.issues.map((i) => `#${i}`).join(',') || 'no-issue'}, ${c.daysSinceMerge}d)`)
    .join('; ');
  return `${headline} — ${top}${commits.length > 5 ? `; +${commits.length - 5} more` : ''}`;
}

function main() {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf('--repo');
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : process.cwd();
  const asJson = args.includes('--json');
  const asBrief = args.includes('--brief');

  const result = collectMergedNotDeployed(repo);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (asBrief) {
    console.log(formatBrief(result));
  } else {
    console.log(formatTable(result));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
