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

/**
 * #1233 round 2: a precedence reader over an in-memory list of COMPLETED documents, [type, filing date].
 * The persister applies the real shared order (scraper/config/listing-sentence-precedence.mjs).
 */
const completedDocs = (
  docs: Array<string | [string, string | null]>,
  selfFilingDate: string | null = '2026-09-15'
): FilingPersisterDeps['listingPrecedence'] => ({
  listingDocuments: async () => ({
    selfFilingDate,
    others: docs.map((d, i) => {
      const [docType, filingDate] = Array.isArray(d) ? d : [d, '2026-09-01'];
      return { id: `doc-${i}`, docType, filingDate };
    }),
  }),
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

/** The upsertIPO mock runs the write-transaction hook the way IPORepository does: fake tx, the stored slice. */
const TX = { fake: 'tx' };
function runHookLikeTheRepository(before: Stored) {
  upsertIPOMock.mockImplementationOnce(async (...args: unknown[]) => {
    const options = args[6] as { inIposWriteTx?: (tx: unknown, b: unknown) => Promise<void> } | undefined;
    if (options?.inIposWriteTx) {
      await options.inIposWriteTx(TX, {
        segment: before.segment,
        listingExchanges: before.listingExchanges,
        offeringType: before.offeringType ?? 'IPO',
      });
    }
    return 'ipo-id';
  });
}

describe('#1233 round 2 MAJOR-3: the plan rebuild runs INSIDE the ipos write transaction', () => {
  const stored: Stored = { segment: 'MAINBOARD', listingExchanges: ['NSE'] };

  it('hands upsertIPO an in-transaction hook that calls planRebuildInTx with that tx and the locked slice', async () => {
    runHookLikeTheRepository(stored);
    const planRebuildInTx = vi.fn(async () => ({ rebuilt: true, typeKeyBefore: 'MAINBOARD', typeKeyAfter: 'SME_NSE', queued: 2 }));
    const { result } = await run(SME_NSE_RHP(), stored, { extra: { planRebuildInTx } as never });
    expect(planRebuildInTx).toHaveBeenCalledTimes(1);
    expect(planRebuildInTx).toHaveBeenCalledWith(TX, IPO_ID, { segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'IPO' });
    expect((result as { plan_rebuild?: string }).plan_rebuild).toBe('rebuilt MAINBOARD -> SME_NSE (queued 2)');
  });

  it('a failing rebuild fails the whole write: persistFilingExtraction throws, nothing reports success', async () => {
    runHookLikeTheRepository(stored);
    const planRebuildInTx = vi.fn(async () => {
      throw new Error('lock timeout');
    });
    await expect(run(SME_NSE_RHP(), stored, { extra: { planRebuildInTx } as never })).rejects.toThrow('lock timeout');
  });

  it('MINOR-1: exchanges ADMIN-held, only the board claimed -> the rebuild still runs (claimed.has(segment))', async () => {
    runHookLikeTheRepository(stored);
    const protectionFilter = vi.fn(async (_id: string, _t: string, data: Record<string, unknown>) => {
      const filtered = { ...data };
      delete filtered.listingExchanges;
      return { filtered };
    });
    const planRebuildInTx = vi.fn(async () => ({ rebuilt: true }));
    const { scraped, contextFields } = await run(SME_NSE_RHP(), stored, { extra: { planRebuildInTx, protectionFilter } as never });
    expect(scraped.segment).toBe('SME');
    expect(contextFields).toContain('listingExchange');
    expect(planRebuildInTx).toHaveBeenCalledTimes(1);
  });

  it('no hook when the document claims no plan-invalidating field, and none on a dry run', async () => {
    const planRebuildInTx = vi.fn(async () => ({ rebuilt: true }));
    await run(undefined, stored, { extra: { planRebuildInTx } as never });
    expect(upsertIPOMock.mock.calls[0]?.[6]).toBeUndefined();
    await run(SME_NSE_RHP(), stored, { apply: false, extra: { planRebuildInTx } as never });
    expect(planRebuildInTx).not.toHaveBeenCalled();
  });
});

describe('#1233 round 2 MAJOR-2: segment is never claimed where section 1.11 says it does not apply (manifest na)', () => {
  it.each(['INVITS', 'REITS'])('a %s row keeps segment NULL: the board is not claimed, the exchanges are', async (offeringType) => {
    const { scraped, contextFields, result } = await run(SME_NSE_RHP(), { segment: null, listingExchanges: null, offeringType });
    expect(contextFields).toContain('segment');
    expect(scraped.segment ?? null).toBeNull();
    expect(contextFields).not.toContain('listingExchange');
    expect(JSON.stringify(result)).toContain(`segment is not applicable for ${offeringType}`);
  });

  it('reads the manifest, not a hand list: a manifest marking IPO not-applicable refuses an IPO board', async () => {
    const fieldManifest = { fields: { 'ipos.segment': { na: ['IPO'] } } };
    const { contextFields } = await run(SME_NSE_RHP(), { segment: 'MAINBOARD', listingExchanges: ['NSE'] }, { extra: { fieldManifest } as never });
    expect(contextFields).toContain('segment');
  });

  it('(a) an unknown offering type fails closed (no board claim)', async () => {
    const { contextFields } = await run(SME_NSE_RHP(), { segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: '' });
    expect(contextFields).toContain('segment');
  });
});

describe('#1233 round 2 (b): answer states of the listing sentence', () => {
  it('UNREADABLE (phrase present, no exchange named) claims nothing and logs the clause with the document', async () => {
    const { default: logger } = await import('../../../src/utils/logger.js');
    (logger.info as ReturnType<typeof vi.fn>).mockClear();
    const { contextFields } = await run(
      [[0, 'The Equity Shares offered are proposed to be listed on the Stock Exchanges. Next sentence.']],
      { segment: 'MAINBOARD', listingExchanges: ['NSE'] }
    );
    expect(contextFields).toContain('segment');
    expect(contextFields).toContain('listingExchange');
    const logged = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[1]).includes('names no exchange'));
    expect(logged?.[0]).toMatchObject({ clause: expect.stringContaining('Stock Exchanges') });
  });
});
