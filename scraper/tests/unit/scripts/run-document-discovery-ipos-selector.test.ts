import { describe, it, expect, vi } from 'vitest';
import {
  resolveIposFromSelectors,
  type IposSelectorRow,
} from '../../../scripts/run-document-discovery.js';

function row(overrides: Partial<IposSelectorRow> = {}): IposSelectorRow {
  return {
    id: 'ipo-1',
    companyName: 'Purple Style Labs Limited',
    symbol: 'PERNIASPOP',
    segment: 'MAINBOARD',
    status: 'OPEN',
    priceRangeMin: 546,
    closeDate: '2026-09-02',
    bseIpoNo: null,
    companyWebsite: null,
    verifierUrl: null,
    ...overrides,
  };
}

describe('resolveIposFromSelectors (T-433 --ipos selector)', () => {
  it('maps a matched row into the ACCEPTANCE_IPOS shape, deriving stage from status+band', async () => {
    const query = vi.fn().mockResolvedValue([row()]);
    const [ipo] = await resolveIposFromSelectors(['PERNIASPOP'], query);
    expect(query).toHaveBeenCalledWith('PERNIASPOP');
    expect(ipo).toMatchObject({
      id: 'ipo-1',
      accId: 'ipo-1',
      companyName: 'Purple Style Labs Limited',
      symbol: 'PERNIASPOP',
      segment: 'MAINBOARD',
      stage: 'OPEN',
      dbStatus: 'OPEN',
      closeDate: '2026-09-02',
    });
  });

  it('derives PRE_OPEN for an UPCOMING status that already has a price band', async () => {
    const query = vi.fn().mockResolvedValue([row({ status: 'UPCOMING', priceRangeMin: 100 })]);
    const [ipo] = await resolveIposFromSelectors(['SYM'], query);
    expect(ipo.stage).toBe('PRE_OPEN');
  });

  it('defaults closeDate to empty string when the row has none yet', async () => {
    const query = vi.fn().mockResolvedValue([row({ closeDate: null })]);
    const [ipo] = await resolveIposFromSelectors(['SYM'], query);
    expect(ipo.closeDate).toBe('');
  });

  it('resolves multiple comma-split selectors in order, one query call each', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([row({ id: 'a', companyName: 'A Ltd', symbol: 'A' })])
      .mockResolvedValueOnce([row({ id: 'b', companyName: 'B Ltd', symbol: 'B' })]);
    const resolved = await resolveIposFromSelectors(['A', 'B'], query);
    expect(resolved.map((i) => i.id)).toEqual(['a', 'b']);
    expect(query).toHaveBeenNthCalledWith(1, 'A');
    expect(query).toHaveBeenNthCalledWith(2, 'B');
  });

  it('throws a named error when a selector matches no row', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await expect(resolveIposFromSelectors(['NOPE'], query)).rejects.toThrow(
      /no ipos row matched "NOPE"/
    );
  });

  it('throws when called with zero selectors', async () => {
    const query = vi.fn();
    await expect(resolveIposFromSelectors([], query)).rejects.toThrow(
      /requires at least one symbol or name/
    );
    expect(query).not.toHaveBeenCalled();
  });
});
