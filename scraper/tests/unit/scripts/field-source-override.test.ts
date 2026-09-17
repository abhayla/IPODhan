// implements: item 3 slice S4 -- field-source-override CLI (parseArgs + run, guards mutation-tested)
import { describe, it, expect, vi } from 'vitest';
import { parseArgs, run, type RunDeps } from '../../../scripts/field-source-override.js';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';
import { FieldSourceOverridesRepository } from '@ipodhan/shared/repositories/field-source-overrides-repository';

const REASON = 'swap test path 2 (owner go 2026-09-17)';

function fakeRepo(overrides: Partial<FieldSourceOverridesRepository> = {}) {
  return {
    listActive: vi.fn().mockResolvedValue([]),
    listActiveFor: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue({ id: 'new-id', expiresAt: new Date('2026-10-18T00:00:00Z') }),
    expire: vi.fn().mockResolvedValue({ id: 'existing-id', tableName: 'ipos', fieldName: 'issue_size' }),
    findById: vi.fn().mockResolvedValue({ id: 'existing-id', tableName: 'ipos', fieldName: 'issue_size' }),
    ...overrides,
  } as unknown as FieldSourceOverridesRepository;
}

function testDbLike(dbName = 'ipodhan_test') {
  return { execute: vi.fn().mockResolvedValue({ rows: [{ name: dbName }] }) };
}

function makeDeps(overrides: Partial<RunDeps> = {}): RunDeps {
  return {
    dbLike: testDbLike() as never,
    repo: fakeRepo(),
    loadManifest: loadFieldManifest,
    resolveIpoId: vi.fn().mockResolvedValue('some-ipo-id'),
    log: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
}

describe('parseArgs', () => {
  it('parses set with all flags', () => {
    const cli = parseArgs([
      'set', '--table', 'ipos', '--column', 'issue_size', '--ranks', 'CHITTORGARH,DOC',
      '--reason', REASON, '--expect-db', 'ipodhan_staging', '--apply',
    ]);
    expect(cli).toMatchObject({
      subcommand: 'set', table: 'ipos', column: 'issue_size', ranks: ['CHITTORGARH', 'DOC'],
      reason: REASON, expectDb: 'ipodhan_staging', apply: true, expiresInDays: 30,
    });
  });

  it('defaults expiresInDays to 30', () => {
    const cli = parseArgs(['set', '--table', 'ipos', '--column', 'issue_size', '--ranks', 'DOC', '--reason', REASON]);
    expect(cli.subcommand === 'set' && cli.expiresInDays).toBe(30);
  });

  it('parses list', () => {
    expect(parseArgs(['list', '--expect-db', 'ipodhan_test'])).toEqual({
      subcommand: 'list', apply: false, allowProd: false, expectDb: 'ipodhan_test',
    });
  });

  it('parses expire with an id', () => {
    const cli = parseArgs(['expire', 'abc-123', '--expect-db', 'ipodhan_test', '--apply']);
    expect(cli).toEqual({ subcommand: 'expire', id: 'abc-123', apply: true, allowProd: false, expectDb: 'ipodhan_test' });
  });

  it('unknown subcommand -> null', () => {
    expect(parseArgs(['bogus'])).toEqual({ subcommand: null });
  });
});

describe('run -- guards, mutation-tested', () => {
  it('no subcommand -> exit 1', async () => {
    const result = await run({ subcommand: null }, makeDeps());
    expect(result.exitCode).toBe(1);
  });

  // CI type-check fix follow-up: the unnarrowed `{ subcommand: null }` union member is the
  // parse-failure branch, and it was previously exercised only in two disconnected tests
  // (parseArgs(['bogus']) above; run({subcommand:null}) here) -- never CHAINED the way `main()`
  // actually calls them. This closes that gap end-to-end, matching the real CLI invocation
  // (`npx tsx scripts/field-source-override.ts bogus` -> exit 1, proven manually this round).
  it('parseArgs(bogus subcommand) chained into run() -> exit 1 with a usage message, the same path main() takes', async () => {
    const errLines: string[] = [];
    const cli = parseArgs(['bogus']);
    const result = await run(cli, makeDeps({ error: (l) => errLines.push(l) }));
    expect(result.exitCode).toBe(1);
    expect(errLines[0]).toMatch(/usage:/);
  });

  it('missing --expect-db -> exit 1, no DB call', async () => {
    const dbLike = testDbLike();
    const result = await run({ subcommand: 'list', apply: false, allowProd: false, expectDb: null }, makeDeps({ dbLike: dbLike as never }));
    expect(result.exitCode).toBe(1);
    expect(dbLike.execute).not.toHaveBeenCalled();
  });

  it('MUTATION TARGET (wrong DB): --expect-db mismatches the connected database -> refused, exit 1', async () => {
    const result = await run(
      { subcommand: 'list', apply: false, allowProd: false, expectDb: 'ipodhan_staging' },
      makeDeps({ dbLike: testDbLike('ipodhan_test') as never })
    );
    expect(result.exitCode).toBe(1);
  });

  it('MUTATION TARGET (incapable source): set refuses BSE for issue_size', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'set', table: 'ipos', column: 'issue_size', ipo: null, ranks: ['BSE'], reason: REASON, expiresInDays: 30, setBy: 'cli', apply: true, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo })
    );
    expect(result.exitCode).toBe(1);
    expect(repo.set).not.toHaveBeenCalled();
  });

  it('MUTATION TARGET (S-05): set refuses DOC on ipos.open_date (E-1 timetable field)', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'set', table: 'ipos', column: 'open_date', ipo: null, ranks: ['DOC', 'NSE'], reason: REASON, expiresInDays: 30, setBy: 'cli', apply: true, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo })
    );
    expect(result.exitCode).toBe(1);
    expect(repo.set).not.toHaveBeenCalled();
  });

  it('a valid set with --apply calls repo.set and returns exit 0', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'set', table: 'ipos', column: 'issue_size', ipo: null, ranks: ['CHITTORGARH', 'DOC'], reason: REASON, expiresInDays: 30, setBy: 'cli', apply: true, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo })
    );
    expect(result.exitCode).toBe(0);
    expect(repo.set).toHaveBeenCalledTimes(1);
  });

  it('a valid set WITHOUT --apply is a dry run: repo.set is never called', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'set', table: 'ipos', column: 'issue_size', ipo: null, ranks: ['CHITTORGARH', 'DOC'], reason: REASON, expiresInDays: 30, setBy: 'cli', apply: false, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo })
    );
    expect(result.exitCode).toBe(0);
    expect(repo.set).not.toHaveBeenCalled();
  });

  it('an --ipo that does not resolve is refused before any write', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'set', table: 'ipos', column: 'issue_size', ipo: 'no-such-ipo', ranks: ['DOC'], reason: REASON, expiresInDays: 30, setBy: 'cli', apply: true, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo, resolveIpoId: vi.fn().mockResolvedValue(null) })
    );
    expect(result.exitCode).toBe(1);
    expect(repo.set).not.toHaveBeenCalled();
  });

  it('list with active overrides prints each row and returns exit 0', async () => {
    const repo = fakeRepo({
      listActive: vi.fn().mockResolvedValue([
        { id: 'x', tableName: 'ipos', fieldName: 'issue_size', ipoId: null, rank1Source: 'DOC', rank2Source: null, rank3Source: null, reason: REASON, setBy: 'cli', expiresAt: new Date('2026-10-18T00:00:00Z') },
      ]),
    });
    const result = await run({ subcommand: 'list', apply: false, allowProd: false, expectDb: 'ipodhan_test' }, makeDeps({ repo }));
    expect(result.exitCode).toBe(0);
  });

  it('expire with --apply on an existing id succeeds', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'expire', id: '11111111-1111-1111-1111-111111111111', apply: true, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo })
    );
    expect(result.exitCode).toBe(0);
    expect(repo.expire).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('expire on a nonexistent id (apply) is refused', async () => {
    const repo = fakeRepo({ expire: vi.fn().mockResolvedValue(null) });
    const result = await run(
      { subcommand: 'expire', id: '22222222-2222-2222-2222-222222222222', apply: true, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo })
    );
    expect(result.exitCode).toBe(1);
  });

  it('expire without --apply is a dry run', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'expire', id: '11111111-1111-1111-1111-111111111111', apply: false, allowProd: false, expectDb: 'ipodhan_test' },
      makeDeps({ repo })
    );
    expect(result.exitCode).toBe(0);
    expect(repo.expire).not.toHaveBeenCalled();
  });

  it('MUTATION TARGET (prod guard): --apply against the prod db name without --allow-prod is refused', async () => {
    const repo = fakeRepo();
    const result = await run(
      { subcommand: 'set', table: 'ipos', column: 'issue_size', ipo: null, ranks: ['DOC'], reason: REASON, expiresInDays: 30, setBy: 'cli', apply: true, allowProd: false, expectDb: 'ipodhan' },
      makeDeps({ repo, dbLike: testDbLike('ipodhan') as never })
    );
    expect(result.exitCode).toBe(1);
    expect(repo.set).not.toHaveBeenCalled();
  });
});
