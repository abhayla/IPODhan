// #829 / build item 33. The DoD item "New owner forks recorded, D14 green" asserted
// `design.includes('| O-14 |') && design.includes('| O-15 |')` — two specific fork ids
// present in the open-fork table. Both forks were ANSWERED on 2026-09-09 and promoted to
// OD-53 and OD-54, whose own acceptance conditions require that no section still marks them
// provisional. So the item demanded the exact state the spec was required to leave behind,
// and had been red since the day those forks were decided.
//
// Hard-coding an id made the item true on the day it was written and guaranteed it would go
// false the moment the process it describes worked. This is the same class the FIRST DoD item
// already fixed once (OD-18: the card count and OD-row count were literals frozen at authoring
// time, restated as "the count matches the register", read from the tree).
//
// The mechanism D14 actually guarantees — the spec states it itself, "D14 fails if a marker
// loses its row" — is already enforced by check-design-consistency.mjs's own D14, which CI
// runs as a hard gate. So the DoD item asserts THAT gate is green rather than re-implementing
// a weaker copy of it.
//
// Run: node --test scripts/tests/check-dod-d14-mechanism.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DOD = join(REPO_ROOT, 'docs', 'design', 'check-dod.mjs');
const SRC = readFileSync(DOD, 'utf8');

// Comment lines are documentation, not assertions — the explanation of WHY the old code was
// wrong necessarily quotes it, and must not itself trip the guard. Strip `//` lines before
// scanning. (A hand-rolled comment scanner would be wrong on a `//` inside a string or a regex
// literal; this file has neither on a line starting with `//`, and the test below pins that.)
const CODE_LINES = SRC.split('\n').filter((l) => !/^\s*\/\//.test(l));
const CODE = CODE_LINES.join('\n');

test('no CODE line in check-dod.mjs asserts a specific O-nn fork id is PRESENT', () => {
  // The regression guard for the whole CLASS, not just O-14/O-15: any future item that
  // hard-codes "this fork row exists" goes false the moment that fork is answered, which is
  // what a correct process does.
  const hardCoded = [...CODE.matchAll(/includes\(['"]\| (O-\d+) \|['"]\)/g)].map((m) => m[1]);
  assert.deepEqual(
    hardCoded,
    [],
    'a DoD item asserts these fork ids are PRESENT; answering any of them turns the DoD red: '
      + hardCoded.join(', ')
  );
});

test('the comment-stripping the guard relies on does not hide a real assertion', () => {
  // Mutation-proof for the guard itself: if stripping `//` lines ever removed a real line of
  // code, the guard above would pass for the wrong reason. Pin that stripping removes only
  // comments — every stripped line must be a comment, and the code must still parse as the
  // same set of DoD items.
  const stripped = SRC.split('\n').filter((l) => /^\s*\/\//.test(l));
  assert.ok(stripped.length > 0, 'this file does have comment lines');
  for (const l of stripped) {
    assert.match(l.trim(), /^\/\//, 'every stripped line must start with // : ' + l.trim());
  }
  assert.equal(
    (CODE.match(/^  \['/gm) || []).length,
    (SRC.match(/^  \['/gm) || []).length,
    'stripping comments must not remove any DoD item'
  );
});

test('the fork-recording DoD item delegates to the gate that enforces the mechanism', () => {
  const item = CODE.slice(CODE.indexOf('New owner forks recorded'));
  assert.ok(item.length > 0, 'the fork-recording DoD item must still exist — it is not deleted');
  const clause = item.slice(0, item.indexOf('],') + 1);
  assert.match(
    clause,
    /check-design-consistency/,
    'the item must delegate to check-design-consistency.mjs, which owns D14'
  );
});

test('the item names no fork id at all — naming one re-creates the bug', () => {
  const item = CODE.slice(CODE.indexOf('New owner forks recorded'));
  const clause = item.slice(0, item.indexOf('],') + 1);
  const named = clause.match(/\bO-\d+\b/g) || [];
  assert.deepEqual(named, [], 'the item must not depend on the CONTENT of the fork table: ' + named.join(', '));
});

test('the item can actually FAIL — its verdict is computed, not a constant', () => {
  // Mutation-caught 2026-09-22: replacing the verdict expression with a literal `true` passed
  // every other test in this file. Those tests assert the SHAPE of the item (delegates to the
  // right gate, names no fork id) and a shape assertion cannot see a hard-coded verdict — the
  // same weakness the original `includes('| O-14 |')` item had, one level up.
  //
  // So pin the verdict expression itself: it must read the gate's output, and must not be a
  // boolean literal.
  const item = CODE.slice(CODE.indexOf('New owner forks recorded'));
  const clause = item.slice(0, item.indexOf('],') + 1);
  // The three cells are: name, verdict, reason. The verdict is the second.
  const cells = clause.split('\n').map((l) => l.trim()).filter(Boolean);
  const verdict = cells[1] || '';
  assert.doesNotMatch(verdict, /^(true|false),?$/,
    'the verdict must be computed from the gate, never a constant: ' + verdict);
  assert.match(verdict, /designConsistencyD14Line|check-design-consistency/,
    'the verdict must read the D14 gate output: ' + verdict);
  assert.match(verdict, /PASS|test\(|includes\(/,
    'the verdict must test that output for a pass, not merely mention it: ' + verdict);
});

test('the fork item reads a PRE-CAPTURED D14 line, not its own gate run', () => {
  // Calling the gate separately for the verdict and the reason would run a multi-second gate
  // twice and could print a reason from a different run than the verdict beside it. The line
  // is captured once, above the item list, and both cells read that capture.
  //
  // Scope note: this asserts the FORK item only. The pre-existing D17-D20 item spawns the same
  // gate three more times (check-dod.mjs:61-62) — a real inefficiency, but one that predates
  // this change and is out of its scope. Asserting a whole-file count here would make this
  // test fail for a reason that has nothing to do with what it guards.
  const item = CODE.slice(CODE.indexOf('New owner forks recorded'));
  const clause = item.slice(0, item.indexOf('],') + 1);
  assert.doesNotMatch(clause, /sh\(/,
    'the fork item must read the captured line, not spawn the gate itself: ' + clause);
  assert.match(clause, /designConsistencyD14Line/, 'it must read the captured line');
  const captures = (CODE.match(/const designConsistencyD14Line\s*=/g) || []).length;
  assert.equal(captures, 1, 'the D14 line must be captured exactly once, got ' + captures);
});

test('the capture itself runs check-design-consistency.mjs, not some other script', () => {
  // Mutation-caught 2026-09-22 (M2b): pointing the CAPTURE at check-build-cards.mjs passed
  // every other test, because they all assert what the ITEM mentions and none asserts what the
  // capture actually runs. A D14 line grepped out of a different script's output would be
  // empty, the item would report NOT with "D14 reported no line at all" — but nothing tested
  // it, so the delegation could be silently re-pointed at the wrong gate.
  const at = CODE.indexOf('const designConsistencyD14Line');
  assert.ok(at > 0, 'the capture must exist');
  const stmt = CODE.slice(at, CODE.indexOf(';', at) + 1);
  const spawned = [...stmt.matchAll(/sh\('node ([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(spawned, ['docs/design/check-design-consistency.mjs'],
    'the capture must run exactly check-design-consistency.mjs: ' + spawned.join(', '));
  assert.match(stmt, /D14/, 'and it must select the D14 line out of that output');
});

test('check-design-consistency.mjs really implements D14 as the marker/row mechanism', () => {
  // If the gate this item now delegates to ever stops asserting the mechanism, delegating to
  // it becomes a false green. Pin that it is still the marker-names-a-real-row check.
  const gate = readFileSync(join(REPO_ROOT, 'docs', 'design', 'check-design-consistency.mjs'), 'utf8');
  const at = gate.indexOf('--- D14');
  assert.ok(at > 0, 'check-design-consistency.mjs must still carry a D14 block');
  const d14 = gate.slice(at, at + 2000);
  assert.match(d14, /PROVISIONAL on/, 'D14 must collect PROVISIONAL markers');
  assert.match(d14, /ok\('D14'/, 'D14 must be able to pass');
  assert.match(d14, /fail\('D14'/, 'D14 must be able to fail');
});

// The end-to-end proof drives the REAL check-dod.mjs, which spawns check-mutations.test.mjs,
// which by design WRITES to tracked files under docs/design/ and restores them md5-verified.
// That makes it slow (minutes) and unsafe to run concurrently with anything reading those
// files — two runs in one checkout mutate the same files at once. So it is opt-in
// (DOD_E2E=1) rather than part of the default CI run, and CI asserts the cheap source
// properties above. The run below IS what proved this fix; it is kept so the proof is
// repeatable, not so it runs on every PR.
test('the fork-recording DoD item reports MET on this checkout', { skip: process.env.DOD_E2E !== '1' && 'set DOD_E2E=1 to run the slow end-to-end proof' }, () => {
  // End-to-end proof on the real script and the real tree. Before this change the line read
  // `NOT   New owner forks recorded, D14 green` with the reason
  // "O-14 and O-15 in the open-fork table".
  let out;
  try {
    out = execFileSync('node', [DOD, REPO_ROOT], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  const line = out.split('\n').find((l) => l.includes('New owner forks recorded'));
  assert.ok(line, 'the DoD must still print a line for this item');
  assert.match(line, /^ *MET /, 'expected MET now that the item asserts the mechanism; got: ' + String(line).trim());
});
