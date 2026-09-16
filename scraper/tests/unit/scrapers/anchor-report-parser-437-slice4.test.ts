/**
 * #437 slice 4 - the row with NO printed share cell at all, derived from the
 * letter's own preamble total.
 *
 * See `scripts/test_anchor_missing_cell_437.py` for the full RCA and what
 * this slice's fix does and does NOT reach - the same real fixtures
 * (LCCPROJECT, GLOTTIS) rendered here through the REAL
 * `anchor_report_text.py` pipeline (`render_rows` / `_plain_ocr_lines`,
 * pre-rendered once and committed as `*-rendered-pages.json`, since this
 * repo's vitest tests never shell out to Python) and fed into the REAL
 * `parseAnchorReport` - this is the end-to-end proof the brief asks for,
 * not a unit test of the derivation in isolation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseAnchorReport,
  parsePreambleTotalShares,
} from '../../../src/scrapers/anchor-report-parser';

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/anchor'
);

function pages(symbol: string): string[] {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${symbol}-rendered-pages.json`), 'utf8'))
    .pages;
}

describe('parsePreambleTotalShares', () => {
  it('reads the preamble sentence LCCPROJECT prints on its table page', () => {
    expect(parsePreambleTotalShares(pages('LCCPROJECT').join('\n'))).toBe(8776869);
  });

  it('reads the preamble sentence GLOTTIS prints on its COVER page (page 0, no table)', () => {
    // Regression guard for the second bug this slice fixed: before it, a
    // scanned page with no rebuildable table rendered to the empty string,
    // and this sentence never reached fullText at all.
    expect(parsePreambleTotalShares(pages('GLOTTIS').join('\n'))).toBe(4283755);
  });

  it('returns null when no such sentence is present', () => {
    expect(parsePreambleTotalShares('Dear Sir, please find attached.')).toBeNull();
  });
});

describe('parseAnchorReport - LCCPROJECT (#437 slice 4, real fixture)', () => {
  it('derives RGSL Investment Fund\'s share count from the preamble total', () => {
    const result = parseAnchorReport(pages('LCCPROJECT'));
    // LCCPROJECT still refuses overall (see the file-level comment above and
    // the Python test's docstring for the real, different reason: two OTHER
    // rows are missing their PERCENT cell, not their share cell - a
    // separate, undocumented residual this slice's Class does not cover).
    // What THIS test proves is narrower and real: the derivation recovered
    // RGSL's row specifically, measured through the refusal reason itself
    // moving from "44.70%" (RGSL's shares entirely absent from the
    // denominator) to "26.61%" (RGSL's shares now counted) - never claiming
    // the letter publishes, which it does not.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('26.61%');
    expect(result.reason).not.toContain('44.70%');
  });
});

describe('parseAnchorReport - GLOTTIS (#437 slice 4, real fixture)', () => {
  it('is unaffected by this slice - its refusal is the documented row-merge defect, not a missing share cell', () => {
    const result = parseAnchorReport(pages('GLOTTIS'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Unchanged from before this slice's fix (measured) - proof this slice
    // correctly declines to touch a defect outside its Class.
    expect(result.reason).toContain('19.92%');
  });
});

describe('parseAnchorReport - SME fixtures MADHURKNIT and SUMAX (#437 slice 4)', () => {
  it('MADHURKNIT: real NSE SME anchor letter, text-layer PDF - the page-rebuild path never reaches parseAnchorReport at all', () => {
    // Honest documentation, not a claim of success: MADHURKNIT has a real
    // pdfplumber text layer (no OCR needed at all), and the text-layer
    // table-rebuild path (`page_rows` in anchor_report_text.py) does not
    // rebuild this letter's table into `# name | shares | ...` lines the
    // way the OCR path does for a scan - so `records()` finds zero
    // pipe-delimited lines and the parser refuses at the candidate stage.
    // This is a DIFFERENT, pre-existing extraction gap on the text-layer
    // path, not this slice's missing-share-cell Class, and is not fixed
    // here.
    const result = parseAnchorReport(pages('MADHURKNIT'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('0 investor rows');
  });

  it('SUMAX: real NSE SME anchor letter, text-layer PDF, percent column prints with no "%" glyph anywhere', () => {
    // SUMAX's letter prints its percent cells as bare numbers ("13.88", no
    // "%") even in the header - `parsePercent` requires a literal "%" (or
    // an OCR-confusable stand-in), which the text-layer rebuild path never
    // restores the way `ocr_table_page_rows`'s `column_text` does for a
    // scan. SUMAX row 6 (IMAP INDIA CAPITAL) is ALSO missing its share
    // cell in the printed letter itself, which IS this slice's Class - but
    // recovering it needs the percent-glyph fix first (no percent anchor
    // for readRow to scan from), which is a separate, larger defect on a
    // different code path than the one this slice touches. Documented
    // honestly as unresolved, not claimed fixed.
    const result = parseAnchorReport(pages('SUMAX'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('0 investor rows');
  });
});
