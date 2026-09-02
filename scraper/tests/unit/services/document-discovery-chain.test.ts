import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';

/**
 * T-403 G1/G2/G4 — the FULL four-rung chain, end to end.
 *
 * The rungs are only worth anything if they are reached in the right order and
 * recorded honestly, so these tests drive the whole chain rather than each rung
 * in isolation:
 *
 *   1. BSE fail -> NSE fail -> SEBI FOUND
 *   2. BSE fail -> NSE fail -> SEBI not listed -> COMPANY HOST found
 *   3. all four fail -> BLOCKED_ALL, with four rung entries in the attempt log
 *
 * G4's rule is the point of the third: the state may not become BLOCKED_ALL
 * until every rung has actually been consulted or explicitly skipped with a
 * reason. "We stopped early" must never look like "the document is unreachable".
 */

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');

const realisticPdf = (marker = 'A') =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(marker.repeat(80_000))]);

const html = (body: string, url = 'https://x/page'): HttpResponse => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: Buffer.from(body),
  url,
});
const pdf = (body: Buffer, url = 'https://x/doc.pdf'): HttpResponse => ({
  status: 200,
  contentType: 'application/pdf',
  body,
  url,
});
const dead: HttpResponse = { status: 0, contentType: null, body: Buffer.alloc(0), url: 'x' };

/** ESDS: on the BSE board, on NSE, AND on SEBI's RHP listing — so all rungs apply. */
const ESDS: DiscoveryIpo = {
  id: 'ipo-esds',
  companyName: 'ESDS Software Solution Limited',
  symbol: 'ESDS',
  segment: 'MAINBOARD',
  stage: 'PRE_OPEN',
  bseIpoNo: 7916,
};

/** Only the RHP is outstanding, so the chain is exercised on exactly one type. */
const onlyRhpDue = ['DRHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE', 'ANCHOR_ALLOCATION_REPORT'].map(
  (docType) => ({
    docType,
    state: 'FOUND' as const,
    attempts: 1,
    nextRetryAt: null,
    blockedSinceAt: null,
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: null,
  })
);

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-chain-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner(responses: Record<string, HttpResponse>, coverCompany = 'ESDS Software Solution Limited') {
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
    rows: [] as { type: string; exchange: string; url: string }[],
    async upsertDocument(doc: { type: string; exchange: string; url: string }) {
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
    // MIN-4: no-op sleep — the retry ladder's timing is not what these test.
    sleep: async () => undefined,
    // Cover text is stubbed: the chain, not the PDF parser, is under test here.
    // The cover must name the company under test, or §3 step 4 correctly
    // rejects the download as another company's filing.
    extractCoverText: async () => ({
      usable: true,
      text: `${coverCompany} red herring prospectus`,
    }),
  });
  return { runner, store, documents, seen };
}

/** The `rungs[...]` line the runner writes for a document type (G4). */
function rungsFor(attempts: { source: string; outcome: string }[], docType: string): string {
  const entry = attempts.find((a) => a.source === 'CHAIN' && a.outcome.startsWith(`rungs[${docType}]`));
  return entry?.outcome ?? '';
}

/** Both exchanges dead — the shared setup for every chain scenario. */
const EXCHANGES_DOWN = {
  IPO_HomePageDetail: dead,
  GetMkt_ISSUE_BBS_IPO: dead,
  'ipo-detail': dead,
};

describe('G1 — chain reaches SEBI when both exchanges fail', () => {
  it('BSE fail -> NSE fail -> SEBI FOUND, and the document is stored from SEBI', async () => {
    const sebiPdf = realisticPdf('S');
    const { runner, documents, seen } = makeRunner({
      ...EXCHANGES_DOWN,
      'smid=11': html(fixture('sebi-rhp-listing.html')),
      'esds-software-solution-limited-rhp': html(fixture('sebi-detail-esds.html')),
      'attachdocs/aug-2026/1787651434841.pdf': pdf(sebiPdf),
    });

    const result = await runner.runIpo(ESDS, onlyRhpDue as never);

    expect(result.due).toEqual(['RHP']);
    expect(result.found).toEqual(['RHP']);
    expect(result.blocked).toEqual([]);
    expect(documents.rows.find((d) => d.type === 'RHP')?.exchange).toBe('SEBI');

    // V-3: assert the EXACT ordered chain, not merely that the parts appear.
    // A rung firing out of order, or an extra rung, is a defect a `toContain`
    // pair would happily pass.
    // W-27: the SEBI rung is now a WALK (page 1, then search, then paging), so
    // the sub-step it actually resolved on is part of the honest chain. Here the
    // company is on page 1, so the walk stops there.
    expect(rungsFor(result.attempts as never, 'RHP').split(' -> ')).toEqual([
      'rungs[RHP]: EXCHANGES:failed',
      'SEBI:page1',
      'SEBI:found',
    ]);

    // SEBI cost exactly two GETs: the listing and the detail page.
    expect(seen.filter((u) => u.includes('sebi.gov.in')).length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('does not consult SEBI at all for a type SEBI never hosts', async () => {
    const { runner, seen } = makeRunner({ ...EXCHANGES_DOWN });
    // Only the price-band ad outstanding — SEBI has no listing for it.
    const rows = ['DRHP', 'RHP', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE', 'ANCHOR_ALLOCATION_REPORT'].map(
      (docType) => ({ ...onlyRhpDue[0], docType })
    );

    const result = await runner.runIpo(ESDS, rows as never);

    expect(result.due).toEqual(['PRICE_BAND_AD']);
    expect(seen.some((u) => u.includes('sebi.gov.in'))).toBe(false);
    expect(rungsFor(result.attempts as never, 'PRICE_BAND_AD')).toContain(
      'SEBI:skipped:not_served_by_sebi'
    );
  }, 60_000);
});

describe('G2 — chain reaches the company host when SEBI does not list the company', () => {
  it('BSE fail -> NSE fail -> SEBI not listed -> COMPANY HOST found', async () => {
    const companyPdf = realisticPdf('C');
    const { runner, documents } = makeRunner({
      ...EXCHANGES_DOWN,
      // SEBI answers, but this company is not on the listing.
      'smid=11': html(fixture('sebi-rhp-listing.html')),
      // W-72: the search + paging POSTs must ANSWER too, otherwise the walk is
      // aborted rather than completed and "not listed" would be a claim about
      // requests that failed. Same listing back: a completed walk, no match.
      jsessionid: html(fixture('sebi-rhp-listing.html')),
      '/investors': html(
        '<a href="/docs/RHP_Unlisted.pdf">Red Herring Prospectus</a>',
        'https://unlisted.example.com/investors'
      ),
      '/docs/RHP_Unlisted.pdf': pdf(companyPdf),
    }, 'Unlisted Example Industries Limited');

    const notOnSebi: DiscoveryIpo = {
      ...ESDS,
      id: 'ipo-unlisted',
      companyName: 'Unlisted Example Industries Limited',
      companyWebsite: 'https://unlisted.example.com',
    };

    const result = await runner.runIpo(notOnSebi, onlyRhpDue as never);

    expect(result.found).toEqual(['RHP']);
    expect(documents.rows.find((d) => d.type === 'RHP')?.exchange).toBe('COMPANY');

    const rungs = rungsFor(result.attempts as never, 'RHP');
    expect(rungs).toContain('EXCHANGES:failed');
    expect(rungs).toContain('SEBI:not_listed');
    expect(rungs).toContain('COMPANY:found');
  }, 60_000);

  it('records no_company_url rather than silently skipping the rung', async () => {
    const { runner, seen } = makeRunner({
      ...EXCHANGES_DOWN,
      'smid=11': html(fixture('sebi-rhp-listing.html')),
    });

    const noSite: DiscoveryIpo = {
      ...ESDS,
      id: 'ipo-nosite',
      companyName: 'Unlisted Example Industries Limited',
    };
    // No cover text is ever produced, so no website can be learned either.
    const result = await runner.runIpo(noSite, onlyRhpDue as never);

    expect(rungsFor(result.attempts as never, 'RHP')).toContain('COMPANY:skipped:no_company_url');
    expect(seen.some((u) => u.includes('example.com'))).toBe(false);
  }, 60_000);
});

describe('G4 — BLOCKED_ALL only after all four rungs, each with an outcome', () => {
  it('all four fail -> BLOCKED_ALL with four rung entries in the attempt log', async () => {
    const { runner, store } = makeRunner({
      ...EXCHANGES_DOWN,
      'smid=11': html(fixture('sebi-rhp-listing.html')), // answers, company absent
      // W-27: the SEBI rung now searches and pages beyond page 1. SEBI answers
      // every one of those POSTs and still never names this company — which is
      // what makes 'SEBI:not_listed' below evidence rather than a guess.
      'HomeAction.do;jsessionid': html('<table id="sample_1"></table>'),
      // Checked BEFORE the company paths: a real Chittorgarh IPO URL contains
      // "/ipo", which would otherwise match the company-host path key first.
      chittorgarh: html('<a href="https://www.chittorgarh.com/own/copy.pdf">RHP</a>'),
      '/investors': { status: 404, contentType: 'text/html', body: Buffer.from('x'), url: 'a' },
      '/investor-relations': { status: 404, contentType: 'text/html', body: Buffer.from('x'), url: 'b' },
      '/ipo': { status: 404, contentType: 'text/html', body: Buffer.from('x'), url: 'c' },
    });

    const allFail: DiscoveryIpo = {
      ...ESDS,
      id: 'ipo-allfail',
      companyName: 'Unlisted Example Industries Limited',
      companyWebsite: 'https://unlisted.example.com',
      verifierUrl: 'https://www.chittorgarh.com/ipo/unlisted/1/',
    };

    const result = await runner.runIpo(allFail, onlyRhpDue as never);

    expect(result.found).toEqual([]);
    expect(result.blocked).toEqual(['RHP']);
    expect(store.all().find((r) => r.docType === 'RHP')!.state).toBe('BLOCKED_ALL');

    // FOUR rungs, in order, each with its own outcome — the SEBI rung spelling
    // out its whole W-27 walk (page 1 -> search -> pages -> exhausted) before it
    // is allowed to say 'not_listed'.
    const rungs = rungsFor(result.attempts as never, 'RHP');
    const parts = rungs.split(' -> ');
    expect(parts).toEqual([
      'rungs[RHP]: EXCHANGES:failed',
      'SEBI:page1',
      'SEBI:searched',
      'SEBI:paged:1',
      'SEBI:paged:2',
      'SEBI:paged:3',
      'SEBI:paged:4',
      'SEBI:paged:5',
      'SEBI:paged:6',
      'SEBI:paged:exhausted',
      'SEBI:not_listed',
      // H-2 sharpened this label: all three investor paths 404, so no page
      // ANSWERED — a different fact from "a page answered and had no link", and
      // the one that must not be read as evidence the filing does not exist.
      'COMPANY:failed:no_page',
      'VERIFIER:no_new_link',
    ]);
    // The four rung FAMILIES, still in order and still each accounted for.
    expect(parts.map((p) => p.replace('rungs[RHP]: ', '').split(':')[0]).filter((f, i, a) => f !== a[i - 1])).toEqual([
      'EXCHANGES',
      'SEBI',
      'COMPANY',
      'VERIFIER',
    ]);
  }, 60_000);

  it('NEVER stores a document from the verifier\'s own host', async () => {
    // Chittorgarh hosts its own copy. It must be ignored, and the exchange link
    // it also shows must be the one followed.
    const bsePdf = realisticPdf('B');
    const { runner, documents } = makeRunner({
      ...EXCHANGES_DOWN,
      'smid=11': html(fixture('sebi-rhp-listing.html')),
      chittorgarh: html(
        '<a href="https://www.chittorgarh.com/own/copy.pdf">Red Herring Prospectus</a>' +
          '<a href="https://listing.bseindia.com/Download/RHP_Corrected.pdf">Red Herring Prospectus</a>'
      ),
      'RHP_Corrected.pdf': pdf(bsePdf),
    }, 'Unlisted Example Industries Limited');

    const viaVerifier: DiscoveryIpo = {
      ...ESDS,
      id: 'ipo-verifier',
      companyName: 'Unlisted Example Industries Limited',
      verifierUrl: 'https://www.chittorgarh.com/ipo/unlisted/1/',
    };

    const result = await runner.runIpo(viaVerifier, onlyRhpDue as never);

    expect(result.found).toEqual(['RHP']);
    const stored = documents.rows.find((d) => d.type === 'RHP')!;
    expect(stored.url).toBe('https://listing.bseindia.com/Download/RHP_Corrected.pdf');
    expect(stored.url).not.toContain('chittorgarh');
    expect(rungsFor(result.attempts as never, 'RHP')).toContain('VERIFIER:found_via_corrected_link');
  }, 60_000);

  it('does NOT escalate when the exchanges merely said "not filed yet" (F3)', async () => {
    // Both exchanges answer and simply have no link. That is NOT_YET_FILED, and
    // burning SEBI + three company GETs on it every 30 minutes would be waste.
    const { runner, seen } = makeRunner({
      IPO_HomePageDetail: html('{"Table":[]}'),
      GetMkt_ISSUE_BBS_IPO: {
        status: 200,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ IPONO_0: [{ IPO_NO: '7916' }] })),
        url: 'bse',
      },
      'ipo-detail': {
        status: 200,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ issueInfo: { dataList: [] } })),
        url: 'nse',
      },
    });

    const result = await runner.runIpo(ESDS, onlyRhpDue as never);

    // W-28/W-46: the RHP IS due at PRE_OPEN, so a clean exchange miss is a
    // discovery miss (NOT_FOUND, 60-min backoff) — NOT_YET_FILED is now reserved
    // for a type the stage says is not due yet, or an optional one. The point of
    // this test is unchanged: no escalation was spent on it.
    expect(result.notFound).toEqual(['RHP']);
    expect(result.notYetFiled).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(seen.some((u) => u.includes('sebi.gov.in'))).toBe(false);
    expect(rungsFor(result.attempts as never, 'RHP')).toContain('SEBI:skipped:exchanges_settled_it');
  }, 60_000);
});
