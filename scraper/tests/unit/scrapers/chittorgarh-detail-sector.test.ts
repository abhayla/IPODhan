// implements: spec field 13 ipos.sector, check F1 "non-empty, from the fixed sector list" (#394, #343, #73).
// Every page here is a REAL Chittorgarh detail page (provenance in the sibling .meta.json).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSectorFromDetailHtml, loadSectorList } from '../../../src/scrapers/chittorgarh-detail-sector.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'chittorgarh');
const page = (name: string) => readFileSync(path.join(FIXTURES, `chittorgarh-${name}-detail.html`), 'utf8');

describe('the fixed sector list (scraper/config/sector-list.json)', () => {
  const sectors = loadSectorList();

  it('holds CG industry index as captured 2026-09-26: 197 codes', () => {
    expect(sectors.size).toBe(197);
    expect(sectors.get('66')).toBe('Other Textile Products');
    expect(sectors.get('78')).toBe('Real Estate related services');
  });

  it('contains every sector value already on staging from CHITTORGARH (measured 2026-09-26)', () => {
    const names = new Set(sectors.values());
    for (const v of [
      'Gems, Jewellery And Watches',
      'Other Electrical Equipment',
      'Diversified Commercial Services',
      'Industrial Products',
      'Pharmaceuticals',
    ]) {
      expect(names.has(v), v).toBe(true);
    }
  });
});

describe('extractSectorFromDetailHtml on live CG pages', () => {
  it.each([
    ['paramount-syntex', 'Other Textile Products'], // SME, code 66, heading agrees
    ['dove-soft', 'Software Products'], // SME, code 176, heading agrees
    ['runwal-enterprises', 'Real Estate related services'], // Mainboard, code 78, NO heading on the page
    ['horizon-reclaim-india', 'Rubber'], // code 167
    ['kwick-forensic-solutions', 'Industrial Products'], // code 162
    ['paluck-technologies', 'Civil Construction'], // code 152
  ])('%s -> %s', (name, expected) => {
    expect(extractSectorFromDetailHtml(page(name))).toBe(expected);
  });

  it('the Runwal page really has no industry heading (the code is the only carrier)', () => {
    expect(page('runwal-enterprises')).not.toContain('Recently Listed IPOs in');
  });
});

describe('extractSectorFromDetailHtml never guesses (each guard mutated)', () => {
  const sectors = loadSectorList();

  it('no ipo_industry code on the page -> null, never ""', () => {
    const html = page('paramount-syntex').replace(/ipo_industry/g, 'ipo_xindustry');
    expect(extractSectorFromDetailHtml(html)).toBeNull();
  });

  it('a code missing from the fixed list -> null', () => {
    const without = new Map(sectors);
    without.delete('66');
    expect(extractSectorFromDetailHtml(page('paramount-syntex'), without)).toBeNull();
  });

  it('the heading names a different industry than the code maps to -> null', () => {
    const wrong = new Map(sectors);
    wrong.set('66', 'Software Products');
    expect(extractSectorFromDetailHtml(page('paramount-syntex'), wrong)).toBeNull();
  });

  it('two different codes on one page -> null', () => {
    const html = `${page('runwal-enterprises')}<script>{\\"ipo_industry\\":\\"66\\"}</script>`;
    expect(extractSectorFromDetailHtml(html)).toBeNull();
  });

  it('empty page -> null', () => {
    expect(extractSectorFromDetailHtml('')).toBeNull();
  });
});
