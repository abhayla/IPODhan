import { describe, it, expect } from 'vitest';
import {
  parseNSEDocuments,
  parseBSEDocuments,
  parseSEBIDrhpListing,
  looksLikePdf,
  extractPdfFromZipBuffer,
  type DiscoveredDocument,
} from '../../../src/services/primary-source-discovery.js';

/**
 * Stage B (2026-06-19 pipeline contract) — pure, no-network document discovery.
 * These parsers take an ALREADY-FETCHED payload/HTML and return DiscoveredDocuments.
 * Fetching is deferred to a later (network) session; nothing here touches the wire.
 *
 * Fixtures are derived from the REAL shapes:
 *  - NSE issueInfo.dataList rows: {title, value} — see nse-api-client.ts:653-767
 *  - BSE detail row fields (Prospectus_GID etc.) — see C-1 research + bse-api-scraper.ts BSEDetailRow
 *  - SEBI server-rendered table#sample_1 — see C-1 (selector is table#sample_1, NOT table.table-data)
 */

describe('parseNSEDocuments', () => {
  const symbol = 'ACMECORP';

  it('maps Red Herring Prospectus + Anchor + Ratios rows to the right doc types and uses the row value as the url', () => {
    const issueInfo = {
      dataList: [
        { title: 'Red Herring Prospectus', value: 'https://nsearchives.nseindia.com/content/ipo/RHP_ACMECORP.zip' },
        { title: 'Anchor Allocation Report', value: 'https://nsearchives.nseindia.com/content/ipo/ANCHOR_ACMECORP.zip' },
        { title: 'Ratios and Basis of Issue Price', value: 'https://nsearchives.nseindia.com/content/ipo/RATIOS_ACMECORP.zip' },
        { title: 'Bidding Centers', value: 'https://nsearchives.nseindia.com/content/ipo/BIDDING_ACMECORP.zip' },
      ],
    };

    const docs = parseNSEDocuments(issueInfo, symbol);

    const rhp = docs.find((d) => d.type === 'RHP');
    const anchor = docs.find((d) => d.type === 'ANCHOR_ALLOCATION_REPORT');
    const ratios = docs.find((d) => d.type === 'RATIOS_BASIS_ISSUE_PRICE');
    const bidding = docs.find((d) => d.type === 'BIDDING_CENTERS');

    expect(rhp).toBeDefined();
    expect(rhp!.url).toBe('https://nsearchives.nseindia.com/content/ipo/RHP_ACMECORP.zip');
    expect(rhp!.source).toBe('NSE');

    expect(anchor).toBeDefined();
    expect(anchor!.url).toBe('https://nsearchives.nseindia.com/content/ipo/ANCHOR_ACMECORP.zip');

    expect(ratios).toBeDefined();
    expect(bidding).toBeDefined();
    // never invents an ANCHOR enum value
    expect(docs.every((d) => d.type !== ('ANCHOR' as unknown as DiscoveredDocument['type']))).toBe(true);
  });

  it('returns [] for missing/empty dataList', () => {
    expect(parseNSEDocuments(null, symbol)).toEqual([]);
    expect(parseNSEDocuments(undefined, symbol)).toEqual([]);
    expect(parseNSEDocuments({}, symbol)).toEqual([]);
    expect(parseNSEDocuments({ dataList: [] }, symbol)).toEqual([]);
    expect(parseNSEDocuments({ dataList: null }, symbol)).toEqual([]);
  });

  it('ignores rows whose value is not a document URL (non-http, or no doc/zip/pdf extension)', () => {
    const issueInfo = {
      dataList: [
        // a doc-typed title but a non-URL value (e.g. "Available" text) → ignored
        { title: 'Red Herring Prospectus', value: 'Available on exchange website' },
        // a doc-typed title pointing at an html page (not a document) → ignored
        { title: 'Anchor Allocation Report', value: 'https://www.nseindia.com/ipo-detail?symbol=ACMECORP' },
        // a non-doc title with a pdf value → ignored (not a tracked doc type)
        { title: 'Tick Size', value: 'https://nsearchives.nseindia.com/x/tick.pdf' },
      ],
    };
    expect(parseNSEDocuments(issueInfo, symbol)).toEqual([]);
  });

  it('accepts a .pdf value as well as .zip', () => {
    const issueInfo = {
      dataList: [
        { title: 'Red Herring Prospectus', value: 'https://nsearchives.nseindia.com/content/ipo/RHP_ACMECORP.pdf' },
      ],
    };
    const docs = parseNSEDocuments(issueInfo, symbol);
    expect(docs).toHaveLength(1);
    expect(docs[0].type).toBe('RHP');
    expect(docs[0].url.endsWith('.pdf')).toBe(true);
  });

  it('classifies the "Security Parameters Pre/Post-Anchor" rows correctly (the substring "Anchor" must NOT make them anchor-allocation docs)', () => {
    const issueInfo = {
      dataList: [
        { title: 'Security Parameters Pre-Anchor', value: 'https://nsearchives.nseindia.com/content/ipo/PREANCHOR_X.zip' },
        { title: 'Security Parameters Post-Anchor', value: 'https://nsearchives.nseindia.com/content/ipo/POSTANCHOR_X.zip' },
        { title: 'Anchor Allocation Report', value: 'https://nsearchives.nseindia.com/content/ipo/ANCHOR_X.zip' },
      ],
    };
    const docs = parseNSEDocuments(issueInfo, 'X');
    expect(docs.find((d) => d.url.includes('PREANCHOR'))!.type).toBe('SECURITY_PARAMS_PRE_ANCHOR');
    expect(docs.find((d) => d.url.includes('POSTANCHOR'))!.type).toBe('SECURITY_PARAMS_POST_ANCHOR');
    expect(docs.find((d) => d.url.includes('/ANCHOR_X'))!.type).toBe('ANCHOR_ALLOCATION_REPORT');
    expect(docs.filter((d) => d.type === 'ANCHOR_ALLOCATION_REPORT')).toHaveLength(1);
  });

  it('is tolerant of rows missing title or value', () => {
    const issueInfo = {
      dataList: [
        { value: 'https://nsearchives.nseindia.com/content/ipo/RHP_X.zip' }, // no title
        { title: 'Red Herring Prospectus' }, // no value
        null,
        'garbage',
      ],
    };
    expect(parseNSEDocuments(issueInfo, symbol)).toEqual([]);
  });
});

describe('parseBSEDocuments', () => {
  it('maps pre-resolved Prospectus_GID (RHP) + Addendum + Corrigendum + Price_Band_Advertisement to docs', () => {
    const detailRow = {
      Prospectus_GID: 'https://www.bseindia.com/downloads/ipo/RHP_500001.pdf',
      Addendum: 'https://www.bseindia.com/downloads/ipo/ADD_500001.pdf',
      Corrigendum: 'https://www.bseindia.com/downloads/ipo/COR_500001.pdf',
      Price_Band_Advertisement: 'https://www.bseindia.com/downloads/ipo/PBA_500001.pdf',
    };

    const docs = parseBSEDocuments(detailRow);

    const rhp = docs.find((d) => d.url.includes('RHP_500001'));
    expect(rhp).toBeDefined();
    expect(rhp!.type).toBe('RHP');
    expect(rhp!.source).toBe('BSE');

    // Addendum/Corrigendum/Price-band-advertisement all map to ADDENDUM (revision/supersede class)
    const addendumish = docs.filter((d) => d.type === 'ADDENDUM');
    expect(addendumish.length).toBe(3);
    expect(docs.every((d) => d.source === 'BSE')).toBe(true);
  });

  it('returns [] when the detail row carries no document fields', () => {
    expect(parseBSEDocuments({})).toEqual([]);
    expect(parseBSEDocuments(null)).toEqual([]);
    expect(parseBSEDocuments({ Price_Band: '120.00-127.00', Market_Lot: '1000' })).toEqual([]);
  });

  it('ignores document fields that are empty or not a resolvable URL (no GID→URL invention)', () => {
    const detailRow = {
      Prospectus_GID: '', // empty
      Addendum: '-', // placeholder
      Corrigendum: '12345', // a bare GID, NOT a URL → DEFERRED (not invented into a URL)
    };
    expect(parseBSEDocuments(detailRow)).toEqual([]);
  });
});

describe('parseSEBIDrhpListing', () => {
  it('extracts detail hrefs + titles from table#sample_1 rows', () => {
    const html = `
      <html><body>
        <table id="sample_1">
          <thead><tr><th>Sr</th><th>Company</th><th>Date</th></tr></thead>
          <tbody>
            <tr>
              <td>1</td>
              <td><a href="/filings/public-issues/drhp-acme-corp-12345.html">Acme Corp Limited</a></td>
              <td>10 Jun 2026</td>
            </tr>
            <tr>
              <td>2</td>
              <td><a href="https://www.sebi.gov.in/filings/widget-industries-67890.html">Widget Industries Ltd</a></td>
              <td>09 Jun 2026</td>
            </tr>
          </tbody>
        </table>
      </body></html>`;

    const rows = parseSEBIDrhpListing(html);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('Acme Corp Limited');
    expect(rows[0].detailHref).toBe('/filings/public-issues/drhp-acme-corp-12345.html');
    expect(rows[1].title).toBe('Widget Industries Ltd');
    expect(rows[1].detailHref).toBe('https://www.sebi.gov.in/filings/widget-industries-67890.html');
  });

  it('returns [] when table#sample_1 is absent (e.g. the dead otherListingAction selector)', () => {
    const htmlNoTable = '<html><body><table class="table-data"><tr><td>x</td></tr></table></body></html>';
    expect(parseSEBIDrhpListing(htmlNoTable)).toEqual([]);
    expect(parseSEBIDrhpListing('')).toEqual([]);
    expect(parseSEBIDrhpListing('<html></html>')).toEqual([]);
  });

  it('skips sample_1 rows that have no anchor href', () => {
    const html = `
      <table id="sample_1"><tbody>
        <tr><td>1</td><td>No link company</td><td>x</td></tr>
        <tr><td>2</td><td><a href="/ok.html">Linked Co</a></td><td>x</td></tr>
      </tbody></table>`;
    const rows = parseSEBIDrhpListing(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Linked Co');
  });
});

describe('looksLikePdf', () => {
  it('returns true for a buffer starting with the %PDF magic bytes', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n...rest of pdf...'))).toBe(true);
  });

  it('returns false for a zip buffer (PK magic) or arbitrary bytes', () => {
    expect(looksLikePdf(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(false); // PK..
    expect(looksLikePdf(Buffer.from('<html>not a pdf</html>'))).toBe(false);
  });

  it('returns false for empty / too-short / non-buffer input', () => {
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
    expect(looksLikePdf(Buffer.from('%PD'))).toBe(false);
    expect(looksLikePdf(null as unknown as Buffer)).toBe(false);
  });
});

describe('extractPdfFromZipBuffer (DEFERRED — no unzip dep)', () => {
  it('returns null until an unzip dependency is added (network session)', () => {
    // No adm-zip/jszip/unzipper dep exists in scraper/package.json. The .zip→%PDF
    // unzip step is DEFERRED to the network session that adds the dependency.
    // The function exists (stable signature) but is a documented no-op for now.
    const fakeZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]);
    expect(extractPdfFromZipBuffer(fakeZip)).toBeNull();
    expect(extractPdfFromZipBuffer(Buffer.alloc(0))).toBeNull();
  });
});
