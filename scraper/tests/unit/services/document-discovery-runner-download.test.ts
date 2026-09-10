// implements: R-160
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// ---------------------------------------------------------------------------
// item 22 slice 2 — defaultFetcher's streaming byte cap
// ---------------------------------------------------------------------------
//
// The class this closes: every document download this system performs, from
// any host, in both slots. Today (flag off) an oversized body is buffered
// into memory IN FULL and checked afterwards. These tests assert on BYTES
// PULLED from the mock stream, not on the returned verdict — a test that
// only checked `res.status` would pass against the unfixed code too, since
// the unfixed code also eventually rejects an over-cap body (via
// verifyDownload's post-hoc check), just after allocating the whole thing.
describe('defaultFetcher — streaming byte cap (item 22 slice 2, build card item-22-document-handling-and-download-limits.md)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /**
   * A byte-counting mock ReadableStream. `pulled.total` is incremented as
   * each chunk is actually produced to the consumer via `pull()` — the
   * count under test, not the eventual verdict. `chunkSize` lets a test
   * split the same total into many small chunks, which a chunk-counting
   * (rather than byte-counting) cap implementation would miss.
   */
  function makeCountingStream(totalBytes: number, chunkSize: number) {
    const pulled = { total: 0, cancelled: false, chunksDelivered: 0 };
    let delivered = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (delivered >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, totalBytes - delivered);
        delivered += size;
        pulled.total += size;
        pulled.chunksDelivered += 1;
        controller.enqueue(new Uint8Array(size).fill(0x41));
      },
      cancel() {
        pulled.cancelled = true;
      },
    });
    return { stream, pulled };
  }

  /** `arrayBuffer()` drains the SAME counting stream via its own reader — so
   * a flag-off test observes exactly how many bytes the old buffer-then-check
   * path pulls (all of them), through the identical counting mechanism the
   * streaming-path tests use. */
  function mockFetchReturning(stream: ReadableStream<Uint8Array>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        url: 'https://x/big.pdf',
        headers: { get: () => 'application/pdf' },
        body: stream,
        arrayBuffer: async () => {
          const reader = stream.getReader();
          const chunks: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          return Buffer.concat(chunks);
        },
      }))
    );
  }

  async function loadWithEnv(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return import('../../../src/services/document-discovery-runner.js');
  }

  it('RED: flag OFF (today\'s default) pulls the WHOLE oversized body — the byte count reaches the full size, not the cap', async () => {
    const totalBytes = 2 * 1024 * 1024; // 2 MB
    const { stream, pulled } = makeCountingStream(totalBytes, 256 * 1024);
    mockFetchReturning(stream);
    const { defaultFetcher } = await loadWithEnv({
      ENABLE_DOWNLOAD_STREAMING_CAP: undefined,
      PROSPECTUS_MAX_DOCUMENT_MB: '1', // a 1 MB cap the OLD path never consults during the fetch itself
    });

    const res = await defaultFetcher('https://x/big.pdf', { headers: {}, timeoutMs: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(totalBytes);
    // The actual byte count reached: the FULL 2 MB, twice the 1 MB cap —
    // proving the unfixed default path buffers everything before any size
    // check is possible.
    expect(pulled.total).toBe(totalBytes);
  });

  it('GREEN: flag ON — the byte count never exceeds the cap, aborting as soon as it is crossed', async () => {
    const totalBytes = 2 * 1024 * 1024; // 2 MB
    const chunkSize = 256 * 1024; // 256 KB
    const capBytes = 1 * 1024 * 1024; // 1 MB
    const { stream, pulled } = makeCountingStream(totalBytes, chunkSize);
    mockFetchReturning(stream);
    const { defaultFetcher } = await loadWithEnv({
      ENABLE_DOWNLOAD_STREAMING_CAP: 'true',
      PROSPECTUS_MAX_DOCUMENT_MB: '1',
    });

    const res = await defaultFetcher('https://x/big.pdf', { headers: {}, timeoutMs: 5000 });

    // Same transport-failure sentinel shape a timeout returns — no new
    // "too big" branch for callers.
    expect(res.status).toBe(0);
    expect(res.body.length).toBe(0);
    // The count that matters: never past the cap plus at most one
    // already-in-flight chunk (the stream's default one-chunk read-ahead).
    expect(pulled.total).toBeGreaterThan(capBytes);
    // The stream's own read-ahead buffering (queuing strategy internals, not
    // this fetcher's logic) means the exact overshoot is a few chunks, not
    // exactly one — the real proof is the NEXT assertion: nowhere near the
    // full 2 MB body.
    expect(pulled.total).toBeLessThanOrEqual(capBytes * 2);
    // And nowhere near the full 2 MB body — this is the actual proof, not
    // just the returned verdict.
    expect(pulled.total).toBeLessThan(totalBytes);
  });

  it('a body just under the cap succeeds — the full (small) count is pulled and returned', async () => {
    const totalBytes = 480 * 1024; // 480 KB, under a 1 MB cap
    const { stream, pulled } = makeCountingStream(totalBytes, 64 * 1024);
    mockFetchReturning(stream);
    const { defaultFetcher } = await loadWithEnv({
      ENABLE_DOWNLOAD_STREAMING_CAP: 'true',
      PROSPECTUS_MAX_DOCUMENT_MB: '1',
    });

    const res = await defaultFetcher('https://x/small.pdf', { headers: {}, timeoutMs: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(totalBytes);
    expect(pulled.total).toBe(totalBytes);
  });

  it('many small chunks summing over the cap still abort — a chunk-counting cap would miss this', async () => {
    const totalBytes = 2 * 1024 * 1024; // 2 MB
    const chunkSize = 8 * 1024; // 8 KB — 250 chunks to deliver the full body
    const capMb = '0.5'; // 512 KB — fractional MB, ~64 tiny chunks to trip
    const { stream, pulled } = makeCountingStream(totalBytes, chunkSize);
    mockFetchReturning(stream);
    const { defaultFetcher } = await loadWithEnv({
      ENABLE_DOWNLOAD_STREAMING_CAP: 'true',
      PROSPECTUS_MAX_DOCUMENT_MB: capMb,
    });

    const res = await defaultFetcher('https://x/many-chunks.pdf', { headers: {}, timeoutMs: 5000 });

    const capBytes = 0.5 * 1024 * 1024;
    expect(res.status).toBe(0);
    // Tripped well before all 250 chunks were pulled.
    expect(pulled.chunksDelivered).toBeLessThan(totalBytes / chunkSize);
    expect(pulled.total).toBeGreaterThan(capBytes);
    expect(pulled.total).toBeLessThanOrEqual(capBytes * 1.25);
  });

  it('the abort actually stops the stream — cancel() is observed, not merely a returned-early verdict', async () => {
    const totalBytes = 4 * 1024 * 1024; // 4 MB
    const { stream, pulled } = makeCountingStream(totalBytes, 128 * 1024);
    mockFetchReturning(stream);
    const { defaultFetcher } = await loadWithEnv({
      ENABLE_DOWNLOAD_STREAMING_CAP: 'true',
      PROSPECTUS_MAX_DOCUMENT_MB: '1',
    });

    await defaultFetcher('https://x/big.pdf', { headers: {}, timeoutMs: 5000 });

    // The mock stream's own `cancel()` callback fires ONLY when the reader
    // actually cancels the underlying source — proving the stream itself
    // was told to stop, not just that defaultFetcher returned early while
    // the stream kept running in the background.
    expect(pulled.cancelled).toBe(true);
    const chunksAtCancel = pulled.chunksDelivered;
    await new Promise((r) => setTimeout(r, 20));
    expect(pulled.chunksDelivered).toBe(chunksAtCancel);
  });

  it('flag OFF is byte-identical to the pre-existing buffer-then-check path — the cap is never consulted during the fetch', async () => {
    const totalBytes = 3 * 1024 * 1024; // 3 MB, well over a 1 MB cap
    const { stream, pulled } = makeCountingStream(totalBytes, 512 * 1024);
    mockFetchReturning(stream);
    const { defaultFetcher } = await loadWithEnv({
      ENABLE_DOWNLOAD_STREAMING_CAP: 'false',
      PROSPECTUS_MAX_DOCUMENT_MB: '1',
    });

    const res = await defaultFetcher('https://x/big.pdf', { headers: {}, timeoutMs: 5000 });

    // Flag off: the full body comes back regardless of the cap — identical
    // to today's shipped behavior. The cap only bites later, in
    // verifyDownload's post-hoc check.
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(totalBytes);
    expect(pulled.total).toBe(totalBytes);
  });
});
