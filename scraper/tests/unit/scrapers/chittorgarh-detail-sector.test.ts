import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  extractSectorFromDetailHtml,
  extractCompanyNameFromDetailHtml,
} from '../../../src/scrapers/chittorgarh-detail-fields.js';

// Three REAL captured Chittorgarh detail pages (T-507, issue #394):
// - Ather Energy (listed May-2025; fixture already in-repo from PR #74/#367 work)
// - Neochem Bio (captured live 2026-09-08 via curl for this fix — round-2 review
//   CRITICAL 1 caught this file mis-titled "vikran-engineering"; its real <title>
//   is "Neochem Bio IPO Date...", renamed to match)
// - HCIN Networks, id 2410 (captured live for the negative case — a REAL page
//   with no "Recently Listed IPOs in..." heading at all, not a synthetic string)
const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/historical'
);

describe('extractSectorFromDetailHtml', () => {
  it('extracts the sector from the real Ather Energy detail page (Automobiles)', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'ather-cg-detail.html'), 'utf-8');
    expect(extractSectorFromDetailHtml(html, 'Ather Energy')).toBe('Automobiles');
  });

  it('extracts the sector from the real Neochem Bio detail page (Specialty Chemicals)', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'neochem-bio-cg-detail.html'), 'utf-8');
    expect(extractSectorFromDetailHtml(html, 'Neochem Bio Solutions')).toBe('Specialty Chemicals');
  });

  it('returns null on a REAL page with no sector heading at all (HCIN Networks, id 2410)', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'hcin-networks-cg-detail-no-sector.html'), 'utf-8');
    expect(extractSectorFromDetailHtml(html, 'HCIN Networks')).toBeNull();
  });

  it('returns null when the heading is absent (synthetic)', () => {
    expect(extractSectorFromDetailHtml('<p>No sector heading on this page.</p>', 'Some Company')).toBeNull();
  });

  it('returns null for empty/missing html', () => {
    expect(extractSectorFromDetailHtml('', 'Some Company')).toBeNull();
  });

  it('rejects an implausibly short captured value (never guessed)', () => {
    const html = `<h2 itemprop="about">Recently Listed IPOs in X</h2>`;
    expect(extractSectorFromDetailHtml(html, 'Some Company')).toBeNull();
  });

  it('trims trailing whitespace/entities around the sector name', () => {
    const html = `<h2 itemprop="about">Recently Listed IPOs in Financial Services  </h2>`;
    expect(extractSectorFromDetailHtml(html, 'Some Company')).toBe('Financial Services');
  });

  it('rejects a generic placeholder value ("India") — round-2 review MINOR', () => {
    const html = `<h2 itemprop="about">Recently Listed IPOs in India</h2>`;
    expect(extractSectorFromDetailHtml(html, 'Some Company')).toBeNull();
  });

  it('rejects "Mainboard" / "SME" as a sector — round-2 review MINOR', () => {
    expect(extractSectorFromDetailHtml(`<h2 itemprop="about">Recently Listed IPOs in Mainboard</h2>`, 'X')).toBeNull();
    expect(extractSectorFromDetailHtml(`<h2 itemprop="about">Recently Listed IPOs in SME</h2>`, 'X')).toBeNull();
  });

  it('rejects a value equal to the company name — round-2 review MINOR', () => {
    const html = `<h2 itemprop="about">Recently Listed IPOs in Acme Traders Ltd</h2>`;
    expect(extractSectorFromDetailHtml(html, 'Acme Traders Ltd')).toBeNull();
  });
});

describe('extractCompanyNameFromDetailHtml (round-2 review CRITICAL 2 identity guard)', () => {
  it('extracts the company name from the real Ather Energy page h1', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'ather-cg-detail.html'), 'utf-8');
    expect(extractCompanyNameFromDetailHtml(html)).toBe('Ather Energy');
  });

  it('extracts the company name from the real Neochem Bio page h1', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'neochem-bio-cg-detail.html'), 'utf-8');
    expect(extractCompanyNameFromDetailHtml(html)).toBe('Neochem Bio Solutions');
  });

  it('extracts the company name from the real HCIN Networks page h1', () => {
    const html = readFileSync(path.join(FIXTURES_DIR, 'hcin-networks-cg-detail-no-sector.html'), 'utf-8');
    expect(extractCompanyNameFromDetailHtml(html)).toBe('HCIN Networks');
  });

  it('returns null when neither h1 nor title match the expected shape', () => {
    expect(extractCompanyNameFromDetailHtml('<p>nothing here</p>')).toBeNull();
  });
});
