#!/usr/bin/env node
// Counts today's pr-gate.yml runs for the shared three-lane Actions budget.
//
// Exists because the count was got wrong twice by retyping the filter. The
// contract counts the IST day; `startsWith("2026-09-10")` counts the UTC day,
// which begins at 05:30 IST and silently drops every run between 00:00 and
// 05:30 IST. On 2026-09-10 that was a two-run gap (46 vs 48) at a moment when
// only four runs remained before the stop — an error large enough to authorise
// a push that should have been held.
//
// pr-gate.yml is `on: pull_request` only, so a push to a branch with NO open
// PR costs nothing. Opening a PR, or pushing to a branch that already has one,
// is what spends.
//
// Usage: node scripts/ops/pr-gate-count.mjs [--json]

import { execFileSync } from 'node:child_process';

// CAP: the owner LIFTED the 60/day cap on 2026-09-10 ("CI-run cap lifted from 60;
// merge on green with no daily run limit"). So there is no cap unless PR_GATE_CAP is
// set, and this script must NOT keep printing a 60 that nobody is holding to -- a
// number presented as a limit that is not one is worse than no number.
// STOP is the lanes' self-imposed nightly reserve and MOVES by agreement --
// it was 50 for most of 2026-09-10 and 58 by 19:57 IST. Hardcoding it made
// this script print "-3 to the 50 stop" while the agreed stop was 58, which
// reads as "you are over" when you are not. Pass PR_GATE_STOP to set it.
const CAP = process.env.PR_GATE_CAP === undefined ? null : Number(process.env.PR_GATE_CAP);
const STOP = process.env.PR_GATE_STOP === undefined ? CAP : Number(process.env.PR_GATE_STOP);
const IST_OFFSET_MIN = 5 * 60 + 30;

function istDayStartUtcIso(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const midnightIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(midnightIst - IST_OFFSET_MIN * 60_000).toISOString();
}

const since = istDayStartUtcIso();
const raw = execFileSync(
  'gh',
  ['run', 'list', '--workflow=pr-gate.yml', '--limit', '300', '--json', 'createdAt,headBranch,event'],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
);

const runs = JSON.parse(raw).filter((r) => r.createdAt >= since);
const nonPr = runs.filter((r) => r.event !== 'pull_request');
const byBranch = new Map();
for (const r of runs) byBranch.set(r.headBranch, (byBranch.get(r.headBranch) ?? 0) + 1);

const used = runs.length;
const result = {
  istDayStartUtc: since,
  used,
  remainingToStop: STOP - used,
  remainingToCap: CAP - used,
  byBranch: [...byBranch.entries()].sort((a, b) => b[1] - a[1]).map(([branch, n]) => ({ branch, n })),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  // Self-describing by construction, not by convention: a pasted reading must
  // say where its stop came from. A tick line saying "4 left" is unusable a day
  // later when nobody remembers whether the stop was 50, 55 or 58.
  const stopSource =
    process.env.PR_GATE_STOP === undefined
      ? 'defaulted to CAP (PR_GATE_STOP unset)'
      : `PR_GATE_STOP=${process.env.PR_GATE_STOP}`;
  console.log(`pr-gate runs since IST midnight (${since}): ${used}`);
  if (STOP === null && CAP === null) {
    console.log(`  no daily cap and no stop set (owner lifted the 60/day cap 2026-09-10); set PR_GATE_CAP / PR_GATE_STOP to reinstate one`);
  } else {
    const capPart = CAP === null ? 'no cap set' : `${result.remainingToCap} to the ${CAP} cap`;
    const stopPart = STOP === null ? 'no stop set' : `${result.remainingToStop} to the ${STOP} stop [${stopSource}]`;
    console.log(`  ${stopPart}, ${capPart}`);
  }
  if (nonPr.length > 0) {
    console.log(`  NOTE: ${nonPr.length} run(s) with event != pull_request — the trigger set has changed, re-read pr-gate.yml`);
  }
  for (const { branch, n } of result.byBranch) console.log(`  ${String(n).padStart(2)}  ${branch}`);
}

process.exit(used >= STOP ? 1 : 0);
