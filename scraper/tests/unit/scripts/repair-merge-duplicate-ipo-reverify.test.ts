/**
 * `--reverify <ledger.json>` (addition B, PM-C item 12, 2026-09-16): re-runs
 * `verifyMergeReadback` from an already-written `scripts/state/merge-applied-*.json`
 * ledger against a fresh DB read, without touching a database itself for the
 * parsing/refusal path this test covers. Only the ledger-parsing refusal is
 * unit-tested here (missing `patch` -> exit 1) — the DB-reading half is
 * exercised by hand against staging, never by this suite.
 */
import { describe, it, expect, afterEach } from 'vitest';
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
  it('refuses with exit 1 when the ledger has no "patch" array (pre-patch-field ledger)', async () => {
    const file = writeTmpLedger({
      keepId: '11111111-1111-1111-1111-111111111111',
      dropId: '22222222-2222-2222-2222-222222222222',
      keepSlug: 'keep-slug',
      droppedSlug: 'drop-slug',
      // no `patch` field — the real shape of the 10 ledgers written tonight
      provenanceWritten: [],
      readback: [],
    });
    const code = await reverify(file);
    expect(code).toBe(1);
  });
});
