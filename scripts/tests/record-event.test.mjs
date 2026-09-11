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
  resolveItemKey,
  applyItemStatus,
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
    JSON.stringify({
      slug: 'pull-model-implementation-loop',
      notes: ['[2026-09-10T10:00:00.000Z] existing note'],
      items: {
        'item-04': { item: 4, card: 'docs/design/build-cards/item-04.md', status: 'PENDING', slices: [{ k: '4-a', pr: 591, status: 'MERGED' }] },
        // Measured on the real lane-A STATE.json (2026-09-11): item 23 exists ALSO under
        // its own plain-number key, not only "item-23" — the two conventions coexist for
        // real. A lookup that assumes only one shape would miss this item.
        '23': { item: 23, status: 'IN-PROGRESS', slices: [] },
      },
    }, null, 2)
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

// The board's item documents are zero-padded to two digits (item-01 .. item-22).
// The test above uses item 20, so it could never have caught a padding bug — and did
// not: item 4's DONE write failed against the live board because this built `item-4`.
// Items 1..9 are the whole affected class, across all three lanes.
test('a SINGLE-DIGIT item is zero-padded to the two-digit document id the board uses', () => {
  const writes = buildBoardWrites({ lane: 'a', nowIso: FIXED_NOW, note: 'hello', item: '4', itemStatus: 'DONE' });
  assert.equal(writes[1].doc_id, 'item-04');
});

test('a two-digit item is left alone, and a leading-zero input stays two digits', () => {
  assert.equal(buildBoardWrites({ lane: 'a', nowIso: FIXED_NOW, note: 'x', item: '22', itemStatus: 'DONE' })[1].doc_id, 'item-22');
  assert.equal(buildBoardWrites({ lane: 'a', nowIso: FIXED_NOW, note: 'x', item: '04', itemStatus: 'DONE' })[1].doc_id, 'item-04');
});

// ---------------------------------------------------------------------------
// resolveItemKey / applyItemStatus — STATE.json's `items` object does NOT
// reliably use one key convention (measured on the real lane-A STATE.json:
// item 23 exists under BOTH "item-23" and the plain "23"). The lookup must
// normalise, never assume the padded doc-id shape the board uses.
// ---------------------------------------------------------------------------

test('resolveItemKey finds an existing zero-padded key', () => {
  assert.equal(resolveItemKey({ 'item-04': { item: 4 } }, '4'), 'item-04');
});

test('resolveItemKey finds an existing plain-number key when no padded key exists', () => {
  assert.equal(resolveItemKey({ '23': { item: 23 } }, '23'), '23');
});

test('resolveItemKey falls back to scanning by the `.item` field when neither key shape matches', () => {
  assert.equal(resolveItemKey({ weird_key_7: { item: 7 } }, '7'), 'weird_key_7');
});

test('resolveItemKey defaults to the padded doc-id for a brand-new item (matches the board convention)', () => {
  assert.equal(resolveItemKey({}, '9'), 'item-09');
});

test('applyItemStatus updates status/updatedAt/lane on an EXISTING item and preserves every other field (slices, card)', () => {
  const original = JSON.stringify({
    items: { 'item-04': { item: 4, card: 'c.md', status: 'PENDING', slices: [{ k: '4-a', pr: 591 }] } },
  });
  const updated = JSON.parse(applyItemStatus(original, { item: '4', itemStatus: 'DONE', lane: 'A', nowIso: FIXED_NOW }));
  assert.equal(updated.items['item-04'].status, 'DONE');
  assert.equal(updated.items['item-04'].updatedAt, FIXED_NOW);
  assert.equal(updated.items['item-04'].lane, 'A');
  assert.equal(updated.items['item-04'].card, 'c.md');
  assert.deepEqual(updated.items['item-04'].slices, [{ k: '4-a', pr: 591 }]);
});

test('applyItemStatus updates the item at its EXISTING plain-number key rather than creating a duplicate padded one', () => {
  const original = JSON.stringify({ items: { '23': { item: 23, status: 'IN-PROGRESS', slices: [] } } });
  const updated = JSON.parse(applyItemStatus(original, { item: '23', itemStatus: 'DONE', lane: 'A', nowIso: FIXED_NOW }));
  assert.equal(updated.items['23'].status, 'DONE');
  assert.equal('item-23' in updated.items, false);
});

test('applyItemStatus creates a new padded entry when the item has never appeared in STATE, and only sets it', () => {
  const updated = JSON.parse(applyItemStatus(JSON.stringify({ items: {} }), { item: '9', itemStatus: 'PENDING', lane: 'A', nowIso: FIXED_NOW }));
  assert.deepEqual(Object.keys(updated.items), ['item-09']);
  assert.equal(updated.items['item-09'].status, 'PENDING');
});

test('applyItemStatus sets note only when itemNote is given, mirroring buildBoardWrites', () => {
  const withNote = JSON.parse(applyItemStatus(JSON.stringify({ items: {} }), { item: '1', itemStatus: 'DONE', itemNote: 'merged abc', lane: 'A', nowIso: FIXED_NOW }));
  assert.equal(withNote.items['item-01'].note, 'merged abc');
  const withoutNote = JSON.parse(applyItemStatus(JSON.stringify({ items: {} }), { item: '1', itemStatus: 'DONE', lane: 'A', nowIso: FIXED_NOW }));
  assert.equal('note' in withoutNote.items['item-01'], false);
});

test('applyItemStatus auto-inits a missing `items` object rather than throwing (fresh STATE files carry no items block yet)', () => {
  const updated = JSON.parse(applyItemStatus(JSON.stringify({ notes: [] }), { item: '1', itemStatus: 'DONE', lane: 'A', nowIso: FIXED_NOW }));
  assert.equal(updated.items['item-01'].status, 'DONE');
});

test('applyItemStatus refuses when `items` exists but is not an object (never guess the shape)', () => {
  assert.throws(() => applyItemStatus(JSON.stringify({ items: [] }), { item: '1', itemStatus: 'DONE', lane: 'A', nowIso: FIXED_NOW }), /not an object/);
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

// THE un-regressable test: not "status was written", but that STATE's items[N]
// and the board payload's items/item-NN write AGREE FIELD FOR FIELD — driven by
// the board write's own keys, so a next silently-skipped output fails this too.
test('runRecordEvent: items[N] in STATE.json agrees FIELD FOR FIELD with the board payload write for that item', () => {
  const root = makeLaneARepo();
  try {
    const result = runRecordEvent({
      repoRoot: root, lane: 'a', event: 'merged s99',
      item: '4', itemStatus: 'DONE', itemNote: 'merged abc123 (PR #999)',
      now: () => FIXED_NOW,
    });

    const state = JSON.parse(readFileSync(result.statePath, 'utf-8'));
    const boardItemWrite = result.boardWrites.find((w) => w.collection === 'items');
    assert.ok(boardItemWrite, 'expected a board write for the item');

    const stateItem = state.items[boardItemWrite.doc_id];
    assert.ok(stateItem, `expected STATE items["${boardItemWrite.doc_id}"] to exist`);

    for (const [field, value] of Object.entries(boardItemWrite.data)) {
      assert.equal(stateItem[field], value, `field "${field}" differs between STATE.json and the board payload`);
    }

    // Pre-existing fields (slices, card) must survive — this is a merge, not an overwrite.
    assert.deepEqual(stateItem.slices, [{ k: '4-a', pr: 591, status: 'MERGED' }]);
    assert.equal(stateItem.card, 'docs/design/build-cards/item-04.md');

    // The `notes` array (load-bearing, 257 entries in real STATE) must still gain
    // exactly one entry — the item update must not touch it.
    assert.equal(state.notes.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRecordEvent: a single-digit --item writes STATE under the zero-padded key, matching the board (not "item-4")', () => {
  const root = makeLaneARepo();
  try {
    const result = runRecordEvent({ repoRoot: root, lane: 'a', event: 'x', item: '4', itemStatus: 'DONE', now: () => FIXED_NOW });
    const state = JSON.parse(readFileSync(result.statePath, 'utf-8'));
    assert.equal('item-4' in state.items, false);
    assert.equal(state.items['item-04'].status, 'DONE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRecordEvent: an item already keyed by its plain number (item 23) is updated in place, not duplicated', () => {
  const root = makeLaneARepo();
  try {
    const result = runRecordEvent({ repoRoot: root, lane: 'a', event: 'x', item: '23', itemStatus: 'BLOCKED-OWNER', now: () => FIXED_NOW });
    const state = JSON.parse(readFileSync(result.statePath, 'utf-8'));
    assert.equal(state.items['23'].status, 'BLOCKED-OWNER');
    assert.equal('item-23' in state.items, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runRecordEvent: without --item, state.items is left completely untouched', () => {
  const root = makeLaneARepo();
  try {
    const before = JSON.parse(readFileSync(join(root, 'docs', 'contracts', 'state', 'pull-model-implementation-loop-STATE.json'), 'utf-8')).items;
    const result = runRecordEvent({ repoRoot: root, lane: 'a', event: 'no item here', now: () => FIXED_NOW });
    const after = JSON.parse(readFileSync(result.statePath, 'utf-8')).items;
    assert.deepEqual(after, before);
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
