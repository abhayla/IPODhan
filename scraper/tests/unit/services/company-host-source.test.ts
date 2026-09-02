import { describe, it, expect } from 'vitest';
import {
  extractWebsiteFromCoverText,
  normalizeCompanyUrl,
  companyInvestorUrls,
  parseCompanyHostLinks,
  extractVerifierLinks,
  isTrustedDocumentHost,
  COMPANY_INVESTOR_PATHS,
  MAX_COMPANY_HOST_FETCHES,
} from '../../../src/services/company-host-source.js';

/**
 * T-403 G2 — the company-host rung and the Chittorgarh link verifier.
 */

describe('extractWebsiteFromCoverText — the issuer, not its bankers', () => {
  it('pulls the website off a filing cover in its usual shapes', () => {
    expect(extractWebsiteFromCoverText('Website: www.skywaysgroup.com')).toBe(
      'https://www.skywaysgroup.com'
    );
    expect(extractWebsiteFromCoverText('Website : https://esds.co.in/')).toBe('https://esds.co.in');
    expect(extractWebsiteFromCoverText('website- madhurknit.in ')).toBe('https://madhurknit.in');
  });

  it('REJECTS the intermediaries a cover also lists', () => {
    // A cover prints the BRLM's and the registrar's websites too. Following one
    // would crawl a merchant bank looking for an issuer's prospectus.
    const cover =
      'Book Running Lead Manager Website: www.holaniconsultants.co.in ' +
      'Registrar Website: www.bigshareonline.com';
    expect(extractWebsiteFromCoverText(cover)).toBeNull();
  });

  it('picks the ISSUER when the cover lists it alongside an intermediary', () => {
    const cover = 'Registrar Website: www.bigshareonline.com Company Website: www.skywaysgroup.com';
    expect(extractWebsiteFromCoverText(cover)).toBe('https://www.skywaysgroup.com');
  });

  it('returns null for empty or website-less text', () => {
    expect(extractWebsiteFromCoverText('')).toBeNull();
    expect(extractWebsiteFromCoverText('RED HERRING PROSPECTUS Dated August 11, 2026')).toBeNull();
  });
});

describe('normalizeCompanyUrl / companyInvestorUrls', () => {
  it('normalises a stored value to a fetchable origin', () => {
    expect(normalizeCompanyUrl('www.example.com')).toBe('https://www.example.com');
    expect(normalizeCompanyUrl('https://example.com/investors')).toBe('https://example.com');
    expect(normalizeCompanyUrl('')).toBeNull();
    expect(normalizeCompanyUrl('not-a-host')).toBeNull();
    expect(normalizeCompanyUrl('https://www.sebi.gov.in')).toBeNull();
  });

  it('tries at most three pages, in order (R12 — the cycle is not a crawler)', () => {
    const urls = companyInvestorUrls('https://example.com/');
    expect(urls).toEqual([
      'https://example.com/investors',
      'https://example.com/investor-relations',
      'https://example.com/ipo',
    ]);
    expect(urls).toHaveLength(MAX_COMPANY_HOST_FETCHES);
    expect(COMPANY_INVESTOR_PATHS).toHaveLength(3);
  });
});

describe('parseCompanyHostLinks — only classifiable filings', () => {
  const page = `
    <html><body>
      <a href="/docs/RHP_Skyways.pdf">Red Herring Prospectus</a>
      <a href="https://example.com/docs/annual-report-2025.pdf">Annual Report 2025</a>
      <a href="/docs/csr-policy.pdf">CSR Policy</a>
      <a href="/docs/corrigendum.pdf">Corrigendum to RHP</a>
      <a href="/about">About us</a>
    </body></html>`;

  it('keeps the filings and drops the governance noise', () => {
    const links = parseCompanyHostLinks(page, 'https://example.com/investors');
    const types = links.map((l) => l.docType);
    expect(types).toContain('RHP');
    expect(types).toContain('CORRIGENDUM');
    // An investor page is mostly annual reports and policies; storing those as
    // filings would be worse than finding nothing.
    expect(links.some((l) => l.url.includes('annual-report'))).toBe(false);
    expect(links.some((l) => l.url.includes('csr-policy'))).toBe(false);
    expect(links.some((l) => l.url.endsWith('/about'))).toBe(false);
  });

  it('resolves relative hrefs against the page they came from', () => {
    const links = parseCompanyHostLinks(page, 'https://example.com/investors');
    expect(links.find((l) => l.docType === 'RHP')!.url).toBe('https://example.com/docs/RHP_Skyways.pdf');
  });

  it('classifies by ANCHOR TEXT when the file name says nothing', () => {
    const links = parseCompanyHostLinks(
      '<a href="/f/12345.pdf">Price Band Advertisement</a>',
      'https://example.com/ipo'
    );
    expect(links).toHaveLength(1);
    expect(links[0].docType).toBe('PRICE_BAND_AD');
  });

  it('returns [] for junk input', () => {
    expect(parseCompanyHostLinks('', 'https://x')).toEqual([]);
    expect(parseCompanyHostLinks('<html></html>', 'https://x')).toEqual([]);
  });
});

describe('Chittorgarh is a VERIFIER, never a source', () => {
  const chittorgarh = `
    <html><body>
      <a href="https://www.chittorgarh.com/files/skyways_rhp.pdf">Skyways RHP (our copy)</a>
      <a href="https://nsearchives.nseindia.com/content/ipo/RHP_SKYWAYS.zip">RHP</a>
      <a href="https://listing.bseindia.com/Download/PreAnchor/RHPSkyways_1.pdf">Red Herring Prospectus</a>
    </body></html>`;

  it('NEVER returns a link on Chittorgarh\'s own host', () => {
    const links = extractVerifierLinks(chittorgarh, 'https://www.chittorgarh.com/ipo/x/1/', []);
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((l) => l.url.includes('chittorgarh.com'))).toBe(false);
  });

  it('returns only exchange/SEBI links we have NOT already tried', () => {
    const tried = ['https://nsearchives.nseindia.com/content/ipo/RHP_SKYWAYS.zip'];
    const links = extractVerifierLinks(chittorgarh, 'https://www.chittorgarh.com/ipo/x/1/', tried);
    expect(links.map((l) => l.url)).toEqual([
      'https://listing.bseindia.com/Download/PreAnchor/RHPSkyways_1.pdf',
    ]);
  });

  it('returns [] when every exchange link was already tried', () => {
    const tried = [
      'https://nsearchives.nseindia.com/content/ipo/RHP_SKYWAYS.zip',
      'https://listing.bseindia.com/Download/PreAnchor/RHPSkyways_1.pdf',
    ];
    expect(extractVerifierLinks(chittorgarh, 'https://www.chittorgarh.com/ipo/x/1/', tried)).toEqual([]);
  });

  it('isTrustedDocumentHost admits only the exchanges and SEBI', () => {
    expect(isTrustedDocumentHost('https://nsearchives.nseindia.com/a.zip')).toBe(true);
    expect(isTrustedDocumentHost('https://listing.bseindia.com/a.pdf')).toBe(true);
    expect(isTrustedDocumentHost('https://www.sebi.gov.in/sebi_data/attachdocs/a.pdf')).toBe(true);
    expect(isTrustedDocumentHost('https://www.chittorgarh.com/a.pdf')).toBe(false);
    expect(isTrustedDocumentHost('https://example.com/a.pdf')).toBe(false);
    expect(isTrustedDocumentHost('not a url')).toBe(false);
  });
});
