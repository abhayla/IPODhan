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

  it('a settled miss on a DUE type is NOT_FOUND, not NOT_YET_FILED (F3 vs F6, W-28)', async () => {
    // Both exchanges answer, so the miss is SETTLED — no BLOCKED_ALL, no alert.
    // But the Prospectus is DUE at CLOSED, so "settled" cannot mean "the company
    // has not filed it" (W-28): that reading is what the E12 badge renders and
    // what made a discovery gap look like an issuer's timetable.
    const { fetcher } = fixtureFetcher();
    const { runner } = makeRunner(fetcher);

    const result = await runner.runIpo({ ...SKYWAYS, stage: 'CLOSED' }, []);

    expect(result.attempts.some((a) => a.source === 'BSE' && a.outcome === 'ok')).toBe(true);
    expect(result.attempts.some((a) => a.source === 'NSE' && a.outcome === 'ok')).toBe(true);
    // Item 44 / F-229: the exchanges no longer SETTLE a post-close Prospectus -- it escalates to
    // SEBI (404 on this fixture), so it is neither a settled notFound nor notYetFiled.
    const chain = result.attempts.find((a) => a.source === 'CHAIN' && a.outcome.startsWith('rungs[PROSPECTUS]'))?.outcome ?? '';
    expect(chain).toContain('EXCHANGES:no_link[due_after_close]');
    expect(chain).not.toContain('exchanges_settled_it');
    expect(result.notYetFiled).not.toContain('PROSPECTUS');
  }, 30_000);

  it('a FAILED exchange must NOT produce NOT_YET_FILED for the types it carries', async () => {
    // The 2026-08-28 re-run made this concrete: BSE timed out for Skyways while
    // NSE answered, and every BSE-ONLY type (price-band ad, corrigendum,
    // addendum) was recorded as NOT_YET_FILED — 'the company has not filed it' —
    // which we had no evidence for, and which both suppresses the retry ladder
    // and silences the alert. BLOCKED_ALL is the honest state.
    const { fetcher } = fixtureFetcher({
      GetMkt_ISSUE_BBS_IPO: { status: 0, contentType: null, body: Buffer.alloc(0), url: 'x' },
    });
    const { runner } = makeRunner(fetcher);

    const result = await runner.runIpo(SKYWAYS, []);

    expect(result.attempts.some((a) => a.source === 'BSE' && a.outcome === 'http_error')).toBe(true);
    expect(result.attempts.some((a) => a.source === 'NSE' && a.outcome === 'ok')).toBe(true);
    // BSE-only types are BLOCKED_ALL, not silently 'not filed yet'.
    expect(result.blocked).toContain('PRICE_BAND_AD');
    expect(result.blocked).toContain('CORRIGENDUM');
    expect(result.notYetFiled).toEqual([]);
    // ...while what NSE did carry is still FOUND.
    expect(result.found).toContain('RHP');
  }, 60_000);

  it('uses a remembered IPO_NO directly and skips the board fetch', async () => {
    const { fetcher, seen } = fixtureFetcher();
    const { runner } = makeRunner(fetcher);
    await runner.runIpo(SKYWAYS, []);
    expect(seen.some((u) => u.includes('IPO_HomePageDetail'))).toBe(false);
    expect(seen.some((u) => u.includes('IPO_NO=7903'))).toBe(true);
  });

  it('an SME IPO known to list on NSE only never touches the BSE board or core API (zero cost, #1201)', async () => {
    const { fetcher, seen } = fixtureFetcher();
    const { runner, counter } = makeRunner(fetcher);

    const result = await runner.runIpo({ ...MADHUR, listingExchanges: ['NSE'] }, []);

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

    // ZERO CALLS is the property. `skipped` is a weaker, different claim, and
    // F-3 separated the two: run 1 found the RHP, so run 2 has one piece of
    // bookkeeping left — marking the now-superseded DRHP — which is not a skip
    // and still touches no network. Asserting `skipped` here would have made
    // the supersession pass look like a regression.
    expect(run2.networkCalls).toBe(0);
    expect(run2.due).toEqual([]);
    expect(run2.superseded).toEqual(['DRHP']);
    expect(counter.count(SKYWAYS.id)).toBe(afterRun1);

    // Convergence: with that bookkeeping written, the next cycle is a pure skip.
    const rows2 = await store.listForIpo(SKYWAYS.id);
    const run3 = await runner.runIpo(
      SKYWAYS,
      rows2.map((r) => ({
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
    expect(run3.skipped).toBe(true);
    expect(run3.networkCalls).toBe(0);
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

describe('SEBI search + paging beyond page 1 (W-27, wired via trySebi)', () => {
  const SEBI_FIXTURES = join(__dirname, '../../fixtures/sebi');
  const sebiFixture = (n: string) => readFileSync(join(SEBI_FIXTURES, n), 'utf8');
  const PAGE1_HTML = sebiFixture('sebi-drhp-page1-with-form.html');
  const SEARCH_MATCH_HTML = sebiFixture('sebi-drhp-search-match.html');

  const DEEPA: DiscoveryIpo = {
    id: 'ipo-deepa',
    companyName: 'Deepa Jewellers Limited',
    symbol: null,
    segment: 'MAINBOARD',
    stage: 'UPCOMING', // dueDocTypesForStage('UPCOMING') === ['DRHP']
  };

  function sebiSearchFetcher() {
    const methodsByUrl: string[] = [];
    const fetcher: HttpFetcher = async (url, init) => {
      if (url.includes('sebiweb/home/HomeAction.do')) {
        methodsByUrl.push(init.method ?? 'GET');
        if ((init.method ?? 'GET') === 'GET') {
          return { status: 200, contentType: 'text/html', body: Buffer.from(PAGE1_HTML), url };
        }
        // The search/paged POST — Deepa's row lives only in the search result.
        return { status: 200, contentType: 'text/html', body: Buffer.from(SEARCH_MATCH_HTML), url };
      }
      // BSE board / NSE lookups and the SEBI detail page: none of them matter
      // to this test, which only proves the SEARCH rung was reached and cached.
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    return { fetcher, methodsByUrl };
  }

  it('records SEBI:searched in the chain and caches the walk per company', async () => {
    const { fetcher, methodsByUrl } = sebiSearchFetcher();
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
      skipDownload: false, // W-27's search rung only runs on the escalation path
    });

    const result = await runner.runIpo(DEEPA, []);

    const chain = result.attempts.find(
      (a) => a.source === 'CHAIN' && a.outcome.includes('rungs[DRHP]')
    );
    expect(chain).toBeDefined();
    expect(chain!.outcome).toContain('SEBI:page1');
    expect(chain!.outcome).toContain('SEBI:searched');
    // The search POST carries doListing=yes and hits the same action URL twice
    // (GET page 1, POST search) — never more, since the match came back on
    // the search itself.
    expect(methodsByUrl).toEqual(['GET', 'POST']);

    // A second IPO on the SAME listing but a DIFFERENT company must not reuse
    // Deepa's cached search result — the cache key is per company (W-27).
    const OTHER: DiscoveryIpo = { ...DEEPA, id: 'ipo-other', companyName: 'Totally Different Co Ltd' };
    const before = methodsByUrl.length;
    await runner.runIpo(OTHER, []);
    // A fresh GET + POST walk ran for the second company — the cache did not
    // short-circuit it with Deepa's answer.
    expect(methodsByUrl.length).toBeGreaterThan(before);
  }, 30_000);
});

describe('#620: SEBI walk requests that do not depend on the company are made once per cycle', () => {
  // Staging 2026-09-27T20:08Z: one discovery cycle spent 176 of its 200 calls on
  // www.sebi.gov.in and found 0 documents. The walk re-fetched the SAME page-1
  // GET and the SAME six paged POSTs (search '' , nextValue n) for every IPO,
  // because the only cache was keyed per company. Only the search POST carries
  // the company; everything else is one request per listing per cycle.
  const SEBI_FIXTURES = join(__dirname, '../../fixtures/sebi');
  const PAGE1_HTML = readFileSync(join(SEBI_FIXTURES, 'sebi-drhp-page1-with-form.html'), 'utf8');
  // Captured live 2026-09-29: SEBI's answer to a search that finds nothing (form +
  // "No record(s) available.", no table#sample_1).
  const NO_RECORDS_HTML = readFileSync(join(SEBI_FIXTURES, 'sebi-drhp-search-page.html'), 'utf8');

  it('59 unlisted UPCOMING IPOs cost 1 GET + 6 paged POSTs + 59 search POSTs on SEBI, not 8 per IPO, and each is not_listed', async () => {
    const sebiRequests: string[] = [];
    const fetcher: HttpFetcher = async (url, init) => {
      if (url.includes('sebi.gov.in')) {
        const body = String(init.body ?? '');
        sebiRequests.push(`${init.method ?? 'GET'} ${url} ${body}`);
        // A company search answers as the live site does for an unknown name; page 1
        // and the paged listing answer with the real page 1 (none of the companies is on it).
        const isSearch = (init.method ?? 'GET') === 'POST' && /search=[^&\s]/.test(body);
        return { status: 200, contentType: 'text/html', body: Buffer.from(isSearch ? NO_RECORDS_HTML : PAGE1_HTML), url };
      }
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    const documents = {
      async upsertDocument() {
        return { id: 'doc-x' };
      },
    };
    const runner = new DocumentDiscoveryRunner({
      fetcher,
      store: new InMemoryDocumentFetchStateStore(),
      documents,
      counter: new NetworkCounter(),
      now: () => NOW,
      sleep: async () => {},
      skipDownload: false,
    });

    const ipos: DiscoveryIpo[] = Array.from({ length: 59 }, (_, i) => ({
      id: `ipo-${i}`,
      // SEBI's search term is the first two normalized words, so the second
      // word differs per company (identical searches are one request, rightly).
      companyName: `Zqxv ${String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26))}qq Holdings Limited`,
      symbol: null,
      segment: 'MAINBOARD',
      stage: 'UPCOMING', // DRHP only
    }));
    const results = [];
    for (const ipo of ipos) results.push(await runner.runIpo(ipo, []));

    // A zero-result search is a real answer: every IPO reads not_listed, none failed.
    for (const r of results) {
      const chain = r.attempts.find((x) => x.source === 'CHAIN' && x.outcome.includes('rungs[DRHP]'));
      expect(chain!.outcome).toContain('SEBI:searched:no_records');
      expect(chain!.outcome).toContain('SEBI:not_listed');
      expect(chain!.outcome).not.toContain('not_a_listing');
    }

    const gets = sebiRequests.filter((r) => r.startsWith('GET '));
    const searches = sebiRequests.filter((r) => r.startsWith('POST ') && /search=[^&\s]/.test(r));
    const pages = sebiRequests.filter((r) => r.startsWith('POST ') && !/search=[^&\s]/.test(r));
    expect(gets.length).toBe(1);
    expect(pages.length).toBe(6);
    expect(searches.length).toBe(59);
    expect(sebiRequests.length).toBe(66);
  }, 60_000);

  it('two companies whose search term is the same share ONE search POST, and each is still matched on its own name', async () => {
    const sebiRequests: string[] = [];
    const fetcher: HttpFetcher = async (url, init) => {
      if (url.includes('sebi.gov.in')) {
        sebiRequests.push(`${init.method ?? 'GET'} ${String(init.body ?? '')}`);
        return { status: 200, contentType: 'text/html', body: Buffer.from(PAGE1_HTML), url };
      }
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    const runner = new DocumentDiscoveryRunner({
      fetcher,
      store: new InMemoryDocumentFetchStateStore(),
      documents: { async upsertDocument() { return { id: 'doc-x' }; } },
      counter: new NetworkCounter(),
      now: () => NOW,
      sleep: async () => {},
      skipDownload: false,
    });
    const base = { symbol: null, segment: 'MAINBOARD', stage: 'UPCOMING' } as const;
    const a = await runner.runIpo({ ...base, id: 'a', companyName: 'Zqxv Abqq Holdings Limited' }, []);
    const b = await runner.runIpo({ ...base, id: 'b', companyName: 'Zqxv Abqq Textiles Limited' }, []);
    expect(sebiRequests.filter((r) => /search=[^&\s]/.test(r)).length).toBe(1);
    // Each IPO still records its own walk and its own not_listed verdict.
    for (const r of [a, b]) {
      const chain = r.attempts.find((x) => x.source === 'CHAIN' && x.outcome.includes('rungs[DRHP]'));
      expect(chain!.outcome).toContain('SEBI:not_listed');
    }
    // The audit trail tells a reused answer from a fetched one.
    const chainB = b.attempts.find((x) => x.source === 'CHAIN' && x.outcome.includes('rungs[DRHP]'));
    expect(chainB!.outcome).toMatch(/SEBI:reused:\d+/);
    expect(b.attempts.some((x) => x.source === 'SEBI' && x.outcome.startsWith('reused:'))).toBe(true);
  }, 30_000);

  // B7 fix round: SEBI answers a dead session / rejected form with a 200
  // HOMEPAGE (no table#sample_1). That walk never looked for the company.
  const NOT_A_LISTING_HTML =
    '<!DOCTYPE html><html><head><title>Securities and Exchange Board of India</title></head>' +
    '<body><div class="home">Welcome</div></body></html>';

  function runnerWith(fetcher: HttpFetcher) {
    return new DocumentDiscoveryRunner({
      fetcher,
      store: new InMemoryDocumentFetchStateStore(),
      documents: { async upsertDocument() { return { id: 'doc-x' }; } },
      counter: new NetworkCounter(),
      now: () => NOW,
      sleep: async () => {},
      skipDownload: false,
    });
  }
  const chainOf = (r: { attempts: { source: string; outcome: string }[] }) =>
    r.attempts.find((x) => x.source === 'CHAIN' && x.outcome.includes('rungs[DRHP]'))!.outcome;
  const base = { symbol: null, segment: 'MAINBOARD', stage: 'UPCOMING' } as const;

  it("a table-less 200 search is SEBI:failed (not not_listed), and the next IPO opens a fresh session", async () => {
    const sebiRequests: string[] = [];
    const fetcher: HttpFetcher = async (url, init) => {
      if (url.includes('sebi.gov.in')) {
        const body = String(init.body ?? '');
        sebiRequests.push(`${init.method ?? 'GET'} ${body}`);
        // IPO #2's search hits a dead session: SEBI answers its homepage.
        if (/search=zqxv\+beqq/.test(body)) {
          return { status: 200, contentType: 'text/html', body: Buffer.from(NOT_A_LISTING_HTML), url };
        }
        return { status: 200, contentType: 'text/html', body: Buffer.from(PAGE1_HTML), url };
      }
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    const runner = runnerWith(fetcher);
    const r1 = await runner.runIpo({ ...base, id: 'i1', companyName: 'Zqxv Aaqq Holdings Limited' }, []);
    const r2 = await runner.runIpo({ ...base, id: 'i2', companyName: 'Zqxv Beqq Holdings Limited' }, []);
    const getsAfter2 = sebiRequests.filter((r) => r.startsWith('GET ')).length;
    const r3 = await runner.runIpo({ ...base, id: 'i3', companyName: 'Zqxv Ceqq Holdings Limited' }, []);

    expect(chainOf(r1)).toContain('SEBI:not_listed');
    expect(chainOf(r2)).toContain('SEBI:searched:not_a_listing');
    expect(chainOf(r2)).toContain('SEBI:failed:search');
    expect(chainOf(r2)).not.toContain('SEBI:not_listed');
    // Page 1 was reused by IPO #2, then dropped when its session proved dead.
    expect(getsAfter2).toBe(1);
    expect(sebiRequests.filter((r) => r.startsWith('GET ')).length).toBe(2);
    // IPO #3 is not poisoned by IPO #2's failure: it walks and answers.
    expect(chainOf(r3)).toContain('SEBI:not_listed');
  }, 30_000);

  it('a table-less 200 search is never memoised: a later IPO with the same search term re-POSTs it', async () => {
    const searches: string[] = [];
    const fetcher: HttpFetcher = async (url, init) => {
      if (url.includes('sebi.gov.in')) {
        const body = String(init.body ?? '');
        if (/search=[^&\s]/.test(body)) {
          searches.push(body);
          // Only the FIRST search hits the dead session.
          if (searches.length === 1) {
            return { status: 200, contentType: 'text/html', body: Buffer.from(NOT_A_LISTING_HTML), url };
          }
        }
        return { status: 200, contentType: 'text/html', body: Buffer.from(PAGE1_HTML), url };
      }
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    const runner = runnerWith(fetcher);
    const a = await runner.runIpo({ ...base, id: 'k1', companyName: 'Zqxv Abqq Holdings Limited' }, []);
    const b = await runner.runIpo({ ...base, id: 'k2', companyName: 'Zqxv Abqq Textiles Limited' }, []);
    expect(chainOf(a)).toContain('SEBI:failed:search');
    expect(searches.length).toBe(2);
    expect(chainOf(b)).toContain('SEBI:not_listed');
  }, 30_000);

  it('a table-less 200 page-1 GET is never reused: each IPO re-fetches it and none says not_listed', async () => {
    const sebiRequests: string[] = [];
    const fetcher: HttpFetcher = async (url, init) => {
      if (url.includes('sebi.gov.in')) {
        sebiRequests.push(`${init.method ?? 'GET'} ${String(init.body ?? '')}`);
        return { status: 200, contentType: 'text/html', body: Buffer.from(NOT_A_LISTING_HTML), url };
      }
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    const runner = runnerWith(fetcher);
    const r1 = await runner.runIpo({ ...base, id: 'j1', companyName: 'Zqxv Aaqq Holdings Limited' }, []);
    const r2 = await runner.runIpo({ ...base, id: 'j2', companyName: 'Zqxv Beqq Holdings Limited' }, []);
    for (const r of [r1, r2]) {
      expect(chainOf(r)).toContain('SEBI:page1:not_a_listing');
      expect(chainOf(r)).not.toContain('SEBI:not_listed');
    }
    expect(sebiRequests.filter((r) => r.startsWith('GET ')).length).toBe(2);
  }, 30_000);
});
