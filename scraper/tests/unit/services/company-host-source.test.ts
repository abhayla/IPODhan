// implements: R-160

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractWebsiteFromCoverText,
  normalizeCompanyUrl,
  companyInvestorUrls,
  parseCompanyHostLinks,
  extractVerifierLinks,
  isTrustedDocumentHost,
  isResolvedAddressPrivate,
  loadRegistrarDocumentHosts,
  resetRegistrarDocumentHostsCache,
  COMPANY_INVESTOR_PATHS,
  MAX_COMPANY_HOST_FETCHES,
} from '../../../src/services/company-host-source.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';

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

  it('isTrustedDocumentHost admits an injected registrar host, not a stranger', () => {
    const registrarHosts = new Set(['linkintime.co.in']);
    expect(isTrustedDocumentHost('https://linkintime.co.in/ipo/allotment.pdf', registrarHosts)).toBe(
      true
    );
    expect(
      isTrustedDocumentHost('https://sub.linkintime.co.in/ipo/allotment.pdf', registrarHosts)
    ).toBe(true);
    expect(isTrustedDocumentHost('https://example.com/a.pdf', registrarHosts)).toBe(false);
    // Exchanges still admitted even with a registrar set injected.
    expect(
      isTrustedDocumentHost('https://nsearchives.nseindia.com/a.zip', registrarHosts)
    ).toBe(true);
  });
});

describe('isResolvedAddressPrivate — DNS-rebinding-safe host refusal (item 22, OD-37)', () => {
  beforeEach(() => {
    vi.mocked(lookup).mockReset();
  });

  it('refuses a public-looking name that resolves to a private IPv4 address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    expect(await isResolvedAddressPrivate('public-looking.example')).toBe(true);
  });

  it('checks EVERY resolved address, not just the first (all: true)', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as never);
    expect(await isResolvedAddressPrivate('mixed.example')).toBe(true);
    expect(lookup).toHaveBeenCalledWith('mixed.example', { all: true });
  });

  it('admits a name that resolves only to public addresses', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    expect(await isResolvedAddressPrivate('public.example')).toBe(false);
  });

  it('refuses an IPv6 unique-local resolution (fc00::/7)', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: 'fd12:3456:789a:1::1', family: 6 },
    ] as never);
    expect(await isResolvedAddressPrivate('unique-local.example')).toBe(true);
  });

  it('refuses an IPv6 link-local resolution (fe80::/10)', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: 'fe80::1', family: 6 }] as never);
    expect(await isResolvedAddressPrivate('link-local.example')).toBe(true);
  });

  it('admits a public IPv6 resolution', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '2606:4700:4700::1111', family: 6 },
    ] as never);
    expect(await isResolvedAddressPrivate('public-v6.example')).toBe(false);
  });

  it('FAILS CLOSED — a lookup that throws is refused, not allowed', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
    expect(await isResolvedAddressPrivate('unresolvable.example')).toBe(true);
  });
});

describe('loadRegistrarDocumentHosts — registrar hosts as data, cached per cycle', () => {
  beforeEach(() => {
    resetRegistrarDocumentHostsCache();
  });

  function mockDb(rows: Array<{ website: string | null }>) {
    return {
      select: () => ({
        from: () => ({
          where: async () => rows,
        }),
      }),
    } as never;
  }

  it('excludes a non-http(s) website', async () => {
    const hosts = await loadRegistrarDocumentHosts(
      mockDb([{ website: 'ftp://linkintime.co.in' }])
    );
    expect(hosts.size).toBe(0);
  });

  it('excludes a non-http(s) scheme even when it would otherwise parse to a real-looking host', async () => {
    // "mailto:x@host" naively prepended with "https://" parses to a valid
    // https URL whose hostname is the real host (the scheme+user become
    // userinfo) — this is the actual class of value the protocol check
    // must catch, not just a scheme that fails to parse at all.
    resetRegistrarDocumentHostsCache();
    const hosts = await loadRegistrarDocumentHosts(
      mockDb([{ website: 'mailto:helpdesk@linkintime.co.in' }])
    );
    expect(hosts.size).toBe(0);
  });

  it('excludes a private-string host', async () => {
    resetRegistrarDocumentHostsCache();
    const hosts = await loadRegistrarDocumentHosts(mockDb([{ website: 'http://10.0.0.5' }]));
    expect(hosts.size).toBe(0);
  });

  it('includes a well-formed registrar website', async () => {
    resetRegistrarDocumentHostsCache();
    const hosts = await loadRegistrarDocumentHosts(
      mockDb([{ website: 'https://linkintime.co.in' }])
    );
    expect(hosts.has('linkintime.co.in')).toBe(true);
  });

  it('refreshes on the next cycle rather than serving the first cycle forever', async () => {
    resetRegistrarDocumentHostsCache();
    const first = await loadRegistrarDocumentHosts(
      mockDb([{ website: 'https://linkintime.co.in' }])
    );
    expect(first.has('linkintime.co.in')).toBe(true);

    // Same cache, no reset — a second registrar added mid-cycle must NOT
    // appear yet (still serving the cached set).
    const stillCached = await loadRegistrarDocumentHosts(
      mockDb([{ website: 'https://bigshareonline.com' }])
    );
    expect(stillCached.has('linkintime.co.in')).toBe(true);
    expect(stillCached.has('bigshareonline.com')).toBe(false);

    // New cycle: reset, then the new DB state is read fresh.
    resetRegistrarDocumentHostsCache();
    const secondCycle = await loadRegistrarDocumentHosts(
      mockDb([{ website: 'https://bigshareonline.com' }])
    );
    expect(secondCycle.has('bigshareonline.com')).toBe(true);
    expect(secondCycle.has('linkintime.co.in')).toBe(false);
  });
});
