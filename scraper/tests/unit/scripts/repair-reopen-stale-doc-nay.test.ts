// #1045: pure parseArgs coverage for repair-reopen-stale-doc-nay.ts, including
// the new --ipo scope flag (test-isolation class, issue #1045). Red before the
// fix: --ipo did not exist on this Cli shape, so a test passing it would have
// had the value silently discarded (parsed nowhere), never scoping the run.
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../../scripts/repair-reopen-stale-doc-nay.js';

describe('repair-reopen-stale-doc-nay parseArgs', () => {
  it('parses --expect-db, --apply, --allow-prod, --undo and --settled-by-lower-rank', () => {
    const cli = parseArgs([
      '--expect-db', 'ipodhan_test',
      '--apply',
      '--allow-prod',
      '--undo', 'ledger.json',
      '--settled-by-lower-rank',
    ]);
    expect(cli).toEqual({
      apply: true,
      allowProd: true,
      expectDb: 'ipodhan_test',
      undo: 'ledger.json',
      settledByLowerRank: true,
      ipoIds: [],
      invalidIpo: [],
    });
  });

  it('defaults to unscoped, non-apply, non-settled when only --expect-db is given', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test']);
    expect(cli).toEqual({
      apply: false,
      allowProd: false,
      expectDb: 'ipodhan_test',
      undo: null,
      settledByLowerRank: false,
      ipoIds: [],
      invalidIpo: [],
    });
  });

  it('MUTATION: an unrecognized/ignored --ipo turns this red — parses a single --ipo value', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo', '00000000-0000-4000-9161-000000000001']);
    expect(cli.ipoIds).toEqual(['00000000-0000-4000-9161-000000000001']);
    expect(cli.invalidIpo).toEqual([]);
  });

  it('parses repeated --ipo flags and comma-separated values together, deduped', () => {
    const cli = parseArgs([
      '--expect-db', 'ipodhan_test',
      '--ipo', '00000000-0000-4000-9161-000000000001,00000000-0000-4000-9161-000000000002',
      '--ipo', '00000000-0000-4000-9161-000000000001',
    ]);
    expect(cli.ipoIds).toEqual([
      '00000000-0000-4000-9161-000000000001',
      '00000000-0000-4000-9161-000000000002',
    ]);
  });

  it('reports a non-uuid --ipo value as invalid rather than silently accepting or dropping it', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo', 'not-a-uuid']);
    expect(cli.invalidIpo).toEqual(['not-a-uuid']);
    expect(cli.ipoIds).toEqual([]);
  });
});
