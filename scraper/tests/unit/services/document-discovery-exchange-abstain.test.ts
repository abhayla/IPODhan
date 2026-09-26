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
 * #632 — an exchange that does not CARRY an issue has abstained; it has neither
 * answered for the issue nor failed.
 *
 * Measured on staging 2026-09-26 (482 BLOCKED_ALL rows, 108 IPOs):
 *  - 181 rows / 44 SME IPOs were "settled" by `NSE:ok` alone, and the SEBI,
 *    company and verifier rungs were skipped (`exchanges_settled_it`). Live, 29
 *    of those 44 NSE symbols return HTTP 200 with `issueInfo: {}` — NSE does not
 *    list the issue (SME-on-BSE), so "ok" was a non-answer settling the type.
 *  - 159 rows / 27 IPOs whose exchanges only said `no_symbol` / `not_on_board`
 *    (abstentions, not failures) were recorded `EXCHANGES:failed`, which sends a
 *    row to BLOCKED_ALL on the first concluded chain instead of the discovery-miss
 *    ladder.
 *
 * The NSE payload below is the real response for PESHWA (series SME), captured
 * 2026-09-26.
 */

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');

const json = (body: string, url = 'https://x/api'): HttpResponse => ({
  status: 200,
  contentType: 'application/json',
  body: Buffer.from(body),
  url,
});
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
const realisticPdf = (marker = 'A') =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(marker.repeat(80_000))]);

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
const ALL_BUT_PROSPECTUS = [
  'DRHP', 'RHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE',
  'ANCHOR_ALLOCATION_REPORT', 'ADDENDUM', 'BASIS_OF_ALLOTMENT_AD',
].map(done);

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'i632-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner(responses: Record<string, HttpResponse>, coverCompany: string) {
  const seen: string[] = [];
  const fetcher: HttpFetcher = async (url) => {
    seen.push(url);
    for (const [needle, response] of Object.entries(responses)) {
      if (url.includes(needle)) return response;
    }
    return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
  };
  const documents = {
    rows: [] as { type: string; exchange: string }[],
    async upsertDocument(doc: { type: string; exchange: string }) {
      this.rows.push(doc);
      return { id: 'doc-' + this.rows.length };
    },
  };
  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store: new InMemoryDocumentFetchStateStore(),
    documents: documents as never,
    counter: new NetworkCounter(),
    now: () => new Date('2026-09-26T06:00:00Z'),
    storeDir,
    sleep: async () => undefined,
    extractCoverText: async () => ({ usable: true, text: `${coverCompany} prospectus` }),
  });
  return { runner, documents, seen };
}

function chainFor(attempts: { source: string; outcome: string }[], docType: string): string {
  return (
    attempts.find((a) => a.source === 'CHAIN' && a.outcome.startsWith(`rungs[${docType}]`))
      ?.outcome ?? ''
  );
}

const SEBI_SERVES_PROSPECTUS = (company: string, slug: string) => ({
  'smid=12': html(
    '<table id="sample_1"><tr><td>Sep 20, 2026</td>' +
      `<td><a href="https://www.sebi.gov.in/filings/public-issues/sep-2026/${slug}-prospectus_1.html" ` +
      `title="${company} - Prospectus">${company} - Prospectus</a></td></tr></table>`
  ),
  [`${slug}-prospectus_1.html`]: html(
    '<a href="https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/632.pdf">Prospectus</a>'
  ),
  'attachdocs/sep-2026/632.pdf': pdf(realisticPdf('P')),
});

describe('#632 NSE 200 with an empty issueInfo does not carry the issue', () => {
  it('is recorded not_carried and does NOT settle an SME type — the later rungs run', async () => {
    const { runner, documents, seen } = makeRunner(
      {
        'ipo-detail': json(fixture('nse-ipo-detail-empty-issueinfo-peshwa-sme.json')),
        ...SEBI_SERVES_PROSPECTUS('Peshwa Wheat Limited', 'peshwa'),
      },
      'Peshwa Wheat Limited'
    );
    const ipo: DiscoveryIpo = {
      id: 'ipo-peshwa',
      companyName: 'Peshwa Wheat Limited',
      symbol: 'PESHWA',
      segment: 'SME',
      stage: 'CLOSED',
      bseIpoNo: null,
    };

    const result = await runner.runIpo(ipo, ALL_BUT_PROSPECTUS as never);

    const nse = result.attempts.filter((a) => a.source === 'NSE');
    expect(nse.map((a) => a.outcome)).toEqual(['not_carried']);
    const chain = chainFor(result.attempts as never, 'PROSPECTUS');
    expect(chain).not.toContain('exchanges_settled_it');
    expect(chain.startsWith('rungs[PROSPECTUS]: EXCHANGES:no_link')).toBe(true);
    expect(seen.some((u) => u.includes('smid=12'))).toBe(true);
    expect(result.found).toEqual(['PROSPECTUS']);
    expect(documents.rows.find((d) => d.type === 'PROSPECTUS')?.exchange).toBe('SEBI');
  }, 60_000);

  it('control: a real NSE payload WITH a dataList is still ok', async () => {
    const { runner } = makeRunner(
      { 'ipo-detail': json(fixture('nse-madhurknit.json')) },
      'Madhur Knit Crafts Limited'
    );
    const ipo: DiscoveryIpo = {
      id: 'ipo-madhur',
      companyName: 'Madhur Knit Crafts Limited',
      symbol: 'MADHURKNIT',
      segment: 'SME',
      stage: 'CLOSED',
      bseIpoNo: null,
    };
    const result = await runner.runIpo(ipo, ALL_BUT_PROSPECTUS as never);
    expect(result.attempts.filter((a) => a.source === 'NSE')[0]?.outcome).toBe('ok');
  }, 60_000);
});

describe('#632 an NSE shape change is a shape_error, never not_carried', () => {
  const peshwa = JSON.parse(fixture('nse-ipo-detail-empty-issueinfo-peshwa-sme.json'));
  const { issueInfo: _drop, ...withoutIssueInfo } = peshwa;
  const cases: [string, string][] = [
    ['no issueInfo key', JSON.stringify(withoutIssueInfo)],
    ['issueInfo: null', JSON.stringify({ ...peshwa, issueInfo: null })],
    ['whole-body {}', '{}'],
    ['whole-body null', 'null'],
    ['whole-body []', '[]'],
    ['renamed dataList', JSON.stringify({ ...peshwa, issueInfo: { dataRows: [{ title: 'x', value: 'y' }] } })],
  ];
  for (const [name, body] of cases) {
    it(`${name} -> shape_error`, async () => {
      const { runner } = makeRunner({ 'ipo-detail': json(body) }, 'Peshwa Wheat Limited');
      const ipo: DiscoveryIpo = {
        id: 'ipo-shape',
        companyName: 'Peshwa Wheat Limited',
        symbol: 'PESHWA',
        segment: 'SME',
        stage: 'CLOSED',
        bseIpoNo: null,
      };
      const result = await runner.runIpo(ipo, ALL_BUT_PROSPECTUS as never);
      expect(result.attempts.filter((a) => a.source === 'NSE').map((a) => a.outcome)).toEqual([
        'shape_error',
      ]);
      expect(chainFor(result.attempts as never, 'PROSPECTUS')).toContain('EXCHANGES:failed');
    }, 60_000);
  }
});

describe('#632 exchanges that only abstained are not a FAILED exchange verdict', () => {
  it('BSE not_on_board + NSE no_symbol reads EXCHANGES:no_link and escalates', async () => {
    const { runner, seen } = makeRunner(
      {
        IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
        ...SEBI_SERVES_PROSPECTUS('Offboard Nosymbol Limited', 'offboard'),
      },
      'Offboard Nosymbol Limited'
    );
    const ipo: DiscoveryIpo = {
      id: 'ipo-offboard',
      companyName: 'Offboard Nosymbol Limited',
      symbol: null,
      segment: 'MAINBOARD',
      stage: 'CLOSED',
      bseIpoNo: null,
    };

    const result = await runner.runIpo(ipo, ALL_BUT_PROSPECTUS as never);

    expect(result.attempts.some((a) => a.source === 'BSE' && a.outcome === 'not_on_board')).toBe(true);
    expect(result.attempts.some((a) => a.source === 'NSE' && a.outcome === 'no_symbol')).toBe(true);
    const chain = chainFor(result.attempts as never, 'PROSPECTUS');
    expect(chain.startsWith('rungs[PROSPECTUS]: EXCHANGES:no_link')).toBe(true);
    expect(chain).not.toContain('exchanges_settled_it');
    expect(seen.some((u) => u.includes('smid=12'))).toBe(true);
    expect(result.found).toEqual(['PROSPECTUS']);
  }, 60_000);

  it('an SME with no NSE symbol is never settled by the exchanges (nobody said ok)', async () => {
    const { runner } = makeRunner({}, 'Nosym Sme Limited');
    const ipo: DiscoveryIpo = {
      id: 'ipo-nosym',
      companyName: 'Nosym Sme Limited',
      symbol: null,
      segment: 'SME',
      stage: 'CLOSED',
      bseIpoNo: null,
    };
    const result = await runner.runIpo(ipo, ALL_BUT_PROSPECTUS as never);
    const chain = chainFor(result.attempts as never, 'PROSPECTUS');
    expect(chain.startsWith('rungs[PROSPECTUS]: EXCHANGES:no_link')).toBe(true);
    expect(chain).not.toContain('exchanges_settled_it');
    // The exchanges' verdict is no_link, not failed. (SEBI 404s in this harness,
    // so the row's final state is decided by that genuine rung failure.)
    expect(chain).not.toContain('EXCHANGES:failed');
  }, 60_000);
});
