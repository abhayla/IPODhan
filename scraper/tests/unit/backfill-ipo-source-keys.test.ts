import { describe, it, expect } from 'vitest';
import { planSourceKeyBackfill, type BackfillRow } from '../../scripts/backfill-ipo-source-keys';

// OD-85 scenario 19 (docs/design/data-sourcing-pull-model.md §2.3.3.2): two rows claiming one key ->
// neither inserted, the pair reported by name.
const row = (over: Partial<BackfillRow>): BackfillRow => ({
  id: 'x', slug: 'x', companyName: 'X', status: 'UPCOMING', bseIpoNo: null, verifierUrl: null, openDate: null, ...over,
});

describe('planSourceKeyBackfill', () => {
  it('reads BSE_IPO_NO from bse_ipo_no and CG_PAGE_ID from verifier_url (slug ignored)', () => {
    const plan = planSourceKeyBackfill([row({ id: 'a', bseIpoNo: 7977, verifierUrl: 'https://www.chittorgarh.com/ipo/nse-ipo/3151/' })], []);
    expect(plan.insert.map((k) => `${k.keyType}:${k.keyValue}`).sort()).toEqual(['BSE_IPO_NO:7977', 'CG_PAGE_ID:3151']);
  });
  it('the Rays of Belief pair claiming one CG id -> neither inserted, pair reported by name', () => {
    const plan = planSourceKeyBackfill([
      row({ id: 'a', slug: 'rays-of-belief-ltd', companyName: 'Rays of Belief Ltd', verifierUrl: 'https://www.chittorgarh.com/ipo/rays-of-belief-ipo/2787/' }),
      row({ id: 'b', slug: 'rays-of-belief-ltd-o', companyName: 'Rays of Belief Ltd', verifierUrl: 'https://www.chittorgarh.com/ipo/rays-of-belief-ltd-ipo/2787/', bseIpoNo: 7920 }),
    ], []);
    expect(plan.insert.map((k) => `${k.ipoId}:${k.keyValue}`)).toEqual(['b:7920']);
    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0].rows.map((r) => r.slug)).toEqual(['rays-of-belief-ltd', 'rays-of-belief-ltd-o']);
  });
  it('skips ended offerings, keys already on their row, and reports a key bound elsewhere', () => {
    const plan = planSourceKeyBackfill([
      row({ id: 'w', status: 'WITHDRAWN', bseIpoNo: 1 }),
      row({ id: 'k', bseIpoNo: 2 }),
      row({ id: 'm', bseIpoNo: 3 }),
    ], [
      { ipoId: 'k', source: 'BSE', keyType: 'BSE_IPO_NO', bindingValue: '2' },
      { ipoId: 'other', source: 'BSE', keyType: 'BSE_IPO_NO', bindingValue: '3' },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.skippedEnded).toBe(1);
    expect(plan.collisions.map((c) => c.keyValue)).toEqual(['3']);
  });
});
