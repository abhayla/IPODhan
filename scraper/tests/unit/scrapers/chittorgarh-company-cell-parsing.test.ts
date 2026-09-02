/**
 * W-36 (2026-09-02): extractTextFromAnchor() in chittorgarh-scraper.ts returned
 * "Deepa Jewellers Ltd. O" for Deepa Jewellers — the report-table `Company` cell
 * carries a status badge (`<span class="badge ...">O</span>`) alongside the
 * anchor, and blindly stripping all tags concatenated the badge's leftover
 * text onto the company name. Consequence: slug became `deepa-jewellers-ltd-o`
 * and a companyName/slug conflict WARNING was written every scrape cycle.
 *
 * Fixture `tests/fixtures/chittorgarh/deepa-company-cell.html` is the raw
 * `Company` cell HTML captured live from the Chittorgarh report-82 API
 * (https://webnodejs.chittorgarh.com/cloud/report/data-read/82/...) for
 * Deepa Jewellers (https://www.chittorgarh.com/ipo/deepa-jewellers-ipo/2827/).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractTextFromAnchor } from '../../../src/scrapers/chittorgarh-scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEEPA_CELL_PATH = path.join(
  __dirname,
  '../../fixtures/chittorgarh/deepa-company-cell.html'
);

describe('extractTextFromAnchor (W-36 regression)', () => {
  it('strips a sibling status badge and keeps only the anchor text (live Deepa Jewellers cell)', () => {
    const cellHtml = readFileSync(DEEPA_CELL_PATH, 'utf-8').trim();
    expect(extractTextFromAnchor(cellHtml)).toBe('Deepa Jewellers Ltd.');
  });

  it('strips a badge nested INSIDE the anchor', () => {
    const html =
      '<a href="/ipo/foo-ipo/1/">Foo Industries Ltd. <span class="badge rounded-pill bg-success">O</span></a>';
    expect(extractTextFromAnchor(html)).toBe('Foo Industries Ltd.');
  });

  it('leaves a plain anchor with no badge unchanged', () => {
    const html = '<a href="/ipo/bar-ipo/2/">Bar Corp Ltd.</a>';
    expect(extractTextFromAnchor(html)).toBe('Bar Corp Ltd.');
  });

  it('falls back to plain text when the cell has no anchor at all', () => {
    expect(extractTextFromAnchor('Baz Ventures Ltd.')).toBe('Baz Ventures Ltd.');
  });

  it('returns empty string for empty input', () => {
    expect(extractTextFromAnchor('')).toBe('');
  });
});
