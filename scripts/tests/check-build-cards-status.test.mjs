// docs/design/check-build-cards.mjs asserts every build card carries a `Status:` line
// (build item 32). This test drives the REAL gate as a subprocess against temporary card
// fixtures under docs/design/build-cards/ (never a re-implementation of the regex), so a
// regression in the assertion — or a future edit that widens it back to accepting a bolded
// `**Status:**` — turns this red. Mutation-proof per this file's own naming: red before the
// change (the assertion did not exist), green after.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const CARDS_DIR = path.join(REPO_ROOT, 'docs', 'design', 'build-cards');
const GATE = path.join(REPO_ROOT, 'docs', 'design', 'check-build-cards.mjs');

const FIXTURE_PREFIX = 'item-999999-status-fixture-';

function writeFixture(name, body) {
  const p = path.join(CARDS_DIR, `${FIXTURE_PREFIX}${name}.md`);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

function cleanupFixtures() {
  for (const f of fs.readdirSync(CARDS_DIR)) {
    if (f.startsWith(FIXTURE_PREFIX)) fs.unlinkSync(path.join(CARDS_DIR, f));
  }
}

// A minimal card body carrying every other required heading, budget and tier, so only the
// Status line varies between fixtures — isolating the assertion under test.
const MINIMAL_CARD = (statusLine) => `# Fixture card

${statusLine}

## Purpose
test

## Serves
test

## Files
| Path | State | Change |
|---|---|---|

## Schema
none

## Interfaces
none

## Feature flag
none

## Tests
none

## Detection
none

## Staging proof
none

## Rollback
none

## Tier, budget and cost
Tier C
Budget: 1 min wall-clock, 1 tool call.

## Rules implemented
none

## Known gaps
none
`;

function runGate() {
  try {
    const out = execFileSync('node', [GATE, '--gate'], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

after(cleanupFixtures);

test('a card with Status: NOT STARTED passes', () => {
  cleanupFixtures();
  writeFixture('a', MINIMAL_CARD('Status: NOT STARTED'));
  const result = runGate();
  assert.doesNotMatch(result.out, /item-999999-status-fixture-a\.md: no "Status:" line/);
  cleanupFixtures();
});

test('a card with a full DONE line passes', () => {
  cleanupFixtures();
  writeFixture('b', MINIMAL_CARD('Status: DONE 2026-09-14 PRs #745, #758 proof 2026-09-14 22:00 cycle'));
  const result = runGate();
  assert.doesNotMatch(result.out, /item-999999-status-fixture-b\.md: no "Status:" line/);
  cleanupFixtures();
});

test('a card with NO Status line fails, naming the file', () => {
  cleanupFixtures();
  const noStatus = MINIMAL_CARD('').replace(/^\n/, ''); // drop the blank Status placeholder
  writeFixture('c', noStatus);
  const result = runGate();
  assert.equal(result.code, 1);
  assert.match(result.out, /item-999999-status-fixture-c\.md: no "Status:" line/);
  cleanupFixtures();
});

test('a BOLDED **Status:** line fails explicitly — the Budget-line hole, reproduced', () => {
  cleanupFixtures();
  writeFixture('d', MINIMAL_CARD('**Status:** NOT STARTED'));
  const result = runGate();
  assert.equal(result.code, 1);
  assert.match(result.out, /item-999999-status-fixture-d\.md: no "Status:" line/);
  cleanupFixtures();
});

test('a Status line with an unrecognised shape fails ("Status: DONE soon")', () => {
  cleanupFixtures();
  writeFixture('e', MINIMAL_CARD('Status: DONE soon'));
  const result = runGate();
  assert.equal(result.code, 1);
  assert.match(result.out, /item-999999-status-fixture-e\.md: no "Status:" line/);
  cleanupFixtures();
});

test('the real gate is red on the current tree with one real card\'s Status line removed, and green restored', () => {
  const target = path.join(CARDS_DIR, 'item-32-card-status-lines.md');
  const original = fs.readFileSync(target, 'utf8');
  try {
    // \r?\n twice over: git's core.autocrlf normalizes checked-out .md files to CRLF on
    // Windows, so a checkout made AFTER this file was committed (as opposed to the same
    // session that authored it) can hold \r\n where this was first written against \n.
    const stripped = original.replace(/^Status: .+\r?\n\r?\n/m, '');
    assert.notEqual(stripped, original, 'fixture setup: expected to find and strip a Status line');
    fs.writeFileSync(target, stripped, 'utf8');
    const redResult = runGate();
    assert.equal(redResult.code, 1);
    assert.match(redResult.out, /item-32-card-status-lines\.md: no "Status:" line/);
  } finally {
    fs.writeFileSync(target, original, 'utf8');
  }
  const greenResult = runGate();
  assert.equal(greenResult.code, 0, greenResult.out);
});

test('a card reading Status: unknown that is NOT on the item-32 allow-list fails the gate', () => {
  cleanupFixtures();
  writeFixture('notallowed', MINIMAL_CARD('Status: unknown — a brand new reason nobody has reviewed yet'));
  const result = runGate();
  assert.equal(result.code, 1);
  assert.match(result.out, /item-999999-status-fixture-notallowed\.md: "Status: unknown" is only accepted for the ten cards named in UNKNOWN_ALLOWED/);
  cleanupFixtures();
});

test('the ten real cards on the item-32 UNKNOWN_ALLOWED list still pass with their unknown Status', () => {
  const result = runGate();
  const allowed = [
    'item-06-pull-walk.md', 'item-07-job-scheduler-and-budgets.md', 'item-09-re-read-loop.md',
    'item-10-verification-checks.md', 'item-11-crore-conversion.md',
    'item-12-name-normaliser-and-duplicate-detection.md', 'item-14-bse-share-count-conversion.md',
    'item-19-merge-tool-shared-write-path.md', 'item-21-read-side.md',
    'item-22-document-handling-and-download-limits.md',
  ];
  for (const f of allowed) {
    assert.doesNotMatch(result.out, new RegExp(`${f}: "Status: unknown" is only accepted`));
  }
});
