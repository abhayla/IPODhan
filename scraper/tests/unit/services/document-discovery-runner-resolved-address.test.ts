// implements: OD-37 (resolved-address refusal on every fetch rung, + the refusal log line D17)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
  refusalOutcomeOr,
  hostnameOf,
  STATUS_REFUSED_RESOLVED_PRIVATE,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';

/**
 * Item 22 slice 3. OD-37 asks that ANY hostname whose RESOLVED address falls in
 * a private/loopback/link-local range is refused — on every fetch rung, not just
 * the company-website rung `normalizeCompanyUrl` already covers.
 *
 * `isResolvedAddressPrivate` shipped in slice 22-1 (#487) and, until this slice,
 * had ZERO callers: the DNS-rebinding hole it was written to close was still
 * wide open on every exchange, SEBI and document fetch. A hostname whose STRING
 * looks public but RESOLVES to 127.0.0.1 or to the cloud metadata address
 * 169.254.169.254 went straight through.
 *
 * These tests drive the REAL runner through its REAL public entry (`runIpo`),
 * so they exercise the actual `request()` choke point every rung passes through
 * rather than a re-implementation of it. The DNS resolver is injected — a unit
 * test must never make a real DNS query — but the code path under test is the
 * production one.
 */

const IPO: DiscoveryIpo = {
  id: 'ipo-1',
  companyName: 'Skyways Air Services Ltd.',
  symbol: 'SKYWAYS',
  segment: 'MAINBOARD',
  stage: 'PRE_OPEN',
  bseIpoNo: 7903,
} as DiscoveryIpo;

const notFound = (url: string): HttpResponse => ({
  status: 404,
  contentType: 'text/html',
  body: Buffer.from('x'),
  url,
});

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'od37-runner-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner(opts: { privateHosts?: string[]; resolverThrows?: boolean } = {}) {
  const fetched: string[] = [];
  const fetcher: HttpFetcher = async (url) => {
    fetched.push(url);
    return notFound(url);
  };

  const resolved: string[] = [];
  const resolveIsPrivate = async (hostname: string): Promise<boolean> => {
    resolved.push(hostname);
    if (opts.resolverThrows) throw new Error('EAI_AGAIN');
    return (opts.privateHosts ?? []).includes(hostname);
  };

  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store: new InMemoryDocumentFetchStateStore(),
    documents: { async upsertDocument() { return { id: 'doc-1' }; } } as never,
    counter: new NetworkCounter(),
    now: () => new Date('2026-09-10T06:00:00Z'),
    storeDir,
    skipDownload: true,
    sleep: async () => {},
    resolveIsPrivate,
  } as never);

  return { runner, fetched, resolved };
}

describe('D17 — a refusal is distinguishable from "the server did not answer"', () => {
  it('classifies the refusal status everywhere, not only on the retry ladder', () => {
    // Six call sites used to classify this independently and every one of them
    // read the refusal as `http_error`, so the refusal was legible only on the
    // ladder path. The counts-only tests below all passed while that was true —
    // this asserts the CLASSIFICATION, which is the thing D17 actually asks for.
    expect(refusalOutcomeOr(STATUS_REFUSED_RESOLVED_PRIVATE, 'http_error')).toBe(
      'refused:resolved_private_address'
    );
    // Every other status keeps the string its call site always emitted. The
    // first version of this collapsed all sites onto one classifier and turned
    // a timeout into 'timeout' at three sites that had always said
    // 'http_error' — the F3/F6 coverage logic matches those strings exactly, so
    // that was a real regression, caught by an existing test rather than by me.
    expect(refusalOutcomeOr(0, 'http_error')).toBe('http_error');
    expect(refusalOutcomeOr(0, 'timeout')).toBe('timeout');
    expect(refusalOutcomeOr(404, 'http_error')).toBe('http_error');
  });
});

/** Drive the NSE rung with a chosen status and return its attempt outcomes. */
async function runWithNseStatus(status: number): Promise<string[]> {
  const runner = new DocumentDiscoveryRunner({
    fetcher: async (url: string): Promise<HttpResponse> =>
      url.includes('nseindia.com')
        ? { status, contentType: null, body: Buffer.alloc(0), url }
        : notFound(url),
    store: new InMemoryDocumentFetchStateStore(),
    documents: { async upsertDocument() { return { id: 'doc-1' }; } } as never,
    counter: new NetworkCounter(),
    now: () => new Date('2026-09-10T06:00:00Z'),
    storeDir,
    skipDownload: true,
    sleep: async () => {},
  } as never);
  const result = await runner.runIpo(IPO, []);
  return result.attempts.filter(a => a.source === 'NSE').map(a => String(a.outcome));
}

describe('the two branches a Tier A review found untested', () => {
  it('MUTATION: a refusal is NOT retried by the ladder', async () => {
    // The ladder retries anything that is not 200. A refusal is a VERDICT, not
    // a transport failure — retrying it three times triples the log noise and
    // implies the host might answer. The early return was written for that and
    // nothing asserted it: flipping the condition to `false` left the whole
    // suite green.
    const { runner } = makeRunner({ privateHosts: ['api.bseindia.com', 'www.nseindia.com'] });

    const result = await runner.runIpo(IPO, []);

    const bse = result.attempts.filter(a => a.source === 'BSE');
    expect(bse.length).toBeGreaterThan(0);
    // Every BSE attempt is the refusal, and there is exactly ONE per rung —
    // no `:try2of3`, no `:try3of3`, no plain http_error retries behind it.
    expect(bse.every(a => a.outcome === 'refused:resolved_private_address')).toBe(true);
    expect(bse.some(a => String(a.outcome).includes('try'))).toBe(false);
  });

  it('hostnameOf returns null for a URL that will not parse (NOT branch coverage)', () => {
    // HONEST LIMIT, stated so nobody reads 11/11 as full coverage: this covers
    // the PREDICATE, not the `host === null` branch inside request(). Mutating
    // that branch to `host !== null` STILL leaves this suite green, because no
    // call site can produce an unparseable URL — all seven build absolute URLs
    // — so the branch is unreachable and a test cannot drive it.
    //
    // It is kept anyway as defence-in-depth for a future call site that does
    // not build its URL, and the surviving mutation is DECLARED rather than
    // dressed up. Removing the branch to make the mutation score look better
    // would trade a real fail-closed guard for a cosmetic number.
    expect(hostnameOf('https://bseindia.com/x.pdf')).toBe('bseindia.com');
    expect(hostnameOf('https://example.com:8443/x.pdf')).toBe('example.com');
    expect(hostnameOf('not a url')).toBeNull();
    expect(hostnameOf('')).toBeNull();
  });

  it('a TIMEOUT is still classified as a timeout, not an http_error', () => {
    // Guards the regression this slice shipped and a review caught: the NSE
    // site's fallback was flattened to 'http_error', so every NSE timeout read
    // as an HTTP error. The F3/F6 coverage logic matches these strings exactly.
    expect(refusalOutcomeOr(0, 'timeout')).toBe('timeout');
    expect(refusalOutcomeOr(0, 0 === 0 ? 'timeout' : 'http_error')).toBe('timeout');
    expect(refusalOutcomeOr(STATUS_REFUSED_RESOLVED_PRIVATE, 'timeout')).toBe(
      'refused:resolved_private_address'
    );
  });

  it('the NSE attempt log still says timeout for status 0, and http_error otherwise', async () => {
    // SITE-level, not helper-level. Asserting refusalOutcomeOr(0,'timeout') only
    // proves the helper; the regression was at the CALL SITE, where the
    // fallback had been flattened to a literal 'http_error'. This drives the
    // real NSE rung and reads the real attempt log, so the reclassification
    // cannot come back a third time.
    const timedOut = await runWithNseStatus(0);
    expect(timedOut).toContain('timeout');
    expect(timedOut).not.toContain('http_error');

    const errored = await runWithNseStatus(404);
    expect(errored).toContain('http_error');
    expect(errored).not.toContain('timeout');
  });

  it('a transient resolver error is NOT cached for the rest of the cycle', async () => {
    // Caching a resolver ERROR blackholes the host for the whole cycle on one
    // blip. A real "resolves private" answer IS cached; a fault is not.
    let calls = 0;
    const runner = new DocumentDiscoveryRunner({
      fetcher: async (url: string) => notFound(url),
      store: new InMemoryDocumentFetchStateStore(),
      documents: { async upsertDocument() { return { id: 'doc-1' }; } } as never,
      counter: new NetworkCounter(),
      now: () => new Date('2026-09-10T06:00:00Z'),
      storeDir,
      skipDownload: true,
      sleep: async () => {},
      resolveIsPrivate: async () => { calls++; throw new Error('EAI_AGAIN'); },
    } as never);

    await runner.runIpo(IPO, []);

    // More than one host is attempted, and a cached error would have collapsed
    // every later lookup to zero additional calls.
    expect(calls).toBeGreaterThan(1);
  });
});

describe('OD-37 — a hostname that RESOLVES private is refused on every rung', () => {
  it('does not fetch a host whose resolved address is private', async () => {
    // Every host resolves private: not one network call may be made.
    const { runner, fetched, resolved } = makeRunner({
      privateHosts: ['api.bseindia.com', 'www.nseindia.com', 'www.sebi.gov.in'],
    });

    await runner.runIpo(IPO, []);

    // The resolver must actually have been consulted — a check that is never
    // called is the failure mode this slice exists to fix, and "0 fetches"
    // could also mean the runner simply did nothing.
    expect(resolved.length).toBeGreaterThan(0);
    expect(fetched).toEqual([]);
  });

  it('still fetches when the resolved address is public', async () => {
    const { runner, fetched, resolved } = makeRunner({ privateHosts: [] });

    await runner.runIpo(IPO, []);

    expect(resolved.length).toBeGreaterThan(0);
    expect(fetched.length).toBeGreaterThan(0);
  });

  it('refuses a host that resolves private even when other hosts are fine', async () => {
    const { runner, fetched } = makeRunner({ privateHosts: ['api.bseindia.com'] });

    await runner.runIpo(IPO, []);

    // The BSE rung is refused; the others are not.
    expect(fetched.some(u => u.includes('bseindia.com'))).toBe(false);
    expect(fetched.length).toBeGreaterThan(0);
  });

  it('fails CLOSED when the resolver itself errors', async () => {
    // A DNS failure must not become an open door. OD-37 puts this at the
    // network boundary, and the boundary fails closed.
    const { runner, fetched } = makeRunner({ resolverThrows: true });

    await runner.runIpo(IPO, []);

    expect(fetched).toEqual([]);
  });

  it('flag OFF makes NO DNS query at all and changes nothing', async () => {
    // The gate must be byte-identical to the pre-flag path when off. If it
    // merely "allowed everything" while still resolving, an unresolvable host
    // would still cost a lookup and a 5s timeout on every fetch in production.
    const fetched: string[] = [];
    const runner = new DocumentDiscoveryRunner({
      fetcher: async (url: string) => { fetched.push(url); return notFound(url); },
      store: new InMemoryDocumentFetchStateStore(),
      documents: { async upsertDocument() { return { id: 'doc-1' }; } } as never,
      counter: new NetworkCounter(),
      now: () => new Date('2026-09-10T06:00:00Z'),
      storeDir,
      skipDownload: true,
      sleep: async () => {},
      // no resolveIsPrivate injected, and the flag defaults OFF outside staging
    } as never);

    await runner.runIpo(IPO, []);

    expect(fetched.length).toBeGreaterThan(0);
  });

  it('consults the resolver ONCE per host, not once per request', async () => {
    // The ladder retries and several rungs share a host. A DNS query per
    // request would add a lookup — and a 5s worst-case timeout — to every
    // retry of every rung.
    const { runner, resolved } = makeRunner({ privateHosts: [] });

    await runner.runIpo(IPO, []);

    const unique = new Set(resolved);
    expect(resolved.length).toBe(unique.size);
  });
});
