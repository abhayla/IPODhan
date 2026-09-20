import { describe, it, expect, vi } from 'vitest';
import { applyMerges } from '../../../scripts/merge-duplicate-ipos';

/**
 * Issue #807 piece 1: `merge-duplicate-ipos.ts` (the plural clustering tool)
 * used to write `ipos`/`gmp_records`/`subscriptions` with raw
 * `db.execute(sql.raw(...))` template strings — grandfathered in the write
 * ratchet (config/write-ratchet-baseline.json:97) because it predates the
 * rule, not because the pattern is fine. `IPORepository.mergeDuplicateInto`
 * (packages/shared/src/repositories/ipo-repository.ts) is the shared write
 * path already used by the singular tool (repair-merge-duplicate-ipo.ts,
 * PR #432/#433) and already proven end-to-end against a real database in
 * scraper/tests/integration/duplicate-ipo-merge.integration.test.ts — it
 * performs the SAME work the raw SQL did (symbol/isin backfill onto the
 * survivor, subscriptions/gmp_records repoint, slug redirect, dropped-row
 * delete), all through the Drizzle query builder.
 *
 * This test proves `applyMerges` (the extracted, now-real function this PR
 * introduces to replace the inline `db.transaction(sql.raw(...))` block in
 * `main()`) calls `IPORepository.mergeDuplicateInto` once per cluster pair
 * with the correct keep/drop ids — routing through the real function, not a
 * re-implementation — rather than issuing any raw SQL itself. The DB-write
 * behaviour of `mergeDuplicateInto` itself is unchanged by this PR and stays
 * covered by its own integration test.
 */

describe('applyMerges', () => {
  it('calls repo.mergeDuplicateInto once per pair with apply:true and forceDifferentName:true', async () => {
    const calls: unknown[] = [];
    const repo = {
      mergeDuplicateInto: vi.fn(async (keepId: string, dropId: string, opts: Record<string, unknown>) => {
        calls.push({ keepId, dropId, opts });
        return { applied: true, keepSlug: 'keep-slug', droppedSlug: 'dup-slug', provenanceWritten: [] };
      }),
    };

    await applyMerges(
      repo as never,
      [
        { keep: 'keep-1', dup: 'dup-1', dupSlug: 'dup-1-slug' },
        { keep: 'keep-2', dup: 'dup-2', dupSlug: 'dup-2-slug' },
      ],
      { allowProd: false }
    );

    expect(repo.mergeDuplicateInto).toHaveBeenCalledTimes(2);
    expect(calls[0]).toMatchObject({
      keepId: 'keep-1',
      dropId: 'dup-1',
      opts: { apply: true, forceDifferentName: true, allowProd: false },
    });
    expect(calls[1]).toMatchObject({
      keepId: 'keep-2',
      dropId: 'dup-2',
      opts: { apply: true, forceDifferentName: true, allowProd: false },
    });
  });

  it('does nothing when given an empty merge list (no writes attempted)', async () => {
    const repo = { mergeDuplicateInto: vi.fn() };
    await applyMerges(repo as never, [], { allowProd: false });
    expect(repo.mergeDuplicateInto).not.toHaveBeenCalled();
  });

  it('propagates a refusal from mergeDuplicateInto (e.g. prod guard) instead of swallowing it', async () => {
    const repo = {
      mergeDuplicateInto: vi.fn(async () => {
        throw new Error('mergeDuplicateInto: refusing to APPLY writes against the production database');
      }),
    };
    await expect(
      applyMerges(repo as never, [{ keep: 'k', dup: 'd', dupSlug: 's' }], { allowProd: false })
    ).rejects.toThrow(/refusing to APPLY/);
  });
});
