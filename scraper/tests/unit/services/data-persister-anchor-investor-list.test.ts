/**
 * W-52: createAnchorInvestors previously wrote
 * `investorList: JSON.stringify(anchorData.investorList)` into a jsonb
 * column typed `$type<IndividualInvestor[]>()`. Postgres/Drizzle stores a
 * plain array as jsonb directly; stringifying it first turns the column
 * into a JSON *string* (jsonb_typeof = 'string'), breaking
 * jsonb_array_elements() and any consumer typed against the array.
 */
import { describe, it, expect, vi } from 'vitest';

const { createAnchorInvestors } = await import('../../../src/services/data-persister.js');

function makeAnchorData(overrides: Record<string, any> = {}) {
  return {
    bidDate: new Date('2026-08-01'),
    totalSharesOffered: 1000000,
    totalAmountRaised: 5000000,
    anchorInvestorsCount: 2,
    lockIn50PercentDate: new Date('2026-09-01'),
    lockInRemainingDate: new Date('2026-11-01'),
    investorList: [
      { name: 'Alpha Fund', shares: 500000 },
      { name: 'Beta Capital', shares: 500000 },
    ],
    ...overrides,
  };
}

describe('createAnchorInvestors — investor_list jsonb write shape (W-52)', () => {
  it('passes investorList as an array (not a JSON string) on the CREATE path', async () => {
    const anchorData = makeAnchorData();
    const createMock = vi.fn().mockResolvedValue({ id: 'anchor-1' });
    const repo = {
      findByIPOId: vi.fn().mockResolvedValue(null),
      create: createMock,
      update: vi.fn(),
    };

    await createAnchorInvestors(repo, 'ipo-1', anchorData);

    expect(createMock).toHaveBeenCalledTimes(1);
    const writtenPayload = createMock.mock.calls[0][0];
    expect(Array.isArray(writtenPayload.investorList)).toBe(true);
    expect(typeof writtenPayload.investorList).not.toBe('string');
    expect(writtenPayload.investorList).toEqual(anchorData.investorList);
  });

  it('passes investorList as an array (not a JSON string) on the UPDATE path', async () => {
    const anchorData = makeAnchorData();
    const updateMock = vi.fn().mockResolvedValue({ id: 'anchor-1' });
    const repo = {
      findByIPOId: vi.fn().mockResolvedValue({ id: 'anchor-1' }),
      create: vi.fn(),
      update: updateMock,
    };

    await createAnchorInvestors(repo, 'ipo-1', anchorData);

    expect(updateMock).toHaveBeenCalledTimes(1);
    const writtenPayload = updateMock.mock.calls[0][1];
    expect(Array.isArray(writtenPayload.investorList)).toBe(true);
    expect(typeof writtenPayload.investorList).not.toBe('string');
    expect(writtenPayload.investorList).toEqual(anchorData.investorList);
  });
});
