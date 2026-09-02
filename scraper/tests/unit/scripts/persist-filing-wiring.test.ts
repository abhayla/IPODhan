/**
 * MAJOR-2: the paired-run refusal must be WIRED, not merely decidable.
 *
 * `decidePairedPersist` is covered as a pure function in the cross-document
 * agreement tests, but nothing asserted that persist-filing.ts actually calls
 * `process.exit(decision.exitCode)` BEFORE persisting — deleting the refusal
 * branch from the script left every existing test green while the CLI printed
 * "REFUSED" and then wrote both documents anyway (the exact bug that branch was
 * added to fix). This drives the script's own `run()` with the DB-touching steps
 * replaced, so an un-wired refusal turns this file RED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The script imports the live DB handle at module scope; nothing in this test
// may open a connection.
vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
  filterProtectedFields: vi.fn(async (_i: string, _t: string, d: unknown) => ({ filtered: d })),
  IPORepository: class {},
  FinancialStatementsRepository: class {},
  IpoValuationRepository: class {},
  PromotersRepository: class {},
  IpoIntermediariesRepository: class {},
  BrlmTrackRecordRepository: class {},
  FinancialDataRepository: class {},
  FieldSourcesRepository: class {},
}));
vi.mock('../../../src/repositories/peer-company-repository.js', () => ({
  PeerCompanyRepository: class {},
}));
vi.mock('../../../src/repositories/anchor-investor-repository.js', () => ({
  AnchorInvestorRepository: class {},
}));
vi.mock('../../../src/scrapers/anchor-investors-scraper.js', () => ({
  scrapeAnchorInvestors: vi.fn(async () => null),
}));

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

/**
 * A pair of extractions. `decidePairedPersist` REFUSES when the two documents
 * cannot be compared at all — an unrecognised unit on either side — which is the
 * case this wiring test drives.
 */
function writePair(
  dir: string,
  adRevenue: number,
  rhpRevenue: number,
  units: [string, string] = ['millions', 'millions']
): [string, string] {
  const doc = (docType: string, revenue: number, unit: string) => ({
    doc_type: docType,
    source_doc: 'fixture.pdf',
    extraction_status: 'OK',
    unit,
    fiscal_years: [2026],
    fields: {
      revenue_by_fy: {
        value: { '2026': revenue },
        page: 1,
        check: { name: 'revenue_check', passed: true },
      },
      pat_by_fy: {
        value: { '2026': 100 },
        page: 1,
        check: { name: 'pat_check', passed: true },
      },
    },
  });
  const adPath = path.join(dir, 'ad.json');
  const rhpPath = path.join(dir, 'rhp.json');
  writeFileSync(adPath, JSON.stringify(doc('PRICE_BAND_AD', adRevenue, units[0])));
  writeFileSync(rhpPath, JSON.stringify(doc('RHP', rhpRevenue, units[1])));
  return [adPath, rhpPath];
}

describe('persist-filing.ts paired run — refusal is wired to process.exit', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('exits with the decision exit code and persists NOTHING when the two documents disagree', async () => {
    const { run } = await import('../../../scripts/persist-filing');
    const { decidePairedPersist, checkCrossDocumentAgreement, comparableSeries } = await import(
      '../../../src/services/cross-document-agreement'
    );
    const { parseFilingUnit } = await import('../../../src/services/filing-persister');

    const dir = mkdtempSync(path.join(tmpdir(), 'persist-filing-wiring-'));
    // The RHP states a unit the parser does not recognise, so the two documents
    // cannot be compared — decidePairedPersist refuses and NEITHER is persisted.
    const [adPath, rhpPath] = writePair(dir, 1000, 2000, ['millions', 'billions']);

    const persistFiling = vi.fn(async () => {
      throw new Error('persistFilingExtraction must not run after a refusal');
    });

    // The exit code this run must produce, computed independently of the script.
    const expected = decidePairedPersist(
      checkCrossDocumentAgreement(
        comparableSeries(JSON.parse(readFileSync(adPath, 'utf8'))),
        comparableSeries(JSON.parse(readFileSync(rhpPath, 'utf8'))),
        undefined,
        'PRICE_BAND_AD',
        'RHP',
        parseFilingUnit('millions'),
        parseFilingUnit('billions')
      )
    );
    expect(expected.proceed).toBe(false);

    await expect(
      run(
        [
          'node',
          'persist-filing.ts',
          '--ipo',
          IPO_ID,
          '--json-ad',
          adPath,
          '--json-rhp',
          rhpPath,
          '--apply',
        ],
        {
          resolveIpoId: async () => IPO_ID,
          persistFiling: persistFiling as never,
        }
      )
    ).rejects.toThrow(`process.exit:${expected.exitCode}`);

    expect(exitSpy).toHaveBeenCalledWith(expected.exitCode);
    expect(persistFiling).not.toHaveBeenCalled();
  });

  it('persists both documents when they agree (the refusal must not be a blanket block)', async () => {
    const { run } = await import('../../../scripts/persist-filing');

    const dir = mkdtempSync(path.join(tmpdir(), 'persist-filing-wiring-ok-'));
    const [adPath, rhpPath] = writePair(dir, 1000, 1000);

    const persistFiling = vi.fn(async () => ({
      written: {},
      skipped_protected: [],
      skipped_cross_document_disagreement: [],
      skipped_failed_check: [],
      skipped_no_column: [],
      skipped_no_unit: [],
      skipped_unit_mismatch: [],
      ipos_fields: [],
      applied: true,
    }));

    await run(
      ['node', 'persist-filing.ts', '--ipo', IPO_ID, '--json-ad', adPath, '--json-rhp', rhpPath, '--apply'],
      { resolveIpoId: async () => IPO_ID, persistFiling: persistFiling as never }
    );

    expect(persistFiling).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('persist-filing.ts main guard — MINOR-3 case-insensitive drive letter on win32', () => {
  it('still runs (prints usage) when invoked with a lowercase drive letter', { timeout: 20000 }, async () => {
    if (process.platform !== 'win32') return; // the bug is win32-only; nothing to reproduce elsewhere
    const { execFileSync } = await import('child_process');
    const scriptPath = path.resolve(__dirname, '../../../scripts/persist-filing.ts');
    // Force a drive-letter case mismatch against import.meta.url's native casing.
    const lowerCasePath = scriptPath[0].toLowerCase() + scriptPath.slice(1);
    // Invoked with no args, the CLI itself exits non-zero after printing its
    // usage banner to stderr — that non-zero exit is expected and is NOT the
    // bug under test; execFileSync throws on it, so capture the thrown
    // error's output instead of the (never reached) return value.
    let stderr = '';
    try {
      execFileSync('npx', ['tsx', lowerCasePath], {
        cwd: path.resolve(__dirname, '../../..'),
        encoding: 'utf8',
        shell: true,
      });
    } catch (err) {
      stderr = String((err as { stderr?: string }).stderr ?? '');
    }
    // A silent no-op (the pre-fix bug: the guard mismatched, `run()` never
    // called) prints nothing at all; the guard matching means the CLI
    // actually ran and printed its usage banner.
    expect(stderr).toContain('usage: persist-filing.ts');
  });
});
