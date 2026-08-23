import { describe, it, expect } from 'vitest';
import { parseReport82DiscoveryEntry } from '../../../scripts/lib/chittorgarh-report82-discovery';

/**
 * P3-7 (round-4 review, T-293): root cause of the Kwick Forensic Solutions /
 * Lumino Industries lot_size gap was DISCOVERY, not extraction — the backfill
 * script only queried report 118 (historical: carries an IPO only once it has
 * opened), so an UPCOMING issue was invisible to it even though Chittorgarh
 * publishes its lot size well before open. `parseReport82DiscoveryEntry` pulls
 * the slug + numeric detail-page id straight out of report 82 (the SAME
 * source `chittorgarh-scraper.ts` uses to discover IPOs at all, which DOES
 * cover upcoming issues) so the existing, already-correct
 * `extractLotSizeFromDetailHtml` extractor has a detail-page URL to fetch.
 */
describe('parseReport82DiscoveryEntry', () => {
  it('extracts slug + numeric id from a real upcoming-IPO row (Kwick Forensic Solutions, T-293)', () => {
    const row = {
      Company: '<a href="https://www.chittorgarh.com/ipo/kwick-forensic-solutions-ipo/2757/" title="Kwick Forensic Solutions IPO Details">Kwick Forensic Solutions Ltd.</a> ',
      '~URLRewrite_Folder_Name': 'kwick-forensic-solutions-ipo',
    };
    const parsed = parseReport82DiscoveryEntry(row);
    expect(parsed).toEqual({
      name: row.Company,
      slug: 'kwick-forensic-solutions-ipo',
      id: '2757',
    });
  });

  it('extracts slug + numeric id from a real upcoming-IPO row (Lumino Industries, T-293)', () => {
    const row = {
      Company: '<a href="https://www.chittorgarh.com/ipo/lumino-industries-ipo/2013/" title="Lumino Industries IPO Details">Lumino Industries Ltd.</a> ',
      '~URLRewrite_Folder_Name': 'lumino-industries-ipo',
    };
    const parsed = parseReport82DiscoveryEntry(row);
    expect(parsed?.id).toBe('2013');
    expect(parsed?.slug).toBe('lumino-industries-ipo');
  });

  it('returns null when the Company anchor has no /ipo/<slug>/<id>/ href (malformed row)', () => {
    expect(parseReport82DiscoveryEntry({ Company: 'Plain text, no anchor', '~URLRewrite_Folder_Name': 'x' })).toBeNull();
  });

  it('returns null when the slug field is missing', () => {
    const row = { Company: '<a href="https://www.chittorgarh.com/ipo/x-ipo/1/">X</a>' };
    expect(parseReport82DiscoveryEntry(row)).toBeNull();
  });
});
