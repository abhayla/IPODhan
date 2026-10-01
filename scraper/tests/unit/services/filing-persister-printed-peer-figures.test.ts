/**
 * #1165 — document peer-table figures arrive as the STRINGS the prospectus
 * printed (scraper/scripts/peer_table_rows.py: "converting them is the
 * persister's job"). Before the fix `numOrNull` accepted numbers only, so every
 * document peer row was saved names-only.
 *
 * The rows below are the extractor's real output for the German Green Steel and
 * Power RHP (tests/fixtures/extractor/german-green-steel-and-power-ltd-rhp-peer-pages.json)
 * and the Green Asia Impex RHP (green-asia-impex-ltd-rhp-peer-pages.json),
 * captured by running extract_filing.run() on those committed fixtures.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { persistFilingExtraction, type FilingExtraction, type FilingPersisterDeps } from '../../../src/services/filing-persister';
import { parsePrintedNumber } from '../../../src/services/printed-number';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa1165';

const GERMAN_GREEN_PEERS = [
  { name: 'Beekay Steel Industries Ltd', face_value: null, eps_basic: '18.94', eps_diluted: '18.94', ronw_pct: '3.49', nav: '548.18', total_income: '1,19,694.32', is_listed: null },
  { name: 'Kamdhenu Limited', face_value: null, eps_basic: '2.78', eps_diluted: '2.72', ronw_pct: '19.77', nav: '14.06', total_income: '77,469.59', is_listed: null },
];
const GREEN_ASIA_PEERS = [
  { name: 'Kings Infra Ventures Limited', face_value: null, closing_price: null, eps_basic: null, ronw_pct: null, nav: '35.47', pe: '17.21', is_listed: true },
  { name: 'Essex Marine Limited', face_value: '10', closing_price: '20.37', eps_basic: '4.63', ronw_pct: '22.85%', nav: null, pe: null, is_listed: true },
];

function extractionWithPeers(peers: Record<string, unknown>[]): FilingExtraction {
  return {
    doc_type: 'RHP',
    source_doc: 'fixture.pdf',
    pages: 2,
    extraction_status: 'OK',
    unit: 'lakhs',
    fiscal_years: [2025],
    fields: {
      peer_companies: { value: peers, page: 181, check: { name: 'peer_rows_parsed_from_peer_section', passed: true } },
    },
  } as FilingExtraction;
}

function makeDeps() {
  const peerReplace = vi.fn(async () => []);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({ id: IPO_ID, companyName: 'German Green Steel and Power Limited', segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING' })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: peerReplace },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;
  return { deps, peerReplace };
}

describe('#1165 parsePrintedNumber — Indian printed figures', () => {
  it.each([
    ['18.94', '18.94'],
    ['1,19,694.32', '119694.32'],
    ['119,694.32', '119694.32'],
    ['22.85%', '22.85'],
    ['(3.45)', '-3.45'],
    ['-3.45', '-3.45'],
    ['12.71x', '12.71'],
    ['₹ 132.00', '132'],
    ['16.54*', '16.54'],
    [70.01, '70.01'],
  ])('%s -> %s', (printed, expected) => {
    expect(parsePrintedNumber(printed)).toMatchObject({ value: expected, reason: null });
  });

  it.each(['-', '–', 'NA', 'N.A.', 'n/a', 'NA#', 'Nil', '[●]', ''])('%s is a placeholder: null, reason placeholder', (printed) => {
    expect(parsePrintedNumber(printed)).toMatchObject({ value: null, reason: 'placeholder' });
  });

  it.each(['12.7.1', '1,2', 'abc', '((3))', '1,19,6943.2'])('%s is unparseable: null with a reason, never a guess', (printed) => {
    expect(parsePrintedNumber(printed)).toMatchObject({ value: null, reason: 'unparseable' });
  });
});

describe('#1165 persistFilingExtraction — printed peer figures reach peer_companies', () => {
  it('German Green RHP: printed EPS / diluted EPS / RoNW / NAV are written as numbers', async () => {
    const s = makeDeps();
    await persistFilingExtraction(IPO_ID, extractionWithPeers(GERMAN_GREEN_PEERS), { docType: 'RHP', apply: true }, s.deps);
    expect(s.peerReplace).toHaveBeenCalledTimes(1);
    const rows = s.peerReplace.mock.calls[0][1] as Array<Record<string, unknown>>;
    const beekay = rows.find((r) => r.companyName === 'Beekay Steel Industries Ltd')!;
    expect(beekay).toMatchObject({ eps: '18.94', dilutedEps: '18.94', ronw: '3.49', nav: '548.18' });
    const kamdhenu = rows.find((r) => r.companyName === 'Kamdhenu Limited')!;
    expect(kamdhenu).toMatchObject({ eps: '2.78', dilutedEps: '2.72', ronw: '19.77', nav: '14.06' });
    // A set carrying figures is a full replacement, not a names-only gap fill.
    expect(s.peerReplace.mock.calls[0][2]).toMatchObject({ fillGapsOnly: false });
  });

  it('Green Asia RHP: a % suffix and a printed P/E parse; an absent cell stays null', async () => {
    const s = makeDeps();
    await persistFilingExtraction(IPO_ID, extractionWithPeers(GREEN_ASIA_PEERS), { docType: 'RHP', apply: true }, s.deps);
    const rows = s.peerReplace.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.companyName === 'Essex Marine Limited')).toMatchObject({ eps: '4.63', ronw: '22.85', peRatio: null, nav: null });
    expect(rows.find((r) => r.companyName === 'Kings Infra Ventures Limited')).toMatchObject({ peRatio: '17.21', nav: '35.47', eps: null });
  });

  it('a combined "EPS basic and diluted" column fills both EPS columns', async () => {
    const s = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      extractionWithPeers([{ name: 'Kamdhenu Limited', eps_basic_and_diluted: '2.78', nav: '14.06', is_listed: true }]),
      { docType: 'RHP', apply: true },
      s.deps
    );
    const rows = s.peerReplace.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ eps: '2.78', dilutedEps: '2.78', nav: '14.06' });
  });

  it('an unparseable printed figure is null AND reported with its text, never silently dropped', async () => {
    const s = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      extractionWithPeers([{ name: 'Kamdhenu Limited', eps_basic: '2.7.8', nav: '14.06', is_listed: true }]),
      { docType: 'RHP', apply: true },
      s.deps
    );
    const rows = s.peerReplace.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ eps: null, nav: '14.06' });
    expect(summary.skipped_failed_check.join('\n')).toContain("peer_companies.eps unparseable '2.7.8' (Kamdhenu Limited)");
  });
});

describe('#1166 (2) a names-only DOC set files provenance only for the rows it inserts', () => {
  it('a peer already stored (from Chittorgarh) gets no DOC claim; an unseen peer does', async () => {
    const flags = FEATURE_FLAGS as never as Record<string, unknown>;
    const original = flags.ENABLE_CHILD_TABLE_CONSOLIDATION;
    flags.ENABLE_CHILD_TABLE_CONSOLIDATION = true;
    try {
      const s = makeDeps();
      const consolidate = vi.fn(async (_ipo: string, _t: string, inputs: { rowKey: string; data: Record<string, unknown> }[]) => ({
        rows: inputs.map((i) => ({ rowKey: i.rowKey, skipped: false, consolidatedData: i.data })),
      }));
      const d = s.deps as unknown as Record<string, Record<string, unknown>>;
      d.peerCompanies.findByIPOId = vi.fn(async () => [{ normalizedName: 'kamdhenu', companyName: 'Kamdhenu Limited' }]);
      (s.deps as unknown as Record<string, unknown>).childRowConsolidator = { consolidatedUpsertChildRows: consolidate };
      await persistFilingExtraction(
        IPO_ID,
        extractionWithPeers([
          { name: 'Kamdhenu Limited', is_listed: true },
          { name: 'VMS TMT Limited', is_listed: true },
        ]),
        { docType: 'RHP', apply: true },
        s.deps
      );
      const peerCall = consolidate.mock.calls.find((c) => c[1] === 'peer_companies')!;
      expect(peerCall[2].map((i) => i.rowKey)).toEqual(['vms tmt']);
      expect(s.peerReplace.mock.calls[0][2]).toMatchObject({ fillGapsOnly: true });
    } finally {
      flags.ENABLE_CHILD_TABLE_CONSOLIDATION = original;
    }
  });
});
