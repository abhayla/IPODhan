import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractIssueTypeFromDetailHtml } from '../../../src/scrapers/chittorgarh-detail-fields.js';

// Real captured Chittorgarh detail page (Ather Energy IPO, listed May-2025;
// fixture already in-repo from PR #74 / #71 historical-ingestion work).
// URL it was captured from: https://www.chittorgarh.com/ipo/ather-energy/<id>/
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/historical/ather-cg-detail.html'
);

describe('extractIssueTypeFromDetailHtml', () => {
  it('extracts BOOK_BUILDING from the real Ather Energy detail page (Issue Type Description anchor)', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    expect(extractIssueTypeFromDetailHtml(html)).toBe('BOOK_BUILDING');
  });

  it('extracts FIXED_PRICE from the same row shape with a Fixed Price value', () => {
    const html = `<span data-component="keyword-popup" data-record-id="1095"><a title="Issue Type Description" href="/keyword/issue-type/1095/">Issue Type</a></span></td><td class="text-end">Fixed Price<!-- --> <!-- -->IPO</td>`;
    expect(extractIssueTypeFromDetailHtml(html)).toBe('FIXED_PRICE');
  });

  it('extracts HYBRID when the page states both forms', () => {
    const html = `<a title="Issue Type Description">Issue Type</a></span></td><td class="text-end">Book Building + Fixed Price</td>`;
    expect(extractIssueTypeFromDetailHtml(html)).toBe('HYBRID');
  });

  it('falls back to the plain anchor-text match when the title attribute wraps differently', () => {
    const html = `<a href="/keyword/issue-type/9/">Issue Type</a></span></td><td>Bookbuilding IPO</td>`;
    expect(extractIssueTypeFromDetailHtml(html)).toBe('BOOK_BUILDING');
  });

  it('returns null when the label is absent', () => {
    expect(extractIssueTypeFromDetailHtml('<p>No issue-type row on this page.</p>')).toBeNull();
  });

  it('returns null when the value matches neither known form (never guessed)', () => {
    const html = `<a title="Issue Type Description">Issue Type</a></span></td><td class="text-end">Rights Issue</td>`;
    expect(extractIssueTypeFromDetailHtml(html)).toBeNull();
  });

  it('returns null for empty/missing html', () => {
    expect(extractIssueTypeFromDetailHtml('')).toBeNull();
  });
});
