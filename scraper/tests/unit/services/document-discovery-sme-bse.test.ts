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
 * #1201 -- spec §1.2.1 "On SME": the order is NSE then BSE. The runner asked NSE
 * only, so a BSE-only SME issue (29 of 44 blocked SME IPOs on staging, 2026-09-26)
 * had no exchange source at all.
 *
 * Fixtures are LIVE captures from api.bseindia.com, 2026-09-30, not typed:
 *  - bse-ipo-homepage-sme-live-...json : the board with 16 small-cap book-built
 *    issues (PIND HOSPITALITY, Shivchem Agro, ...) -- SME issues ARE on the board.
 *  - bse-sme-core-pind-hospitality-...json (IPO_NO 8012): RHP&GID zip, Corrigendum,
 *    Price Band Advertisement.
 *  - bse-sme-core-shivchem-agro-...json (IPO_NO 8008): Prospectus+GID zip and price
 *    band ad on listing.bseindia.com (a different host and a backslash path).
 * The NSE payload is the real PESHWA (series SME) reply: HTTP 200, `issueInfo: {}`.
 */
const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');
const BOARD = 'bse-ipo-homepage-sme-live-2026-09-30.json';
const PIND = 'bse-sme-core-pind-hospitality-live-2026-09-30.json';
const SHIVCHEM = 'bse-sme-core-shivchem-agro-live-2026-09-30.json';
const NSE_EMPTY = 'nse-ipo-detail-empty-issueinfo-peshwa-sme.json';

const json = (body: string): HttpResponse => ({
  status: 200,
  contentType: 'application/json',
  body: Buffer.from(body),
  url: 'https://x/api',
});
const pdf = (): HttpResponse => ({
  status: 200,
  contentType: 'application/pdf',
  body: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('B'.repeat(80_000))]),
  url: 'https://x/doc.pdf',
});
const dead: HttpResponse = { status: 0, contentType: null, body: Buffer.alloc(0), url: 'x' };
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
const ALL = [
  'DRHP', 'RHP', 'PROSPECTUS', 'PRICE_BAND_AD', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE',
  'ANCHOR_ALLOCATION_REPORT', 'ADDENDUM', 'BASIS_OF_ALLOTMENT_AD',
];
const onlyDue = (...due: string[]) => ALL.filter((t) => !due.includes(t)).map(done);

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'i1201-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner(overrides: Record<string, HttpResponse> = {}) {
  const seen: string[] = [];
  const fetcher: HttpFetcher = async (url) => {
    seen.push(url);
    for (const [needle, response] of Object.entries(overrides)) {
      if (url.includes(needle)) return response;
    }
    if (url.includes('IPO_HomePageDetail')) return json(fixture(BOARD));
    if (url.includes('IPO_NO=8012')) return json(fixture(PIND));
    if (url.includes('IPO_NO=8008')) return json(fixture(SHIVCHEM));
    if (url.includes('nseindia.com/api/ipo-detail')) return json(fixture(NSE_EMPTY));
    if (url.includes('bseindia.com/downloads') || url.includes('listing.bseindia.com/Download')) return pdf();
    return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
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
    now: () => new Date('2026-09-30T14:00:00Z'),
    storeDir,
    sleep: async () => undefined,
    extractCoverText: async () => ({ usable: true, text: 'PIND HOSPITALITY LIMITED Shivchem Agro Limited prospectus' }),
  });
  return { runner, documents, seen };
}

const PIND_IPO: DiscoveryIpo = {
  id: 'ipo-pind',
  companyName: 'PIND HOSPITALITY LIMITED',
  symbol: 'PIND',
  segment: 'SME',
  stage: 'OPEN',
  listingExchanges: ['BSE'],
  bseIpoNo: null,
};
const SHIVCHEM_IPO: DiscoveryIpo = {
  id: 'ipo-shivchem',
  companyName: 'Shivchem Agro Limited',
  symbol: 'SHIVCHEM',
  segment: 'SME',
  stage: 'OPEN',
  listingExchanges: ['BSE'],
  bseIpoNo: null,
};
const bseOutcomes = (r: { attempts: { source: string; outcome: string }[] }) =>
  r.attempts.filter((a) => a.source === 'BSE').map((a) => a.outcome);

describe('#1201 an SME issue listed on BSE is asked of BSE after NSE (spec "On SME")', () => {
  it('SME_BSE: NSE abstains (empty issueInfo), BSE board + core are asked and its documents are FOUND', async () => {
    const { runner, documents, seen } = makeRunner();
    const result = await runner.runIpo(PIND_IPO, onlyDue('PRICE_BAND_AD', 'CORRIGENDUM', 'RHP') as never);

    expect(result.attempts.filter((a) => a.source === 'NSE').map((a) => a.outcome)).toEqual(['not_carried']);
    expect(seen.some((u) => u.includes('IPO_HomePageDetail'))).toBe(true);
    expect(seen.some((u) => u.includes('GetMkt_ISSUE_BBS_IPO/w?IPO_NO=8012'))).toBe(true);
    expect(bseOutcomes(result)).toContain('ok');
    expect(result.found).toEqual(expect.arrayContaining(['PRICE_BAND_AD', 'CORRIGENDUM', 'RHP']));
    expect(documents.rows.filter((d) => d.exchange === 'BSE').length).toBeGreaterThanOrEqual(1);
    // The IPO_NO is remembered so a closed issue (dropped off the board) stays reachable.
    expect(result.resolvedBseIpoNo).toBe(8012);
    // NSE first, BSE second.
    const firstNse = seen.findIndex((u) => u.includes('nseindia.com'));
    const firstBse = seen.findIndex((u) => u.includes('api.bseindia.com'));
    expect(firstNse).toBeGreaterThanOrEqual(0);
    expect(firstNse).toBeLessThan(firstBse);
  }, 60_000);

  it('a listing.bseindia.com document link (backslash path) is fetched and stored', async () => {
    const { runner, seen } = makeRunner();
    const result = await runner.runIpo(SHIVCHEM_IPO, onlyDue('PRICE_BAND_AD') as never);
    expect(seen.some((u) => u.includes('IPO_NO=8008'))).toBe(true);
    expect(result.found).toEqual(['PRICE_BAND_AD']);
  }, 60_000);

  it('SME known to list on NSE only: BSE is never called (zero cost)', async () => {
    const { runner, seen } = makeRunner();
    await runner.runIpo({ ...PIND_IPO, listingExchanges: ['NSE'] }, onlyDue('PRICE_BAND_AD') as never);
    expect(seen.some((u) => u.includes('api.bseindia.com'))).toBe(false);
  }, 60_000);

  it('unknown listing exchanges (null) still ask BSE', async () => {
    const { runner, seen } = makeRunner();
    await runner.runIpo({ ...PIND_IPO, listingExchanges: null }, onlyDue('PRICE_BAND_AD') as never);
    expect(seen.some((u) => u.includes('IPO_NO=8012'))).toBe(true);
  }, 60_000);

  it('a remembered bse_ipo_no skips the board (a closed issue is no longer on it)', async () => {
    const { runner, seen } = makeRunner();
    await runner.runIpo({ ...SHIVCHEM_IPO, bseIpoNo: 8008 }, onlyDue('PRICE_BAND_AD') as never);
    expect(seen.some((u) => u.includes('IPO_HomePageDetail'))).toBe(false);
    expect(seen.some((u) => u.includes('IPO_NO=8008'))).toBe(true);
  }, 60_000);
});

describe('#1201 every answer state of the BSE fetch for an SME issue', () => {
  it('not published: BSE ok but lists no ADDENDUM -> NOT_YET_FILED, settled by BSE alone (NSE not_carried does not veto)', async () => {
    const { runner, seen } = makeRunner();
    const result = await runner.runIpo(SHIVCHEM_IPO, onlyDue('ADDENDUM') as never);
    expect(bseOutcomes(result)).toContain('ok');
    expect(result.notYetFiled).toEqual(['ADDENDUM']);
    expect(seen.some((u) => u.includes('sebi.gov.in'))).toBe(false);
  }, 60_000);

  it('empty listing: not on the board, no remembered IPO_NO -> not_on_board (abstain), never NOT_YET_FILED', async () => {
    const { runner } = makeRunner();
    const result = await runner.runIpo(
      { ...PIND_IPO, companyName: 'Some Closed Issue Limited' },
      onlyDue('ADDENDUM') as never
    );
    expect(bseOutcomes(result)).toEqual(['not_on_board']);
    expect(result.notYetFiled).toEqual([]);
  }, 60_000);

  it('fetch failed: board unreachable -> failure outcome, not "not yet filed"', async () => {
    const { runner } = makeRunner({ IPO_HomePageDetail: dead });
    const result = await runner.runIpo(PIND_IPO, onlyDue('ADDENDUM') as never);
    expect(bseOutcomes(result)).toContain('board_unavailable');
    expect(result.notYetFiled).toEqual([]);
  }, 60_000);

  it('fetch failed: core payload unreachable -> failure outcome, not "not yet filed"', async () => {
    const { runner } = makeRunner({ GetMkt_ISSUE_BBS_IPO: dead });
    const result = await runner.runIpo(PIND_IPO, onlyDue('ADDENDUM') as never);
    expect(bseOutcomes(result).some((o) => ['http_error', 'timeout'].includes(o))).toBe(true);
    expect(result.notYetFiled).toEqual([]);
  }, 60_000);

  it('ambiguous: two board rows with the same name -> no guess, not_on_board (abstain), core never called', async () => {
    const board = JSON.parse(fixture(BOARD));
    board.Table.push({ ...board.Table[0], IPO_NO: 9999 });
    const { runner, seen } = makeRunner({ IPO_HomePageDetail: json(JSON.stringify(board)) });
    const result = await runner.runIpo(PIND_IPO, onlyDue('ADDENDUM') as never);
    expect(bseOutcomes(result)).toEqual(['not_on_board']);
    expect(seen.some((u) => u.includes('GetMkt_ISSUE_BBS_IPO'))).toBe(false);
  }, 60_000);

  it('download failed: BSE lists the link but the download 404s -> not found', async () => {
    const { runner } = makeRunner({
      'bseindia.com/downloads': { status: 404, contentType: 'text/html', body: Buffer.from('x'), url: 'x' },
    });
    const result = await runner.runIpo(PIND_IPO, onlyDue('PRICE_BAND_AD') as never);
    expect(bseOutcomes(result)).toContain('ok');
    expect(result.found).toEqual([]);
  }, 60_000);
});
