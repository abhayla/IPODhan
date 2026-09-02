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

  it('every fixture field matches the printed advertisement, and every check passed', () => {
    if (!have) {
      console.warn(`SKIPPED: ${PBA_PDF} not present (gitignored acceptance store)`);
      return;
    }
    if (!pythonAvailable) return;

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

  it('every extracted field carries a page number and the source document', () => {
    if (!have || !pythonAvailable) return;
    for (const key of Object.keys(EXPECTED.PRICE_BAND_AD)) {
      const field = out.fields[key];
      expect(field.source_doc, key).toBe(path.basename(PBA_PDF));
      expect(typeof field.page, `${key} page`).toBe('number');
      expect(field.page!, `${key} page`).toBeGreaterThanOrEqual(0);
    }
  });

  it('fields the document cannot yet carry are null WITH a reason, never a value', () => {
    if (!have || !pythonAvailable) return;
    for (const [key, reason] of Object.entries(EXPECTED._null_with_reason.PRICE_BAND_AD)) {
      const field = out.fields[key];
      expect(field, key).toBeDefined();
      expect(field.value, key).toBeNull();
      expect(field.check.detail, key).toBe(reason);
    }
  });

  it('a field absent from the fixture is not invented (P/E is null, not a number)', () => {
    if (!have || !pythonAvailable) return;
    expect(Object.keys(EXPECTED.PRICE_BAND_AD)).not.toContain('pe_at_cap');
    expect(out.fields.pe_at_cap.value).toBeNull();
    expect(out.fields.pe_at_cap.check.detail).toBe('not_ascertainable_loss');
  });
});

describe('extract_filing — Purple Style Labs RHP (real PDF)', () => {
  const have = existsSync(RHP_PDF);

  it('reads the fiscal years from the header row and the CIN from the cover', () => {
    if (!have) {
      console.warn(`SKIPPED: ${RHP_PDF} not present (gitignored acceptance store)`);
      return;
    }
    if (!pythonAvailable) return;
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
  it('category rows that do not sum to the printed total FAIL the check', () => {
    if (!pythonAvailable) return;
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

  it('a [•] in a price-dependent cell yields null with reason not_priced_yet', () => {
    if (!pythonAvailable) return;
    const page = [
      'INITIAL PUBLIC OFFERING OF UP TO [●] EQUITY SHARES OF FACE VALUE OF `10 EACH FOR CASH',
      'AT A PRICE OF `[●] PER EQUITY SHARE (INCLUDING A SHARE PREMIUM OF `[●] PER EQUITY SHARE)',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.issue_price.value).toBeNull();
    expect(out.fields.issue_price.check.detail).toBe('not_priced_yet');
    expect(out.fields.issue_price.check.passed).toBe(true); // classified, not failed
  });

  it('a document with no text layer is classified NEEDS_OCR and writes no values', () => {
    if (!pythonAvailable) return;
    const out = runOnTexts([[0, ''], [1, '   \n  ']], 'RHP');
    expect(out.extraction_status).toBe('NEEDS_OCR');
    expect(out.fields).toEqual({});
    expect(out.pages).toBe(2);
  });

  it('a price band whose cap exceeds the regulatory width FAILS, nulling both prices', () => {
    if (!pythonAvailable) return;
    const page = 'PRICE BAND: ` 100 TO ` 200 PER EQUITY SHARE OF FACE VALUE OF ` 10 EACH.';
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.price_band_floor.value).toBeNull();
    expect(out.fields.price_band_cap.value).toBeNull();
    expect(out.fields.price_band_cap.check.detail).toContain('1.2x floor');
    expect(out.extraction_status).toBe('PARTIAL');
  });
});
