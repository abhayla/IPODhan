import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Item 2 slice 3a: a row with a null/unknown `segment` MUST NOT be queried
 * against NSE's mainboard 'EQ' series by default — that fetches the wrong
 * series entirely (or none) for a real SME IPO. The candidate row is
 * skipped and counted rather than guessed.
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
  DocumentRepository: vi.fn().mockImplementation(() => ({
    upsertDocument: vi.fn().mockResolvedValue(undefined),
  })),
}));

const fetchNSEIssueInfoMock = vi.fn();
vi.mock('../../../src/scrapers/nse-api-client.js', () => ({
  fetchNSEIssueInfo: (...args: unknown[]) => fetchNSEIssueInfoMock(...args),
}));

const parseNSEDocumentsMock = vi.fn().mockReturnValue([]);
vi.mock('../../../src/services/primary-source-discovery.js', () => ({
  parseNSEDocuments: (...args: unknown[]) => parseNSEDocumentsMock(...args),
}));

const COVERAGE_ROW = { rows: [{ ipos: 0, docs: 0, nse_docs: 0 }] };

describe('runPrimaryDocBackfill — unknown segment (item 2 slice 3a)', () => {
  beforeEach(() => {
    infoMock.mockClear();
    warnMock.mockClear();
    dbExecuteMock.mockReset();
    fetchNSEIssueInfoMock.mockReset();
    parseNSEDocumentsMock.mockClear();
  });

  it('skips a row with null segment instead of querying the EQ series', async () => {
    const { runPrimaryDocBackfill } = await import('../../../src/scripts/backfill-primary-source-documents.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-1', symbol: 'UNKCO', company_name: 'Unknown Co', segment: null }] })
      .mockResolvedValueOnce(COVERAGE_ROW);

    await runPrimaryDocBackfill({ execute: false });

    expect(fetchNSEIssueInfoMock).not.toHaveBeenCalled();
    const skipCall = warnMock.mock.calls.find(
      (call) => call[1] === '[primary-doc-backfill] segment unknown — skipping rather than guessing EQ series'
    );
    expect(skipCall).toBeDefined();
  });

  it('still fetches a row with a known MAINBOARD segment using the EQ series', async () => {
    const { runPrimaryDocBackfill } = await import('../../../src/scripts/backfill-primary-source-documents.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-2', symbol: 'MBCO', company_name: 'Mainboard Co', segment: 'MAINBOARD' }] })
      .mockResolvedValueOnce(COVERAGE_ROW);
    fetchNSEIssueInfoMock.mockResolvedValueOnce({});

    await runPrimaryDocBackfill({ execute: false });

    expect(fetchNSEIssueInfoMock).toHaveBeenCalledWith('MBCO', 'EQ');
  });
});
