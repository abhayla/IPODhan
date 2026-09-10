import { describe, it, expect } from 'vitest';
import {
  deriveIssueSizeRupees,
  applyRepairAtomically,
  type RepairWriteTarget,
} from '../../../scripts/repair-price-band-lot-issue-size-t453.js';

/**
 * #453: Manika Plastech's issue_size was frozen at a pre-band draft value
 * (fresh amount + OFS shares x the price-band FLOOR) instead of the
 * market-convention headline figure (fresh amount + OFS shares x the
 * price-band CAP). This is the pure derivation the repair tool uses to
 * compute the corrected value — unit-tested in isolation so a future class
 * member's re-derivation trigger can reuse it without re-deriving the
 * arithmetic from memory.
 */
describe('deriveIssueSizeRupees — fresh amount + OFS shares x band cap', () => {
  it('matches the stale stored value when driven at the band FLOOR (regression check on real numbers)', () => {
    // Manika Plastech's actual stored issue_size (1,231,976,720.00) was
    // derived at the band floor (Rs 40) — reproducing it here proves the
    // formula, not just a made-up example.
    const freshIssueRupees = 925_000_000; // Rs 92.5 Cr
    const ofsShares = 7_674_418;
    const bandFloor = 40;
    expect(deriveIssueSizeRupees(freshIssueRupees, ofsShares, bandFloor)).toBe(1_231_976_720);
  });

  it('derives the corrected value at the band CAP (the market-convention headline figure)', () => {
    const freshIssueRupees = 925_000_000; // Rs 92.5 Cr
    const ofsShares = 7_674_418; // NSE ipo-detail: OFS of up to 7,674,418 equity shares
    const bandCap = 43;
    // 925,000,000 + 7,674,418 * 43 = 925,000,000 + 329,999,974 = 1,254,999,974
    expect(deriveIssueSizeRupees(freshIssueRupees, ofsShares, bandCap)).toBe(1_254_999_974);
  });

  it('throws on a non-finite or non-positive input rather than silently returning NaN/0', () => {
    expect(() => deriveIssueSizeRupees(Number.NaN, 100, 40)).toThrow();
    expect(() => deriveIssueSizeRupees(100, 0, 40)).toThrow();
    expect(() => deriveIssueSizeRupees(100, 100, 0)).toThrow();
  });
});

/**
 * Tier-A review (PR #456, MAJOR-1): the original code committed the
 * `field_sources` provenance writes inside `db.transaction(...)` and THEN
 * called `repo.applyOfferTerms()` OUTSIDE that transaction — a throw from
 * the update left provenance rows on disk describing a write that never
 * happened. `applyRepairAtomically()` puts both halves inside ONE
 * `dbLike.transaction(...)` call so a throw anywhere rolls back everything.
 *
 * The fake `dbLike.transaction()` below reproduces real transactional
 * semantics in memory: writes made through the `tx` handle only land in
 * `committed` if the callback returns without throwing; a throw leaves
 * `committed` untouched (simulating a real ROLLBACK). This is the
 * regression guard for the ordering fix — flip `applyRepairAtomically` back
 * to the old two-call shape (provenance committed via a real `db.transaction`,
 * then an unguarded `repo.applyOfferTerms()` call after it) and the first
 * assertion below goes RED because the provenance write would already be
 * committed by the time the update throws.
 */
describe('applyRepairAtomically — provenance and the ipos update share one transaction', () => {
  function makeFakeDb() {
    const committed: Array<{ kind: 'field_source' | 'offer_terms'; payload: unknown }> = [];
    return {
      committed,
      transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const pending: Array<{ kind: 'field_source' | 'offer_terms'; payload: unknown }> = [];
        const tx = { pending };
        const result = await fn(tx); // a throw here rejects — `pending` is never merged into `committed`
        committed.push(...pending);
        return result;
      },
    };
  }

  const targets: RepairWriteTarget[] = [{ field: 'lotSize', from: null, to: 348 }];

  it('RED-proving case: an update-side throw leaves NO field_sources row committed', async () => {
    const fakeDb = makeFakeDb();
    const upsertFieldSourceFn = (async (tx: any, params: any) => {
      tx.pending.push({ kind: 'field_source', payload: params });
      return { previousSource: null };
    }) as any;
    const makeRepo = (tx: any) => ({
      applyOfferTerms: async () => {
        // Simulates the repository's own db.update(...) throwing — e.g. a
        // constraint violation — AFTER field_sources would already have
        // been queued for this same transaction.
        throw new Error('simulated ipos update failure');
      },
    });

    await expect(
      applyRepairAtomically(fakeDb, {
        ipoId: 'ipo-1',
        targets,
        updatedBy: 'TEST',
        reason: 'test',
        updatePayload: { lotSize: 348 },
        upsertFieldSourceFn,
        makeRepo,
      })
    ).rejects.toThrow('simulated ipos update failure');

    expect(fakeDb.committed).toHaveLength(0);
  });

  it('GREEN case: provenance and the offer-terms update commit together on success', async () => {
    const fakeDb = makeFakeDb();
    const upsertFieldSourceFn = (async (tx: any, params: any) => {
      tx.pending.push({ kind: 'field_source', payload: params });
      return { previousSource: null };
    }) as any;
    const applied: Array<{ id: string; data: unknown }> = [];
    const makeRepo = (tx: any) => ({
      applyOfferTerms: async (id: string, data: any) => {
        tx.pending.push({ kind: 'offer_terms', payload: { id, data } });
        applied.push({ id, data });
      },
    });

    await applyRepairAtomically(fakeDb, {
      ipoId: 'ipo-1',
      targets,
      updatedBy: 'TEST',
      reason: 'test',
      updatePayload: { lotSize: 348 },
      upsertFieldSourceFn,
      makeRepo,
    });

    expect(fakeDb.committed).toHaveLength(2);
    expect(fakeDb.committed.map((c) => c.kind)).toEqual(['field_source', 'offer_terms']);
    expect(applied).toHaveLength(1);
  });
});
