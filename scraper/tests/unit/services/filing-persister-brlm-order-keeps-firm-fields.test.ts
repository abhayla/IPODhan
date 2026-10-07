/**
 * Item 39 / row 158 (OD-91 "the fields it produced", D7): the BRLM rows follow the list
 * `ipos.lead_managers` HOLDS. A later offer document that names the SAME set of firms in a different
 * order is still the document that produced each firm's per-firm fields, so its grievance e-mails file
 * on the firm it printed them under, and a per-firm column the document has no value for keeps the
 * stored value instead of being rewritten to null by the whole-row replace.
 *
 * Measured 2026-10-07 on ipodhan_test (NSE DRHP-d88fad44 then RHP-3cb0ba27): the two documents print
 * the same 20 BRLMs, the RHP moves SBI Capital Markets Limited from 7th to last; the order-sensitive
 * comparison read "not the document's list", so the RHP built 20 BRLM rows with grievance_email null
 * and the 17 e-mails the DRHP had saved were deleted by replaceForIpo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock, recordDocumentSourceHints: vi.fn() }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';

const IPO_ID = 'b8c5d769-3ad1-4c6c-b58d-9f37965ee343';
const RHP_ID = '3cb0ba27-4ec8-4b65-bb2a-e6ee74492120';
type Field = FilingExtraction['fields'][string];
const value = (v: unknown, page: number): Field =>
  ({ value: v, page, check: { name: 'c', passed: true }, state: 'VALUE', source_text: 'TEXT' }) as unknown as Field;

const KOTAK = 'Kotak Mahindra Capital Company Limited';
const JM = 'JM Financial Limited';
const SBI = 'SBI Capital Markets Limited';
const AXIS = 'Axis Capital Limited';
const HELD = [KOTAK, JM, SBI];

const KOTAK_MAIL = 'kmccredressal@kotak.com';
const JM_MAIL = 'grievance.ibd@jmfl.com';
const SBI_MAIL = 'investor.relations@sbicaps.com';

type Stored = { role: string; name: string; sebiRegNo?: string | null; contactPerson?: string | null; phone?: string | null; email?: string | null; grievanceEmail?: string | null };

function extraction(fields: Record<string, Field>): FilingExtraction {
  return {
    doc_type: 'RHP', source_doc: 'RHP-3cb0ba27.pdf', pages: 668, extraction_status: 'OK', unit: 'millions',
    fiscal_years: [], fields,
  } as FilingExtraction;
}

function makeDeps(stored: Stored[], held: string[] = HELD) {
  const replaceForIpo = vi.fn(async () => []);
  const listByIpoAndRole = vi.fn(async (_ipoId: string, role: string) =>
    stored
      .filter((r) => r.role === role)
      .map((r) => ({
        id: `row-${r.name}`, ipoId: IPO_ID, normalizedName: rowKeyForName(r.name), sebiRegNo: null, contactPerson: null,
        phone: null, email: null, grievanceEmail: null, ...r,
      }))
  );
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
        segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: [], leadManagers: held,
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo, listByIpoAndRole },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    // No provenance row: the held list is kept (D7), so the rows follow HELD's order.
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: {
      upsert: vi.fn(async (_id: string, values: Record<string, unknown>, opts?: { afterWriteInTx?: (tx: unknown, w: Record<string, unknown>) => Promise<void> }) => {
        await opts?.afterWriteInTx?.('tx-1', values);
      }),
      insertIfMissing: vi.fn(async () => false),
    },
  } as unknown as FilingPersisterDeps;
  return { deps, replaceForIpo, listByIpoAndRole };
}

const run = (h: ReturnType<typeof makeDeps>, fields: Record<string, Field>) =>
  persistFilingExtraction(IPO_ID, extraction(fields), { docType: 'RHP', documentId: RHP_ID, apply: true }, h.deps);

const brlmPairs = (h: ReturnType<typeof makeDeps>) =>
  ((h.replaceForIpo.mock.calls[0]?.[1] ?? []) as Array<Record<string, unknown>>)
    .filter((r) => r.role === 'BRLM')
    .map((r) => [r.name, r.grievanceEmail]);

const grievanceReceipts = (summary: Awaited<ReturnType<typeof persistFilingExtraction>>) =>
  (summary.receipt_fields ?? [])
    .filter((r) => r.tableName === 'ipo_intermediaries' && r.fieldName === 'grievanceEmail')
    .map((r) => [r.rowKey, r.value])
    .sort();

describe('filing-persister - the same BRLM set in another order keeps each firm its own fields', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('(a) same set reordered: each e-mail files on its own firm, and the receipts name them', async () => {
    const h = makeDeps([]);
    const summary = await run(h, {
      lead_managers: value([SBI, KOTAK, JM], 1),
      brlm_grievance_emails: value({ [SBI]: SBI_MAIL, [KOTAK]: KOTAK_MAIL, [JM]: JM_MAIL }, 103),
    });
    expect(brlmPairs(h)).toEqual([
      [KOTAK, KOTAK_MAIL],
      [JM, JM_MAIL],
      [SBI, SBI_MAIL],
    ]);
    expect(grievanceReceipts(summary)).toEqual(
      [
        [`BRLM:${rowKeyForName(KOTAK)}`, KOTAK_MAIL],
        [`BRLM:${rowKeyForName(JM)}`, JM_MAIL],
        [`BRLM:${rowKeyForName(SBI)}`, SBI_MAIL],
      ].sort()
    );
  });

  it('(a2) a name the document spells differently but that normalises equal still maps to its firm', async () => {
    const h = makeDeps([]);
    await run(h, {
      lead_managers: value(['SBI Capital Markets Ltd.', KOTAK, JM], 1),
      brlm_grievance_emails: value({ 'SBI Capital Markets Ltd.': SBI_MAIL, [KOTAK]: KOTAK_MAIL }, 103),
    });
    expect(brlmPairs(h)).toEqual([
      [KOTAK, KOTAK_MAIL],
      [JM, null],
      [SBI, SBI_MAIL],
    ]);
  });

  it('(b) a different set: no e-mail from this document is pinned on any held firm, and no receipt names one', async () => {
    const h = makeDeps([
      { role: 'BRLM', name: KOTAK, grievanceEmail: 'old-kotak@kotak.com' },
      { role: 'BRLM', name: JM, grievanceEmail: null },
    ]);
    const summary = await run(h, {
      lead_managers: value([KOTAK, JM, AXIS], 1),
      brlm_grievance_emails: value({ [KOTAK]: KOTAK_MAIL, [JM]: JM_MAIL, [AXIS]: 'axis@axiscap.in' }, 103),
    });
    // KOTAK keeps the value it already held; JM and SBI receive nothing from this document.
    expect(brlmPairs(h)).toEqual([
      [KOTAK, 'old-kotak@kotak.com'],
      [JM, null],
      [SBI, null],
    ]);
    expect(grievanceReceipts(summary)).toEqual([]);
  });

  it('(b2) two document names that normalise to one firm are ambiguous: no e-mail files', async () => {
    const h = makeDeps([]);
    await run(h, {
      lead_managers: value([KOTAK, JM, SBI, 'SBI Capital Markets Ltd'], 1),
      brlm_grievance_emails: value({ [KOTAK]: KOTAK_MAIL, [SBI]: SBI_MAIL }, 103),
    });
    expect(brlmPairs(h)).toEqual([
      [KOTAK, null],
      [JM, null],
      [SBI, null],
    ]);
  });

  it('(c) same set with NO grievance e-mails: the stored e-mails are kept, not rewritten to null', async () => {
    const h = makeDeps([
      { role: 'BRLM', name: KOTAK, grievanceEmail: KOTAK_MAIL, sebiRegNo: 'INM000008704' },
      { role: 'BRLM', name: JM, grievanceEmail: JM_MAIL },
      { role: 'BRLM', name: SBI, grievanceEmail: SBI_MAIL },
    ]);
    const summary = await run(h, { lead_managers: value([SBI, KOTAK, JM], 1) });
    const rows = (h.replaceForIpo.mock.calls[0]?.[1] ?? []) as Array<Record<string, unknown>>;
    expect(brlmPairs(h)).toEqual([
      [KOTAK, KOTAK_MAIL],
      [JM, JM_MAIL],
      [SBI, SBI_MAIL],
    ]);
    expect(rows.find((r) => r.name === KOTAK)?.sebiRegNo).toBe('INM000008704');
    // The kept values are the earlier document's; this document's record names none of them.
    expect(grievanceReceipts(summary)).toEqual([]);
  });

  it('(c2) the registrar row keeps its stored contact lines when this document did not read them', async () => {
    const REG = 'KFin Technologies Limited';
    const h = makeDeps([{ role: 'REGISTRAR', name: REG, email: 'nse.ipo@kfintech.com', phone: '+91 40 6716 2222', contactPerson: 'M. Murali Krishna' }]);
    (h.deps.ipoRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: [], leadManagers: HELD, registrar: REG,
    });
    await run(h, { lead_managers: value(HELD, 1) });
    const reg = ((h.replaceForIpo.mock.calls[0]?.[1] ?? []) as Array<Record<string, unknown>>).find((r) => r.role === 'REGISTRAR');
    expect([reg?.email, reg?.phone, reg?.contactPerson]).toEqual(['nse.ipo@kfintech.com', '+91 40 6716 2222', 'M. Murali Krishna']);
  });

  it('a stored-row read that fails refuses the replace rather than wiping the stored columns', async () => {
    const h = makeDeps([]);
    h.listByIpoAndRole.mockRejectedValue(new Error('read failed'));
    const summary = await run(h, { lead_managers: value(HELD, 1) });
    expect(h.replaceForIpo).not.toHaveBeenCalled();
    expect(summary.skipped_no_column.some((s) => s.startsWith('ipo_intermediaries'))).toBe(true);
  });
});
