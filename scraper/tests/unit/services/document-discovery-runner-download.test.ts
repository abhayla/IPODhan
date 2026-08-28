import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  DOWNLOAD_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';

/**
 * T-403 round 1, M1 and M4. These exercise the DOWNLOAD path end-to-end through
 * the runner — the layer where both defects lived:
 *
 *  M1: the runner passed `expectedCompanyName` to the verifier but never an
 *      extractor, so the cover-page company check silently never ran and F8
 *      (storing another company's filing) was unguarded. A unit test on the
 *      verifier alone could not have caught it.
 *  M4: (a) the download request must get the 120s budget, not the 20s API one —
 *      the live run timed the Skyways RHP out at exactly 20,018 ms; and (b) when
 *      the BSE copy fails verification the NSE copy must be tried in the SAME
 *      cycle (matrix F2).
 */

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const json = (text: string): HttpResponse => ({
  status: 200,
  contentType: 'application/json',
  body: Buffer.from(text),
  url: 'https://fixture',
});

/** A >50 KB buffer starting with the %PDF magic. */
const realisticPdf = (marker = 'A') =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(marker.repeat(80_000))]);

const pdfResponse = (body: Buffer, url = 'https://x/doc.pdf'): HttpResponse => ({
  status: 200,
  contentType: 'application/pdf',
  body,
  url,
});

/** Single-member STORED zip, so the NSE branch is exercised as it really is. */
function makeZip(name: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'latin1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localPart = Buffer.concat([local, nameBuf, content]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

const SKYWAYS: DiscoveryIpo = {
  id: 'ipo-skyways',
  companyName: 'Skyways Air Services Ltd.',
  symbol: 'SKYWAYS',
  segment: 'MAINBOARD',
  stage: 'PRE_OPEN',
  bseIpoNo: 7903,
};

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-runner-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

interface Harness {
  responses: Record<string, HttpResponse>;
  coverText?: { usable: boolean; text?: string };
}

function makeRunner(h: Harness) {
  const seen: { url: string; timeoutMs: number }[] = [];
  const fetcher: HttpFetcher = async (url, init) => {
    seen.push({ url, timeoutMs: init.timeoutMs });
    for (const [needle, response] of Object.entries(h.responses)) {
      if (url.includes(needle)) return response;
    }
    if (url.includes('GetMkt_ISSUE_BBS_IPO')) return json(fixture('bse-skyways-core.json'));
    if (url.includes('symbol=SKYWAYS')) return json(fixture('nse-skyways.json'));
    return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
  };

  const store = new InMemoryDocumentFetchStateStore();
  const documents = {
    rows: [] as { type: string; exchange: string }[],
    async upsertDocument(doc: { type: string; exchange: string }) {
      this.rows.push(doc);
      return { id: 'doc-' + this.rows.length };
    },
  };

  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store,
    documents: documents as never,
    counter: new NetworkCounter(),
    now: () => new Date('2026-08-28T06:00:00Z'),
    storeDir,
    extractCoverText: async () =>
      h.coverText ?? { usable: true, text: 'SKYWAYS AIR SERVICES LIMITED' },
  });
  return { runner, store, documents, seen };
}

describe('M1 — the cover-page company check actually runs in the runner path', () => {
  it('REJECTS a PDF whose cover names a different company (F8)', async () => {
    const { runner } = makeRunner({
      responses: { '.pdf': pdfResponse(realisticPdf()), '.zip': pdfResponse(realisticPdf()) },
      coverText: { usable: true, text: 'RED HERRING PROSPECTUS Madhur Knit Crafts Limited' },
    });

    const result = await runner.runIpo(SKYWAYS, []);

    expect(result.found).toEqual([]);
    expect(result.blocked.length).toBeGreaterThan(0);
    expect(
      result.attempts.some((a) => String(a.outcome).includes('rejected:wrong_company'))
    ).toBe(true);
  }, 60_000);

  it('ACCEPTS a matching cover and records cover_check: passed', async () => {
    const { runner } = makeRunner({
      responses: { '.pdf': pdfResponse(realisticPdf()), '.zip': pdfResponse(realisticPdf()) },
      coverText: { usable: true, text: 'SKYWAYS AIR SERVICES LIMITED red herring prospectus' },
    });

    const result = await runner.runIpo(SKYWAYS, []);

    expect(result.found.length).toBeGreaterThan(0);
    expect(result.attempts.some((a) => String(a.outcome).includes('cover_check: passed'))).toBe(true);
  }, 60_000);

  it('SKIPS the check VISIBLY when the PDF has no usable text layer (E4)', async () => {
    // A font-subsetted newspaper ad. Skipping is correct; rejecting would throw
    // away a legitimate filing. The skip must be visible, not look like a pass.
    const { runner } = makeRunner({
      responses: { '.pdf': pdfResponse(realisticPdf()), '.zip': pdfResponse(realisticPdf()) },
      coverText: { usable: false },
    });

    const result = await runner.runIpo(SKYWAYS, []);

    expect(result.found.length).toBeGreaterThan(0);
    expect(
      result.attempts.some((a) => String(a.outcome).includes('cover_check: skipped_no_text_layer'))
    ).toBe(true);
  }, 60_000);
});

describe('M4a — the download gets the DOWNLOAD budget, not the API budget', () => {
  it('passes DOWNLOAD_TIMEOUT_MS to document requests and FETCH_TIMEOUT_MS to API requests', async () => {
    // The live run timed the 47 MB Skyways RHP out at exactly 20,018 ms because
    // one budget covered a 6 KB JSON payload and a 25 MB PDF. Dropping the
    // timeout argument must fail this test.
    expect(DOWNLOAD_TIMEOUT_MS).toBe(120_000);
    expect(FETCH_TIMEOUT_MS).toBe(20_000);

    const { runner, seen } = makeRunner({
      responses: { '.pdf': pdfResponse(realisticPdf()), '.zip': pdfResponse(realisticPdf()) },
    });
    await runner.runIpo(SKYWAYS, []);

    const apiCalls = seen.filter(
      (c) => c.url.includes('BseIndiaAPI') || c.url.includes('/api/ipo-detail')
    );
    const downloads = seen.filter((c) => /\.(pdf|zip)/i.test(c.url));

    expect(apiCalls.length).toBeGreaterThan(0);
    expect(downloads.length).toBeGreaterThan(0);
    expect(apiCalls.every((c) => c.timeoutMs === FETCH_TIMEOUT_MS)).toBe(true);
    expect(downloads.every((c) => c.timeoutMs === DOWNLOAD_TIMEOUT_MS)).toBe(true);
  }, 60_000);
});

describe('M4b — F2: a failed BSE download falls through to the NSE copy in the SAME cycle', () => {
  it('stores the NSE zip copy when the BSE PDF fails verification', async () => {
    const nsePdf = realisticPdf('N');
    const { runner, documents } = makeRunner({
      responses: {
        // BSE serves its not-found HTML page at 200 — the real failure shape.
        'listing.bseindia.com': {
          status: 200,
          contentType: 'text/html; charset=UTF-8',
          body: Buffer.from(
            '<head><title>Document Moved</title></head><body><h1>Object Moved</h1></body>'
          ),
          url: 'https://listing.bseindia.com/Download//PreAnchor/RHPSkyways.pdf',
        },
        'RHP_SKYWAYS.zip': {
          status: 200,
          contentType: 'application/zip',
          body: makeZip('RHP_SKYWAYS/RHP Skyways.pdf', nsePdf),
          url: 'https://nsearchives.nseindia.com/content/ipo/RHP_SKYWAYS.zip',
        },
        '.zip': pdfResponse(realisticPdf('Z'), 'https://x/other.zip'),
      },
    });

    const result = await runner.runIpo(SKYWAYS, []);

    // The RHP is FOUND despite BSE failing, and it came from NSE.
    expect(result.found).toContain('RHP');
    const rhpRow = documents.rows.find((d) => d.type === 'RHP');
    expect(rhpRow?.exchange).toBe('NSE');

    const rhpAttempts = result.attempts.filter((a) =>
      /RHPSkyways|RHP_SKYWAYS/i.test(a.url ?? '')
    );
    expect(rhpAttempts.some((a) => String(a.outcome).startsWith('rejected:html_body'))).toBe(true);
    expect(rhpAttempts.some((a) => String(a.outcome).startsWith('downloaded'))).toBe(true);
  }, 60_000);
});

describe('M4c — F2 rescue when BSE covered EVERY due type and its download fails', () => {
  it('consults NSE on demand for that type instead of going BLOCKED_ALL', async () => {
    // The residual gap round 1 left open and documented: NSE was fetched only
    // when BSE had left a due type without a link. So if BSE supplied every link
    // and one of those downloads failed, the NSE copy was never consulted and
    // the type went BLOCKED_ALL — which matrix F2 explicitly forbids.
    //
    // Setup: every PRE_OPEN type is already FOUND except the RHP, so the RHP is
    // the ONLY due type. BSE has a link for it, so the cheap path does not
    // pre-fetch NSE. The BSE download then fails.
    const done = (docType: string) => ({
      docType,
      state: 'FOUND' as const,
      attempts: 1,
      nextRetryAt: null,
      blockedSinceAt: null,
      filingDate: null,
      extractorVersion: null,
      lastAttemptAt: null,
    });
    const existing = [
      done('DRHP'),
      done('PRICE_BAND_AD'),
      done('CORRIGENDUM'),
      done('RATIOS_BASIS_ISSUE_PRICE'),
      done('ANCHOR_ALLOCATION_REPORT'),
    ];

    const nsePdf = realisticPdf('N');
    const { runner, seen, documents } = makeRunner({
      responses: {
        'listing.bseindia.com': {
          status: 200,
          contentType: 'text/html; charset=UTF-8',
          body: Buffer.from('<html><body><h1>Object Moved</h1></body></html>'),
          url: 'https://listing.bseindia.com/Download//PreAnchor/RHPSkyways.pdf',
        },
        'RHP_SKYWAYS.zip': {
          status: 200,
          contentType: 'application/zip',
          body: makeZip('RHP_SKYWAYS/RHP Skyways.pdf', nsePdf),
          url: 'https://nsearchives.nseindia.com/content/ipo/RHP_SKYWAYS.zip',
        },
      },
    });

    const result = await runner.runIpo(SKYWAYS, existing as never);

    expect(result.due).toEqual(['RHP']);
    // The RHP is FOUND from NSE, not BLOCKED_ALL.
    expect(result.found).toEqual(['RHP']);
    expect(result.blocked).toEqual([]);
    expect(documents.rows.find((d) => d.type === 'RHP')?.exchange).toBe('NSE');

    // And NSE was consulted only AFTER the BSE download failed — proving this is
    // the on-demand rescue and not the cheap pre-fetch path.
    const bseDownloadIdx = seen.findIndex((c) => c.url.includes('listing.bseindia.com'));
    const nseApiIdx = seen.findIndex((c) => c.url.includes('/api/ipo-detail'));
    expect(bseDownloadIdx).toBeGreaterThanOrEqual(0);
    expect(nseApiIdx).toBeGreaterThan(bseDownloadIdx);
  }, 60_000);
});
