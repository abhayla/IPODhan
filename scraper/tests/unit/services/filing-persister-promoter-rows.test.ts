/**
 * OD-173 section 2, OD-174, OD-175, rows 110-112 / 152-153: the extractor's `promoter_rows` (one row
 * per promoter the document declares: shares held, cost of acquisition, one-year cost) reaches the
 * `promoters` table, keyed by the normalised name, with this document's receipts (OD-91).
 *
 * Mirrors the ipo_intermediaries rule (filing-persister-brlm-order-keeps-firm-fields.test.ts): a
 * per-row column this run has null for keeps the stored value of the same promoter; a kept value is
 * never credited to this document; a stored-row read that fails refuses the replace and is not counted.
 * Spec row 111: a nil cost is null, never 0.
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

const IPO_ID = 'a1c5d769-3ad1-4c6c-b58d-9f37965ee311';
const DOC_ID = '4dc5d769-3ad1-4c6c-b58d-9f37965ee322';
type Field = FilingExtraction['fields'][string];
const value = (v: unknown, page: number): Field =>
  ({ value: v, page, check: { name: 'c', passed: true }, state: 'VALUE', source_text: 'TEXT' }) as unknown as Field;

const RAVI = 'Ravi Shankar Mehta';
const ASHA = 'Asha Mehta';
const OLD = 'Mehta Family Trust';

type PRow = { name: string; is_promoter_group?: boolean; shares_held: number | null; waca: number | null; waca_last_year: number | null };
const pRow = (name: string, shares: number | null, waca: number | null, waca1y: number | null): PRow => ({
  name, is_promoter_group: false, shares_held: shares, waca, waca_last_year: waca1y,
});

type Stored = { name: string; sharesHeld?: number | null; waca?: string | null; wacaLastYear?: string | null; isPromoterGroup?: boolean };

function extraction(fields: Record<string, Field>): FilingExtraction {
  return {
    doc_type: 'DRHP', source_doc: 'DRHP-4dc5d769.pdf', pages: 420, extraction_status: 'OK', unit: 'millions',
    fiscal_years: [], fields,
  } as FilingExtraction;
}

function makeDeps(stored: Stored[]) {
  const replacePromoters = vi.fn(async () => []);
  const listPromotersByIpo = vi.fn(async () =>
    stored.map((r) => ({
      id: `row-${r.name}`, ipoId: IPO_ID, normalizedName: rowKeyForName(r.name), sharesHeld: null, waca: null,
      wacaLastYear: null, isPromoterGroup: false, ...r,
    }))
  );
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'Mehta Industries Limited', slug: 'mehta-industries-ltd',
        segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: [], leadManagers: [],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters, listPromotersByIpo, replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: {
      upsert: vi.fn(async (_id: string, values: Record<string, unknown>, opts?: { afterWriteInTx?: (tx: unknown, w: Record<string, unknown>) => Promise<void> }) => {
        await opts?.afterWriteInTx?.('tx-1', values);
      }),
      insertIfMissing: vi.fn(async () => false),
    },
  } as unknown as FilingPersisterDeps;
  return { deps, replacePromoters, listPromotersByIpo };
}

const run = (h: ReturnType<typeof makeDeps>, fields: Record<string, Field>) =>
  persistFilingExtraction(IPO_ID, extraction(fields), { docType: 'DRHP', documentId: DOC_ID, apply: true }, h.deps);

const written = (h: ReturnType<typeof makeDeps>) =>
  ((h.replacePromoters.mock.calls[0]?.[1] ?? []) as Array<Record<string, unknown>>).map((r) => ({
    name: r.name,
    normalizedName: r.normalizedName,
    sharesHeld: r.sharesHeld,
    waca: r.waca,
    wacaLastYear: r.wacaLastYear,
    isPromoterGroup: r.isPromoterGroup,
  }));

const promoterReceipts = (summary: Awaited<ReturnType<typeof persistFilingExtraction>>) =>
  (summary.receipt_fields ?? [])
    .filter((r) => r.tableName === 'promoters')
    .map((r) => `${r.rowKey}|${r.fieldName}|${r.value}`)
    .sort();

describe('filing-persister - promoter_rows reach the promoters table', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('two promoters: each row carries its own shares, cost and one-year cost, and the receipts name them', async () => {
    const h = makeDeps([]);
    const summary = await run(h, {
      promoter_names: value([RAVI, ASHA], 1),
      promoter_rows: value([pRow(RAVI, 12_500_000, 10.5, 45.25), pRow(ASHA, 3_000_000, 2, null)], 88),
    });
    expect(written(h)).toEqual([
      { name: RAVI, normalizedName: rowKeyForName(RAVI), sharesHeld: 12_500_000, waca: '10.5', wacaLastYear: '45.25', isPromoterGroup: false },
      { name: ASHA, normalizedName: rowKeyForName(ASHA), sharesHeld: 3_000_000, waca: '2', wacaLastYear: null, isPromoterGroup: false },
    ]);
    const r = rowKeyForName(RAVI) as string;
    const a = rowKeyForName(ASHA) as string;
    expect(promoterReceipts(summary)).toEqual(
      [
        `${r}|name|${RAVI}`, `${r}|sharesHeld|12500000`, `${r}|waca|10.5`, `${r}|wacaLastYear|45.25`, `${r}|isPromoterGroup|false`,
        `${a}|name|${ASHA}`, `${a}|sharesHeld|3000000`, `${a}|waca|2`, `${a}|isPromoterGroup|false`,
      ].sort()
    );
    expect(summary.written.promoters).toBe(2);
  });

  it('a later run with a null cost for one promoter keeps that promoter\'s stored cost, and does not credit it', async () => {
    const h = makeDeps([
      { name: RAVI, sharesHeld: 12_500_000, waca: '10.50', wacaLastYear: '45.25' },
      { name: ASHA, sharesHeld: 3_000_000, waca: '2.00', wacaLastYear: null },
    ]);
    const summary = await run(h, {
      promoter_names: value([RAVI, ASHA], 1),
      promoter_rows: value([pRow(RAVI, 12_500_000, null, null), pRow(ASHA, 3_100_000, 2.4, null)], 90),
    });
    expect(written(h)).toEqual([
      { name: RAVI, normalizedName: rowKeyForName(RAVI), sharesHeld: 12_500_000, waca: '10.50', wacaLastYear: '45.25', isPromoterGroup: false },
      { name: ASHA, normalizedName: rowKeyForName(ASHA), sharesHeld: 3_100_000, waca: '2.4', wacaLastYear: null, isPromoterGroup: false },
    ]);
    const r = rowKeyForName(RAVI) as string;
    const receipts = promoterReceipts(summary);
    expect(receipts.filter((x) => x.startsWith(`${r}|waca`))).toEqual([]);
    expect(receipts).toContain(`${rowKeyForName(ASHA)}|waca|2.4`);
  });

  it('a promoter the later document no longer declares is not kept: the later document\'s list replaces (OD-30, OD-154)', async () => {
    const h = makeDeps([
      { name: RAVI, sharesHeld: 12_500_000, waca: '10.50' },
      { name: OLD, sharesHeld: 900_000, waca: '1.00' },
    ]);
    await run(h, {
      promoter_names: value([RAVI, ASHA], 1),
      promoter_rows: value([pRow(RAVI, 12_500_000, 10.5, null), pRow(ASHA, 3_000_000, 2, null)], 88),
    });
    expect(written(h).map((r) => r.name)).toEqual([RAVI, ASHA]);
    // OLD's stored figures are never carried onto another promoter.
    expect(written(h).find((r) => r.name === ASHA)?.sharesHeld).toBe(3_000_000);
  });

  it('two promoter_rows names that normalise to one promoter are ambiguous: no figure from either is attached', async () => {
    const h = makeDeps([]);
    const summary = await run(h, {
      promoter_names: value([RAVI, ASHA], 1),
      promoter_rows: value(
        [pRow(RAVI, 12_500_000, 10.5, 45.25), pRow('Ravi Shankar Mehta.', 99, 99, 99), pRow(ASHA, 3_000_000, 2, null)],
        88
      ),
    });
    expect(written(h)).toEqual([
      { name: RAVI, normalizedName: rowKeyForName(RAVI), sharesHeld: null, waca: null, wacaLastYear: null, isPromoterGroup: false },
      { name: ASHA, normalizedName: rowKeyForName(ASHA), sharesHeld: 3_000_000, waca: '2', wacaLastYear: null, isPromoterGroup: false },
    ]);
    const r = rowKeyForName(RAVI) as string;
    expect(promoterReceipts(summary).filter((x) => x.startsWith(`${r}|`) && !x.startsWith(`${r}|name|`))).toEqual([]);
    expect(summary.skipped_failed_check.some((s) => s.includes('promoter_rows') && s.includes(r))).toBe(true);
  });

  it('a promoter_rows name the document does not declare is not attached to any promoter', async () => {
    const h = makeDeps([]);
    await run(h, {
      promoter_names: value([RAVI], 1),
      promoter_rows: value([pRow(ASHA, 3_000_000, 2, null)], 88),
    });
    expect(written(h)).toEqual([
      { name: RAVI, normalizedName: rowKeyForName(RAVI), sharesHeld: null, waca: null, wacaLastYear: null, isPromoterGroup: false },
    ]);
  });

  it('a zero cost is null, never 0 (row 111), and a non-whole share count is not saved', async () => {
    const h = makeDeps([]);
    await run(h, {
      promoter_names: value([RAVI], 1),
      promoter_rows: value([pRow(RAVI, 1250.5, 0, 0)], 88),
    });
    expect(written(h)).toEqual([
      { name: RAVI, normalizedName: rowKeyForName(RAVI), sharesHeld: null, waca: null, wacaLastYear: null, isPromoterGroup: false },
    ]);
  });

  it('a stored-row read that fails refuses the replace, is not counted, and names each row unresolved', async () => {
    const h = makeDeps([]);
    h.listPromotersByIpo.mockRejectedValue(new Error('read failed'));
    const summary = await run(h, {
      promoter_names: value([RAVI, ASHA], 1),
      promoter_rows: value([pRow(RAVI, 12_500_000, 10.5, 45.25), pRow(ASHA, 3_000_000, 2, null)], 88),
    });
    expect(h.replacePromoters).not.toHaveBeenCalled();
    expect(summary.written.promoters).toBeUndefined();
    expect(summary.skipped_no_column.some((s) => s.startsWith('promoters (stored rows unreadable'))).toBe(true);
    expect((summary.unresolved_child_rows ?? []).filter((s) => s.startsWith('promoters')).sort()).toEqual(
      [RAVI, ASHA].map((n) => `promoters ${rowKeyForName(n)} (stored-rows-unreadable; replace refused)`).sort()
    );
  });
});
