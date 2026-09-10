import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Item 2 slice 3a: a row with a null/unknown `segment` MUST NOT be queried
 * against NSE's mainboard 'EQ' series by default. Skipped and counted
 * rather than guessed.
 */

const infoMock = vi.fn();
const warnMock = vi.fn();

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: infoMock, warn: warnMock, error: vi.fn() },
}));

const dbExecuteMock = vi.fn();
vi.mock('@ipodhan/shared', () => ({
  db: { execute: (...args: unknown[]) => dbExecuteMock(...args) },
  getRedisClient: () => ({}),
  SubscriptionRepository: vi.fn().mockImplementation(() => ({})),
}));

const fetchIPODetailMock = vi.fn();
vi.mock('../../../src/scrapers/nse-api-client.js', () => ({
  fetchIPODetail: (...args: unknown[]) => fetchIPODetailMock(...args),
}));

vi.mock('../../../src/services/data-persister.js', () => ({
  createSubscriptionSnapshot: vi.fn().mockResolvedValue(undefined),
}));

const COVERAGE_ROW = { rows: [{ ipos: 0, subs: 0 }] };

describe('runSubscriptionBackfill — unknown segment (item 2 slice 3a)', () => {
  beforeEach(() => {
    infoMock.mockClear();
    warnMock.mockClear();
    dbExecuteMock.mockReset();
    fetchIPODetailMock.mockReset();
  });

  it('skips a row with null segment instead of querying the EQ series', async () => {
    const { runSubscriptionBackfill } = await import('../../../src/scripts/backfill-subscription.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-1', symbol: 'UNKCO', company_name: 'Unknown Co', segment: null }] })
      .mockResolvedValueOnce(COVERAGE_ROW);

    await runSubscriptionBackfill({ execute: false });

    expect(fetchIPODetailMock).not.toHaveBeenCalled();
    const skipCall = warnMock.mock.calls.find(
      (call) => call[1] === '[sub-backfill] segment unknown — skipping rather than guessing EQ series'
    );
    expect(skipCall).toBeDefined();
  });

  it('still fetches a row with a known MAINBOARD segment using the EQ series', async () => {
    const { runSubscriptionBackfill } = await import('../../../src/scripts/backfill-subscription.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-2', symbol: 'MBCO', company_name: 'Mainboard Co', segment: 'MAINBOARD' }] })
      .mockResolvedValueOnce(COVERAGE_ROW);
    fetchIPODetailMock.mockResolvedValueOnce({ subscriptions: [] });

    await runSubscriptionBackfill({ execute: false });

    expect(fetchIPODetailMock).toHaveBeenCalledWith('MBCO', 'EQ');
  });
});
