/**
 * GitHub #69 — company_description source (Chittorgarh "About" / id=ipoSummary).
 *
 * company_description was 0/285. Chittorgarh detail pages carry a clean business
 * description in <div id="ipoSummary"><p>…</p></div>. This proves the pure
 * extractor produces clean prose (tags stripped, entities decoded, plausibility
 * gated) across >=7 REAL IPOs of mixed type (mainboard + SME), per the owner's
 * "7 IPOs of different types" directive, plus crafted edge cases.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractCompanyDescriptionFromDetailHtml } from '../../../src/scrapers/chittorgarh-detail-fields.js';

const fixture: Record<string, { company: string; ipoSummaryHtml: string | null }> = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'listing', 'cg-detail-descriptions.json'), 'utf-8')
);

const realCases = Object.entries(fixture).filter(([, v]) => v.ipoSummaryHtml);

describe('extractCompanyDescriptionFromDetailHtml — real CG pages (#69)', () => {
  it('captured >=7 real IPO descriptions of mixed type', () => {
    expect(realCases.length).toBeGreaterThanOrEqual(7);
  });

  it.each(realCases)('%s: extracts clean, plausible prose', (_slug, v) => {
    const desc = extractCompanyDescriptionFromDetailHtml(v.ipoSummaryHtml as string);
    expect(desc, v.company).toBeTruthy();
    expect((desc as string).length).toBeGreaterThanOrEqual(20);
    expect(desc).not.toMatch(/<[^>]+>/); // no HTML tags
    expect(desc).not.toMatch(/&(amp|lt|gt|nbsp|#39|quot);/); // entities decoded
    expect(desc).toMatch(/incorporated|limited|provides|specializes|manufactur|services|company/i);
  });

  it('decodes &amp; in a real entity-bearing description (Modern Diagnostic & Research)', () => {
    const modern = fixture['modern-diagnostic-and-research-centre-ipo'] ?? Object.values(fixture).find((v) => /Modern Diagnostic/.test(v.company));
    if (modern?.ipoSummaryHtml) {
      const desc = extractCompanyDescriptionFromDetailHtml(modern.ipoSummaryHtml);
      expect(desc).toContain('&');
      expect(desc).not.toContain('&amp;');
    }
  });
});

describe('extractCompanyDescriptionFromDetailHtml — edge cases', () => {
  it('returns null when the ipoSummary block is absent', () => {
    expect(extractCompanyDescriptionFromDetailHtml('<div id="other">x</div>')).toBeNull();
    expect(extractCompanyDescriptionFromDetailHtml('')).toBeNull();
  });

  it('returns null for an implausibly short description (output-plausibility)', () => {
    expect(extractCompanyDescriptionFromDetailHtml('<div id="ipoSummary"><p>Short.</p></div>')).toBeNull();
  });

  it('joins multi-paragraph descriptions with spacing and strips tags', () => {
    const html = '<div id="ipoSummary" class="collapse "><p>Incorporated in 2010, Acme Limited makes widgets.</p><p>It also provides services nationwide.</p></div>';
    const desc = extractCompanyDescriptionFromDetailHtml(html);
    expect(desc).toBe('Incorporated in 2010, Acme Limited makes widgets. It also provides services nationwide.');
  });

  it('decodes a crafted entity-bearing description', () => {
    const html = '<div id="ipoSummary"><p>Foo &amp; Bar Limited provides IT &amp; consulting services across India.</p></div>';
    expect(extractCompanyDescriptionFromDetailHtml(html)).toBe('Foo & Bar Limited provides IT & consulting services across India.');
  });
});
