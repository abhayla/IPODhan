/**
 * `--reverify <ledger.json>` (addition B, PM-C item 12, 2026-09-16): re-runs
 * `verifyMergeReadback` from an already-written `scripts/state/merge-applied-*.json`
 * ledger against a fresh DB read, without touching a database itself for the
 * parsing/refusal path this test covers. Only the ledger-parsing refusal is
 * unit-tested here (missing `patch` -> exit 1) — the DB-reading half is
 * exercised by hand against staging, never by this suite.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reverify } from '../../../scripts/repair-merge-duplicate-ipo';

const tmpFiles: string[] = [];
function writeTmpLedger(payload: unknown): string {
  const file = path.join(os.tmpdir(), `reverify-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  tmpFiles.push(file);
  return file;
}

afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    try {
      fs.rmSync(f);
    } catch {
      // already gone
    }
  }
});

describe('reverify — ledger parsing refuses before touching a database', () => {
  it('refuses with exit 1 when the ledger file does not exist', async () => {
    const code = await reverify(path.join(os.tmpdir(), 'reverify-test-does-not-exist.json'));
    expect(code).toBe(1);
  });

  it('refuses with exit 1 when the ledger file is not valid JSON', async () => {
    const file = path.join(os.tmpdir(), `reverify-test-badjson-${Date.now()}.json`);
    fs.writeFileSync(file, '{not json');
    tmpFiles.push(file);
    const code = await reverify(file);
    expect(code).toBe(1);
  });

  it('refuses with exit 1 when keepId/dropId/droppedSlug are missing', async () => {
    const file = writeTmpLedger({ patch: [] });
    const code = await reverify(file);
    expect(code).toBe(1);
  });

  // The load-bearing case for this addition: a ledger written before the
  // `patch` field existed on the write side (every 2026-09-16 staging ledger)
  // must be refused explicitly, not silently re-verified against an empty
  // patch (which would trivially PASS every "carried field" check and report
  // a false all-clear).
  //
  // Tier A review finding (2): asserting only `expect(code).toBe(1)` is a
  // weak guard — on a machine WITH a reachable database, deleting the
  // `!Array.isArray(ledger.patch)` early-return would fall through into
  // `readbackFromDb` (a real DB call) and could still return a non-1 code
  // that happens to differ, but on a machine WITHOUT one it would throw an
  // unhandled rejection instead of returning cleanly — either way the test's
  // red signal would depend on environment DB reachability, not on a
  // deliberate assertion about WHICH code path ran. Spying on
  // `console.error` and asserting the exact refusal message text pins the
  // test to the ledger-parsing refusal branch specifically: only that branch
  // ever produces this message, so the test is a real guard on a machine
  // with OR without a reachable DB.
  it('refuses with exit 1 when the ledger has no "patch" array (pre-patch-field ledger), via the ledger-parsing refusal path specifically', async () => {
    const file = writeTmpLedger({
      keepId: '11111111-1111-1111-1111-111111111111',
      dropId: '22222222-2222-2222-2222-222222222222',
      keepSlug: 'keep-slug',
      droppedSlug: 'drop-slug',
      // no `patch` field — the real shape of the 10 ledgers written tonight
      provenanceWritten: [],
      readback: [],
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const code = await reverify(file);
      expect(code).toBe(1);
      // Pins the refusal to the specific early-return branch, not to any
      // downstream (DB-triggered) failure that could also produce exit 1.
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('has no "patch" array'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(file));
      // MUTATION CHECK: deleting the `!Array.isArray(ledger.patch)` branch
      // makes execution reach `readbackFromDb` — on a DB-reachable machine
      // this message is never printed and the first assertion above fails;
      // on a DB-unreachable machine `reverify` throws before returning, and
      // `await reverify(file)` rejects instead of resolving to a code at
      // all, which also fails this test (as an uncaught rejection) rather
      // than silently reporting green.
    } finally {
      errorSpy.mockRestore();
    }
  });
});
