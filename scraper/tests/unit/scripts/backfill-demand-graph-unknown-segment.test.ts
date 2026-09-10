import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Item 2 slice 3a: a row with a null/unknown `segment` MUST NOT be queried
 * against NSE's mainboard 'EQ' series by default — that fetches the wrong
 * series entirely (or none) for a real SME IPO. The candidate row is skipped
 * and counted rather than guessed.
 */

const infoMock = vi.fn();
const warnMock = vi.fn();

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: infoMock, warn: warnMock, error: vi.fn() },
}));

const dbExecuteMock = vi.fn();
vi.mock('@ipodhan/shared/db', () => ({
  db: { execute: (...args: unknown[]) => dbExecuteMock(...args) },
}));

const fetchIPODetailMock = vi.fn();
vi.mock('../../../src/scrapers/nse-api-client.js', () => ({
  fetchIPODetail: (...args: unknown[]) => fetchIPODetailMock(...args),
}));

vi.mock('../../../src/services/data-persister.js', () => ({
  createDemandGraphSnapshot: vi.fn().mockResolvedValue(0),
}));

describe('runDemandBackfill — unknown segment (item 2 slice 3a)', () => {
  beforeEach(() => {
    infoMock.mockClear();
    warnMock.mockClear();
    dbExecuteMock.mockReset();
    fetchIPODetailMock.mockReset();
  });

  it('skips a row with null segment instead of querying the EQ series', async () => {
    const { runDemandBackfill } = await import('../../../src/scripts/backfill-demand-graph.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-1', symbol: 'UNKCO', company_name: 'Unknown Co', segment: null }] })
      .mockResolvedValueOnce({ rows: [{ ipos: 0, points: 0 }] });

    await runDemandBackfill({ execute: false });

    expect(fetchIPODetailMock).not.toHaveBeenCalled();
    const skipCall = warnMock.mock.calls.find(
      (call) => call[1] === '[demand-backfill] segment unknown — skipping rather than guessing EQ series'
    );
    expect(skipCall).toBeDefined();
  });

  it('still fetches a row with a known MAINBOARD segment using the EQ series', async () => {
    const { runDemandBackfill } = await import('../../../src/scripts/backfill-demand-graph.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-2', symbol: 'MBCO', company_name: 'Mainboard Co', segment: 'MAINBOARD' }] })
      .mockResolvedValueOnce({ rows: [{ ipos: 0, points: 0 }] });
    fetchIPODetailMock.mockResolvedValueOnce({ demandGraph: [] });

    await runDemandBackfill({ execute: false });

    expect(fetchIPODetailMock).toHaveBeenCalledWith('MBCO', 'EQ');
  });

  it('fetches a known SME segment using the SME series, not EQ', async () => {
    const { runDemandBackfill } = await import('../../../src/scripts/backfill-demand-graph.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-3', symbol: 'SMECO', company_name: 'SME Co', segment: 'SME' }] })
      .mockResolvedValueOnce({ rows: [{ ipos: 0, points: 0 }] });
    fetchIPODetailMock.mockResolvedValueOnce({ demandGraph: [] });

    await runDemandBackfill({ execute: false });

    expect(fetchIPODetailMock).toHaveBeenCalledWith('SMECO', 'SME');
  });
});
