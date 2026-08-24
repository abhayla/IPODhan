import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T-311F2: wiring-level mutation proof for the two loop-level guards in
 * runPrimaryDocBackfill (the per-fetch timeout and the total time budget).
 * backfill-primary-source-documents-budget.test.ts already covers the pure
 * helpers (withTimeout / isBudgetExhausted) in isolation, but T-311C2 found
 * that deleting either guard AT THE CALL SITE left those tests green — the
 * pure-helper coverage doesn't prove the loop actually wires them in. This
 * file drives runPrimaryDocBackfill() itself (DB/network mocked) so a
 * regression that un-wires either guard turns these RED.
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

describe('runPrimaryDocBackfill loop-level guard wiring (T-311F2)', () => {
  beforeEach(() => {
    infoMock.mockClear();
    warnMock.mockClear();
    dbExecuteMock.mockReset();
    fetchNSEIssueInfoMock.mockReset();
    parseNSEDocumentsMock.mockClear();
  });

  it('per-fetch timeout: a hanging fetchNSEIssueInfo is aborted after perFetchTimeoutMs and logged as a skip', async () => {
    const { runPrimaryDocBackfill } = await import('../../../src/scripts/backfill-primary-source-documents.js');

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ id: 'ipo-1', symbol: 'TESTCO', company_name: 'Test Co', segment: 'MAINBOARD' }] })
      .mockResolvedValueOnce(COVERAGE_ROW);
    // Hangs forever — only a working per-fetch timeout can move the loop past it.
    fetchNSEIssueInfoMock.mockReturnValue(new Promise(() => {}));

    await runPrimaryDocBackfill({ execute: false, budgetMs: 60_000, perFetchTimeoutMs: 20 });

    const failedSkipCall = warnMock.mock.calls.find(
      (call) => call[1] === '[primary-doc-backfill] failed — skipping'
    );
    expect(failedSkipCall).toBeDefined();
    expect(failedSkipCall![0]).toMatchObject({ symbol: 'TESTCO' });
    expect(failedSkipCall![0].err).toMatch(/fetchNSEIssueInfo\(TESTCO\) timed out after 20ms/);
  });

  it('total budget: a zero budget skips all remaining candidates and logs skip-remaining before any fetch', async () => {
    const { runPrimaryDocBackfill } = await import('../../../src/scripts/backfill-primary-source-documents.js');

    dbExecuteMock
      .mockResolvedValueOnce({
        rows: [
          { id: 'ipo-1', symbol: 'AAA', company_name: 'A Co', segment: 'MAINBOARD' },
          { id: 'ipo-2', symbol: 'BBB', company_name: 'B Co', segment: 'MAINBOARD' },
        ],
      })
      .mockResolvedValueOnce(COVERAGE_ROW);
    fetchNSEIssueInfoMock.mockResolvedValue({});

    await runPrimaryDocBackfill({ execute: false, budgetMs: 0, perFetchTimeoutMs: 15_000 });

    const budgetExhaustedCall = warnMock.mock.calls.find(
      (call) =>
        call[1] ===
        '[primary-doc-backfill] time budget exhausted — skipping remaining candidates this cycle (they will be retried on the next daily-cadence run)'
    );
    expect(budgetExhaustedCall).toBeDefined();
    expect(budgetExhaustedCall![0]).toMatchObject({ processed: 0, remaining: 2, budgetMs: 0 });
    expect(fetchNSEIssueInfoMock).not.toHaveBeenCalled();
  });
});
