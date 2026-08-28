import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSebiListing,
  matchSebiRow,
  parseSebiDetailPdfUrl,
  sebiListingUrlFor,
  SEBI_LISTINGS,
  SEBI_NAME_MATCH_THRESHOLD,
} from '../../../src/services/sebi-source.js';

/**
 * T-403 G1 — the SEBI rung, against listings captured live on 2026-08-28.
 *
 * The `smid` values were discovered by probing and confirmed by reading each
 * listing's own rows: 10 = Draft Offer Documents, 11 = Red Herring Documents,
 * 12 = Final Prospectus.
 */
const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');

describe('parseSebiListing — the real RHP listing', () => {
  const rows = parseSebiListing(fixture('sebi-rhp-listing.html'));

  it('parses every row with a company, a type and a DETAIL url', () => {
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(r.companyName).not.toBe('');
      expect(r.detailUrl).toMatch(/^https:\/\/www\.sebi\.gov\.in\//);
    }
  });

  it('splits "<Company> - <Kind>" and classifies the kind', () => {
    const esds = rows.find((r) => r.companyName === 'ESDS Software Solution Limited')!;
    expect(esds).toBeDefined();
    expect(esds.docType).toBe('RHP');
    expect(esds.detailUrl).toContain('esds-software-solution-limited-rhp_103893.html');
  });

  it('does NOT take the nested Abridged-Prospectus anchor as the row link', () => {
    // Each row's title embeds a second <a> for the abridged document. Taking the
    // first href inside the title would yield a SUMMARY, not the filing.
    for (const r of rows) {
      expect(r.detailUrl).not.toContain('commondocs');
      expect(r.detailUrl).not.toMatch(/Abridged/i);
      expect(r.companyName).not.toContain('<a');
      expect(r.companyName).not.toMatch(/Abridged/i);
    }
  });

  it('distinguishes an addendum/corrigendum row from a plain RHP row', () => {
    const molbio = rows.filter((r) => r.companyName.startsWith('Molbio'));
    expect(molbio.length).toBeGreaterThanOrEqual(2);
    expect(molbio.map((r) => r.docType)).toContain('ADDENDUM');
    expect(molbio.map((r) => r.docType)).toContain('RHP');
  });

  it('parses the DRHP listing (smid=10) as draft documents', () => {
    const draft = parseSebiListing(fixture('sebi-drhp-listing.html'));
    expect(draft.length).toBeGreaterThan(5);
    // Every row on this listing is a draft-offer document of some kind.
    expect(draft.some((r) => r.docType === 'DRHP')).toBe(true);
    expect(draft.some((r) => /DRHP/i.test(r.title))).toBe(true);
  });

  it('returns [] for a page with no listing table', () => {
    expect(parseSebiListing('<html><body>nope</body></html>')).toEqual([]);
    expect(parseSebiListing('')).toEqual([]);
  });
});

describe('matchSebiRow — fuzzy company matching at >= 0.85', () => {
  const rows = parseSebiListing(fixture('sebi-rhp-listing.html'));

  it('matches our stored name to SEBI\'s across suffix variance', () => {
    expect(SEBI_NAME_MATCH_THRESHOLD).toBe(0.85);
    expect(matchSebiRow(rows, 'ESDS Software Solution Limited', 'RHP')?.companyName).toBe(
      'ESDS Software Solution Limited'
    );
    expect(matchSebiRow(rows, 'ESDS Software Solution Ltd.', 'RHP')?.companyName).toBe(
      'ESDS Software Solution Limited'
    );
    expect(matchSebiRow(rows, 'Deepa Jewellers Ltd.', 'RHP')?.companyName).toBe(
      'Deepa Jewellers Limited'
    );
  });

  it('only matches rows of the WANTED type', () => {
    // Molbio has both an RHP row and an Addendum row on this listing.
    expect(matchSebiRow(rows, 'Molbio Diagnostics Limited', 'RHP')?.docType).toBe('RHP');
    expect(matchSebiRow(rows, 'Molbio Diagnostics Limited', 'ADDENDUM')?.docType).toBe('ADDENDUM');
    expect(matchSebiRow(rows, 'Molbio Diagnostics Limited', 'PROSPECTUS')).toBeNull();
  });

  it('matches Skyways, whose RHP SEBI does carry (case-insensitively)', () => {
    // Worth pinning: SEBI prints it "Skyways Air Services limited" (lower-case
    // 'limited'). The rung is genuinely usable for Skyways, so a test asserting
    // it is absent would have been asserting a convenient fiction.
    expect(matchSebiRow(rows, 'Skyways Air Services Ltd.', 'RHP')?.companyName).toBe(
      'Skyways Air Services limited'
    );
  });

  it('returns null for a company that is not listed, rather than a near miss', () => {
    expect(matchSebiRow(rows, 'Completely Unrelated Industries Limited', 'RHP')).toBeNull();
    expect(matchSebiRow(rows, '', 'RHP')).toBeNull();
    expect(matchSebiRow([], 'ESDS Software Solution Limited', 'RHP')).toBeNull();
  });

  it('refuses an AMBIGUOUS match rather than downloading the wrong prospectus', () => {
    const dupes = [
      { companyName: 'Acme Ltd', docType: 'RHP' as const, detailUrl: 'https://x/1', title: 'Acme Ltd - RHP' },
      { companyName: 'Acme Limited', docType: 'RHP' as const, detailUrl: 'https://x/2', title: 'Acme Limited - RHP' },
    ];
    expect(matchSebiRow(dupes, 'Acme Ltd.', 'RHP')).toBeNull();
  });
});

describe('parseSebiDetailPdfUrl — the filing, never the abridged copy', () => {
  it('extracts the attachdocs PDF from the real ESDS detail page', () => {
    const url = parseSebiDetailPdfUrl(fixture('sebi-detail-esds.html'));
    expect(url).toBe('https://www.sebi.gov.in/sebi_data/attachdocs/aug-2026/1787651434841.pdf');
  });

  it('REFUSES a commondocs (abridged) link — that is a summary, not the filing', () => {
    const html =
      '<a href="https://www.sebi.gov.in/sebi_data/commondocs/aug-2026/X%20-%20Abridged%20Prospectus_p.pdf">Abridged</a>';
    expect(parseSebiDetailPdfUrl(html)).toBeNull();
  });

  it('returns null when the page carries no PDF at all', () => {
    expect(parseSebiDetailPdfUrl('<html><body>no docs</body></html>')).toBeNull();
    expect(parseSebiDetailPdfUrl('')).toBeNull();
  });
});

describe('sebiListingUrlFor — SEBI only serves three types', () => {
  it('maps each served type to its verified listing', () => {
    expect(sebiListingUrlFor('DRHP')).toBe(SEBI_LISTINGS.DRHP);
    expect(sebiListingUrlFor('RHP')).toBe(SEBI_LISTINGS.RHP);
    expect(sebiListingUrlFor('PROSPECTUS')).toBe(SEBI_LISTINGS.PROSPECTUS);
    expect(SEBI_LISTINGS.DRHP).toContain('smid=10');
    expect(SEBI_LISTINGS.RHP).toContain('smid=11');
    expect(SEBI_LISTINGS.PROSPECTUS).toContain('smid=12');
  });

  it('returns null for types SEBI does not host, so the rung is not consulted', () => {
    for (const t of ['PRICE_BAND_AD', 'CORRIGENDUM', 'ADDENDUM', 'ANCHOR_ALLOCATION_REPORT'] as const) {
      expect(sebiListingUrlFor(t)).toBeNull();
    }
  });
});
