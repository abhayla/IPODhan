// OD-100 (#1022, review round 2 MAJOR-2): run() with fake deps — every guard
// exercised end to end, no real database. computeRemovedFieldKeys/parseArgs
// are pure and mutation-tested directly; run()'s guards are tested by
// mutating the deps a real caller would supply (a wrong db name, a missing
// flag, a prod db) and asserting the refusal, plus the apply/undo write
// order.
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  computeRemovedFieldKeys,
  parseArgs,
  run,
  buildSnapshotQuery,
  buildExistingFieldKeysQuery,
  type Cli,
  type RunDeps,
  type LedgerPayload,
} from '../../../scripts/repair-retire-manifest-removed-fields.js';
import { buildIpoScopeCondition } from '../../../scripts/lib/repair-tool.js';

describe('computeRemovedFieldKeys', () => {
  it('returns a field key present in ipo_field_plan but absent from the manifest', () => {
    const removed = computeRemovedFieldKeys(
      ['ipos.issue_size', 'gmp_records.gmp'],
      new Set(['ipos.issue_size'])
    );
    expect(removed).toEqual(['gmp_records.gmp']);
  });

  it('returns nothing when every existing key is still in the manifest', () => {
    const removed = computeRemovedFieldKeys(['ipos.issue_size'], new Set(['ipos.issue_size', 'gmp_records.gmp']));
    expect(removed).toEqual([]);
  });

  it('dedups repeated existing keys and sorts the result', () => {
    const removed = computeRemovedFieldKeys(['b.field', 'a.field', 'b.field'], new Set());
    expect(removed).toEqual(['a.field', 'b.field']);
  });
});

describe('parseArgs', () => {
  it('parses --expect-db, --apply, --allow-prod and --undo', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_staging', '--apply', '--allow-prod', '--undo', 'ledger.json']);
    expect(cli).toEqual({
      apply: true,
      allowProd: true,
      expectDb: 'ipodhan_staging',
      undoLedger: 'ledger.json',
      ipoIds: [],
      invalidIpo: [],
      unusableIpo: false,
    });
  });

  it('defaults to a dry run with no undo when only --expect-db is given', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test']);
    expect(cli).toEqual({
      apply: false,
      allowProd: false,
      expectDb: 'ipodhan_test',
      undoLedger: null,
      ipoIds: [],
      invalidIpo: [],
      unusableIpo: false,
    });
  });

  // #1045: red before the fix — --ipo did not exist, so the flag's value was
  // silently ignored (parsed nowhere) instead of scoping the run.
  it('MUTATION: an unrecognized/ignored --ipo turns this red — parses a single --ipo value', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo', '00000000-0000-4000-9f61-000000000001']);
    expect(cli.ipoIds).toEqual(['00000000-0000-4000-9f61-000000000001']);
    expect(cli.invalidIpo).toEqual([]);
  });

  it('parses repeated --ipo flags and comma-separated values together', () => {
    const cli = parseArgs([
      '--expect-db', 'ipodhan_test',
      '--ipo', '00000000-0000-4000-9f61-000000000001,00000000-0000-4000-9f61-000000000002',
      '--ipo', '00000000-0000-4000-9f61-000000000003',
    ]);
    expect(cli.ipoIds).toEqual([
      '00000000-0000-4000-9f61-000000000001',
      '00000000-0000-4000-9f61-000000000002',
      '00000000-0000-4000-9f61-000000000003',
    ]);
  });

  it('reports a non-uuid --ipo value as invalid rather than silently accepting or dropping it', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo', 'not-a-uuid']);
    expect(cli.invalidIpo).toEqual(['not-a-uuid']);
    expect(cli.ipoIds).toEqual([]);
  });

  // #1053 review round 2 MAJOR-1: a present-but-unusable --ipo must never
  // read the same as "no --ipo given" — each of these fell back to unscoped
  // (ipoIds: []) before the fix, which for --apply means every row DB-wide.
  it.each([
    ['--ipo followed by another flag', ['--expect-db', 'ipodhan_test', '--ipo', '--apply']],
    ['a trailing --ipo with no value', ['--expect-db', 'ipodhan_test', '--ipo']],
    ['--ipo given an empty string', ['--expect-db', 'ipodhan_test', '--ipo', '']],
    ['--ipo given a bare comma', ['--expect-db', 'ipodhan_test', '--ipo', ',']],
  ])('MUTATION: unusableIpo is true for %s', (_label, argv) => {
    const cli = parseArgs(argv);
    expect(cli.unusableIpo).toBe(true);
    expect(cli.ipoIds).toEqual([]);
    expect(cli.invalidIpo).toEqual([]);
  });

  it('MUTATION: parses the --ipo=<uuid> single-token form instead of treating it as absent', () => {
    const cli = parseArgs(['--expect-db', 'ipodhan_test', '--ipo=00000000-0000-4000-9f61-000000000001']);
    expect(cli.ipoIds).toEqual(['00000000-0000-4000-9f61-000000000001']);
    expect(cli.unusableIpo).toBe(false);
  });
});

const REMOVED_ROW = { id: 'row-1', table_name: 'gmp_records', field_name: 'gmp', state: 'PENDING' };

function baseCli(overrides: Partial<Cli> = {}): Cli {
  return {
    apply: false,
    allowProd: false,
    expectDb: 'ipodhan_staging',
    undoLedger: null,
    ipoIds: [],
    invalidIpo: [],
    ...overrides,
  };
}

function baseDeps(overrides: Partial<RunDeps> = {}): RunDeps {
  const calls: string[] = [];
  return {
    cli: baseCli(),
    dbLike: { execute: vi.fn().mockResolvedValue({ rows: [{ name: 'ipodhan_staging' }] }) } as never,
    loadManifest: () => ({ version: 2, fields: { 'ipos.issue_size': {} } }) as never,
    readExistingFieldKeys: async () => {
      calls.push('read-existing');
      return ['ipos.issue_size', 'gmp_records.gmp'];
    },
    snapshotRows: async () => {
      calls.push('snapshot-dry-run');
      return [REMOVED_ROW];
    },
    snapshotAndDeleteInTransaction: async (_fieldKeys, onSnapshot) => {
      calls.push('tx-start');
      onSnapshot([REMOVED_ROW]);
      calls.push('tx-delete');
      return { rows: [REMOVED_ROW], deleted: 1 };
    },
    restoreRowsInTransaction: async (rows) => {
      calls.push('restore');
      return rows.length;
    },
    readLedger: () => ({ tool: 't', at: 'x', dbName: 'ipodhan_staging', removedFieldKeys: ['gmp_records.gmp'], rows: [REMOVED_ROW] }),
    writeLedger: (_payload: LedgerPayload) => {
      calls.push('write-ledger');
      return '/tmp/ledger.json';
    },
    logger: { log: () => {}, error: () => {} },
    ...overrides,
  };
}

// queryCurrentDatabase in the real module reads `SELECT current_database() AS name`
// from `dbLike.execute` — every fake dbLike below returns that shape.
function dbLikeReturning(name: string) {
  return { execute: vi.fn().mockResolvedValue({ rows: [{ name }] }) } as never;
}

describe('run — dry run (default)', () => {
  it('never writes: 0 deletes, ledger never invoked, delete transaction never invoked', async () => {
    const deps = baseDeps({ dbLike: dbLikeReturning('ipodhan_staging') });
    const writeLedger = vi.fn();
    const snapshotAndDeleteInTransaction = vi.fn();
    const result = await run({ ...deps, writeLedger, snapshotAndDeleteInTransaction });
    expect(result.exitCode).toBe(0);
    expect(result.wrote).toBe(false);
    expect(result.deleted).toBe(0);
    expect(writeLedger).not.toHaveBeenCalled();
    expect(snapshotAndDeleteInTransaction).not.toHaveBeenCalled();
    expect(result.removedFieldKeys).toEqual(['gmp_records.gmp']);
  });

  it('reports nothing to repair when every existing key is still in the manifest', async () => {
    const deps = baseDeps({
      dbLike: dbLikeReturning('ipodhan_staging'),
      readExistingFieldKeys: async () => ['ipos.issue_size'],
    });
    const result = await run(deps);
    expect(result.removedFieldKeys).toEqual([]);
    expect(result.wrote).toBe(false);
  });
});

describe('run — guards (mutation-tested: deleting any one turns its case green when it must not)', () => {
  it('refuses with no --expect-db, before any read', async () => {
    const readExistingFieldKeys = vi.fn();
    const deps = baseDeps({ cli: baseCli({ expectDb: null }), readExistingFieldKeys });
    const result = await run(deps);
    expect(result.exitCode).toBe(1);
    expect(result.refusedAt).toBe('no-expect-db');
    expect(readExistingFieldKeys).not.toHaveBeenCalled();
  });

  it('refuses when --expect-db names a database this pool is not connected to', async () => {
    const deps = baseDeps({
      cli: baseCli({ expectDb: 'ipodhan_staging' }),
      dbLike: dbLikeReturning('ipodhan_test'), // connected elsewhere
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(1);
    expect(result.refusedAt).toBe('db-mismatch');
  });

  it('refuses an --apply against production without --allow-prod', async () => {
    const deps = baseDeps({
      cli: baseCli({ expectDb: 'ipodhan', apply: true, allowProd: false }),
      dbLike: dbLikeReturning('ipodhan'),
    });
    const snapshotAndDeleteInTransaction = vi.fn();
    const result = await run({ ...deps, snapshotAndDeleteInTransaction });
    expect(result.exitCode).toBe(1);
    expect(result.refusedAt).toBe('prod-guard');
    expect(snapshotAndDeleteInTransaction).not.toHaveBeenCalled();
  });

  it('allows --apply against production with --allow-prod', async () => {
    const deps = baseDeps({
      cli: baseCli({ expectDb: 'ipodhan', apply: true, allowProd: true }),
      dbLike: dbLikeReturning('ipodhan'),
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(0);
    expect(result.wrote).toBe(true);
  });
});

describe('run — --apply: ledger written strictly before the delete, in one transaction call', () => {
  it('calls writeLedger from inside snapshotAndDeleteInTransaction, before it returns', async () => {
    const order: string[] = [];
    const deps = baseDeps({
      cli: baseCli({ apply: true }),
      dbLike: dbLikeReturning('ipodhan_staging'),
      snapshotAndDeleteInTransaction: async (_keys, onSnapshot) => {
        order.push('tx:snapshot');
        onSnapshot([REMOVED_ROW]);
        order.push('tx:after-onSnapshot');
        order.push('tx:delete');
        return { rows: [REMOVED_ROW], deleted: 1 };
      },
      writeLedger: () => {
        order.push('ledger:write');
        return '/tmp/ledger.json';
      },
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(0);
    expect(result.wrote).toBe(true);
    expect(result.deleted).toBe(1);
    // the ledger write happens between the snapshot and the delete, inside
    // the SAME transaction call — never after it returns.
    expect(order).toEqual(['tx:snapshot', 'ledger:write', 'tx:after-onSnapshot', 'tx:delete']);
  });

  it('never deletes when there is nothing to repair — snapshotAndDeleteInTransaction is not called', async () => {
    const snapshotAndDeleteInTransaction = vi.fn();
    const deps = baseDeps({
      cli: baseCli({ apply: true }),
      dbLike: dbLikeReturning('ipodhan_staging'),
      readExistingFieldKeys: async () => ['ipos.issue_size'],
      snapshotAndDeleteInTransaction,
    });
    const result = await run(deps);
    expect(result.wrote).toBe(false);
    expect(snapshotAndDeleteInTransaction).not.toHaveBeenCalled();
  });
});

describe('run — --undo', () => {
  it('restores rows from the ledger via restoreRowsInTransaction', async () => {
    const restoreRowsInTransaction = vi.fn().mockResolvedValue(1);
    const deps = baseDeps({
      cli: baseCli({ apply: true, undoLedger: '/tmp/ledger.json' }),
      dbLike: dbLikeReturning('ipodhan_staging'),
      restoreRowsInTransaction,
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(0);
    expect(result.restored).toBe(1);
    expect(restoreRowsInTransaction).toHaveBeenCalledWith([REMOVED_ROW]);
  });

  it('dry-run --undo (no --apply) restores nothing', async () => {
    const restoreRowsInTransaction = vi.fn();
    const deps = baseDeps({
      cli: baseCli({ apply: false, undoLedger: '/tmp/ledger.json' }),
      dbLike: dbLikeReturning('ipodhan_staging'),
      restoreRowsInTransaction,
    });
    const result = await run(deps);
    expect(result.wrote).toBe(false);
    expect(restoreRowsInTransaction).not.toHaveBeenCalled();
  });

  // MINOR-5 (review round 2): a ledger captured from one database must never
  // be replayed against a different one the operator happens to be
  // connected to right now.
  it('refuses --undo when the ledger names a different database than the one this pool is connected to', async () => {
    const restoreRowsInTransaction = vi.fn();
    const deps = baseDeps({
      cli: baseCli({ apply: true, undoLedger: '/tmp/ledger.json', expectDb: 'ipodhan_staging' }),
      dbLike: dbLikeReturning('ipodhan_staging'),
      readLedger: () => ({ tool: 't', at: 'x', dbName: 'ipodhan_test', removedFieldKeys: ['gmp_records.gmp'], rows: [REMOVED_ROW] }),
      restoreRowsInTransaction,
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(1);
    expect(result.refusedAt).toBe('undo-db-mismatch');
    expect(restoreRowsInTransaction).not.toHaveBeenCalled();
  });

  it('accepts --undo when the ledger names the SAME database this pool is connected to', async () => {
    const restoreRowsInTransaction = vi.fn().mockResolvedValue(1);
    const deps = baseDeps({
      cli: baseCli({ apply: true, undoLedger: '/tmp/ledger.json', expectDb: 'ipodhan_staging' }),
      dbLike: dbLikeReturning('ipodhan_staging'),
      readLedger: () => ({ tool: 't', at: 'x', dbName: 'ipodhan_staging', removedFieldKeys: ['gmp_records.gmp'], rows: [REMOVED_ROW] }),
      restoreRowsInTransaction,
    });
    const result = await run(deps);
    expect(result.exitCode).toBe(0);
    expect(restoreRowsInTransaction).toHaveBeenCalled();
  });
});

/**
 * #1053 review round 2, MAJOR-2: the compiled SQL of both reads must carry
 * `ipo_id = ANY(...)` — bound as ONE array param — when scoped, and carry no
 * such clause at all when unscoped. Rendered via `PgDialect().sqlToQuery`
 * (the same text node-postgres receives), not executed against a database.
 *
 * MUTATION VERIFIED (2026-09-25, manually): passing `null` in place of the
 * real `ipoScope` in `main()`'s call sites (i.e. dropping the scope
 * condition) turns both "scoped" cases below red — `.sql` no longer contains
 * `ipo_id = ANY(` and `.params` no longer carries the id array — while the
 * "unscoped" cases (already `null`) stay green, confirming the assertion
 * actually exercises the scope clause rather than passing vacuously. This is
 * exactly the class the four green-but-wrong deletions in review round 2
 * missed: 72 unit tests stayed green when the scope condition was removed
 * from these query builders, because nothing asserted on the compiled SQL.
 */
describe('#1053 MAJOR-2: readSnapshot / readExistingFieldKeys scope condition is present in the compiled SQL', () => {
  const UUID = '00000000-0000-4000-9f61-00000000000a';

  it('buildSnapshotQuery: scoped — carries ipo_id = ANY($n::uuid[]) with the ids as one param', () => {
    const scope = buildIpoScopeCondition([UUID]);
    const rendered = new PgDialect().sqlToQuery(buildSnapshotQuery(scope, 'ipos', 'issue_size'));
    expect(rendered.sql).toMatch(/ipo_id = ANY\(\$\d+::uuid\[\]\)/);
    expect(rendered.params).toContainEqual([UUID]);
  });

  it('buildSnapshotQuery: unscoped (null) — carries no ANY(...) scope clause at all', () => {
    const rendered = new PgDialect().sqlToQuery(buildSnapshotQuery(null, 'ipos', 'issue_size'));
    expect(rendered.sql).not.toMatch(/ipo_id = ANY\(/);
  });

  it('buildExistingFieldKeysQuery: scoped — carries ipo_id = ANY($n::uuid[]) with the ids as one param', () => {
    const scope = buildIpoScopeCondition([UUID]);
    const rendered = new PgDialect().sqlToQuery(buildExistingFieldKeysQuery(scope));
    expect(rendered.sql).toMatch(/ipo_id = ANY\(\$\d+::uuid\[\]\)/);
    expect(rendered.params).toContainEqual([UUID]);
  });

  it('buildExistingFieldKeysQuery: unscoped (null) — carries no ANY(...) scope clause at all', () => {
    const rendered = new PgDialect().sqlToQuery(buildExistingFieldKeysQuery(null));
    expect(rendered.sql).not.toMatch(/ipo_id = ANY\(/);
  });
});
