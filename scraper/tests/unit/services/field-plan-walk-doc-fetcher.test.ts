// implements: stage 2 item 6 -- the DOC fetcher (rank 1) for the field-plan
// walk (design §2.4, OD-33: a document is never re-scraped).
import { describe, it, expect, vi } from 'vitest';
import { buildDocFetcher, type DocFetcherDeps } from '../../../src/services/field-plan-walk-doc-fetcher.js';

const IPO_ID = '00000000-0000-4000-8000-0000000660a1';

function makeDeps(overrides: Partial<DocFetcherDeps> = {}): DocFetcherDeps {
  return {
    fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any,
    ipoRepository: { findById: vi.fn().mockResolvedValue(null) } as any,
    documentRepository: { findByIPO: vi.fn().mockResolvedValue([]) } as any,
    manifestDocumentType: () => 'PRICE_BAND_AD',
    ...overrides,
  };
}

describe('DOC fetcher — no document yet', () => {
  it('answers NOT_AVAILABLE_YET when no COMPLETED document of the wanted family exists', async () => {
    const deps = makeDeps({
      documentRepository: { findByIPO: vi.fn().mockResolvedValue([]) } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('ignores a document that exists but has not COMPLETED extraction', async () => {
    const deps = makeDeps({
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'PRICE_BAND_AD', extractionStatus: 'IN_PROGRESS', isActive: true, sha256: null },
        ]),
      } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });
});

describe('DOC fetcher — document COMPLETED, no provenance', () => {
  it('answers NOT_PRINTED when field_sources has no row for this field', async () => {
    const deps = makeDeps({
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: 'a'.repeat(64) },
        ]),
      } as any,
      fieldSources: { findByField: vi.fn().mockResolvedValue(null) } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
  });

  it('answers NOT_PRINTED when the provenance row is not sourced from a document (source !== DRHP)', async () => {
    const deps = makeDeps({
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: null },
        ]),
      } as any,
      fieldSources: {
        findByField: vi.fn().mockResolvedValue({ source: 'BSE', dataLineage: null }),
      } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
  });
});

describe('DOC fetcher — SUPPLIED', () => {
  it('answers SUPPLIED with the current column value and the provenance evidence, converting snake_case to camelCase', async () => {
    const findByFieldMock = vi.fn().mockResolvedValue({
      source: 'DRHP',
      dataLineage: { docType: 'PRICE_BAND_AD', documentId: 'doc-1', sourceSha: 'b'.repeat(64) },
    });
    const deps = makeDeps({
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: 'b'.repeat(64) },
        ]),
      } as any,
      fieldSources: { findByField: findByFieldMock } as any,
      ipoRepository: { findById: vi.fn().mockResolvedValue({ issueSize: '1234500000' }) } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');

    expect(answer).toEqual({
      outcome: 'SUPPLIED',
      value: '1234500000',
      documentId: 'doc-1',
      documentType: 'PRICE_BAND_AD',
      sha256: 'b'.repeat(64),
    });
    // camelCase conversion — provenance was looked up under `issueSize`, not `issue_size`.
    expect(findByFieldMock).toHaveBeenCalledWith(IPO_ID, 'ipos', 'issueSize', '');
  });

  it('answers NOT_PRINTED when the provenance docType is from a different family than the manifest wants', async () => {
    const deps = makeDeps({
      manifestDocumentType: () => 'RHP',
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'RHP', extractionStatus: 'COMPLETED', isActive: true, sha256: null },
        ]),
      } as any,
      fieldSources: {
        findByField: vi.fn().mockResolvedValue({ source: 'DRHP', dataLineage: { docType: 'PRICE_BAND_AD' } }),
      } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'financial_statements', 'FY2026', 'revenue');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
  });
});

describe('DOC fetcher — no manifest documentType declared', () => {
  it('answers CHECK_FAILED, DEFINITIVE, rather than guessing', async () => {
    const deps = makeDeps({ manifestDocumentType: () => undefined });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'subscriptions', '', 'total_subscription');
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'no documentType in manifest for this field',
      transient: false,
    });
  });
});

describe('DOC fetcher — read failures are transient, never thrown', () => {
  it('a documentRepository.findByIPO throw answers CHECK_FAILED (transient default)', async () => {
    const deps = makeDeps({
      documentRepository: { findByIPO: vi.fn().mockRejectedValue(new Error('ECONNRESET')) } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'CHECK_FAILED', reason: 'ECONNRESET' });
  });

  it('a fieldSources.findByField throw answers CHECK_FAILED (transient default)', async () => {
    const deps = makeDeps({
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: null },
        ]),
      } as any,
      fieldSources: { findByField: vi.fn().mockRejectedValue(new Error('pool exhausted')) } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'CHECK_FAILED', reason: 'pool exhausted' });
  });
});
