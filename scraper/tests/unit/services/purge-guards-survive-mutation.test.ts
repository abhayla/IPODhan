/**
 * #933 round 2 (Tier A review of PR #1131) — MAJOR: removing the per-document
 * hold (item 18 s2b, `everyDocumentPastItsOwnWindow`) or the `unextracted > 0`
 * synthetic-null rule left all five existing purge test files green, because
 * every one of them exercises `decidePurge` directly with `allDocumentsRead`
 * set consistently with the document-level facts it is testing.
 *
 * The real gap: `unread_count` (from `document_fetch_state`, LEFT JOINed
 * independently) and `unextracted_count` (from `documents.extracted_at IS
 * NULL`, the OTHER LEFT JOIN) can disagree — a document can exist with no
 * successful extraction while its fetch-state row is missing or already
 * marked otherwise, so `allDocumentsRead` (built from `unread_count`) reads
 * TRUE while a document that was never actually read still exists. Only the
 * s2b/`unextracted` guard in `runDocumentPurge` catches that skew; removing
 * it lets `decidePurge` alone approve the purge.
 *
 * These tests exercise `runDocumentPurge` end-to-end against a mocked DB
 * result shaped exactly like `PURGE_CANDIDATES_SQL`'s columns — not
 * `decidePurge` in isolation — because the isolation is exactly what let the
 * gap through review the first time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbExecuteMock = vi.fn();
const purgeIpoDocumentsMock = vi
  .fn()
  .mockResolvedValue({ ipoId: 'x', purged: true, filesDeleted: 1, bytesFreed: 100 });

vi.mock('@ipodhan/shared', () => ({
  db: { execute: (...args: unknown[]) => dbExecuteMock(...args) },
  getRedisClient: () => ({}),
  getBoxWideRedisClient: () => ({}),
  DocumentRepository: vi.fn().mockImplementation(() => ({ findByIPO: vi.fn().mockResolvedValue([]) })),
  DocumentFetchStateRepository: vi.fn().mockImplementation(() => ({
    listForIpo: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  IPORepository: vi.fn().mockImplementation(() => ({})),
  IpoPipelineStepsRepository: vi.fn().mockImplementation(() => ({ findByIpo: vi.fn().mockResolvedValue([]) })),
  IpoFieldPlanRepository: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../src/services/document-store.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/document-store.js')>(
    '../../../src/services/document-store.js'
  );
  return {
    ...actual,
    purgeIpoDocuments: (...args: unknown[]) => purgeIpoDocumentsMock(...args),
  };
});

const { runDocumentPurge } = await import('../../../src/services/document-cycle.js');

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

function row(overrides: Record<string, unknown>) {
  return {
    id: 'ipo-1',
    close_date: null,
    status: 'OPEN',
    unread_count: 0,
    textless_count: 0,
    newest_extracted_at: null,
    latest_extracted_at: null,
    document_count: 1,
    unextracted_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  dbExecuteMock.mockReset();
  purgeIpoDocumentsMock.mockClear();
  purgeIpoDocumentsMock.mockResolvedValue({ ipoId: 'x', purged: true, filesDeleted: 1, bytesFreed: 100 });
});

describe('runDocumentPurge — the per-document guard survives a fetch-state/documents skew', () => {
  it('HOLDS when unread_count says "all read" but a document was never extracted', async () => {
    // The exact skew: document_fetch_state has no unread rows for this IPO
    // (unread_count=0, so decidePurge's allDocumentsRead reads true), yet the
    // documents table independently shows one document with extracted_at
    // NULL. Only the s2b/unextracted guard catches this.
    dbExecuteMock.mockResolvedValue({
      rows: [
        row({
          id: 'ipo-skew',
          unread_count: 0,
          latest_extracted_at: daysAgo(8),
          document_count: 2,
          unextracted_count: 1,
        }),
      ],
    });

    const summary = await runDocumentPurge();

    expect(purgeIpoDocumentsMock).not.toHaveBeenCalled();
    expect(summary.purged).toBe(0);
  });

  it('PURGES when every document really was extracted more than the window ago', async () => {
    dbExecuteMock.mockResolvedValue({
      rows: [
        row({
          id: 'ipo-clean',
          unread_count: 0,
          latest_extracted_at: daysAgo(8),
          document_count: 1,
          unextracted_count: 0,
        }),
      ],
    });

    const summary = await runDocumentPurge();

    expect(purgeIpoDocumentsMock).toHaveBeenCalledWith('ipo-clean');
    expect(summary.purged).toBe(1);
  });

  it('HOLDS an IPO whose fetch-state rows show it unread, whatever decidePurge alone would say', async () => {
    dbExecuteMock.mockResolvedValue({
      rows: [
        row({
          id: 'ipo-unread',
          unread_count: 1,
          latest_extracted_at: daysAgo(8),
          document_count: 2,
          unextracted_count: 0,
        }),
      ],
    });

    const summary = await runDocumentPurge();

    expect(purgeIpoDocumentsMock).not.toHaveBeenCalled();
    expect(summary.purged).toBe(0);
  });
});

describe('runDocumentPurge — the SQL it actually sends to the DB (final review pin)', () => {
  it('is fully substituted (no {{ placeholders left) and carries the extraction EXISTS arm', async () => {
    dbExecuteMock.mockResolvedValue({ rows: [] });

    await runDocumentPurge();

    expect(dbExecuteMock).toHaveBeenCalledTimes(1);
    const sqlArg = dbExecuteMock.mock.calls[0][0] as {
      queryChunks: Array<{ value?: string[] }>;
    };
    const sentSql = sqlArg.queryChunks.map((c) => (c?.value ? c.value.join('') : '')).join('');

    expect(sentSql).not.toMatch(/\{\{/);
    expect(sentSql).toContain('OR EXISTS (');
    expect(sentSql).toMatch(/d2\.extracted_at\s*<\s*now\(\)\s*-\s*make_interval\(days => \d+\)/);
  });
});
