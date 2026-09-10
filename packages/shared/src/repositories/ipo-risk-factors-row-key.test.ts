/**
 * Item 1 slice s6 — the row key of `ipo_risk_factors` is the heading's
 * content, not its position.
 *
 * The guard that matters is `reorders without changing either row key`: it is
 * the whole reason the re-key exists, and it is mutation-tested (put `seq`
 * back into the key and it goes red — see the test's own comment).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  prepareRiskFactorRows,
  IpoRiskFactorsRepository,
  type IpoRiskFactorInsert,
} from './ipo-risk-factors-repository';
import { normalizeHeading, headingHashForRiskFactor } from '../utils/risk-factor-heading-key';

const IPO = '11111111-1111-1111-1111-111111111111';
const factor = (heading: string): IpoRiskFactorInsert => ({ ipoId: IPO, heading, body: null, kpis: null });

describe('normalizeHeading', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeHeading('  We DEPEND, heavily,  on  ONE customer.  ')).toBe('we depend heavily on one customer');
  });

  it('gives the same key to headings differing only in case or punctuation', () => {
    // The real prasol-chemicals-ltd collision on staging was exactly this:
    // two rows differing only in "plot" vs "Plot".
    expect(headingHashForRiskFactor('Owned plot, Raigad')).toBe(headingHashForRiskFactor('Owned Plot Raigad'));
  });

  it('gives DIFFERENT keys to genuinely different headings', () => {
    expect(headingHashForRiskFactor('We depend on one customer')).not.toBe(
      headingHashForRiskFactor('We depend on two customers')
    );
  });

  it('returns null for a heading with no content, and a stable distinct key for junk', () => {
    expect(headingHashForRiskFactor('   ')).toBeNull();
    expect(headingHashForRiskFactor(null)).toBeNull();
    // Punctuation-only headings normalize to '' but are still distinct facts:
    // they must not all collapse onto one constant hash.
    expect(headingHashForRiskFactor('---')).not.toBe(headingHashForRiskFactor('***'));
    expect(headingHashForRiskFactor('---')).toBe(headingHashForRiskFactor('  ---  '));
  });

  it('is 16 hex characters, inside the varchar(32) column', () => {
    expect(headingHashForRiskFactor('Anything at all')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('prepareRiskFactorRows — reordering stability', () => {
  it('produces the SAME row keys with swapped seq when two factors swap position', () => {
    const first = prepareRiskFactorRows([
      factor('Risk one: supply'),
      factor('Risk two: demand'),
      factor('Risk three: THIRD ITEM'),
      factor('Risk four: FOURTH ITEM'),
    ]);
    // The later RHP prints the same four risks with #3 and #4 swapped.
    const second = prepareRiskFactorRows([
      factor('Risk one: supply'),
      factor('Risk two: demand'),
      factor('Risk four: FOURTH ITEM'),
      factor('Risk three: THIRD ITEM'),
    ]);

    const keyOf = (p: typeof first, heading: string) => p.rows.find((r) => r.heading === heading)!;
    const thirdBefore = keyOf(first, 'Risk three: THIRD ITEM');
    const thirdAfter = keyOf(second, 'Risk three: THIRD ITEM');
    const fourthBefore = keyOf(first, 'Risk four: FOURTH ITEM');
    const fourthAfter = keyOf(second, 'Risk four: FOURTH ITEM');

    // Identity survives the reorder...
    expect(thirdAfter.headingHash).toBe(thirdBefore.headingHash);
    expect(fourthAfter.headingHash).toBe(fourthBefore.headingHash);
    // ...and the whole key SET is unchanged, so no provenance is re-attributed.
    expect(new Set(second.rows.map((r) => r.headingHash))).toEqual(
      new Set(first.rows.map((r) => r.headingHash))
    );
    // ...while display order follows the new document.
    expect([thirdBefore.seq, fourthBefore.seq]).toEqual([3, 4]);
    expect([thirdAfter.seq, fourthAfter.seq]).toEqual([4, 3]);

    // MUTATION: make the key positional again — e.g. in
    // `headingHashForRiskFactor`, hash `${seq}:${normalized}` instead of the
    // normalized heading, or in `prepareRiskFactorRows` set
    // `headingHash: `${prepared.rows.length + 1}:${headingHash}``. Both
    // assertions above go red: thirdAfter.headingHash becomes the key that
    // belonged to the FOURTH risk factor, which is precisely the silent
    // provenance mis-attribution this slice removes.
  });

  it('re-derives seq from array position and ignores any caller numbering', () => {
    const prepared = prepareRiskFactorRows([factor('Alpha'), factor('Beta'), factor('Gamma')]);
    expect(prepared.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });
});

describe('prepareRiskFactorRows — de-duplication (the constraint would throw without it)', () => {
  it('keeps the FIRST occurrence, so the lowest original seq survives', () => {
    const prepared = prepareRiskFactorRows([
      factor('We depend on one customer.'),
      factor('Something else entirely'),
      // Byte-identical repeat — the shape measured on staging (7 groups, 14
      // surplus rows, every group differing only in seq).
      factor('We depend on one customer.'),
      // Same fact, different punctuation/case — still one row.
      factor('WE DEPEND ON ONE CUSTOMER'),
    ]);

    expect(prepared.rows).toHaveLength(2);
    expect(prepared.rows[0].heading).toBe('We depend on one customer.');
    expect(prepared.rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(prepared.droppedDuplicateKey).toHaveLength(2);
    // No two rows can collide on the unique constraint.
    expect(new Set(prepared.rows.map((r) => r.headingHash)).size).toBe(prepared.rows.length);
  });

  it('drops a heading that carries no content rather than inventing a key', () => {
    const prepared = prepareRiskFactorRows([factor('   '), factor('Real risk')]);
    expect(prepared.rows.map((r) => r.heading)).toEqual(['Real risk']);
    expect(prepared.droppedNoHeading).toBe(1);
  });
});

describe('replaceForIpo — delete and insert stay in ONE transaction', () => {
  /** A fake db that answers BOTH shapes — `db.transaction(...)` and a direct
   * `db.delete(...)`/`db.insert(...)` — so a split-statement implementation
   * runs to completion instead of failing on a missing method. Without this
   * the guard passes for the wrong reason and cannot be mutated red. */
  function fakeDb(onInsert: () => never | unknown) {
    const deletes: ('in-transaction' | 'direct')[] = [];
    let committedDeletes = 0;
    const arm = (where: 'in-transaction' | 'direct') => ({
      delete: () => ({
        where: async () => {
          deletes.push(where);
          if (where === 'direct') committedDeletes += 1; // no rollback outside a tx
        },
      }),
      insert: () => ({ values: () => ({ returning: async () => onInsert() }) }),
    });
    const db = {
      ...arm('direct'),
      transaction: async (cb: (t: ReturnType<typeof arm>) => Promise<unknown>) => {
        const out = await cb(arm('in-transaction'));
        committedDeletes += deletes.filter((d) => d === 'in-transaction').length;
        return out; // a throw inside cb never reaches here: the delete rolls back
      },
    };
    return { db, deletes, committed: () => committedDeletes };
  }

  it('leaves the IPO rows intact when the insert throws', async () => {
    const { db, deletes, committed } = fakeDb(() => {
      throw new Error('duplicate key value violates unique constraint');
    });
    const repo = new IpoRiskFactorsRepository(db as never, { del: vi.fn() } as never);

    await expect(repo.replaceForIpo(IPO, [factor('A risk')])).rejects.toThrow();

    // The delete must have happened inside the transaction, and must NOT have
    // committed — otherwise the IPO now shows ZERO risk factors on a live page.
    expect(deletes).toEqual(['in-transaction']);
    expect(committed()).toBe(0);

    // MUTATION: split `replaceForIpo` into two statements — `this.db.delete(...)`
    // then `this.db.insert(...)`, outside `this.db.transaction`. `deletes`
    // becomes ['direct'] and `committed()` becomes 1 while the insert still
    // throws: both assertions go red.
  });

  it('commits the delete with the insert on the happy path', async () => {
    const { db, committed } = fakeDb(() => []);
    const repo = new IpoRiskFactorsRepository(db as never, { del: vi.fn() } as never);
    await repo.replaceForIpo(IPO, [factor('A risk')]);
    expect(committed()).toBe(1);
  });
});
