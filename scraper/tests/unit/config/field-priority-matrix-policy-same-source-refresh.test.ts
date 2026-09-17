/**
 * Item 3 slice S1b, test (d): `allowsSameSourceRefresh('lotSize', 'BSE', 'ipos')` under the
 * flipped `issue-size` policy answers from `resolveFieldSourcePolicy(...).ranks`, not
 * `rules.sameSourceRefreshSources ?? rules.sources` (card finding 5).
 *
 * `ipos.lot_size` is in the flipped `issue-size` group. Its LEGACY matrix entry
 * (`field-priority-matrix.ts`'s `lotSize`) opts BSE OUT of self-refresh —
 * `sameSourceRefreshSources: ['DRHP']` only, despite `BSE` being in the wider `sources` list
 * ("BSE data is more accurate historically" per the entry's own description, yet excluded from
 * self-refresh today). The manifest POLICY for `ipos.lot_size` (MAINBOARD) ranks
 * `[DOC, BSE, NSE]` — BSE IS ranked. RED on origin/main: the function takes no `tableName` and
 * always answers from the legacy narrow list, so BSE is always refused; this test requires BSE
 * to be ALLOWED once the field is flipped (the resolver, not the stale matrix entry, decides).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: {
    ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()).FEATURE_FLAGS,
    ENABLE_POLICY_WRITER: true,
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('item 3 S1b (d): allowsSameSourceRefresh under a flipped policy', () => {
  it('BSE: excluded from the legacy sameSourceRefreshSources list but ranked in the manifest policy for ipos.lot_size -> allowed', async () => {
    const { allowsSameSourceRefresh } = await import('../../../src/config/field-priority-matrix.js');
    expect(allowsSameSourceRefresh('lotSize', 'BSE', 'ipos')).toBe(true);
  });

  it('DRHP: authoritative in BOTH the legacy narrow list and the manifest policy ranks -> still allowed', async () => {
    const { allowsSameSourceRefresh } = await import('../../../src/config/field-priority-matrix.js');
    expect(allowsSameSourceRefresh('lotSize', 'DRHP', 'ipos')).toBe(true);
  });

  it('MONEYCONTROL: in the wider legacy sources list but not sameSourceRefreshSources, and not in the manifest policy ranks -> refused under policy', async () => {
    const { allowsSameSourceRefresh } = await import('../../../src/config/field-priority-matrix.js');
    expect(allowsSameSourceRefresh('lotSize', 'MONEYCONTROL', 'ipos')).toBe(false);
  });

  it('no tableName (pre-S1b one-arg call shape): always answers from the legacy narrow list, BSE refused', async () => {
    const { allowsSameSourceRefresh } = await import('../../../src/config/field-priority-matrix.js');
    expect(allowsSameSourceRefresh('lotSize', 'BSE')).toBe(false);
  });
});
