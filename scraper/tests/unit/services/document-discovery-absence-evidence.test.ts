import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  answeredFrom,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';

/**
 * T-403 round 5, Class 1 (third occurrence): a NON-ANSWER recorded as evidence
 * of absence.
 *
 * Rounds 3 and 4 each fixed the instances they could see - every SEBI failure
 * path returning null (r3), a 503 written as "not filed" (r4) - while the TYPE
 * still let the next early return mint absence out of nothing. Round 4's review
 * then found three more: "escalation budget exhausted" returning 'absent' at
 * three sites, i.e. NOT_YET_FILED concluded from a request never made.
 *
 * This file pins the CLASS, not the three instances:
 *
 *  1. STRUCTURALLY - the absent arm may be constructed in exactly one place, a
 *     factory that requires an `AnsweredResponse`, and an `AnsweredResponse` may
 *     be minted in exactly one place, from a real 200. Any future early return
 *     that wants to say "absent" must therefore hold a response, or it does not
 *     compile.
 *  2. BEHAVIOURALLY - the specific non-answers (a budget refusal on each of the
 *     three escalation rungs, a 403 on an investor page) land the row in
 *     BLOCKED_ALL, which is retryable and alerted, never NOT_YET_FILED.
 */

const RUNNER_SRC = readFileSync(
  join(__dirname, '../../../src/services/document-discovery-runner.ts'),
  'utf8'
);

describe('structural: absence is unconstructible without an AnsweredResponse', () => {
  it('constructs the absent arm in exactly one place - the evidence-taking factory', () => {
    const sites = RUNNER_SRC.match(/kind:\s*'absent'/g) ?? [];
    // One in the RungOutcome type declaration, one in the factory. Nothing else
    // may build the absent arm by hand.
    expect(sites.length).toBe(2);
    expect(RUNNER_SRC).toMatch(
      /function absent\(evidence: AnsweredResponse\)[\s\S]{0,240}kind:\s*'absent',\s*evidence/
    );
  });

  it('every absent() call site passes an argument', () => {
    const empty = RUNNER_SRC.match(/\babsent\(\s*\)/g) ?? [];
    expect(empty).toEqual([]);
  });

  it('mints an AnsweredResponse in exactly one place, and only from a 200', () => {
    const brandWrites = RUNNER_SRC.match(/\[ANSWERED\]:\s*true/g) ?? [];
    expect(brandWrites.length).toBe(1);
    expect(
      answeredFrom({ status: 503, contentType: null, body: Buffer.alloc(0), url: 'u' })
    ).toBeNull();
    expect(
      answeredFrom({ status: 404, contentType: null, body: Buffer.alloc(0), url: 'u' })
    ).toBeNull();
    expect(
      answeredFrom({ status: 0, contentType: null, body: Buffer.alloc(0), url: 'u' })
    ).toBeNull();
    const ok = answeredFrom({
      status: 200,
      contentType: 'text/html',
      body: Buffer.from('hello'),
      url: 'https://x/p',
    });
    expect(ok).not.toBeNull();
    expect(ok!.status).toBe(200);
    expect(ok!.bytes).toBe(5);
  });

  it('no rung returns the bare string literals the old union used', () => {
    // The old union `... | 'failed' | 'absent'` is what let an early return mint
    // absence. Its literals must not survive as rung return values.
    expect(RUNNER_SRC).not.toMatch(/return\s+'absent'\s*;/);
    expect(RUNNER_SRC).not.toMatch(/return\s+'failed'\s*;/);
  });
});

// ---------------------------------------------------------------------------
// Behavioural: the three budget sites, and the investor-page 403
// ---------------------------------------------------------------------------

const html = (body: string, url = 'https://x/page'): HttpResponse => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: Buffer.from(body),
  url,
});
const json = (body: string, url = 'https://x/api'): HttpResponse => ({
  status: 200,
  contentType: 'application/json',
  body: Buffer.from(body),
  url,
});
const fail = (status: number, url = 'https://x/fail'): HttpResponse => ({
  status,
  contentType: null,
  body: Buffer.alloc(0),
  url,
});

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-r5-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner(responses: Record<string, HttpResponse>, escalationBudget?: number) {
  const seen: string[] = [];
  const fetcher: HttpFetcher = async (url) => {
    seen.push(url);
    for (const [needle, response] of Object.entries(responses)) {
      if (url.includes(needle)) return response;
    }
    return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
  };
  const store = new InMemoryDocumentFetchStateStore();
  const documents = {
    async upsertDocument() {
      return { id: 'doc-1' };
    },
  };
  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store,
    documents: documents as never,
    counter: new NetworkCounter(),
    now: () => new Date('2026-08-28T06:00:00Z'),
    storeDir,
    sleep: async () => undefined,
    escalationBudget,
    extractCoverText: async () => ({ usable: false }),
  });
  return { runner, store, seen };
}

const NO_EXCHANGE = {
  IPO_HomePageDetail: json(JSON.stringify({ Table: [] })),
  'ipo-detail': json(JSON.stringify({ issueInfo: { dataList: [] } })),
};

const openIpo = (over: Partial<DiscoveryIpo> = {}): DiscoveryIpo => ({
  id: 'ipo-r5',
  companyName: 'Evidence Industries Limited',
  symbol: 'EVID',
  segment: 'MAINBOARD',
  stage: 'OPEN',
  bseIpoNo: null,
  ...over,
});

async function statesOf(store: InMemoryDocumentFetchStateStore, ipoId: string) {
  const rows = await store.listForIpo(ipoId);
  return rows.map((r) => r.state);
}

describe('a refused escalation GET is never evidence that the company has not filed', () => {
  it('SEBI, company and verifier budget refusals all leave BLOCKED_ALL, not NOT_YET_FILED', async () => {
    // Budget of 1: the first escalation GET goes out, every rung after it is
    // refused WITHOUT a request. Under the old string union each refusal
    // returned 'absent' and the row settled as "the company has not filed it".
    const { runner, store } = makeRunner(
      {
        ...NO_EXCHANGE,
        'sebi.gov.in': html('<table id="sample_1"></table>'),
        'evid.example.com': html('<p>no filings here</p>'),
        'chittorgarh.com': html('<a href="https://nsearchives.nseindia.com/x.pdf">RHP</a>'),
      },
      1
    );

    const result = await runner.runIpo(
      openIpo({
        companyWebsite: 'https://evid.example.com',
        verifierUrl: 'https://www.chittorgarh.com/ipo/evid/1/',
      }),
      []
    );

    expect(result.due.length).toBeGreaterThan(2);
    const states = await statesOf(store, 'ipo-r5');
    expect(states).not.toContain('NOT_YET_FILED');
    expect(states.every((s) => s === 'BLOCKED_ALL')).toBe(true);
    const chains = result.attempts
      .filter((a) => a.source === 'CHAIN')
      .map((a) => a.outcome)
      .join('\n');
    expect(chains).toMatch(/budget/);
  }, 60_000);

  it('an investor page that answers 403 is a failure, not an absence', async () => {
    // Page 1 answers with no link; a later page returns 403. A 403 is the server
    // refusing to say anything, so the rung learned nothing about that page -
    // "a page answered and does not carry it" is not true of the SET of pages.
    const { runner, store } = makeRunner({
      ...NO_EXCHANGE,
      'evid.example.com/investors': html('<p>nothing</p>'),
      'evid.example.com/investor-relations': fail(403),
    });

    const result = await runner.runIpo(
      openIpo({ id: 'ipo-403', companyWebsite: 'https://evid.example.com' }),
      []
    );

    expect(result.due.length).toBeGreaterThan(0);
    const states = await statesOf(store, 'ipo-403');
    expect(states).not.toContain('NOT_YET_FILED');
    expect(states).toContain('BLOCKED_ALL');
  }, 60_000);

  it('a page that genuinely answers with no link IS an absence', async () => {
    // The control: the mechanism must not turn every outcome into a failure.
    // A 404 on the other investor paths is normal - most issuers lack them.
    const { runner, store } = makeRunner({
      ...NO_EXCHANGE,
      'sebi.gov.in': html('<table id="sample_1"></table>'),
      'evid.example.com': html('<p>no filings here</p>'),
    });

    const result = await runner.runIpo(
      openIpo({ id: 'ipo-honest', companyWebsite: 'https://evid.example.com' }),
      []
    );

    expect(result.due.length).toBeGreaterThan(0);
    const states = await statesOf(store, 'ipo-honest');
    expect(states).toContain('NOT_YET_FILED');
  }, 60_000);
});

describe('the verifier page is fetched once per cycle, not once per due type', () => {
  it('costs one GET however many types escalate', async () => {
    const { runner, seen } = makeRunner({
      ...NO_EXCHANGE,
      'sebi.gov.in': html('<table id="sample_1"></table>'),
      'chittorgarh.com': html('<p>no links</p>'),
    });

    const result = await runner.runIpo(
      openIpo({ id: 'ipo-verif', verifierUrl: 'https://www.chittorgarh.com/ipo/evid/1/' }),
      []
    );

    expect(result.due.length).toBeGreaterThan(2);
    expect(seen.filter((u) => u.includes('chittorgarh.com')).length).toBe(1);
  }, 60_000);
});

describe('the verifier URL is re-validated on READ, not only on write', () => {
  it('refuses to fetch a verifier_url that is not a chittorgarh https URL', async () => {
    const { runner, seen } = makeRunner({
      ...NO_EXCHANGE,
      'sebi.gov.in': html('<table id="sample_1"></table>'),
    });

    await runner.runIpo(
      openIpo({ id: 'ipo-bad-verif', verifierUrl: 'https://evil.test/ipo/evid/1/' }),
      []
    );

    expect(seen.filter((u) => u.includes('evil.test'))).toEqual([]);
  }, 60_000);
});
