// Mutation-proof self-tests for scripts/ops/record-event.mjs (item 1 / s15).
// Run: node --test scripts/tests/record-event.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import {
  BOARD_URL,
  ALLOWED_FLAGS,
  inferLaneFromBranch,
  laneFiles,
  parseCliArgs,
  buildStateNoteLine,
  buildProgressLine,
  appendStateNotes,
  appendProgressText,
  buildBoardWrites,
  writeThreeRecordsAtomically,
  runRecordEvent,
  runMarkConsumed,
} from '../ops/record-event.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'ops', 'record-event.mjs');
const FIXED_NOW = '2026-09-11T03:14:15.000Z';

function makeLaneARepo() {
  const root = mkdtempSync(join(tmpdir(), 'record-event-'));
  mkdirSync(join(root, 'docs', 'contracts', 'state'), { recursive: true });
  mkdirSync(join(root, 'docs', 'contracts', '.run'), { recursive: true });
  writeFileSync(
    join(root, 'docs', 'contracts', 'state', 'pull-model-implementation-loop-STATE.json'),
    JSON.stringify({ slug: 'pull-model-implementation-loop', notes: ['[2026-09-10T10:00:00.000Z] existing note'] }, null, 2)
  );
  writeFileSync(
    join(root, 'docs', 'contracts', '.run', 'pull-model-implementation-loop-PROGRESS.md'),
    '# Progress\n\n- 2026-09-10 10:00 UTC existing line\n'
  );
  return root;
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

test('lane inference maps the three real ledger branches, and only those', () => {
  assert.equal(inferLaneFromBranch('ops/impl-loop-ledger'), 'a');
  assert.equal(inferLaneFromBranch('ops/impl-loop-b-ledger'), 'b');
  assert.equal(inferLaneFromBranch('ops/impl-loop-c-ledger'), 'c');
  assert.equal(inferLaneFromBranch('main'), null);
  assert.equal(inferLaneFromBranch('feat/pm-item01-s15-couple-record-writes'), null);
});

test('laneFiles rejects an unknown lane', () => {
  assert.throws(() => laneFiles('d'), /unknown lane/);
});

test('buildStateNoteLine and buildProgressLine both use the given timestamp verbatim', () => {
  assert.equal(buildStateNoteLine(FIXED_NOW, 'did a thing'), `[${FIXED_NOW}] did a thing`);
  assert.equal(buildProgressLine(FIXED_NOW, 'did a thing'), `- ${FIXED_NOW} did a thing`);
});

test('appendStateNotes appends to notes[] and preserves other fields', () => {
  const original = JSON.stringify({ a: 1, notes: ['n1'] });
  const updated = JSON.parse(appendStateNotes(original, 'n2'));
  assert.deepEqual(updated.notes, ['n1', 'n2']);
  assert.equal(updated.a, 1);
});

test('appendStateNotes throws when STATE.json has no notes array', () => {
  assert.throws(() => appendStateNotes(JSON.stringify({ a: 1 }), 'x'), /no `notes` array/);
});

test('appendProgressText appends one line, tolerating trailing blank lines', () => {
  const out = appendProgressText('line1\nline2\n\n', '- new line');
  assert.equal(out, 'line1\nline2\n- new line\n');
});

test('buildBoardWrites emits a batch-shaped writes array for run/meta only when no item given', () => {
  const writes = buildBoardWrites({ lane: 'a', nowIso: FIXED_NOW, note: 'hello' });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { op: 'update', collection: 'run', doc_id: 'meta', data: { lastUpdate: FIXED_NOW, note: 'hello', lane: 'A' } });
});

test('buildBoardWrites adds an items/item-NN write, with lane b using meta-b', () => {
  const writes = buildBoardWrites({ lane: 'b', nowIso: FIXED_NOW, note: 'hello', item: '20', itemStatus: 'MERGED', itemNote: 'done' });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].doc_id, 'meta-b');
  assert.deepEqual(writes[1], { op: 'update', collection: 'items', doc_id: 'item-20', data: { status: 'MERGED', updatedAt: FIXED_NOW, note: 'done', lane: 'B' } });
});

// ---------------------------------------------------------------------------
// Arg parsing — the "caller cannot supply a timestamp" guard
// ---------------------------------------------------------------------------

test('parseCliArgs REJECTS every timestamp-shaped flag', () => {
  for (const flag of ['--timestamp', '--at', '--time', '--date', '--now']) {
    assert.throws(
      () => parseCliArgs([flag, '2026-01-01T00:00:00Z', '--event', 'x']),
      /no timestamp parameter/,
      `expected ${flag} to be refused`
    );
  }
});

test('parseCliArgs rejects --timestamp on its OWN guard, not by accident of the unrecognised-flag fallback', () => {
  // Register the timestamp-shaped flag as RECOGNISED first, so the
  // unrecognised-flag guard cannot fire and cannot be the reason this
  // throws. If the timestamp-specific check were ever removed, this flag
  // would now parse as an ordinary (accepted) argument instead of throwing.
  assert.equal(ALLOWED_FLAGS.has('--timestamp'), false, 'precondition: not already allowed');
  ALLOWED_FLAGS.add('--timestamp');
  try {
    assert.throws(
      () => parseCliArgs(['--timestamp', '2020-01-01T00:00:00Z', '--event', 'x']),
      /no timestamp parameter/
    );
  } finally {
    ALLOWED_FLAGS.delete('--timestamp');
  }
});

test('parseCliArgs requires --event unless --mark-consumed', () => {
  assert.throws(() => parseCliArgs(['--lane', 'a']), /--event.*is required/);
  assert.doesNotThrow(() => parseCliArgs(['--mark-consumed', '--lane', 'a']));
});

test('parseCliArgs requires --item and --item-status together', () => {
  assert.throws(() => parseCliArgs(['--event', 'x', '--item', '20']), /--item and --item-status must be given together/);
});

test('parseCliArgs rejects an unrecognised flag', () => {
  assert.throws(() => parseCliArgs(['--event', 'x', '--bogus', 'y']), /unrecognised flag/);
});

// ---------------------------------------------------------------------------
// The atomic core — one invocation, all three or none
// ---------------------------------------------------------------------------

test('writeThreeRecordsAtomically: happy path writes and renames all three, in order', () => {
  const calls = [];
  const fake = {
    writeFileSync: (p) => calls.push(['write', p]),
    renameSync: (from, to) => calls.push(['rename', to]),
    unlinkSync: (p) => calls.push(['unlink', p]),
  };
  writeThreeRecordsAtomically(
    [
      { label: 'STATE.json', finalPath: '/x/state.json', content: 's' },
      { label: 'PROGRESS.md', finalPath: '/x/progress.md', content: 'p' },
      { label: 'board payload', finalPath: '/x/payload.json', content: 'b' },
    ],
    fake
  );
  const renames = calls.filter((c) => c[0] === 'rename').map((c) => c[1]);
  assert.deepEqual(renames, ['/x/state.json', '/x/progress.md', '/x/payload.json']);
  assert.equal(calls.filter((c) => c[0] === 'unlink').length, 0);
});

for (const [failIndex, label] of [[0, 'STATE.json'], [1, 'PROGRESS.md'], [2, 'board payload']]) {
  test(`writeThreeRecordsAtomically: a failure staging "${label}" leaves ALL real files untouched and names it`, () => {
    let call = -1;
    const renamed = [];
    const unlinked = [];
    const fake = {
      writeFileSync: () => {
        call++;
        if (call === failIndex) throw new Error('disk full (simulated)');
      },
      renameSync: (from, to) => renamed.push(to),
      unlinkSync: (p) => unlinked.push(p),
    };
    const targets = [
      { label: 'STATE.json', finalPath: '/x/state.json', content: 's' },
      { label: 'PROGRESS.md', finalPath: '/x/progress.md', content: 'p' },
      { label: 'board payload', finalPath: '/x/payload.json', content: 'b' },
    ];
    assert.throws(
      () => writeThreeRecordsAtomically(targets, fake),
      (err) => err.failedRecord === label
    );
    // Nothing was ever renamed onto a real path — none of the three "stand".
    assert.equal(renamed.length, 0);
    // Every temp file staged BEFORE the failure was cleaned up.
    assert.equal(unlinked.length, failIndex);
  });
}

// ---------------------------------------------------------------------------
// End-to-end against a real (temp) filesystem
// ---------------------------------------------------------------------------

test('runRecordEvent: one call appends STATE.json, appends PROGRESS.md, and writes a batch-shaped payload', () => {
  const root = mkdtempSync(join(tmpdir(), 'record-event-'));
  try {
    mkdirSync(join(root, 'docs', 'contracts', 'state'), { recursive: true });
    mkdirSync(join(root, 'docs', 'contracts', '.run'), { recursive: true });
    writeFileSync(join(root, 'docs', 'contracts', 'state', 'pull-model-implementation-loop-STATE.json'), JSON.stringify({ notes: ['[old] n1'] }));
    writeFileSync(join(root, 'docs', 'contracts', '.run', 'pull-model-implementation-loop-PROGRESS.md'), '- old line\n');

    const result = runRecordEvent({ repoRoot: root, lane: 'a', event: 'built s15', now: () => FIXED_NOW });

    const state = JSON.parse(readFileSync(result.statePath, 'utf-8'));
    assert.deepEqual(state.notes, ['[old] n1', `[${FIXED_NOW}] built s15`]);

    const progress = readFileSync(result.progressPath, 'utf-8');
    assert.equal(progress, `- old line\n- ${FIXED_NOW} built s15\n`);

    const payload = JSON.parse(readFileSync(result.payloadPath, 'utf-8'));
    assert.equal(payload[0].collection, 'run');
    assert.equal(payload[0].doc_id, 'meta');
    assert.equal(payload[0].data.note, 'built s15');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRecordEvent: refuses a second event while the previous payload is still pending', () => {
  const root = makeLaneARepo();
  try {
    runRecordEvent({ repoRoot: root, lane: 'a', event: 'first', now: () => FIXED_NOW });
    assert.throws(
      () => runRecordEvent({ repoRoot: root, lane: 'a', event: 'second', now: () => FIXED_NOW }),
      /still PENDING/
    );
    // The refusal must not have touched STATE.json again.
    const state = JSON.parse(readFileSync(join(root, 'docs', 'contracts', 'state', 'pull-model-implementation-loop-STATE.json'), 'utf-8'));
    assert.equal(state.notes.length, 2); // existing + "first" only
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRecordEvent: --force overrides a pending payload; --mark-consumed clears it', () => {
  const root = makeLaneARepo();
  try {
    runRecordEvent({ repoRoot: root, lane: 'a', event: 'first', now: () => FIXED_NOW });
    assert.doesNotThrow(() => runRecordEvent({ repoRoot: root, lane: 'a', event: 'second', force: true, now: () => FIXED_NOW }));

    const cleared = runMarkConsumed({ repoRoot: root, lane: 'a' });
    assert.equal(cleared.deleted, true);
    assert.equal(existsSync(cleared.path), false);

    const again = runMarkConsumed({ repoRoot: root, lane: 'a' });
    assert.equal(again.deleted, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI (subprocess) — exercises argv parsing and exit codes for real
// ---------------------------------------------------------------------------

test('CLI: successful run prints the exact Artifact follow-up call', () => {
  const root = makeLaneARepo();
  try {
    const out = execFileSync('node', [SCRIPT_PATH, '--event', 'cli run', '--lane', 'a', '--repo-root', root], { encoding: 'utf8' });
    assert.match(out, /STATE\.json note appended/);
    assert.match(out, /PROGRESS\.md line appended/);
    assert.match(out, /Board payload written/);
    assert.match(out, new RegExp(BOARD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(out, /db_op: "batch"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a timestamp flag exits non-zero without writing anything', () => {
  const root = makeLaneARepo();
  try {
    assert.throws(() => execFileSync('node', [SCRIPT_PATH, '--event', 'x', '--lane', 'a', '--repo-root', root, '--timestamp', '2020-01-01'], { encoding: 'utf8' }));
    const state = JSON.parse(readFileSync(join(root, 'docs', 'contracts', 'state', 'pull-model-implementation-loop-STATE.json'), 'utf-8'));
    assert.equal(state.notes.length, 1); // unchanged
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a missing PROGRESS.md target directory fails loudly and leaves STATE.json unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'record-event-'));
  try {
    mkdirSync(join(root, 'docs', 'contracts', 'state'), { recursive: true });
    // Deliberately do NOT create docs/contracts/.run — PROGRESS.md's temp write will ENOENT.
    writeFileSync(join(root, 'docs', 'contracts', 'state', 'pull-model-implementation-loop-STATE.json'), JSON.stringify({ notes: [] }));

    let threw = false;
    try {
      execFileSync('node', [SCRIPT_PATH, '--event', 'x', '--lane', 'a', '--repo-root', root], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      threw = true;
      assert.match(err.stderr.toString(), /PROGRESS\.md/);
    }
    assert.equal(threw, true);

    const state = JSON.parse(readFileSync(join(root, 'docs', 'contracts', 'state', 'pull-model-implementation-loop-STATE.json'), 'utf-8'));
    assert.deepEqual(state.notes, []); // unchanged — the STATE temp was cleaned up, never renamed
    assert.equal(existsSync(join(root, 'docs', 'contracts', '.run', 'board-payload-pending-a.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
