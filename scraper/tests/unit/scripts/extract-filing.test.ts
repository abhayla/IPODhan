import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-430 — WP C-2 filing extractor (`scripts/extract_filing.py`).
 *
 * Two layers, deliberately:
 *
 * 1. FIXTURE tests against the REAL Purple Style Labs documents (RHP + price band
 *    advertisement) as obtained by the T-403 discovery runner. The oracle is
 *    `docs/reviews/fixtures/purple-style-labs-expected.json`, transcribed by hand
 *    from the printed advertisement — NOT from extractor output — so a wrong
 *    extraction fails instead of being blessed. These skip loudly when the PDFs
 *    are not on this machine: they live under the gitignored
 *    `.prospectus-acceptance/`, so CI (which has never fetched them) reports the
 *    skip rather than a false green.
 *
 * 2. NEGATIVE unit tests on the §1 check functions, driven by tiny synthetic page
 *    text through the script's `--texts` seam — no PDFs, always run everywhere.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(SCRAPER_ROOT, '..');
const SCRIPT = 'scripts/extract_filing.py';

const PDF_DIR = path.join(REPO_ROOT, '.prospectus-acceptance', 'psl-1');
const PBA_PDF = path.join(PDF_DIR, 'PRICE_BAND_AD-cebd8036.pdf');
const RHP_PDF = path.join(PDF_DIR, 'DRHP-700fce50.pdf');
const EXPECTED = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'docs/reviews/fixtures/purple-style-labs-expected.json'), 'utf-8'),
);

interface Field {
  value: unknown;
  page: number | null;
  source_doc: string;
  check: { name: string; passed: boolean; detail: string };
}
interface Extraction {
  doc_type: string;
  pages: number;
  extraction_status: 'OK' | 'PARTIAL' | 'NEEDS_OCR';
  unit: string | null;
  fiscal_years: number[];
  fields: Record<string, Field>;
}

function runPython(args: string[]): Extraction {
  const res = spawnSync('python', [SCRIPT, ...args], {
    cwd: SCRAPER_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`extract_filing.py exited ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Run the extractor on synthetic page text: [[pageIndex, "text"], ...]. */
function runOnTexts(pages: [number, string][], docType: string): Extraction {
  const dir = mkdtempSync(path.join(tmpdir(), 'extract-filing-'));
  const file = path.join(dir, 'pages.json');
  writeFileSync(file, JSON.stringify(pages), 'utf-8');
  return runPython(['--texts', file, '--doc-type', docType]);
}

let pythonAvailable = true;
beforeAll(() => {
  pythonAvailable = !spawnSync('python', ['--version'], { encoding: 'utf-8' }).error;
});

describe('extract_filing — Purple Style Labs price band advertisement (real PDF)', () => {
  const have = existsSync(PBA_PDF);
  let out: Extraction;

  beforeAll(() => {
    if (!have || !pythonAvailable) return;
    out = runPython([PBA_PDF, '--doc-type', 'PRICE_BAND_AD']);
  });

  it('every fixture field matches the printed advertisement, and every check passed', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();

    expect(out.extraction_status).toBe('OK');
    expect(out.unit).toBe(EXPECTED.PRICE_BAND_AD.unit);
    expect(out.fiscal_years).toEqual(EXPECTED.PRICE_BAND_AD.fiscal_years);

    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(EXPECTED.PRICE_BAND_AD)) {
      const field = out.fields[key];
      if (!field) {
        mismatches.push(`${key}: not emitted`);
        continue;
      }
      if (JSON.stringify(field.value) !== JSON.stringify(expected)) {
        mismatches.push(`${key}: got ${JSON.stringify(field.value)} want ${JSON.stringify(expected)}`);
      }
    }
    expect(mismatches).toEqual([]);

    // Every emitted check must have passed — a failed check means a null value.
    const failed = Object.entries(out.fields)
      .filter(([, f]) => !f.check.passed)
      .map(([k, f]) => `${k}: ${f.check.detail}`);
    expect(failed).toEqual([]);
  });

  it('every extracted field carries a page number and the source document', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    for (const key of Object.keys(EXPECTED.PRICE_BAND_AD)) {
      const field = out.fields[key];
      expect(field.source_doc, key).toBe(path.basename(PBA_PDF));
      expect(typeof field.page, `${key} page`).toBe('number');
      expect(field.page!, `${key} page`).toBeGreaterThanOrEqual(0);
    }
  });

  it('fields the document cannot yet carry are null WITH a reason, never a value', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    for (const [key, reason] of Object.entries(EXPECTED._null_with_reason.PRICE_BAND_AD)) {
      const field = out.fields[key];
      expect(field, key).toBeDefined();
      expect(field.value, key).toBeNull();
      expect(field.check.detail, key).toBe(reason);
    }
  });

  it('a field absent from the fixture is not invented (P/E is null, not a number)', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    expect(Object.keys(EXPECTED.PRICE_BAND_AD)).not.toContain('pe_at_cap');
    expect(out.fields.pe_at_cap.value).toBeNull();
    expect(out.fields.pe_at_cap.check.detail).toBe('not_ascertainable_loss');
  });
});

describe('extract_filing — Purple Style Labs RHP (real PDF)', () => {
  const have = existsSync(RHP_PDF);

  it('reads the fiscal years from the header row and the CIN from the cover', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    const out = runPython([RHP_PDF, '--doc-type', 'RHP']);
    expect(out.fiscal_years).toEqual(EXPECTED.RHP.fiscal_years);
    expect(out.unit).toBe(EXPECTED.RHP.unit);
    expect(out.fields.cin.value).toBe(EXPECTED.RHP.cin);
    expect(out.fields.cin.check.passed).toBe(true);
    // The RHP's own P&L must agree with the figures the advertisement reprints.
    const pat = out.fields.pat_by_fy.value as Record<string, number> | null;
    if (pat) {
      for (const [fy, expected] of Object.entries(
        EXPECTED.PRICE_BAND_AD.pat_by_fy as Record<string, number>,
      )) {
        expect(pat[fy], `PAT ${fy}`).toBeCloseTo(expected, 1);
      }
    }
    // A ~450-page prospectus: pdfplumber needs minutes, so this test owns a
    // generous budget. It never runs in CI (the PDF is gitignored).
  }, 900_000);
});

describe('extract_filing — check functions reject bad documents (synthetic, offline)', () => {
  it('category rows that do not sum to the printed total FAIL the check', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    // Track record: 30 + 20 + common 19 = 69, but the table prints Total 85.
    const page = [
      'Axis Capital Limited* 30 4',
      'IIFL Capital Services Limited* 20 10',
      'Common Issues 19 5',
      'Total 85 19',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    const field = out.fields.brlm_track_record;
    expect(field.check.name).toBe('brlm_rows_reconcile_with_total');
    expect(field.check.passed).toBe(false);
    expect(field.value).toBeNull();
    expect(field.check.detail).toContain('check_failed');
    expect(field.check.detail).toContain('69');
    expect(out.extraction_status).toBe('PARTIAL');
  });

  it('a [•] in a price-dependent cell yields null with reason not_priced_yet', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = [
      'INITIAL PUBLIC OFFERING OF UP TO [●] EQUITY SHARES OF FACE VALUE OF `10 EACH FOR CASH',
      'AT A PRICE OF `[●] PER EQUITY SHARE (INCLUDING A SHARE PREMIUM OF `[●] PER EQUITY SHARE)',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.issue_price.value).toBeNull();
    expect(out.fields.issue_price.check.detail).toBe('not_priced_yet');
    expect(out.fields.issue_price.check.passed).toBe(true); // classified, not failed
  });

  it('a document with no text layer is classified NEEDS_OCR and writes no values', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts([[0, ''], [1, '   \n  ']], 'RHP');
    expect(out.extraction_status).toBe('NEEDS_OCR');
    expect(out.fields).toEqual({});
    expect(out.pages).toBe(2);
  });

  it('a price band whose cap exceeds the regulatory width FAILS, nulling both prices', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = 'PRICE BAND: ` 100 TO ` 200 PER EQUITY SHARE OF FACE VALUE OF ` 10 EACH.';
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.price_band_floor.value).toBeNull();
    expect(out.fields.price_band_cap.value).toBeNull();
    expect(out.fields.price_band_cap.check.detail).toContain('1.2x floor');
    expect(out.extraction_status).toBe('PARTIAL');
  });

  // MAJOR-1 (T-430 round 2): a P&L table with no explicit "in <unit>" line anywhere
  // must null EVERY C-group money field with reason unit_unknown — this must FAIL
  // before the fix (the shared module's own detector silently defaults to "lakhs").
  it('a P&L table with no unit line nulls every C-group money field as unit_unknown', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = [
      'Restated Consolidated Statement of Profit and Loss',
      '                          March 31, 2026    March 31, 2025    March 31, 2024',
      'Revenue from operations        17,538             15,000             12,000',
      'Total income                   17,900             15,300             12,300',
      'Profit for the year               500                400               300',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'RHP');

    expect(out.fields.unit.value).toBeNull();
    expect(out.fields.unit.check.name).toBe('unit_not_stated');
    expect(out.fields.unit.check.passed).toBe(false);
    expect(out.extraction_status).toBe('PARTIAL');

    for (const key of ['revenue_by_fy', 'total_income_by_fy', 'pat_by_fy']) {
      const field = out.fields[key];
      expect(field.value, key).toBeNull();
      expect(field.check.detail, key).toBe('unit_unknown');
      expect(field.check.passed, key).toBe(true); // classified, not a failed arithmetic check
    }
  });

  // MAJOR-3 (T-430 round 2): `_find_unit` used to match PROSE. Every C-group money
  // field is scaled by the detected unit, so a prose match is a silent 10x/100x
  // error carrying a GREEN check. These two probes are the exact sentences from the
  // review; both must leave the unit null.
  it.each([
    ['We serve 3 million customers in millions of cities across India.'],
    ['Our sarees are present in lakhs of homes across the country.'],
  ])('prose mentioning a unit does not become the document unit: %s', (prose: string) => {
    if (!pythonAvailable) return;
    const page = [
      prose,
      'Restated Consolidated Statement of Profit and Loss',
      '                          March 31, 2026    March 31, 2025    March 31, 2024',
      'Revenue from operations        17,538             15,000             12,000',
      'Profit for the year               500                400               300',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'RHP');
    expect(out.fields.unit.value).toBeNull();
    expect(out.fields.unit.check.passed).toBe(false);
    expect(out.fields.pat_by_fy.value).toBeNull();
    expect(out.fields.pat_by_fy.check.detail).toBe('unit_unknown');
  });

  it('a units caption IS accepted where prose is not', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts([[0, 'Restated Statement of Profit and Loss (` in million)']], 'RHP');
    expect(out.fields.unit.value).toBe('millions');
  });

  it('two pages stating different units null the unit with reason unit_conflict', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts(
      [[0, '(₹ in million)'], [3, '(₹ in crores)']],
      'RHP',
    );
    expect(out.fields.unit.value).toBeNull();
    expect(out.fields.unit.check.passed).toBe(false);
    expect(out.fields.unit.check.detail).toContain('unit_conflict');
  });

  // MAJOR-3, second half: the market-cap consistency check used to hard-code
  // Rs million. A crore-denominated advertisement must fail CLOSED with a reason,
  // never pass a comparison that is silently 10x wrong.
  it('market cap fails closed with unit_unknown when no unit caption exists', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = [
      'PRICE BAND : ` 546 TO ` 575 PER EQUITY SHARE OF FACE VALUE OF ` 10 EACH.',
      'Fresh Issue 12,454,212 6,800.00 11,826,086 6,800.00',
      'Post-Issue market capitalisation 44,056.31 46,035.12',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.market_cap_at_cap.value).toBeNull();
    expect(out.fields.market_cap_at_cap.check.detail).toContain('unit_unknown');
    expect(out.fields.shares_at_floor.value).toBeNull();
    expect(out.fields.shares_at_floor.check.detail).toContain('unit_unknown');
  });

  // MAJOR-2 mutation proof: the floor-side and cap-side implied pre-issue share
  // counts must independently reproduce the same number. Bumping mcap_cap by 1%
  // (leaving shares/prices untouched) must flip the combined check from green to
  // red — proving the new check function actually exercises live arithmetic and
  // is not a tautology.
  it('mcap consistency FAILS when mcap_cap disagrees with the floor-side implied share count', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const buildPage = (mcapCap: string) => [
      '(` in million)',
      'PRICE BAND : ` 546 TO ` 575 PER EQUITY SHARE OF FACE VALUE OF ` 10 EACH.',
      'Fresh Issue 12,454,212 6,800.00 11,826,086 6,800.00',
      'Post-Issue market capitalisation 44,056.31 ' + mcapCap,
    ].join('\n');

    const ok = runOnTexts([[0, buildPage('46,035.12')]], 'PRICE_BAND_AD');
    expect(ok.fields.market_cap_at_cap.check.name).toBe('market_cap_ordering_and_consistency');
    expect(ok.fields.market_cap_at_cap.check.passed).toBe(true);
    expect(ok.fields.market_cap_at_cap.value).toBe(46035.12);

    // mcap_cap x 1.01 = 46,495.47 — same floor side, only the cap side mutated.
    const mutated = runOnTexts([[0, buildPage('46,495.47')]], 'PRICE_BAND_AD');
    expect(mutated.fields.market_cap_at_cap.check.passed).toBe(false);
    expect(mutated.fields.market_cap_at_cap.value).toBeNull();
    expect(mutated.fields.market_cap_at_floor.value).toBeNull();
    expect(mutated.fields.market_cap_at_cap.check.detail).toContain('implied pre-issue shares');
    expect(mutated.extraction_status).toBe('PARTIAL');
  });
});
