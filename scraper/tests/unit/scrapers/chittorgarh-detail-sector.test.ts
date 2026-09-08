import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractSectorFromDetailHtml } from '../../../src/scrapers/chittorgarh-detail-fields.js';

// Two REAL captured Chittorgarh detail pages (T-507, issue #394):
// - Ather Energy (listed May-2025; fixture already in-repo from PR #74/#367 work)
// - Vikran Engineering (captured live 2026-09-08 via curl for this fix)
const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/historical'
);

describe('extractSectorFromDetailHtml', () => {
  it('extracts the sector from the real Ather Energy detail page (Automobiles)', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'ather-cg-detail.html'), 'utf-8');
    expect(extractSectorFromDetailHtml(html)).toBe('Automobiles');
  });

  it('extracts the sector from the real Vikran Engineering detail page (Specialty Chemicals)', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'vikran-engineering-cg-detail.html'), 'utf-8');
    expect(extractSectorFromDetailHtml(html)).toBe('Specialty Chemicals');
  });

  it('returns null when the heading is absent', () => {
    expect(extractSectorFromDetailHtml('<p>No sector heading on this page.</p>')).toBeNull();
  });

  it('returns null for empty/missing html', () => {
    expect(extractSectorFromDetailHtml('')).toBeNull();
  });

  it('rejects an implausibly short captured value (never guessed)', () => {
    const html = `<h2 itemprop="about">Recently Listed IPOs in X</h2>`;
    expect(extractSectorFromDetailHtml(html)).toBeNull();
  });

  it('trims trailing whitespace/entities around the sector name', () => {
    const html = `<h2 itemprop="about">Recently Listed IPOs in Financial Services  </h2>`;
    expect(extractSectorFromDetailHtml(html)).toBe('Financial Services');
  });
});
