/**
 * Item 9 (OD-90, F-163): the corrigendum sentence -> suggestion rules, on REAL reader output.
 * Fixtures: tests/fixtures/corrigendum/*.pages.json (provenance in the .meta.json beside each).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCorrigendumSuggestions,
  parseLongDate,
  UNKNOWN_FIELD,
  type CorrigendumPage,
} from '@ipodhan/shared/services/corrigendum-suggestions';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): CorrigendumPage[] =>
  JSON.parse(readFileSync(path.join(here, '..', '..', 'fixtures', 'corrigendum', name), 'utf8')).pages;

describe('parseCorrigendumSuggestions — Rays of Belief intimation letter (text layer)', () => {
  const out = parseCorrigendumSuggestions(fixture('rays-of-belief-intimation.pages.json'));

  it('produces exactly one suggestion: designated exchange BSE -> NSE, page 1, not OCR', () => {
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      fieldName: 'designatedExchange',
      tableName: 'ipo_details',
      proposedValue: 'NSE',
      statedOldValue: 'BSE',
      page: 1,
      ocr: false,
      ocrConfidence: null,
    });
  });

  it('quotes the correcting sentence verbatim', () => {
    expect(out[0].quote).toBe(
      'The Designated Stock Exchange as mentioned across the RHP should be read as \u201CNSE\u201D instead of \u201CBSE\u201D'
    );
  });
});

describe('parseCorrigendumSuggestions — Skyways newspaper notice (OCR only)', () => {
  const out = parseCorrigendumSuggestions(fixture('skyways-newspaper-notice.ocr.pages.json'));

  it('maps the close-date change and carries the OCR mark and confidence', () => {
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      fieldName: 'closeDate',
      tableName: 'ipos',
      proposedValue: '2026-08-27',
      statedOldValue: '2026-08-26',
      page: 1,
      ocr: true,
      ocrConfidence: 0.782,
    });
    expect(out[0].quote).toMatch(/^Issue\/Offer closes .*updated from Wednesday, August 26, 2026 to Thursday, August 27, 2026$/);
  });
});

describe('parseCorrigendumSuggestions — a correction no rule maps still reaches the admin', () => {
  it('emits field = unknown with the quote and no proposed value', () => {
    const out = parseCorrigendumSuggestions([
      {
        page: 3,
        ocr: false,
        text: 'Notice to investors. The Maximum Bid for Non-Institutional Investors should be read as [\u25CF] Equity Shares. Other text.',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ fieldName: UNKNOWN_FIELD, proposedValue: null, page: 3 });
    expect(out[0].quote).toContain('should be read as');
  });

  it('emits nothing for a page with no correction sentence', () => {
    expect(parseCorrigendumSuggestions([{ page: 1, ocr: false, text: 'Dear Madam/Sir, please take this on record.' }])).toEqual([]);
  });
});

describe('parseLongDate', () => {
  it('reads a long date and refuses an impossible one', () => {
    expect(parseLongDate('August 27, 2026')).toBe('2026-08-27');
    expect(parseLongDate('February 30, 2026')).toBeNull();
  });
});
