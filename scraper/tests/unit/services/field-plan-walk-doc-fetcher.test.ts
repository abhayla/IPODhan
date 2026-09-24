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
    isDocCapable: () => true,
    ipoDetailsReader: { findByIpoId: vi.fn().mockResolvedValue(null) } as any,
    ...overrides,
  };
}

// Review round 1, M2 (MAJOR): DOC never checked capability.DOC.capable —
// unlike BSE and CHITTORGARH, which both gate on their own capability flag
// before touching provenance. A field the manifest marks DOC-incapable must
// answer NOT_PRINTED without ever reading field_sources.
describe('DOC fetcher — capability gating', () => {
  it('answers NOT_PRINTED when capability.DOC.capable is false, without touching provenance', async () => {
    const findByFieldMock = vi.fn().mockResolvedValue({ source: 'DRHP', dataLineage: null });
    const deps = makeDeps({
      isDocCapable: () => false,
      fieldSources: { findByField: findByFieldMock } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
    expect(findByFieldMock).not.toHaveBeenCalled();
  });
});

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

describe('DOC fetcher — document COMPLETED, no provenance (review round 2, RCA2)', () => {
  // RCA2 (staging wake 619660c3): absence of a field_sources provenance row
  // on a COMPLETED document is an EXTRACTOR gap (item 13 is not built yet),
  // NEVER evidence the document does not print the field -- every DRHP
  // prints issue_size/fresh_issue/ofs_issue/min_investment, and the fetcher
  // does not know whether "no provenance row" means "not printed" or "not
  // yet extracted". Retiring the field (NOT_PRINTED, which upstream
  // eventually becomes EXHAUSTED) over a gap in OUR OWN extraction pipeline
  // wrongly retired 13 real rows on the first staging wake. The ONLY thing
  // that may answer NOT_PRINTED is `capability.DOC.capable === false`
  // (checked earlier in this function, before provenance is ever read).
  it('answers CHECK_FAILED, transient, when field_sources has no row for this field (extractor gap, never a definitive no)', async () => {
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
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'no document provenance for issueSize on PRICE_BAND_AD (extractor gap or field absent) — not retired',
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    });
  });

  it('answers CHECK_FAILED, transient (never NOT_PRINTED, never SUPPLIED) when the provenance row is not sourced from a document (source !== DRHP)', async () => {
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
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'no document provenance for issueSize on PRICE_BAND_AD (extractor gap or field absent) — not retired',
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    });
  });

  // Review round 1, C2 (CRITICAL, mutation-tested) -- updated for RCA2's
  // outcome change (CHECK_FAILED transient, not NOT_PRINTED). A mutation
  // that widened the guard from "provenance missing OR source !== DRHP" to
  // just "provenance missing" (dropping the source check entirely) left the
  // original 9 tests green, because none of them supplied a NON-NULL,
  // non-DRHP provenance row for every source that can legitimately own a
  // field ahead of DOC. Every source that can currently write field_sources
  // MUST be covered here, individually, asserting BOTH the outcome and that
  // a mutated fetcher never carries a documentId for an answer that did not
  // come from a document.
  it.each(['CHITTORGARH', 'BSE', 'ADMIN'] as const)(
    'answers CHECK_FAILED transient, never SUPPLIED, and carries no documentId when provenance.source is %s',
    async (source) => {
      const deps = makeDeps({
        documentRepository: {
          findByIPO: vi.fn().mockResolvedValue([
            { id: 'doc-1', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: null },
          ]),
        } as any,
        // A REAL column value, so a mutated guard that lets this fall through
        // cannot be masked by readColumnValue's own "no value -> NOT_PRINTED"
        // branch — the guard itself, not a downstream branch, must be what
        // stops this from reading SUPPLIED.
        ipoRepository: { findById: vi.fn().mockResolvedValue({ issueSize: '999999999' }) } as any,
        fieldSources: {
          findByField: vi.fn().mockResolvedValue({
            source,
            dataLineage: null,
          }),
        } as any,
      });
      const fetcher = buildDocFetcher(deps);
      const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
      expect(answer.outcome).toBe('CHECK_FAILED');
      expect((answer as { transient?: boolean }).transient).toBe(true);
      expect(answer).not.toHaveProperty('documentId');
    }
  );
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

  // Review round 2, RCA2: a cross-family provenance row is the SAME
  // ambiguity as "no provenance row" -- the field might genuinely not be in
  // the wanted family's document, or the wanted family simply has not been
  // extracted yet (extractor gap). Neither is a settled "not printed".
  it('answers CHECK_FAILED, transient, when the provenance docType is from a different family than the manifest wants', async () => {
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
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'no document provenance for revenue on RHP (extractor gap or field absent) — not retired',
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    });
  });
});

describe('DOC fetcher — no manifest documentType declared', () => {
  // Review round 1, m2 (MINOR): a manifest gap (no documentType declared for
  // this field) is a fact about the MANIFEST, not about the field's DEFINITIVE
  // absence from every document. A manifest edit can add a documentType at any
  // time, so this must stay re-askable (CHECK_FAILED, transient: true), never
  // terminal-looking. The prior version asserted transient: false here, which
  // was itself the defect this round found.
  it('answers CHECK_FAILED, TRANSIENT (a manifest gap, not a definitive per-field fact)', async () => {
    const deps = makeDeps({ manifestDocumentType: () => undefined });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'subscriptions', '', 'total_subscription');
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'no documentType in manifest for this field',
      transient: true,
      gap: 'NO_DOCUMENT_TYPE',
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

// Review round 1, m1 (MINOR but decides what cycle 1 does): readColumnValue
// used to return `undefined` for EVERY non-`ipos` table, so a `ipo_details`
// field with real DRHP provenance would read the column as absent and answer
// NOT_PRINTED even though the document DID supply it — and with BSE/
// CHITTORGARH also answering NOT_PRINTED (they don't carry fresh/ofs/min-
// investment either), the field records EXHAUSTED (terminal) on cycle 1.
// That is a coverage gap wearing a "source answered" costume.
describe('DOC fetcher — ipo_details column reads (review round 1, m1)', () => {
  it('reads a real ipo_details column value through ipoDetailsReader and answers SUPPLIED', async () => {
    const deps = makeDeps({
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: null },
        ]),
      } as any,
      fieldSources: {
        findByField: vi.fn().mockResolvedValue({
          source: 'DRHP',
          dataLineage: { docType: 'PRICE_BAND_AD', documentId: 'doc-1' },
        }),
      } as any,
      ipoDetailsReader: { findByIpoId: vi.fn().mockResolvedValue({ freshIssue: '5000000000' }) } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'ipo_details', '', 'fresh_issue');
    expect(answer).toEqual({
      outcome: 'SUPPLIED',
      value: '5000000000',
      documentId: 'doc-1',
      documentType: 'PRICE_BAND_AD',
      sha256: undefined,
    });
  });

  it('a table with no read implementation (e.g. financial_statements) answers CHECK_FAILED, transient, naming the table — never NOT_PRINTED', async () => {
    const deps = makeDeps({
      documentRepository: {
        findByIPO: vi.fn().mockResolvedValue([
          { id: 'doc-1', type: 'RHP', extractionStatus: 'COMPLETED', isActive: true, sha256: null },
        ]),
      } as any,
      manifestDocumentType: () => 'RHP',
      fieldSources: {
        findByField: vi.fn().mockResolvedValue({ source: 'DRHP', dataLineage: { docType: 'RHP' } }),
      } as any,
    });
    const fetcher = buildDocFetcher(deps);
    const answer = await fetcher(IPO_ID, 'financial_statements', 'FY2026', 'revenue');
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'DOC column read not implemented for financial_statements',
      transient: true,
      gap: 'COLUMN_READ_NOT_IMPLEMENTED',
    });
  });
});

// Item 6 / F-161 (staging 2026-09-24): 984 plan rows across 23 IPOs answered
// rank1:DOC:NOT_AVAILABLE_YET although the IPO's offer document was
// extracted. 980 of them are fields whose manifest documentType is
// PRICE_BAND_AD, and the PRICE_BAND_AD family held only PRICE_BAND_AD — so an
// IPO with a COMPLETED RHP / PROSPECTUS / DRHP and no price-band ad (every SME
// IPO: spec §1 "SME IPOs have zero PRICE_BAND_AD documents") could never be
// answered from its own offer document. Spec §1: DOC = "the IPO's own offer
// document, best available type"; §1 order for price-dependent fields
// PRICE_BAND_AD > RHP > PROSPECTUS > DRHP, for final post-issue facts
// PROSPECTUS > PRICE_BAND_AD > RHP > DRHP. The rows below are REAL staging rows
// (fixture + .meta.json), not shapes typed from memory.
import axiomFixture from '../../fixtures/field-plan-walk/axiom-rhp-doc-fetcher-staging.json';
import { docTypeFamily } from '../../../src/services/field-plan-walk-doc-fetcher.js';

function axiomDeps(): DocFetcherDeps {
  const bySource = (table: string, field: string) =>
    axiomFixture.fieldSources.find((r) => r.tableName === table && r.fieldName === field) ?? null;
  return makeDeps({
    documentRepository: { findByIPO: vi.fn().mockResolvedValue(axiomFixture.documents) } as any,
    fieldSources: {
      findByField: vi.fn(async (_ipo: string, table: string, field: string) => bySource(table, field)),
    } as any,
    ipoRepository: { findById: vi.fn().mockResolvedValue(axiomFixture.ipos) } as any,
    ipoDetailsReader: { findByIpoId: vi.fn().mockResolvedValue(axiomFixture.ipoDetails) } as any,
    manifestDocumentType: () => 'PRICE_BAND_AD',
  });
}

describe('DOC fetcher — best available offer document (item 6, F-161)', () => {
  it('a PRICE_BAND_AD field is SUPPLIED from the COMPLETED RHP that printed it (axiom face_value, real staging rows)', async () => {
    const fetcher = buildDocFetcher(axiomDeps());
    const answer = await fetcher(IPO_ID, 'ipo_details', '', 'face_value');
    expect(answer).toEqual({
      outcome: 'SUPPLIED',
      value: '5.00',
      documentId: '7328a5e2-8397-4a74-8627-3963fa2c7238',
      documentType: 'RHP',
      sha256: 'c3a425f80ee877050ee4044095e25baa0690bd8f3b6341505248b8f403375987',
    });
  });

  it('a PRICE_BAND_AD field the RHP did not print is NOT "not available yet": the document was read (axiom issue_size, RHP prints "[.] Lakhs")', async () => {
    const fetcher = buildDocFetcher(axiomDeps());
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'no document provenance for issueSize on PRICE_BAND_AD (extractor gap or field absent) — not retired',
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    });
  });

  it('every manifest documentType family contains every full offer document the extractor reads (class guard)', () => {
    // RHP, PROSPECTUS and DRHP are the offer document itself at three stages;
    // each can answer any documentType. A price-band ad prints only the
    // price-dependent terms, so it joins only the PRICE_BAND_AD and
    // PROSPECTUS (final-terms) families.
    for (const t of ['PRICE_BAND_AD', 'RHP', 'PROSPECTUS', 'DRHP']) {
      for (const offerDoc of ['RHP', 'PROSPECTUS', 'DRHP']) {
        expect(docTypeFamily(t), `${t} family lacks ${offerDoc}`).toContain(offerDoc);
      }
    }
  });

  it('family order follows spec §1: price-dependent PBA > RHP > PROSPECTUS > DRHP; final facts PROSPECTUS > PBA > RHP > DRHP', () => {
    expect(docTypeFamily('PRICE_BAND_AD')).toEqual(['PRICE_BAND_AD', 'RHP', 'PROSPECTUS', 'DRHP']);
    expect(docTypeFamily('PROSPECTUS')).toEqual(['PROSPECTUS', 'PRICE_BAND_AD', 'RHP', 'DRHP']);
  });

  it('still NOT_AVAILABLE_YET when the IPO has no COMPLETED offer document at all (only non-offer documents)', async () => {
    const deps = axiomDeps();
    (deps.documentRepository as any).findByIPO = vi.fn().mockResolvedValue(
      axiomFixture.documents.filter((d) => d.type !== 'RHP'),
    );
    const answer = await buildDocFetcher(deps)(IPO_ID, 'ipo_details', '', 'face_value');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });
});
