import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  sourceOfDocumentUrl,
  ESCALATION_GET_BUDGET_PER_IPO,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';
import { parseNseLeadManagers } from '../../../src/services/nse-party-parser.js';

/**
 * T-403 round 4 — the chain-level findings from the third review and from
 * Fable's own live run.
 *
 * Every case here is one the previous rounds' evidence PASSED while the defect
 * was live, which is why each is pinned as a test rather than as a note.
 */

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');
const NSE_LIVE = join(__dirname, '../../fixtures/nse/ipo-detail-SKYWAYS.live-2026-08-28.json');

const realisticPdf = (marker = 'A') =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(marker.repeat(80_000))]);

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
const pdf = (body: Buffer, url = 'https://x/doc.pdf'): HttpResponse => ({
  status: 200,
  contentType: 'application/pdf',
  body,
  url,
});
const fail = (status: number, url = 'https://x/fail'): HttpResponse => ({
  status,
  contentType: null,
  body: Buffer.alloc(0),
  url,
});

const CLEAN_EXCHANGES = {
  IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
  GetMkt_ISSUE_BBS_IPO: json(fixture('bse-skyways-core.json')),
  'ipo-detail': json(fixture('nse-skyways.json')),
};

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-r4-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner(
  responses: Record<string, HttpResponse>,
  coverCompany = 'Acme Industries Limited',
  escalationBudget?: number
) {
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
    rows: [] as { type: string; exchange: string; sha256?: string }[],
    async upsertDocument(doc: { type: string; exchange: string; sha256?: string }) {
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
    sleep: async () => undefined,
    escalationBudget,
    extractCoverText: async () => ({ usable: true, text: coverCompany + ' prospectus' }),
  });
  return { runner, store, documents, seen };
}

function rungsFor(attempts: { source: string; outcome: string }[], docType: string): string {
  const prefix = 'rungs[' + docType + ']';
  return attempts.find((a) => a.source === 'CHAIN' && a.outcome.startsWith(prefix))?.outcome ?? '';
}

const upcoming = (over: Partial<DiscoveryIpo> = {}): DiscoveryIpo => ({
  id: 'ipo-acme',
  companyName: 'Acme Industries Limited',
  symbol: 'ACME',
  segment: 'MAINBOARD',
  stage: 'UPCOMING',
  bseIpoNo: 7903,
  ...over,
});

// ---------------------------------------------------------------------------
// H-2
// ---------------------------------------------------------------------------

describe('H-2 an escalation rung that FAILS must not mint NOT_YET_FILED', () => {
  it('SEBI 503 on a DRHP lands the row in BLOCKED_ALL, not NOT_YET_FILED', async () => {
    // The exchanges answer cleanly and carry no DRHP — none ever does — so the
    // chain escalates (that is B-1). SEBI then returns 503. Before this fix
    // every SEBI failure path returned null, which the caller could not tell
    // from "SEBI does not list it", so the row was written NOT_YET_FILED: "the
    // company has not filed its draft prospectus", concluded from a 503.
    const { runner, store } = makeRunner({ ...CLEAN_EXCHANGES, 'smid=10': fail(503) });

    const result = await runner.runIpo(upcoming(), []);

    expect(result.due).toEqual(['DRHP']);
    expect(result.blocked).toEqual(['DRHP']);
    expect(result.notYetFiled).toEqual([]);
    expect(rungsFor(result.attempts as never, 'DRHP')).toContain('SEBI:failed:http_error');

    // BLOCKED_ALL is the state that carries the retry ladder — the whole point
    // of not settling as NOT_YET_FILED is that this row comes back.
    const row = (await store.listForIpo('ipo-acme')).find((r) => r.docType === 'DRHP');
    expect(row?.state).toBe('BLOCKED_ALL');
    expect(row?.nextRetryAt).toBeInstanceOf(Date);
  }, 60_000);

  it('SEBI listing the filing but serving no PDF is a failure, not an absence', async () => {
    const { runner } = makeRunner({
      ...CLEAN_EXCHANGES,
      'smid=10': html(
        '<table id="sample_1"><tr><td>Aug 20, 2026</td>' +
          '<td><a href="https://www.sebi.gov.in/filings/public-issues/aug-2026/acme-drhp_1.html" ' +
          'title="Acme Industries Limited - DRHP">Acme Industries Limited - DRHP</a></td></tr></table>'
      ),
      // The detail page loads and carries no PDF link at all.
      'acme-drhp_1.html': html('<p>Document temporarily unavailable</p>'),
    });

    const result = await runner.runIpo(upcoming(), []);

    expect(result.blocked).toEqual(['DRHP']);
    expect(result.notYetFiled).toEqual([]);
    expect(rungsFor(result.attempts as never, 'DRHP')).toContain('SEBI:failed:no_pdf_on_detail_page');
  }, 60_000);

  it('SEBI answering and simply not listing the filing IS an absence', async () => {
    // The other direction, so the fix cannot degenerate into "call everything a
    // failure": an empty SEBI list is real evidence the draft is not filed yet.
    const { runner } = makeRunner({
      ...CLEAN_EXCHANGES,
      'smid=10': html('<table id="sample_1"></table>'),
    });

    const result = await runner.runIpo(upcoming(), []);

    expect(result.notYetFiled).toEqual(['DRHP']);
    expect(result.blocked).toEqual([]);
    expect(rungsFor(result.attempts as never, 'DRHP')).toContain('SEBI:not_listed');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// H-3
// ---------------------------------------------------------------------------

describe('H-3 one SEBI HTTP error must not be cached as "not listed" for the cycle', () => {
  it('a later IPO records the cached FAILURE, not a not_listed it never checked', async () => {
    const { runner, seen } = makeRunner({ ...CLEAN_EXCHANGES, 'smid=10': fail(503) });

    const first = await runner.runIpo(upcoming({ id: 'ipo-one', companyName: 'One Limited' }), []);
    const second = await runner.runIpo(upcoming({ id: 'ipo-two', companyName: 'Two Limited' }), []);

    expect(rungsFor(first.attempts as never, 'DRHP')).toContain('SEBI:failed:http_error');
    // The lie this pins: the second IPO used to read 'SEBI:not_listed', an
    // assertion about a request that was never made.
    expect(rungsFor(second.attempts as never, 'DRHP')).toContain('SEBI:failed:cached_http_error');
    expect(second.blocked).toEqual(['DRHP']);

    // Still cached — one 503 must not become one request per IPO.
    expect(seen.filter((u) => u.includes('smid=10')).length).toBe(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// F-1
// ---------------------------------------------------------------------------

describe('F-1 the retry ladder must be visible in the attempt log', () => {
  it('three BSE core tries produce three logged tries, not one 7-second line', async () => {
    // Fable's 2026-08-28 run showed a single BSE attempt reading "http 0, ms
    // 6762" — three real requests and two sleeps, collapsed into one line that
    // reads like one request that hung. A reviewer concluded the retry was not
    // wired. An attempt log that hides the retries cannot be used to check them.
    const { runner, seen } = makeRunner({
      IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
      GetMkt_ISSUE_BBS_IPO: fail(0),
      'ipo-detail': json(fixture('nse-skyways.json')),
    });

    const result = await runner.runIpo(upcoming(), []);

    expect(seen.filter((u) => u.includes('GetMkt_ISSUE_BBS_IPO')).length).toBe(3);
    const tries = result.attempts.filter(
      (a) => a.source === 'BSE' && /^timeout:try\dof3$/.test(a.outcome)
    );
    expect(tries.map((t) => t.outcome)).toEqual([
      'timeout:try1of3',
      'timeout:try2of3',
      'timeout:try3of3',
    ]);
    // The plain summary line still exists, so the F3/F6 coverage logic that
    // matches on exact outcome strings is unaffected.
    expect(result.attempts.some((a) => a.source === 'BSE' && a.outcome === 'http_error')).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// F-2
// ---------------------------------------------------------------------------

describe('F-2 lead managers survive one exchange being down', () => {
  it('parses all three book running lead managers out of the NSE payload', () => {
    const payload = JSON.parse(readFileSync(NSE_LIVE, 'utf8'));
    const names = parseNseLeadManagers(payload.issueInfo);
    // NSE packs them into one sentence: "A, B and C". Splitting on commas alone
    // merges the last two firms — the co-BRLM undercount (F17).
    expect(names).toEqual([
      'Holani Consultants Private Limited',
      'Shannon Advisors Private Limited',
      'Dolat Finserv Private Limited',
    ]);
  });

  it('the runner fills them from NSE when the BSE core call fails', async () => {
    const nsePayload = JSON.parse(readFileSync(NSE_LIVE, 'utf8'));
    const { runner } = makeRunner({
      IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
      GetMkt_ISSUE_BBS_IPO: fail(0),
      'ipo-detail': json(JSON.stringify(nsePayload)),
    });

    const result = await runner.runIpo(upcoming({ stage: 'OPEN', symbol: 'SKYWAYS' }), []);

    expect(result.leadManagers).toHaveLength(3);
    expect(result.leadManagerSource).toBe('NSE');
  }, 60_000);

  it('BSE still wins when it answers — NSE is the fallback, not a competitor', async () => {
    const { runner } = makeRunner(CLEAN_EXCHANGES);
    const result = await runner.runIpo(upcoming({ stage: 'OPEN', symbol: 'SKYWAYS' }), []);
    expect(result.leadManagerSource).toBe('BSE');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// F-4
// ---------------------------------------------------------------------------

describe('F-4 a row last_attempt carries only its own type chain', () => {
  it('does not staple every other document type rung chain onto every row', async () => {
    const { runner, store } = makeRunner(CLEAN_EXCHANGES);

    const result = await runner.runIpo(upcoming({ stage: 'OPEN', symbol: 'SKYWAYS' }), []);
    expect(result.due.length).toBeGreaterThan(1);

    for (const row of await store.listForIpo('ipo-acme')) {
      const chains = ((row.lastAttempt ?? []) as { source: string; outcome: string }[]).filter(
        (a) => a.source === 'CHAIN'
      );
      // Exactly one chain line, and it must be THIS row's type. The old filter
      // kept every CHAIN entry (they all lack a url), so a nine-type IPO wrote
      // nine chains onto each of its nine rows.
      expect(chains).toHaveLength(1);
      expect(chains[0].outcome.startsWith('rungs[' + row.docType + ']')).toBe(true);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// M-d
// ---------------------------------------------------------------------------

describe('M-d escalation is budgeted, and investor pages are fetched once per cycle', () => {
  it('fetches each investor page once no matter how many types escalate', async () => {
    // The un-cached version fetched the same page once per DUE TYPE — four GETs
    // of one investor page in the observed run, up to 27 for a nine-type IPO.
    const { runner, seen } = makeRunner({
      // BSE is off the board and NSE has nothing, so every type escalates.
      IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
      'ipo-detail': json(JSON.stringify({ issueInfo: { dataList: [] } })),
      'acme.example.com/investors': html('<a href="/annual-report.pdf">Annual Report</a>'),
    });

    const result = await runner.runIpo(
      upcoming({
        id: 'ipo-budget',
        companyName: 'Budget Industries Limited',
        stage: 'OPEN',
        bseIpoNo: null,
        companyWebsite: 'https://acme.example.com',
      }),
      []
    );

    expect(result.due.length).toBeGreaterThan(2);
    const investorGets = seen.filter((u) => u.includes('acme.example.com/investors')).length;
    expect(investorGets).toBe(1);
  }, 60_000);

  it('never exceeds the per-IPO escalation budget', async () => {
    const { runner, seen, store } = makeRunner({
      IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
      'ipo-detail': json(JSON.stringify({ issueInfo: { dataList: [] } })),
      'sebi.gov.in': html('<table id="sample_1"></table>'),
      'cap.example.com': html('<p>nothing here</p>'),
    });

    const result = await runner.runIpo(
      upcoming({
        id: 'ipo-cap',
        companyName: 'Cap Industries Limited',
        stage: 'OPEN',
        bseIpoNo: null,
        companyWebsite: 'https://cap.example.com',
      }),
      []
    );

    // Counted as REQUESTS, not as attempt lines: a cached investor page still
    // records a per-type `links:N` line (that is the point of the per-type
    // record), and the budget governs what goes on the wire.
    expect(result.due.length).toBeGreaterThan(2);
    const escalationGets = seen.filter(
      (u) => u.includes('sebi.gov.in') || u.includes('cap.example.com')
    ).length;
    expect(escalationGets).toBeGreaterThan(0);
    expect(escalationGets).toBeLessThanOrEqual(ESCALATION_GET_BUDGET_PER_IPO);

    // T-403 r5 detection-gap upgrade, part 1: assert the row STATE, not just
    // the call count. Here the budget is never reached, every rung answers, and
    // NOT_YET_FILED is the CORRECT settlement - so the assertion is that the
    // rows exist, carry their own chain, and none of them concluded anything
    // from a rung that did not answer.
    const rows = await store.listForIpo('ipo-cap');
    expect(rows.length).toBe(result.due.length);
    for (const row of rows) {
      const chain = rungsFor((row.lastAttempt ?? []) as never, row.docType);
      expect(chain).not.toBe('');
      if (/budget/.test(chain)) expect(row.state).not.toBe('NOT_YET_FILED');
    }
  }, 60_000);

  it('when the cap DOES bite, the row stays retryable and never says "not filed"', async () => {
    // Part 2, and the finding itself: this is the case the old test never
    // built. A budget refusal is a request we chose not to make, so it can say
    // nothing about whether the company filed - yet all three refusal sites
    // returned 'absent', and the row settled NOT_YET_FILED with its retry
    // ladder cleared. The budget is injected rather than manufactured with
    // thirteen fixtures: its EFFECT on the row is identical at 1 and at 12.
    const { runner, store } = makeRunner(
      {
        IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
        'ipo-detail': json(JSON.stringify({ issueInfo: { dataList: [] } })),
        'sebi.gov.in': html('<table id="sample_1"></table>'),
        'cap.example.com': html('<p>nothing here</p>'),
      },
      'Acme Industries Limited',
      1
    );

    const result = await runner.runIpo(
      upcoming({
        id: 'ipo-cap-bites',
        companyName: 'Cap Industries Limited',
        stage: 'OPEN',
        bseIpoNo: null,
        companyWebsite: 'https://cap.example.com',
      }),
      []
    );

    const rows = await store.listForIpo('ipo-cap-bites');
    expect(rows.length).toBe(result.due.length);
    expect(rows.map((r) => r.state)).not.toContain('NOT_YET_FILED');
    expect(rows.every((r) => r.state === 'BLOCKED_ALL')).toBe(true);
    // and the reason is in the audit trail, not inferred
    const chains = rows
      .map((r) => rungsFor((r.lastAttempt ?? []) as never, r.docType))
      .join('\n');
    expect(chains).toMatch(/budget/);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// NIT-4
// ---------------------------------------------------------------------------

describe('NIT-4 the source label is decided by host', () => {
  it('does not read a substring of the path or the query as an exchange', () => {
    expect(sourceOfDocumentUrl('https://www.bseindia.com/x.pdf')).toBe('BSE');
    expect(sourceOfDocumentUrl('https://listing.bseindia.com/x.pdf')).toBe('BSE');
    expect(sourceOfDocumentUrl('https://www.sebi.gov.in/x.pdf')).toBe('SEBI');
    expect(sourceOfDocumentUrl('https://nsearchives.nseindia.com/x.zip')).toBe('NSE');
    // The substring version labelled this BSE.
    expect(sourceOfDocumentUrl('https://cdn.example.com/f.pdf?ref=bseindia')).toBe('NSE');
    expect(sourceOfDocumentUrl('https://evil.test/sebi.gov.in/f.pdf')).toBe('NSE');
    // r5 (7): a string that is not a URL at all was labelled 'NSE' - a real
    // exchange's name stamped on something we could not parse, in the one
    // record whose job is to say where a file came from.
    expect(sourceOfDocumentUrl('not a url')).toBe('UNKNOWN');
    expect(sourceOfDocumentUrl('')).toBe('UNKNOWN');
  });
});
