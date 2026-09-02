import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSebiListing,
  matchSebiRow,
  parseSebiDetailPdfUrl,
  sebiListingUrlFor,
  extractSebiSearchForm,
  fetchSebiListingRows,
  SEBI_LISTINGS,
  SEBI_BASE,
  SEBI_NAME_MATCH_THRESHOLD,
  type SebiFetcher,
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

// ---------------------------------------------------------------------------
// W-27 — search + paging beyond the newest-25 page 1 (`fetchSebiListingRows`)
// ---------------------------------------------------------------------------

const SEBI_FIXTURES = join(__dirname, '../../fixtures/sebi');
const sebiFixture = (n: string) => readFileSync(join(SEBI_FIXTURES, n), 'utf8');

const PAGE1_HTML = sebiFixture('sebi-drhp-page1-with-form.html');
const SEARCH_MATCH_HTML = sebiFixture('sebi-drhp-search-match.html');

/** A company on page 1 of the captured DRHP listing (no search needed). */
const PAGE1_COMPANY = 'Kataria Dhulchand Pannalal Jewellers Limited';
/** Not on page 1; found only via the search fixture (real 2026-09-02 capture). */
const SEARCH_ONLY_COMPANY = 'Deepa Jewellers Limited';

describe('extractSebiSearchForm — the POST recipe read off a live page', () => {
  it('reads the action (jsessionid preserved, ?doListing=yes appended) and every hidden/select field', () => {
    const form = extractSebiSearchForm(PAGE1_HTML);
    expect(form).not.toBeNull();
    expect(form!.actionUrl).toMatch(/^https:\/\/www\.sebi\.gov\.in\/sebiweb\/home\/HomeAction\.do;jsessionid=.*\?doListing=yes$/);
    expect(form!.fields.sid).toBe('3');
    expect(form!.fields.ssidhidden).toBe('15');
    expect(form!.fields.smidhidden).toBe('10');
    expect(form!.fields.sectName).toBe('Filings');
    expect(form!.fields.ssid).toBe('15');
    expect(form!.fields.smid).toBe('10');
  });

  it('returns null when the page carries no homeForm', () => {
    expect(extractSebiSearchForm('<html><body>no form</body></html>')).toBeNull();
    expect(extractSebiSearchForm('')).toBeNull();
  });
});

describe('fetchSebiListingRows — search then page beyond page 1', () => {
  it('(d) a match on page 1 returns immediately — zero extra requests', async () => {
    const calls: string[] = [];
    const fetchImpl: SebiFetcher = async (url) => {
      calls.push(url);
      return { status: 200, body: PAGE1_HTML };
    };

    const result = await fetchSebiListingRows('DRHP', { companyName: PAGE1_COMPANY, fetchImpl });

    expect(calls.length).toBe(1);
    expect(result.rungs).toEqual(['SEBI:page1']);
    expect(result.matched?.companyName).toBe(PAGE1_COMPANY);
  });

  it('(a) no match on page 1 triggers a search POST carrying the search term + the hidden form fields', async () => {
    const requests: { url: string; init: Parameters<SebiFetcher>[1] }[] = [];
    const fetchImpl: SebiFetcher = async (url, init) => {
      requests.push({ url, init });
      if (init.method === 'GET') return { status: 200, body: PAGE1_HTML };
      // No real search endpoint here — just prove the request shape.
      return { status: 200, body: PAGE1_HTML };
    };

    await fetchSebiListingRows('DRHP', { companyName: SEARCH_ONLY_COMPANY, fetchImpl });

    expect(requests.length).toBeGreaterThanOrEqual(2);
    const search = requests[1];
    expect(search.init.method).toBe('POST');
    expect(search.init.headers.Referer).toBe(SEBI_LISTINGS.DRHP);
    expect(search.init.headers.Origin).toBe(SEBI_BASE);
    expect(search.init.body).toContain('search=deepa+jewellers');
    expect(search.init.body).toContain('sid=3');
    expect(search.init.body).toContain('ssidhidden=15');
    expect(search.init.body).toContain('smidhidden=10');
  });

  it('(b) a search result carrying the match returns it without paging', async () => {
    const requests: string[] = [];
    const fetchImpl: SebiFetcher = async (url, init) => {
      requests.push(init.method);
      if (init.method === 'GET') return { status: 200, body: PAGE1_HTML };
      return { status: 200, body: SEARCH_MATCH_HTML };
    };

    const result = await fetchSebiListingRows('DRHP', { companyName: SEARCH_ONLY_COMPANY, fetchImpl });

    expect(requests).toEqual(['GET', 'POST']);
    expect(result.rungs).toEqual(['SEBI:page1', 'SEBI:searched']);
    expect(result.matched?.companyName).toBe(SEARCH_ONLY_COMPANY);
    expect(result.matched?.detailUrl).toContain('deepa-jewellers-limited');
  });

  it('(c) a search the site ignores pages up to maxPages then gives up with a clear note', async () => {
    let calls = 0;
    const fetchImpl: SebiFetcher = async () => {
      calls += 1;
      // Every request (GET, search POST, or a paged POST) answers with the
      // SAME no-match page — simulating a site that ignores the search term.
      return { status: 200, body: PAGE1_HTML };
    };

    const result = await fetchSebiListingRows('DRHP', {
      companyName: SEARCH_ONLY_COMPANY,
      fetchImpl,
      maxPages: 3,
    });

    // 1 GET (page 1) + 1 search POST + 3 paged POSTs = 5.
    expect(calls).toBe(5);
    expect(result.matched).toBeNull();
    expect(result.rungs).toEqual([
      'SEBI:page1',
      'SEBI:searched',
      'SEBI:paged:1',
      'SEBI:paged:2',
      'SEBI:paged:3',
      'SEBI:paged:exhausted',
    ]);
  });

  it('page 1 HTTP failure is recorded and never followed by a search attempt', async () => {
    const calls: string[] = [];
    const fetchImpl: SebiFetcher = async (url) => {
      calls.push(url);
      return { status: 503, body: '' };
    };

    const result = await fetchSebiListingRows('DRHP', { companyName: SEARCH_ONLY_COMPANY, fetchImpl });

    expect(calls.length).toBe(1);
    expect(result.rungs).toEqual(['SEBI:page1:http_error:503']);
    expect(result.matched).toBeNull();
  });

  it('a docType SEBI does not serve is skipped without any request', async () => {
    const fetchImpl: SebiFetcher = async () => {
      throw new Error('must not be called');
    };
    const result = await fetchSebiListingRows('PRICE_BAND_AD' as never, { fetchImpl });
    expect(result.rungs).toEqual(['SEBI:skipped:not_served_by_sebi']);
  });
});
