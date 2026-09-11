#!/usr/bin/env node
// scripts/ops/record-event.mjs — slice s15 of item 1
// (docs/contracts/state/pull-model-implementation-loop-STATE.json, slice k:"s15":
// "couple the status-board write to the ledger write so the board cannot go stale").
//
// WHY: three records must describe the same events — STATE.json's `notes`
// array, the lane's tracked PROGRESS.md, and the live board (an Artifact
// database, published at BOARD_URL below) — and today all three are written
// by hand, in three separate steps. The second and third are routinely
// forgotten (see the STATE.json notes for 2026-09-10: the board sat 33-140
// minutes stale on lane A, four entries stale on lane B for a full day). The
// cause is not carelessness about any one record; it is that a rule which
// must be remembered on every turn is not a mechanism. This command makes
// the three writes ONE operation.
//
// This script cannot itself call the `Artifact` tool (no MCP access from a
// plain Node process), so it writes the board's payload to a JSON file on
// disk and PRINTS the exact follow-up call — the last step is then
// mechanical (copy the printed call), never recalled from memory.
//
// Timestamps: every timestamp in every one of the three records comes from
// the clock INSIDE this command (`new Date().toISOString()`), never from a
// caller-supplied value. On 2026-09-10 a hand-typed board timestamp was 85
// minutes in the FUTURE, which made the board's freshness strip read "fresh"
// no matter what happened — a freshness indicator fed by a typed timestamp
// can never report stale. There is no --timestamp/--at/--time/--date flag;
// if one is passed, the command refuses to run rather than silently ignore it.
//
// Atomicity: the three records are staged to temp files first; a temp-write
// failure for ANY of the three aborts before any of the three real files is
// touched (the already-staged temp files are deleted), and the command exits
// non-zero naming exactly which record failed and why. Only once all three
// are staged does it commit them (one rename per file).
//
// Consumed-payload gate (the card's stretch, built now — cheap and it closes
// a real gap): a board payload this command emits is "pending" until a
// separate `--mark-consumed` run deletes it (run that after the printed
// Artifact call actually executes). If a NEW event is recorded while a
// payload is still pending, that would silently overwrite a board update
// nobody has published yet — the exact defect this tool exists to remove,
// now hidden a layer deeper because it would look safe. So a pending payload
// for the same lane REFUSES the next event (exit 2) unless the caller
// passes --force (an explicit, visible override, not a default).
//
// Usage:
//   node scripts/ops/record-event.mjs --event "<text>" [--lane a|b|c]
//     [--repo-root <path>] [--board-note "<text>"] [--item NN --item-status S
//     [--item-note "<text>"]] [--out <path>] [--force]
//   node scripts/ops/record-event.mjs --mark-consumed [--lane a|b|c] [--repo-root <path>]
//
// Exit codes: 0 success; 2 usage / lane-not-inferable / pending-payload
// refusal; 1 a staged write failed (message names the record).

import { readFileSync as fsReadFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const BOARD_URL = 'https://claude.ai/code/artifact/28b3afb4-c8cd-4a61-a007-9e36de5ca851';

const TIMESTAMP_FLAG = /^--?(timestamp|at|time|date|now)(=.*)?$/i;

// ---------------------------------------------------------------------------
// Lane identity (decision 1): infer from the current branch, override with
// --lane. The three ledger branches are fixed and do not follow a pattern
// worth parsing cleverly — a lookup table is both simpler and more honest
// about being fixed.
// ---------------------------------------------------------------------------
const LANES = {
  a: {
    branch: 'ops/impl-loop-ledger',
    state: 'docs/contracts/state/pull-model-implementation-loop-STATE.json',
    progress: 'docs/contracts/.run/pull-model-implementation-loop-PROGRESS.md',
    runDocId: 'meta',
    label: 'A',
  },
  b: {
    branch: 'ops/impl-loop-b-ledger',
    state: 'docs/contracts/state/pull-model-implementation-lane-b-STATE.json',
    progress: 'docs/contracts/.run/pull-model-implementation-lane-b-PROGRESS.md',
    runDocId: 'meta-b',
    label: 'B',
  },
  c: {
    branch: 'ops/impl-loop-c-ledger',
    state: 'docs/contracts/state/pull-model-implementation-lane-c-STATE.json',
    progress: 'docs/contracts/.run/pull-model-implementation-lane-c-PROGRESS.md',
    runDocId: 'meta-c',
    label: 'C',
  },
};

export function inferLaneFromBranch(branchName) {
  const hit = Object.entries(LANES).find(([, v]) => v.branch === branchName);
  return hit ? hit[0] : null;
}

export function laneFiles(lane) {
  const l = LANES[lane];
  if (!l) throw new Error(`record-event: unknown lane "${lane}" (expected a, b or c)`);
  return l;
}

// ---------------------------------------------------------------------------
// Arg parsing — a strict allow-list. Rejects any timestamp-shaped flag by
// name, on purpose: the guard must hold even if someone tries to pass one,
// not just because the happy path never reads it.
//
// ALLOWED_FLAGS is exported (and mutable) so a test can prove the timestamp
// rejection fires ON ITS OWN — by temporarily registering a timestamp-shaped
// flag as "recognised" here, which removes the unrecognised-flag guard as a
// possible (accidental) cause of the same throw. Two guards that both happen
// to throw is one guard wearing a disguise; this is what stops that.
// ---------------------------------------------------------------------------
export const ALLOWED_FLAGS = new Set([
  '--event', '--lane', '--repo-root', '--board-note',
  '--item', '--item-status', '--item-note', '--out',
  '--force', '--mark-consumed',
]);

export function parseCliArgs(argv) {
  const args = { markConsumed: false, force: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (TIMESTAMP_FLAG.test(flag)) {
      throw new Error(
        `record-event: "${flag}" is refused — there is no timestamp parameter. ` +
        `Every timestamp comes from this command's own clock (2026-09-10: a hand-typed ` +
        `timestamp 85 minutes in the future made the board's freshness strip lie).`
      );
    }
    if (!ALLOWED_FLAGS.has(flag)) {
      throw new Error(`record-event: unrecognised flag "${flag}"`);
    }
    if (flag === '--force') { args.force = true; continue; }
    if (flag === '--mark-consumed') { args.markConsumed = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`record-event: "${flag}" requires a value`);
    }
    i++;
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    args[key] = value;
  }

  if (!args.markConsumed && !args.event) {
    throw new Error('record-event: --event "<text>" is required (or pass --mark-consumed)');
  }
  if ((args.item && !args.itemStatus) || (!args.item && args.itemStatus)) {
    throw new Error('record-event: --item and --item-status must be given together');
  }
  return args;
}

// ---------------------------------------------------------------------------
// Pure content builders — no I/O, fully testable.
// ---------------------------------------------------------------------------
export function buildStateNoteLine(nowIso, eventText) {
  return `[${nowIso}] ${eventText}`;
}

export function buildProgressLine(nowIso, eventText) {
  return `- ${nowIso} ${eventText}`;
}

export function appendStateNotes(stateJsonText, noteLine) {
  const state = JSON.parse(stateJsonText);
  if (!Array.isArray(state.notes)) {
    throw new Error('record-event: STATE.json has no `notes` array to append to');
  }
  state.notes = [...state.notes, noteLine];
  return JSON.stringify(state, null, 2) + '\n';
}

export function appendProgressText(progressText, progressLine) {
  const trimmed = progressText.replace(/\n+$/, '');
  return `${trimmed}\n${progressLine}\n`;
}

export function buildBoardWrites({ lane, nowIso, note, item, itemStatus, itemNote }) {
  const l = laneFiles(lane);
  const writes = [
    {
      op: 'update',
      collection: 'run',
      doc_id: l.runDocId,
      data: { lastUpdate: nowIso, note, lane: l.label },
    },
  ];
  if (item) {
    writes.push({
      op: 'update',
      collection: 'items',
      // The board's item documents are zero-padded (item-01 .. item-22). Without this,
      // items 1..9 built `item-4` and the update failed against a document that does not
      // exist - which is how item 4's DONE write was lost. Items 10+ hid it for a whole night.
      doc_id: `item-${String(item).padStart(2, '0')}`,
      data: {
        status: itemStatus,
        updatedAt: nowIso,
        ...(itemNote ? { note: itemNote } : {}),
        lane: l.label,
      },
    });
  }
  return writes;
}

// ---------------------------------------------------------------------------
// The atomic three-write core. Stages all three to temp files; only commits
// (renames) once every stage succeeded. `fsImpl` is injectable so tests can
// make one target's staging throw without touching a real filesystem target
// that should remain unchanged.
// ---------------------------------------------------------------------------
const defaultFsImpl = { readFileSync: fsReadFileSync, writeFileSync, renameSync, unlinkSync, existsSync };

export function writeThreeRecordsAtomically(targets, fsImpl = defaultFsImpl) {
  // targets: [{ label, finalPath, content }, ...] — order is STATE, PROGRESS, board payload.
  const staged = [];
  for (const t of targets) {
    const tempPath = `${t.finalPath}.tmp-record-event`;
    try {
      fsImpl.writeFileSync(tempPath, t.content, 'utf-8');
      staged.push({ ...t, tempPath });
    } catch (err) {
      for (const s of staged) {
        try { fsImpl.unlinkSync(s.tempPath); } catch { /* best-effort cleanup */ }
      }
      const failure = new Error(`record-event: failed to stage ${t.label} (${err.message}) — nothing written`);
      failure.failedRecord = t.label;
      throw failure;
    }
  }
  for (const s of staged) {
    fsImpl.renameSync(s.tempPath, s.finalPath);
  }
}

// ---------------------------------------------------------------------------
// CLI orchestration
// ---------------------------------------------------------------------------
function pendingPayloadPath(repoRoot, lane) {
  return join(repoRoot, 'docs', 'contracts', '.run', `board-payload-pending-${lane}.json`);
}

export function runMarkConsumed({ repoRoot, lane, fsImpl = defaultFsImpl }) {
  const path = pendingPayloadPath(repoRoot, lane);
  if (!fsImpl.existsSync(path)) {
    return { deleted: false, path };
  }
  fsImpl.unlinkSync(path);
  return { deleted: true, path };
}

export function runRecordEvent({ repoRoot, lane, event, boardNote, item, itemStatus, itemNote, out, force, now, fsImpl = defaultFsImpl }) {
  const l = laneFiles(lane);
  const statePath = join(repoRoot, l.state);
  const progressPath = join(repoRoot, l.progress);
  const payloadPath = out ? join(repoRoot, out) : pendingPayloadPath(repoRoot, lane);

  if (!force && fsImpl.existsSync(payloadPath)) {
    const refusal = new Error(
      `record-event: a board payload for lane ${l.label} is still PENDING at ${payloadPath}. ` +
      `Publish it (run the Artifact call it printed) then \`--mark-consumed\`, or pass --force to overwrite it deliberately.`
    );
    refusal.pendingPayload = true;
    throw refusal;
  }

  const nowIso = now();
  const stateOriginal = fsImpl.readFileSync(statePath, 'utf-8');
  const progressOriginal = fsImpl.readFileSync(progressPath, 'utf-8');

  const stateNoteLine = buildStateNoteLine(nowIso, event);
  const progressLine = buildProgressLine(nowIso, event);
  const stateNew = appendStateNotes(stateOriginal, stateNoteLine);
  const progressNew = appendProgressText(progressOriginal, progressLine);
  const boardWrites = buildBoardWrites({ lane, nowIso, note: boardNote || event, item, itemStatus, itemNote });
  const payloadNew = JSON.stringify(boardWrites, null, 2) + '\n';

  writeThreeRecordsAtomically(
    [
      { label: 'STATE.json', finalPath: statePath, content: stateNew },
      { label: 'PROGRESS.md', finalPath: progressPath, content: progressNew },
      { label: 'board payload', finalPath: payloadPath, content: payloadNew },
    ],
    fsImpl
  );

  return { nowIso, statePath, progressPath, payloadPath, boardWrites };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const repoRoot = args.repoRoot ? args.repoRoot : execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  let lane = args.lane;
  if (!lane) {
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    lane = inferLaneFromBranch(branch);
    if (!lane) {
      console.error(`record-event: cannot infer a lane from branch "${branch}" — pass --lane a|b|c`);
      process.exit(2);
    }
  }
  if (!LANES[lane]) {
    console.error(`record-event: --lane must be a, b or c (got "${lane}")`);
    process.exit(2);
  }

  if (args.markConsumed) {
    const result = runMarkConsumed({ repoRoot, lane });
    console.log(result.deleted
      ? `Consumed: removed ${result.path}`
      : `Nothing pending at ${result.path} (already consumed, or never written)`);
    process.exit(0);
  }

  try {
    const result = runRecordEvent({
      repoRoot,
      lane,
      event: args.event,
      boardNote: args.boardNote,
      item: args.item,
      itemStatus: args.itemStatus,
      itemNote: args.itemNote,
      out: args.out,
      force: args.force,
      now: () => new Date().toISOString(),
    });
    console.log(`OK [${result.nowIso}] lane ${LANES[lane].label}`);
    console.log(`  STATE.json note appended: ${result.statePath}`);
    console.log(`  PROGRESS.md line appended: ${result.progressPath}`);
    console.log(`  Board payload written: ${result.payloadPath}`);
    console.log('');
    console.log('Publish it, then run --mark-consumed for this lane. The exact follow-up:');
    console.log('');
    console.log(`Artifact({ action: "write_db", url: "${BOARD_URL}", db_op: "batch", writes: <contents of ${result.payloadPath}> })`);
  } catch (err) {
    if (err.pendingPayload) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err.message);
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
