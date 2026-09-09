/**
 * MAJOR-3 (PR #433 review): `mergeDuplicateInto({apply: true})` used to trust its CALLER to
 * refuse a production write (the CLI wrapper's `openRepairDb`/`decideProdWriteRefusal`) — a
 * future caller (an admin route, another script) that skipped that guard would write production
 * with no refusal at all. The guard now lives INSIDE the method: the very first thing it does
 * when `opts.apply` is true is read `current_database()` off the SAME connection and throw
 * `ProdWriteRefusedError` before any other read or write when that name is "ipodhan" and
 * `opts.allowProd` is not `true`.
 *
 * The db here is a hand-rolled stub (matching `ipo-repository-prefix.test.ts`'s pattern) whose
 * `execute` only ever needs to answer `select current_database()` for the refusal case — the
 * guard throws before `select().from(ipos)...` or anything else is called, so `select` is
 * asserted NOT called on refusal.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository } from './ipo-repository';
import { ProdWriteRefusedError } from '../errors/repository-errors';

function makeStubDb(currentDatabase: string) {
  const execute = vi.fn().mockResolvedValue({ rows: [{ current_database: currentDatabase }] });
  const select = vi.fn(() => {
    throw new Error('select() must not be called — the prod guard must refuse before any read/write');
  });
  return { execute, select, insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() } as unknown as never;
}

const mockRedis = { get: vi.fn(), setex: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() } as unknown as never;

describe('IPORepository.mergeDuplicateInto — prod write guard (MAJOR-3, PR #433 review)', () => {
  it('throws ProdWriteRefusedError BEFORE any read/write when current_database() is "ipodhan" and allowProd is not set', async () => {
    const db = makeStubDb('ipodhan');
    const repo = new IPORepository(db as never, mockRedis as never);

    await expect(
      repo.mergeDuplicateInto('keep-id', 'drop-id', { apply: true })
    ).rejects.toBeInstanceOf(ProdWriteRefusedError);

    expect((db as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled();
  });

  it('throws ProdWriteRefusedError when current_database() is "ipodhan" and allowProd is explicitly false', async () => {
    const db = makeStubDb('ipodhan');
    const repo = new IPORepository(db as never, mockRedis as never);

    await expect(
      repo.mergeDuplicateInto('keep-id', 'drop-id', { apply: true, allowProd: false })
    ).rejects.toBeInstanceOf(ProdWriteRefusedError);
  });

  it('does NOT refuse (proceeds past the guard) when current_database() is "ipodhan_staging"', async () => {
    const db = makeStubDb('ipodhan_staging');
    const repo = new IPORepository(db as never, mockRedis as never);

    // Past the guard it calls `this.db.select().from(ipos)...` next — the stub's `select` throws
    // a DIFFERENT error, proving the guard let execution continue instead of refusing.
    await expect(repo.mergeDuplicateInto('keep-id', 'drop-id', { apply: true })).rejects.toThrow(
      /must not be called — the prod guard must refuse/
    );
    await expect(repo.mergeDuplicateInto('keep-id', 'drop-id', { apply: true })).rejects.not.toBeInstanceOf(
      ProdWriteRefusedError
    );
  });

  it('does NOT refuse when current_database() is "ipodhan" but allowProd is true', async () => {
    const db = makeStubDb('ipodhan');
    const repo = new IPORepository(db as never, mockRedis as never);

    await expect(
      repo.mergeDuplicateInto('keep-id', 'drop-id', { apply: true, allowProd: true })
    ).rejects.toThrow(/must not be called — the prod guard must refuse/);
    await expect(
      repo.mergeDuplicateInto('keep-id', 'drop-id', { apply: true, allowProd: true })
    ).rejects.not.toBeInstanceOf(ProdWriteRefusedError);
  });

  it('is never even queried on a dry run (opts.apply: false), whatever the database is', async () => {
    const db = makeStubDb('ipodhan');
    const repo = new IPORepository(db as never, mockRedis as never);

    await expect(repo.mergeDuplicateInto('keep-id', 'drop-id', { apply: false })).rejects.toThrow(
      /must not be called — the prod guard must refuse/
    );
    expect((db as { execute: ReturnType<typeof vi.fn> }).execute).not.toHaveBeenCalled();
  });
});
