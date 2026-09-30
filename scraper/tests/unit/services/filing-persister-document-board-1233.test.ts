/**
 * #1233 (OD-129, row 23): the offer document's listing sentence decides the BOARD
 * (`ipos.segment`), not only the exchanges. Real cover-page text from staging
 * (tests/fixtures/listing-sentence/staging-listing-sentences.json).
 *
 * Class: every IPO whose offer document states a board, all statuses and both segments:
 * a stored NULL segment, a feed-set segment that disagrees, a document-set segment a later
 * filing supersedes (OD-30, gated by the listing-precedence reader), and an admin-held
 * segment (the protection gate drops it; never claimed). A claimed plan-invalidating field
 * rebuilds the plan through the ONE rebuild path (§2.8, OD-142).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';
import { higherRankedOfferDocumentTypes } from '../../../src/services/listing-sentence.js';

const IPO_ID = 'b3b0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6d';

function cover(): FilingExtraction {
  const values: Record<string, unknown> = { face_value: 10, lot_size: 1200 };
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    fields[k] = { value: v, page: 0, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'RHP',
    source_doc: 'rhp.pdf',
    pages: 3,
    extraction_status: 'OK',
    unit: 'lakhs',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/listing-sentence/staging-listing-sentences.json'), 'utf8')
) as { entries: Array<{ slug: string; docType: string; pageNumber: number; excerpt: string }> };
const page = (slug: string, docType: string) => {
  const e = fixture.entries.find((x) => x.slug === slug && x.docType === docType)!;
  return [e.pageNumber - 1, e.excerpt] as [number, string];
};
/** NSE Emerge (SME) RHP and a BSE+NSE main-board DRHP, both real. */
const SME_NSE_RHP = () => [page('axiom-gas-engineering-ltd', 'RHP')];
const MAINBOARD_DRHP = () => [page('a-one-steels-india-ltd', 'DRHP')];

const completedDocs = (types: string[]): FilingPersisterDeps['listingPrecedence'] => ({
  higherRankedOfferDocumentCompleted: async (_ipo, docType) =>
    types.some((t) => higherRankedOfferDocumentTypes(docType).includes(t)),
});

interface Stored {
  segment: string | null;
  listingExchanges: string[] | null;
  offeringType?: string;
}

function makeDeps(
  stored: Stored,
  extra: Partial<FilingPersisterDeps> = {}
): FilingPersisterDeps {
  return {
    listingPrecedence: completedDocs([]),
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Axiom Gas Engineering Limited',
        slug: 'axiom-gas-engineering-ltd',
        segment: stored.segment,
        offeringType: stored.offeringType ?? 'IPO',
        status: 'UPCOMING',
        listingExchanges: stored.listingExchanges,
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
    ...extra,
  } as unknown as FilingPersisterDeps;
}

async function run(
  pageTexts: Array<[number, string]> | undefined,
  stored: Stored,
  opts: { docType?: 'RHP' | 'DRHP' | 'PROSPECTUS'; extra?: Partial<FilingPersisterDeps>; apply?: boolean } = {}
) {
  upsertIPOMock.mockClear();
  const extraction = { ...cover(), page_texts: pageTexts } as FilingExtraction;
  const deps = makeDeps(stored, opts.extra);
  const result = await persistFilingExtraction(
    IPO_ID,
    extraction,
    { docType: opts.docType ?? 'RHP', apply: opts.apply ?? true },
    deps
  );
  const call = upsertIPOMock.mock.calls[0] as unknown[] | undefined;
  return {
    result,
    scraped: (call?.[1] ?? {}) as Record<string, unknown>,
    contextFields: (call?.[4] ?? []) as string[],
  };
}

describe('#1233 OD-129: the listing sentence claims the board (ipos.segment)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('an NSE Emerge RHP over a stored MAINBOARD (feed-set, disagreeing) claims SME, not context', async () => {
    const { scraped, contextFields } = await run(SME_NSE_RHP(), { segment: 'MAINBOARD', listingExchanges: ['NSE'] });
    expect(scraped.segment).toBe('SME');
    expect(contextFields).not.toContain('segment');
  });

  it('a main-board DRHP over a stored NULL segment claims MAINBOARD', async () => {
    const { scraped, contextFields } = await run(MAINBOARD_DRHP(), { segment: null, listingExchanges: null }, { docType: 'DRHP' });
    expect(scraped.segment).toBe('MAINBOARD');
    expect(contextFields).not.toContain('segment');
  });

  it('a document agreeing with the stored board still claims it (the document becomes its source)', async () => {
    const { scraped, contextFields } = await run(SME_NSE_RHP(), { segment: 'SME', listingExchanges: ['NSE'] });
    expect(scraped.segment).toBe('SME');
    expect(contextFields).not.toContain('segment');
  });

  it('OD-30: a lower-ranked filing extracted after a better one claims no board (context only)', async () => {
    const { scraped, contextFields } = await run(
      MAINBOARD_DRHP(),
      { segment: 'SME', listingExchanges: ['NSE'] },
      { docType: 'DRHP', extra: { listingPrecedence: completedDocs(['RHP']) } }
    );
    expect(scraped.segment).toBe('SME'); // the stored echo
    expect(contextFields).toContain('segment');
  });

  it('a page with no listing sentence claims no board', async () => {
    const { contextFields } = await run(undefined, { segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'] });
    expect(contextFields).toContain('segment');
  });

  it('§9: an admin-held segment is dropped by the protection gate and never claimed', async () => {
    const protectionFilter = vi.fn(async (_id: string, _t: string, data: Record<string, unknown>) => {
      const filtered = { ...data };
      delete filtered.segment;
      return { filtered };
    });
    const { scraped, contextFields } = await run(
      SME_NSE_RHP(),
      { segment: 'MAINBOARD', listingExchanges: ['NSE'] },
      { extra: { protectionFilter } as never }
    );
    expect(scraped.segment).toBe('MAINBOARD'); // the stored echo, context only
    expect(contextFields).toContain('segment');
  });
});

describe('#1233 §2.8 / OD-142: a claimed board or exchange set rebuilds the plan through the one rebuild path', () => {
  it('calls planRebuild with the type slice read BEFORE the write', async () => {
    const planRebuild = vi.fn(async () => ({ rebuilt: true }));
    await run(SME_NSE_RHP(), { segment: 'MAINBOARD', listingExchanges: ['NSE'] }, { extra: { planRebuild } as never });
    expect(planRebuild).toHaveBeenCalledTimes(1);
    expect(planRebuild).toHaveBeenCalledWith(IPO_ID, {
      segment: 'MAINBOARD',
      listingExchanges: ['NSE'],
      offeringType: 'IPO',
    });
  });

  it('does not call it when the document claims no plan-invalidating field', async () => {
    const planRebuild = vi.fn(async () => ({ rebuilt: true }));
    await run(undefined, { segment: 'MAINBOARD', listingExchanges: ['NSE'] }, { extra: { planRebuild } as never });
    expect(planRebuild).not.toHaveBeenCalled();
  });

  it('does not call it on a dry run', async () => {
    const planRebuild = vi.fn(async () => ({ rebuilt: true }));
    await run(SME_NSE_RHP(), { segment: 'MAINBOARD', listingExchanges: ['NSE'] }, { apply: false, extra: { planRebuild } as never });
    expect(planRebuild).not.toHaveBeenCalled();
  });

  it('a failing rebuild is reported, not swallowed silently, and does not undo the write', async () => {
    const planRebuild = vi.fn(async () => {
      throw new Error('lock timeout');
    });
    const { result } = await run(SME_NSE_RHP(), { segment: 'MAINBOARD', listingExchanges: ['NSE'] }, { extra: { planRebuild } as never });
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).toContain('plan rebuild failed');
  });
});
