// scripts/tests/vps-data-audit-cron-ist-day.test.mjs -- #687 slice 2.
//
// RCA: DATE_TAG in scripts/vps-data-audit-cron.sh was `$(date +%F)`, the HOST
// (UTC) calendar day. The VPS clock is UTC and the nightly cron fires
// 02:00-03:45 IST, when UTC is still the previous day -- so the floor state
// file ($STATE_DIR/floor/$DATE_TAG.txt) and run-$DATE_TAG.log were named one
// day behind the IST day the run actually happened in. Same family as
// #682/#689 (due-step-cycle, status updater) and the slice-1 fix in
// scripts/lib/ist-day.mjs -- but the cron SCRIPT's own DATE_TAG line was never
// touched, one layer upstream of what slice 1 fixed.
//
// Tier-A finding (2026-09-16): the first fix for this made DATE_TAG use
// `TZ=Asia/Kolkata date +%F`, the first runtime tzdata dependency in this
// repo. If the VPS lacks /usr/share/zoneinfo/Asia/Kolkata, GNU date silently
// falls back to UTC -- the exact pre-fix bug, undetected. Every other IST
// helper in the repo (scripts/lib/ist-day.mjs, due-step-cycle.ts istDateIso,
// web/lib/utils/ist-date.ts) uses fixed +5:30 offset arithmetic on the epoch
// second, which needs no zone data. DATE_TAG now does the same:
// `date -u -d "@$(( $(date +%s) + 19800 ))" +%F` (19800s = 5h30m).
//
// This is a static assertion (grep the shipped shell text, anchored to the
// exact line so a regression to the TZ= form or any other variant fails it)
// plus an unconditional runtime proof of the offset arithmetic itself -- never
// a behavioral run of the cron script, which must never be executed by
// CI/tests (no DB, no VPS side effects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'vps-data-audit-cron.sh');
const SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

// Anchored to the exact line: any deviation (the old TZ= form, a two-statement
// export form, whitespace drift) fails this, not just "contains TZ" or
// "contains date +%F". Escaping is done char-by-char against an explicit
// allow-set rather than a single regex-literal character class, because a
// character class of the form [-/\^$*+?.()|[\]{}] silently fails to escape
// `$` in V8 (the unescaped `[` before `\]` terminates the class early) --
// caught by the doesNotMatch assertions below when the naive version shipped.
const EXPECTED_LINE =
  'DATE_TAG="$(date -u -d "@$(( $(date +%s) + 19800 ))" +%F)"';

const REGEX_SPECIAL_CHARS = new Set([
  '.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\', '/',
]);

function escapeRegExp(str) {
  let out = '';
  for (const ch of str) {
    out += REGEX_SPECIAL_CHARS.has(ch) ? '\\' + ch : ch;
  }
  return out;
}

const ANCHORED_PATTERN = new RegExp('^' + escapeRegExp(EXPECTED_LINE) + '$');

function findDateTagLine(source) {
  return source.split('\n').find((line) => line.trim().startsWith('DATE_TAG='));
}

test('escapeRegExp actually escapes every special char (regression guard for the class-literal bug)', () => {
  for (const ch of REGEX_SPECIAL_CHARS) {
    const escaped = escapeRegExp(ch);
    assert.equal(escaped.length, 2, `expected a backslash-prefixed escape for '${ch}', got '${escaped}'`);
    assert.equal(escaped[0], '\\', `expected '${ch}' to be backslash-escaped, got '${escaped}'`);
  }
  // The exact char that the earlier buggy char-class silently failed to escape.
  const dollarEscaped = escapeRegExp('$');
  assert.equal(dollarEscaped, '\\$', '"$" must be escaped, not left as a bare anchor');
});

test('DATE_TAG is derived using fixed-offset arithmetic, not TZ/zoneinfo', () => {
  const dateTagLine = findDateTagLine(SOURCE);
  assert.ok(dateTagLine, 'could not locate the DATE_TAG= assignment line');
  assert.match(
    dateTagLine.trim(),
    ANCHORED_PATTERN,
    `DATE_TAG line must match the exact offset-arithmetic form (found: ${dateTagLine})`
  );
});

test('the anchored pattern rejects the tzdata-dependent and pre-fix variants', () => {
  const brokenVariants = [
    // The Tier-A-flagged intermediate fix: depends on VPS tzdata being present.
    'DATE_TAG="$(TZ=Asia/Kolkata date +%F)"',
    // The original pre-#687 bug: bare host (UTC) clock.
    'DATE_TAG="$(date +%F)"',
    // A two-statement export form -- still tzdata-dependent, still wrong shape.
    'DATE_TAG="$(export TZ=Asia/Kolkata; date +%F)"',
  ];

  for (const variant of brokenVariants) {
    assert.doesNotMatch(
      variant,
      ANCHORED_PATTERN,
      `anchored pattern must reject the broken variant: ${variant}`
    );
  }
});

test('sanity: the anchored pattern DOES match the exact expected line (positive control)', () => {
  assert.match(EXPECTED_LINE, ANCHORED_PATTERN);
});

test(
  'proof: fixed +5:30 offset arithmetic on the epoch second changes the ' +
    "calendar day at the cron's firing instant, needs no tzdata",
  () => {
    // 2026-09-15T20:30:00Z == 2026-09-16T02:00:00+05:30: the exact instant the
    // cron is firing while UTC is still the previous calendar day.
    const FIXED_EPOCH = 1789504200; // verified via `date -u -d @1789504200 +%F` => 2026-09-15
    const OFFSET_SECONDS = 19800; // 5h30m

    let utcDay;
    let offsetDay;
    try {
      utcDay = execFileSync('date', ['-u', '-d', `@${FIXED_EPOCH}`, '+%F']).toString().trim();
      offsetDay = execFileSync('bash', [
        '-c',
        `date -u -d "@$(( ${FIXED_EPOCH} + ${OFFSET_SECONDS} ))" +%F`,
      ]).toString().trim();
    } catch (err) {
      // WHY not skip: GNU 'date -d' is required by the shipped script itself,
      // so a sandbox without it cannot prove this assertion -- but we say so
      // explicitly rather than silently skipping (owner rule: no silent
      // skips). Fail loudly instead of passing green with no proof.
      throw new Error(
        `GNU 'date -d' is unavailable in this sandbox, so the runtime proof cannot run: ${err.message}. ` +
          'This is an environment gap, not a pass -- run on a host with GNU coreutils (the VPS/CI both have it).'
      );
    }

    assert.equal(utcDay, '2026-09-15', 'sanity: UTC day at this instant must be 2026-09-15');
    assert.equal(offsetDay, '2026-09-16', 'IST-offset day at this instant must already be 2026-09-16');
    assert.notEqual(offsetDay, utcDay, 'the +5:30 offset must change the calendar day at this instant');
  }
);

// Second worked example matching the RCA's "tonight's run" proof point, so
// the test also documents the concrete date the supervisor reads after
// deploy (floor/2026-09-17.txt).
test('proof: 2026-09-16T19:00:00Z (00:30 IST on 2026-09-17) tags as 2026-09-17', () => {
  const EPOCH = 1789590000; // 2026-09-16T19:00:00Z
  const OFFSET_SECONDS = 19800;
  const utcDay = execFileSync('date', ['-u', '-d', `@${EPOCH}`, '+%F']).toString().trim();
  const offsetDay = execFileSync('bash', [
    '-c',
    `date -u -d "@$(( ${EPOCH} + ${OFFSET_SECONDS} ))" +%F`,
  ]).toString().trim();

  assert.equal(utcDay, '2026-09-16');
  assert.equal(offsetDay, '2026-09-17');
});
