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
import {
  EXCHANGE_SERVED_TYPES,
  isExchangeServedType,
} from '../../../src/services/document-types.js';

/**
 * T-403 round 3, B-1 — a clean "no link" must NOT settle a type the exchanges
 * cannot serve.
 *
 * THE BLOCKER THIS PINS. Escalation used to be gated on
 * `outcome === 'all_sources_failed'`. At UPCOMING the only due type is the DRHP;
 * both exchanges answer normally and simply have no DRHP link — which is
 * `no_link`, not a failure. So the chain recorded
 * `SEBI:skipped:exchanges_settled_it`, the row sat NOT_YET_FILED forever, and
 * the SEBI rung — whose entire reason for existing is the DRHP — could never
 * fire once. The same held for the Prospectus of a closed IPO that had dropped
 * off the BSE board. The round-2 acceptance evidence certified that as a pass.
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

/** Both exchanges answer normally. Neither carries a DRHP — none ever does. */
const CLEAN_EXCHANGES = {
  IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
  GetMkt_ISSUE_BBS_IPO: json(fixture('bse-skyways-core.json')),
  'ipo-detail': json(fixture('nse-skyways.json')),
};

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

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-b1-'));
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
    sleep: async () => undefined,
    extractCoverText: async () => ({ usable: true, text: `${coverCompany} prospectus` }),
  });
  return { runner, store, documents, seen };
}

/** The `rungs[...]` line the runner writes for one document type. */
function rungsFor(attempts: { source: string; outcome: string }[], docType: string): string {
  return (
    attempts.find((a) => a.source === 'CHAIN' && a.outcome.startsWith(`rungs[${docType}]`))
      ?.outcome ?? ''
  );
}

describe('EXCHANGE_SERVED_TYPES', () => {
  it('excludes the DRHP and nothing else', () => {
    // No exchange publishes a draft prospectus; SEBI is the only source for it
    // (decision-matrix §2, row S0).
    expect(isExchangeServedType('DRHP')).toBe(false);
    for (const t of ['RHP', 'PROSPECTUS', 'PRICE_BAND_AD', 'CORRIGENDUM', 'ADDENDUM'] as const) {
      expect(isExchangeServedType(t)).toBe(true);
    }
    expect(EXCHANGE_SERVED_TYPES).not.toContain('DRHP');
  });
});

describe('B-1 (a) UPCOMING, exchanges clean, SEBI serves the DRHP', () => {
  it('escalates to SEBI and stores the DRHP', async () => {
    const { runner, documents, seen } = makeRunner(
      {
        ...CLEAN_EXCHANGES,
        'smid=10': html(
          '<table id="sample_1"><tr><td>Aug 20, 2026</td>' +
            '<td><a href="https://www.sebi.gov.in/filings/public-issues/aug-2026/acme-drhp_1.html" ' +
            'title="Acme Industries Limited - DRHP">Acme Industries Limited - DRHP</a></td></tr></table>'
        ),
        'acme-drhp_1.html': html(
          '<a href="https://www.sebi.gov.in/sebi_data/attachdocs/aug-2026/555.pdf">DRHP</a>'
        ),
        'attachdocs/aug-2026/555.pdf': pdf(realisticPdf('D')),
      },
      'Acme Industries Limited'
    );

    const upcoming: DiscoveryIpo = {
      id: 'ipo-acme',
      companyName: 'Acme Industries Limited',
      symbol: 'ACME',
      segment: 'MAINBOARD',
      stage: 'UPCOMING',
      bseIpoNo: 7903,
    };

    const result = await runner.runIpo(upcoming, []);

    expect(result.due).toEqual(['DRHP']);
    expect(result.found).toEqual(['DRHP']);
    expect(documents.rows.find((d) => d.type === 'DRHP')?.exchange).toBe('SEBI');
    expect(seen.some((u) => u.includes('smid=10'))).toBe(true);

    const parts = rungsFor(result.attempts as never, 'DRHP').split(' -> ');
    expect(parts[0]).toBe('rungs[DRHP]: EXCHANGES:no_link');
    expect(parts[1]).toBe('SEBI:found');
  }, 60_000);
});

describe('B-1 (b) CLOSED IPO off the BSE board, SEBI lists the Prospectus', () => {
  it('escalates and stores it, because BSE not_on_board is not coverage', async () => {
    const { runner, documents, seen } = makeRunner(
      {
        // The board answers, but this company has left it (it closed).
        IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
        'ipo-detail': json(JSON.stringify({ issueInfo: { dataList: [] } })),
        'smid=12': html(
          '<table id="sample_1"><tr><td>Aug 28, 2026</td>' +
            '<td><a href="https://www.sebi.gov.in/filings/public-issues/aug-2026/offboard-prospectus_1.html" ' +
            'title="Offboard Industries Limited - Prospectus">Offboard Industries Limited - Prospectus</a></td></tr></table>'
        ),
        'offboard-prospectus_1.html': html(
          '<a href="https://www.sebi.gov.in/sebi_data/attachdocs/aug-2026/999.pdf">Prospectus</a>'
        ),
        'attachdocs/aug-2026/999.pdf': pdf(realisticPdf('P')),
      },
      'Offboard Industries Limited'
    );

    const closed: DiscoveryIpo = {
      id: 'ipo-offboard',
      companyName: 'Offboard Industries Limited',
      symbol: 'OFFBOARD',
      segment: 'MAINBOARD',
      stage: 'CLOSED',
      bseIpoNo: null,
    };
    const alreadyDone = [
      'DRHP', 'RHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE',
      'ANCHOR_ALLOCATION_REPORT', 'ADDENDUM', 'BASIS_OF_ALLOTMENT_AD',
    ].map(done);

    const result = await runner.runIpo(closed, alreadyDone as never);

    expect(result.due).toEqual(['PROSPECTUS']);
    expect(result.found).toEqual(['PROSPECTUS']);
    expect(documents.rows.find((d) => d.type === 'PROSPECTUS')?.exchange).toBe('SEBI');
    // BSE said not_on_board — a fact, not a failure, and NOT coverage.
    expect(result.attempts.some((a) => a.source === 'BSE' && a.outcome === 'not_on_board')).toBe(true);
    expect(seen.some((u) => u.includes('smid=12'))).toBe(true);
  }, 60_000);
});

describe('B-1 (c) SEBI has nothing', () => {
  it('settles NOT_YET_FILED with SEBI CONSULTED, not skipped', async () => {
    const { runner, seen } = makeRunner(
      { ...CLEAN_EXCHANGES, 'smid=10': html(fixture('sebi-drhp-listing.html')) },
      'Nowhere Industries Limited'
    );

    const upcoming: DiscoveryIpo = {
      id: 'ipo-nowhere',
      companyName: 'Nowhere Industries Limited',
      symbol: 'NOWHERE',
      segment: 'MAINBOARD',
      stage: 'UPCOMING',
      bseIpoNo: 7903,
    };

    const result = await runner.runIpo(upcoming, []);

    expect(result.notYetFiled).toEqual(['DRHP']);
    expect(result.blocked).toEqual([]);
    // The whole point: SEBI was actually asked. Before B-1 it never was.
    expect(seen.some((u) => u.includes('smid=10'))).toBe(true);
    const rungs = rungsFor(result.attempts as never, 'DRHP');
    expect(rungs).toContain('SEBI:not_listed');
    expect(rungs).not.toContain('exchanges_settled_it');
  }, 60_000);
});

describe('B-1 must not make EVERY clean no_link escalate', () => {
  it('an exchange-served type on a fully covered IPO is still settled without SEBI', async () => {
    // Otherwise every 30-minute cycle would burn a SEBI listing fetch and three
    // company GETs on documents that simply are not filed yet.
    // A core payload that ANSWERS but carries no price-band link — the exact
    // 'exchange said no_link' condition, without any other document confusing it.
    const { runner, seen } = makeRunner(
      {
        ...CLEAN_EXCHANGES,
        GetMkt_ISSUE_BBS_IPO: json(
          JSON.stringify({ IPONO_0: [{ IPO_NO: '7916', Price_Band_Advertisement: '' }] })
        ),
        'ipo-detail': json(JSON.stringify({ issueInfo: { dataList: [] } })),
      },
      'ESDS Software Solution Limited'
    );

    const preOpen: DiscoveryIpo = {
      id: 'ipo-esds',
      companyName: 'ESDS Software Solution Limited',
      symbol: 'ESDS',
      segment: 'MAINBOARD',
      stage: 'PRE_OPEN',
      bseIpoNo: 7916,
    };
    const allButPba = [
      'DRHP', 'RHP', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE', 'ANCHOR_ALLOCATION_REPORT',
    ].map(done);

    const result = await runner.runIpo(preOpen, allButPba as never);

    expect(result.due).toEqual(['PRICE_BAND_AD']);
    expect(result.notYetFiled).toEqual(['PRICE_BAND_AD']);
    expect(seen.some((u) => u.includes('sebi.gov.in'))).toBe(false);
    expect(rungsFor(result.attempts as never, 'PRICE_BAND_AD')).toContain('exchanges_settled_it');
  }, 60_000);
});
