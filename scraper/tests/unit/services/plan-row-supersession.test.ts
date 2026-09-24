// implements: item 6 -- plan-row supersession (spec §2.5, §2.5.5 rules 1 and 3, OD-65, OD-90, OD-91)
import { describe, it, expect, vi } from 'vitest';
import {
  decidePlanRowSupersession,
  findPlanRowSupersessor,
  isFixedPriceIssue,
} from '../../../src/services/document-state-machine.js';
import { evaluateSupersession, familyFor, receiptKey, type SuppliedPlanRow } from '../../../src/services/plan-supersession.js';
import { buildDocFetcher, docTypeFamily, type DocFetcherDeps } from '../../../src/services/field-plan-walk-doc-fetcher.js';

const RHP_FAMILY = docTypeFamily('RHP'); // RHP, DRHP, PROSPECTUS
const PBA_FAMILY = docTypeFamily('PRICE_BAND_AD');
const book = { family: RHP_FAMILY, fixedPrice: false };

describe('same-type-later-filing-wins (§2.5.5 Rule 1)', () => {
  it('a later-filed RHP supersedes the older one, whatever order the extractions finished in', () => {
    const older = { id: 'rhp-old', docType: 'RHP', filingDate: '2026-08-01' };
    const newer = { id: 'rhp-new', docType: 'RHP', filingDate: '2026-09-01' };
    expect(decidePlanRowSupersession(older, newer, book).supersede).toBe(true);
    // The older one "arriving second" (extracted later) never wins.
    expect(decidePlanRowSupersession(newer, older, book).supersede).toBe(false);
  });

  it('same type with a missing filing_date is kept and reported unordered (inferred, not spec-stated)', () => {
    const d = decidePlanRowSupersession(
      { id: 'a', docType: 'RHP', filingDate: '2026-08-01' },
      { id: 'b', docType: 'RHP', filingDate: null },
      book
    );
    expect(d).toMatchObject({ supersede: false, unordered: true });
  });
});

describe('corrigendum-never-reopens (OD-90)', () => {
  it('a CORRIGENDUM or ADDENDUM filed after the prospectus reopens nothing', () => {
    const chosen = { id: 'p', docType: 'PROSPECTUS', filingDate: '2026-09-01' };
    for (const t of ['CORRIGENDUM', 'ADDENDUM']) {
      const d = decidePlanRowSupersession(chosen, { id: t, docType: t, filingDate: '2026-09-10' }, {
        family: [...RHP_FAMILY, t],
        fixedPrice: false,
      });
      expect(d.supersede).toBe(false);
    }
  });
});

describe('corrigendum-never-reopens — even where its precedence would outrank the chosen RHP', () => {
  it('a CORRIGENDUM (80) or ADDENDUM (75) in the family does not supersede an RHP (50)', () => {
    const chosen = { id: 'r', docType: 'RHP', filingDate: '2026-09-01' };
    for (const t of ['CORRIGENDUM', 'ADDENDUM']) {
      const d = decidePlanRowSupersession(chosen, { id: t, docType: t, filingDate: '2026-09-10' }, {
        family: [...RHP_FAMILY, t],
        fixedPrice: false,
      });
      expect(d.supersede).toBe(false);
    }
  });
});

describe('§2.5.5 Rule 3 — the prospectus is terminal for book-built, baseline for fixed-price', () => {
  it('book-built: nothing of lower precedence supersedes a prospectus', () => {
    const d = decidePlanRowSupersession(
      { id: 'p', docType: 'PROSPECTUS', filingDate: '2026-09-01' },
      { id: 'pba', docType: 'PRICE_BAND_AD', filingDate: '2026-09-05' },
      { family: PBA_FAMILY, fixedPrice: false }
    );
    expect(d.supersede).toBe(false);
  });
  it('fixed-price: a later-filed family document supersedes the prospectus baseline', () => {
    const d = decidePlanRowSupersession(
      { id: 'p', docType: 'PROSPECTUS', filingDate: '2026-09-01' },
      { id: 'pba', docType: 'PRICE_BAND_AD', filingDate: '2026-09-05' },
      { family: PBA_FAMILY, fixedPrice: true }
    );
    expect(d.supersede).toBe(true);
  });
  it('fixed-price is decided by issue_type, else floor = cap', () => {
    expect(isFixedPriceIssue('FIXED_PRICE', 10, 20)).toBe(true);
    expect(isFixedPriceIssue('BOOK_BUILDING', 50, 50)).toBe(false);
    expect(isFixedPriceIssue(null, 50, 50)).toBe(true);
    expect(isFixedPriceIssue(null, 48, 50)).toBe(false);
  });
});

function row(field: string, table: string, chosen: { id: string; docType: string }): SuppliedPlanRow {
  return {
    planRowId: `plan-${table}-${field}`,
    ipoId: 'ipo-1',
    ipoSlug: 'lcc-projects-ltd',
    tableName: table,
    rowKey: '',
    fieldName: field,
    chosen: { ...chosen, filingDate: null },
    fixedPrice: false,
  };
}

describe('prospectus-reopens-only-receipted-fields (OD-91)', () => {
  const rhp = { id: 'rhp', docType: 'RHP' };
  const pba = { id: 'pba', docType: 'PRICE_BAND_AD' };
  const prospectus = { id: 'pro', docType: 'PROSPECTUS', filingDate: null };
  const docTypeOf = (t: string, f: string) => (t === 'ipos' && f === 'company_description' ? 'RHP' : 'PRICE_BAND_AD');
  const rows = [row('company_description', 'ipos', rhp), row('face_value', 'ipo_details', pba), row('fresh_issue', 'ipo_details', pba)];

  it('reopens only the rows whose field is in the prospectus receipt', () => {
    const ev = evaluateSupersession(
      {
        rows,
        candidatesByIpo: new Map([['ipo-1', [prospectus]]]),
        receipts: new Map([['pro', new Map([[receiptKey('ipos', '', 'companyDescription'), 'x'], [receiptKey('ipo_details', '', 'faceValue'), '10']])]]),
      },
      docTypeOf
    );
    expect(ev.reopen.map((v) => v.row.fieldName).sort()).toEqual(['company_description', 'face_value']);
    expect(ev.reopen.every((v) => v.supersededBy.id === 'pro')).toBe(true);
  });

  it('no-receipt-no-churn: a prospectus with no receipt (extracted before OD-91) reopens nothing', () => {
    const ev = evaluateSupersession(
      { rows, candidatesByIpo: new Map([['ipo-1', [prospectus]]]), receipts: new Map() },
      docTypeOf
    );
    expect(ev.reopen).toEqual([]);
  });

  it('the pairwise rule alone (no receipt filter) would reopen all three — the receipt is what narrows it', () => {
    const n = rows.filter(
      (r) => findPlanRowSupersessor(r.chosen, [prospectus], { family: docTypeFamily(docTypeOf(r.tableName, r.fieldName)), fixedPrice: false }).supersededBy
    ).length;
    expect(n).toBe(3);
  });
});

describe('DOC fetcher credits the best receipted document only for the value it supplied (OD-91, OD-73)', () => {
  const docs = [
    { id: 'rhp', type: 'RHP', extractionStatus: 'COMPLETED', isActive: true, sha256: 'r'.repeat(64), filingDate: '2026-09-01' },
    { id: 'pro', type: 'PROSPECTUS', extractionStatus: 'COMPLETED', isActive: true, sha256: 'p'.repeat(64), filingDate: '2026-09-10' },
    { id: 'pba', type: 'PRICE_BAND_AD', extractionStatus: 'COMPLETED', isActive: true, sha256: 'b'.repeat(64), filingDate: '2026-09-15' },
  ];
  const R = (entries: Array<[string, Array<[string, string | null]>]>) =>
    new Map(entries.map(([id, kv]) => [id, new Map(kv)]));
  function deps(
    receipts: Map<string, ReadonlyMap<string, string | null>>,
    o: {
      docType?: string;
      lineage?: { docType: string; documentId: string };
      ipo?: Record<string, unknown>;
      details?: Record<string, unknown> | null;
    } = {}
  ): DocFetcherDeps {
    return {
      fieldSources: {
        findByField: vi.fn().mockResolvedValue({ source: 'DRHP', dataLineage: o.lineage ?? { docType: 'RHP', documentId: 'rhp' } }),
      } as any,
      ipoRepository: { findById: vi.fn().mockResolvedValue(o.ipo ?? { companyDescription: 'Makes helmets.' }) } as any,
      documentRepository: { findByIPO: vi.fn().mockResolvedValue(docs) } as any,
      manifestDocumentType: () => o.docType ?? 'RHP',
      isDocCapable: () => true,
      ipoDetailsReader: { findByIpoId: vi.fn().mockResolvedValue(o.details ?? null) } as any,
      receiptReader: vi.fn().mockResolvedValue(receipts),
    };
  }
  const desc = receiptKey('ipos', '', 'companyDescription');

  it('chooses the PROSPECTUS over an outranked RHP lineage when its receipt has the identical value', async () => {
    const answer = await buildDocFetcher(deps(R([['pro', [[desc, 'Makes helmets.']]]])))('ipo-1', 'ipos', '', 'company_description');
    expect(answer).toMatchObject({ outcome: 'SUPPLIED', documentId: 'pro', documentType: 'PROSPECTUS' });
  });

  it('reviewer case: a PROSPECTUS value dropped because the ad owns the headline does not flip the row to the prospectus', async () => {
    const fv = receiptKey('ipos', '', 'faceValue');
    const answer = await buildDocFetcher(
      deps(R([['pro', [[fv, '5']]], ['pba', [[fv, '10']]]]), {
        docType: 'PRICE_BAND_AD',
        lineage: { docType: 'PRICE_BAND_AD', documentId: 'pba' },
        ipo: { faceValue: 10 },
      })
    )('ipo-1', 'ipos', '', 'face_value');
    expect(answer).toMatchObject({ outcome: 'SUPPLIED', documentId: 'pba' });
  });

  it('no-receipt-no-churn: with no receipt anywhere the pre-OD-91 choice (the lineage RHP) stands', async () => {
    const answer = await buildDocFetcher(deps(new Map()))('ipo-1', 'ipos', '', 'company_description');
    expect(answer).toMatchObject({ outcome: 'SUPPLIED', documentId: 'rhp' });
  });

  it('a prospectus receipt WITHOUT the field leaves the row on the receipted RHP', async () => {
    const answer = await buildDocFetcher(
      deps(R([['pro', [[receiptKey('ipos', '', 'faceValue'), '10']]], ['rhp', [[desc, 'Makes helmets.']]]]))
    )('ipo-1', 'ipos', '', 'company_description');
    expect(answer).toMatchObject({ outcome: 'SUPPLIED', documentId: 'rhp' });
  });

  const fvD = receiptKey('ipo_details', '', 'faceValue');
  const both = R([['pro', [[fvD, '10']]], ['pba', [[fvD, '10']]]]);
  it('ipo_details field, FIXED_PRICE issue_type: a later-filed PRICE_BAND_AD supersedes the prospectus baseline (Rule 3)', async () => {
    const answer = await buildDocFetcher(
      deps(both, {
        docType: 'PROSPECTUS',
        lineage: { docType: 'PROSPECTUS', documentId: 'pro' },
        ipo: { priceRangeMin: 50, priceRangeMax: 52 },
        details: { issueType: 'FIXED_PRICE', faceValue: 10 },
      })
    )('ipo-1', 'ipo_details', '', 'face_value');
    expect(answer).toMatchObject({ outcome: 'SUPPLIED', documentId: 'pba' });
  });

  it('ipo_details field, BOOK_BUILDING with floor = cap: issue_type wins, the prospectus stays terminal', async () => {
    const answer = await buildDocFetcher(
      deps(both, {
        docType: 'PROSPECTUS',
        lineage: { docType: 'PROSPECTUS', documentId: 'pro' },
        ipo: { priceRangeMin: 50, priceRangeMax: 50 },
        details: { issueType: 'BOOK_BUILDING', faceValue: 10 },
      })
    )('ipo-1', 'ipo_details', '', 'face_value');
    expect(answer).toMatchObject({ outcome: 'SUPPLIED', documentId: 'pro' });
  });
});

describe('parity: the scraper and the PULL-FROZEN audit run the same rule', () => {
  it('cin (RHP family) and open_date (no documentType) give the same answer on both sides', async () => {
    const audit = await import('../../../../scripts/lib/pull-frozen-checks.mjs');
    type Ref = { id: string; docType: string; filingDate: string | null };
    const cases: Array<[string, string, Ref, Ref, boolean]> = [
      ['ipos', 'cin', { id: 'r', docType: 'RHP', filingDate: '2026-08-01' }, { id: 'p', docType: 'PRICE_BAND_AD', filingDate: '2026-09-01' }, false],
      ['ipos', 'cin', { id: 'r', docType: 'RHP', filingDate: '2026-08-01' }, { id: 'x', docType: 'PROSPECTUS', filingDate: null }, true],
      ['ipos', 'open_date', { id: 'p', docType: 'PRICE_BAND_AD', filingDate: '2026-08-01' }, { id: 'x', docType: 'PROSPECTUS', filingDate: null }, false],
      ['ipos', 'open_date', { id: 'p', docType: 'PRICE_BAND_AD', filingDate: '2026-08-01' }, { id: 'q', docType: 'PRICE_BAND_AD', filingDate: '2026-09-01' }, true],
    ];
    for (const [t, f, chosen, cand, expected] of cases) {
      const row: SuppliedPlanRow = { planRowId: 'x', ipoId: 'i', ipoSlug: 's', tableName: t, rowKey: '', fieldName: f, chosen, fixedPrice: false };
      const scraperSide = decidePlanRowSupersession(chosen, cand, { family: familyFor(row), fixedPrice: false }).supersede;
      const auditSide = audit.supersedesForField(t, f, chosen, cand, false);
      expect([f, cand.docType, scraperSide]).toEqual([f, cand.docType, expected]);
      expect([f, cand.docType, auditSide]).toEqual([f, cand.docType, expected]);
    }
  });
});
