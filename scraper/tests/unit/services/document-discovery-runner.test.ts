import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  NSE_RETRY_BACKOFF_MS,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const json = (text: string, status = 200): HttpResponse => ({
  status,
  contentType: 'application/json',
  body: Buffer.from(text),
  url: 'https://fixture',
});

const NOW = new Date('2026-08-28T06:00:00Z');

const SKYWAYS: DiscoveryIpo = {
  id: 'ipo-skyways',
  companyName: 'Skyways Air Services Ltd.',
  symbol: 'SKYWAYS',
  segment: 'MAINBOARD',
  stage: 'OPEN',
  // Remembered from when Skyways was still on the board. See the drop-off
  // describe() block below for why this cannot be re-derived by name now.
  bseIpoNo: 7903,
};

const MADHUR: DiscoveryIpo = {
  id: 'ipo-madhur',
  companyName: 'Madhur Knit Crafts Ltd.',
  symbol: 'MADHURKNIT',
  segment: 'SME',
  stage: 'OPEN',
};

/** A fetcher that serves the captured payloads and records what was asked for. */
function fixtureFetcher(overrides: Record<string, HttpResponse> = {}) {
  const seen: string[] = [];
  const fetcher: HttpFetcher = async (url) => {
    seen.push(url);
    for (const [needle, response] of Object.entries(overrides)) {
      if (url.includes(needle)) return response;
    }
    if (url.includes('IPO_HomePageDetail')) return json(fixture('bse-ipo-homepage.json'));
    if (url.includes('GetMkt_ISSUE_BBS_IPO')) return json(fixture('bse-skyways-core.json'));
    if (url.includes('symbol=SKYWAYS')) return json(fixture('nse-skyways.json'));
    if (url.includes('symbol=MADHURKNIT')) return json(fixture('nse-madhurknit.json'));
    return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
  };
  return { fetcher, seen };
}

function makeRunner(fetcher: HttpFetcher) {
  const store = new InMemoryDocumentFetchStateStore();
  const counter = new NetworkCounter();
  const documents = {
    upserted: [] as unknown[],
    async upsertDocument(doc: Record<string, unknown>) {
      this.upserted.push(doc);
      return { id: `doc-${this.upserted.length}` };
    },
  };
  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store,
    documents,
    counter,
    now: () => NOW,
    // Prove the discovery + state behaviour without writing 20 MB PDFs to disk;
    // the download path itself is covered by document-download-verifier.test.ts.
    skipDownload: true,
  });
  return { runner, store, counter, documents };
}

describe('DocumentDiscoveryRunner — BSE-first discovery on REAL payloads', () => {
  it('finds Skyways documents and all THREE lead managers from the BSE core payload', async () => {
    const { fetcher } = fixtureFetcher();
    const { runner, store } = makeRunner(fetcher);

    const result = await runner.runIpo(SKYWAYS, []);

    expect(result.skipped).toBe(false);
    expect(result.found).toEqual(
      expect.arrayContaining(['RHP', 'CORRIGENDUM', 'ADDENDUM', 'PRICE_BAND_AD'])
    );
    expect(result.found.length).toBeGreaterThanOrEqual(4);
    expect(result.leadManagers).toEqual([
      'Holani Consultants Private Limited',
      'Shannon Advisors Private Limited',
      'Dolat Finserv Private Limited',
    ]);
    expect(store.all().filter((r) => r.state === 'FOUND').length).toBeGreaterThanOrEqual(4);
  });

  it('treats an EMPTY BSE Anchor_Details as NOT_YET_FILED, never as a failure (F3)', async () => {
    // BSE answers 200 with Anchor_Details:"" until anchor day. Conflating that
    // with 'no source answered' would page the owner every 30 minutes for a
    // filing that simply does not exist yet.
    const { fetcher } = fixtureFetcher({ 'ipo-detail': { status: 0, contentType: null, body: Buffer.alloc(0), url: 'x' } });
    const { runner } = makeRunner(fetcher);

    const result = await runner.runIpo({ ...SKYWAYS, stage: 'PRE_OPEN' }, []);

    expect(result.attempts.some((a) => a.source === 'BSE' && a.outcome === 'ok')).toBe(true);
    // BSE answered, so the types it has no link for are NOT_YET_FILED...
    expect(result.notYetFiled).toContain('ANCHOR_ALLOCATION_REPORT');
    // ...and nothing is BLOCKED_ALL even though NSE timed out entirely.
    expect(result.blocked).toEqual([]);
  }, 30_000);

  it('uses a remembered IPO_NO directly and skips the board fetch', async () => {
    const { fetcher, seen } = fixtureFetcher();
    const { runner } = makeRunner(fetcher);
    await runner.runIpo(SKYWAYS, []);
    expect(seen.some((u) => u.includes('IPO_HomePageDetail'))).toBe(false);
    expect(seen.some((u) => u.includes('IPO_NO=7903'))).toBe(true);
  });

  it('an SME IPO never touches the BSE board or core API (F13, not F4)', async () => {
    const { fetcher, seen } = fixtureFetcher();
    const { runner, counter } = makeRunner(fetcher);

    const result = await runner.runIpo(MADHUR, []);

    expect(seen.some((u) => u.includes('bseindia'))).toBe(false);
    expect(seen.every((u) => u.includes('nseindia'))).toBe(true);
    expect(result.found).toEqual(expect.arrayContaining(['RHP', 'RATIOS_BASIS_ISSUE_PRICE']));
    expect(counter.byHost()['www.nseindia.com']).toBeGreaterThan(0);
    expect(counter.byHost()['api.bseindia.com']).toBeUndefined();
  });
});

describe('THE acceptance property — run 2 makes ZERO network calls', () => {
  it('re-running immediately costs nothing for an IPO whose documents are all found', async () => {
    const { fetcher } = fixtureFetcher();
    const { runner, store, counter } = makeRunner(fetcher);

    const run1 = await runner.runIpo(SKYWAYS, []);
    expect(run1.networkCalls).toBeGreaterThan(0);
    const afterRun1 = counter.count(SKYWAYS.id);

    const rows = await store.listForIpo(SKYWAYS.id);
    const run2 = await runner.runIpo(
      SKYWAYS,
      rows.map((r) => ({
        docType: r.docType as never,
        state: r.state,
        attempts: r.attempts,
        nextRetryAt: r.nextRetryAt,
        blockedSinceAt: r.blockedSinceAt,
        filingDate: r.filingDate,
        extractorVersion: r.extractorVersion,
        lastAttemptAt: r.lastAttemptAt,
      }))
    );

    expect(run2.skipped).toBe(true);
    expect(run2.networkCalls).toBe(0);
    expect(counter.count(SKYWAYS.id)).toBe(afterRun1);
  });
});

describe('failure handling', () => {
  it('retries NSE three times at 2/4/8 s before giving up', async () => {
    // The single defect that starved Skyways of documents: one 15 s attempt,
    // no retry. The ladder is asserted here, not assumed.
    expect(NSE_RETRY_BACKOFF_MS).toEqual([2_000, 4_000, 8_000]);
    const timeout: HttpResponse = { status: 0, contentType: null, body: Buffer.alloc(0), url: 'x' };
    const { fetcher, seen } = fixtureFetcher({ 'ipo-detail': timeout });
    const { runner } = makeRunner(fetcher);

    await runner.runIpo({ ...MADHUR }, []);
    expect(seen.filter((u) => u.includes('ipo-detail'))).toHaveLength(3);
  }, 30_000);

  it('records BLOCKED_ALL when NO exchange answers — but never for an empty field', async () => {
    const timeout: HttpResponse = { status: 0, contentType: null, body: Buffer.alloc(0), url: 'x' };
    const { fetcher } = fixtureFetcher({ 'ipo-detail': timeout });
    const { runner, store } = makeRunner(fetcher);

    const result = await runner.runIpo(MADHUR, []);
    expect(result.found).toEqual([]);
    expect(result.blocked.length).toBeGreaterThan(0);
    expect(result.notYetFiled).toEqual([]);
    expect(store.all().every((r) => r.state === 'BLOCKED_ALL')).toBe(true);
  }, 30_000);

  it('falls back to NSE when the BSE board changes shape, instead of writing nothing (F18)', async () => {
    const { fetcher, seen } = fixtureFetcher({
      IPO_HomePageDetail: json('{"Data":[]}'),
    });
    const { runner } = makeRunner(fetcher);

    const result = await runner.runIpo(SKYWAYS, []);
    expect(seen.some((u) => u.includes('ipo-detail'))).toBe(true);
    expect(result.found).toEqual(expect.arrayContaining(['RHP']));
  });

  it('does not abort the whole cycle when one IPO throws', async () => {
    const { fetcher } = fixtureFetcher();
    const { runner, store } = makeRunner(fetcher);
    const original = store.listForIpo.bind(store);
    let called = 0;
    store.listForIpo = async (ipoId: string) => {
      called++;
      if (ipoId === 'ipo-broken') throw new Error('store exploded');
      return original(ipoId);
    };

    const results = await runner.runCycle([
      { ...SKYWAYS, id: 'ipo-broken' },
      MADHUR,
    ]);
    expect(called).toBe(2);
    expect(results).toHaveLength(1);
    expect(results[0].ipoId).toBe('ipo-madhur');
  });
});

describe('the board is fetched once per cycle, lazily', () => {
  let seen: string[];
  beforeEach(() => {
    seen = [];
  });

  it('fetches the board ONCE for many mainboard IPOs that still need resolving', async () => {
    // The board is a whole-market payload, so fetching it per IPO would be N
    // identical requests. Both IPOs here have no remembered IPO_NO, so both need it.
    const f = fixtureFetcher();
    const { runner } = makeRunner(f.fetcher);
    await runner.runCycle([
      { ...SKYWAYS, bseIpoNo: null },
      { ...SKYWAYS, id: 'ipo-esds', companyName: 'ESDS Software Solution Limited', symbol: 'ESDS', bseIpoNo: null },
    ]);
    expect(f.seen.filter((u) => u.includes('IPO_HomePageDetail'))).toHaveLength(1);
  }, 30_000);

  it('never fetches the board at all when nothing is due', async () => {
    const f = fixtureFetcher();
    const { runner, store } = makeRunner(f.fetcher);
    await runner.runIpo(SKYWAYS, []);
    const rows = (await store.listForIpo(SKYWAYS.id)).map((r) => ({
      docType: r.docType as never,
      state: r.state,
      attempts: r.attempts,
      nextRetryAt: r.nextRetryAt,
      blockedSinceAt: r.blockedSinceAt,
      filingDate: r.filingDate,
      extractorVersion: r.extractorVersion,
      lastAttemptAt: r.lastAttemptAt,
    }));

    const fresh = fixtureFetcher();
    const second = makeRunner(fresh.fetcher);
    await second.runner.runIpo(SKYWAYS, rows);
    expect(fresh.seen).toEqual([]);
  });
});

describe('a closed mainboard IPO drops off the BSE board (found live, 2026-08-28)', () => {
  // IPO_HomePageDetail lists only LIVE and FORTHCOMING issues. Skyways closed on
  // 27 Aug and was already absent from the board captured on 28 Aug — which is
  // exactly when its final Prospectus becomes due. Resolving IPO_NO by name from
  // the board therefore works only while we need it least. Hence ipos.bse_ipo_no.
  it('cannot resolve a closed IPO by name, so BSE is unreachable without a remembered IPO_NO', async () => {
    const { fetcher, seen } = fixtureFetcher();
    const { runner } = makeRunner(fetcher);

    const withoutMemory = { ...SKYWAYS, bseIpoNo: null };
    const result = await runner.runIpo(withoutMemory, []);

    expect(result.attempts.some((a) => a.source === 'BSE' && a.outcome === 'not_on_board')).toBe(true);
    expect(seen.some((u) => u.includes('GetMkt_ISSUE_BBS_IPO'))).toBe(false);
    // Not a failure: NSE covers it, so nothing is BLOCKED_ALL.
    expect(result.blocked).toEqual([]);
    expect(result.found).toEqual(expect.arrayContaining(['RHP']));
  });

  it('reports the IPO_NO it resolved from the board so the caller can remember it', async () => {
    const { fetcher } = fixtureFetcher();
    const { runner } = makeRunner(fetcher);
    // ESDS is still on the board (opens 28 Aug), so it resolves by name today.
    const result = await runner.runIpo(
      { id: 'ipo-esds', companyName: 'ESDS Software Solution Limited', symbol: 'ESDS', segment: 'MAINBOARD', stage: 'PRE_OPEN' },
      []
    );
    expect(result.resolvedBseIpoNo).toBe(7916);
  }, 30_000);
});
