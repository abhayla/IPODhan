import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  chainSettledByExchanges,
  chainEscalatedAfterClose,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';
import {
  exchangeNoLinkDecision,
  planIpoCycle,
  type StateRow,
} from '../../../src/services/document-state-machine.js';

/**
 * Item 44 / F-229 — an exchange "no link" does not settle a post-close publisher type.
 *
 * Staging 2026-10-02: 84 of 105 PROSPECTUS rows BLOCKED_ALL, 48 of them with the chain
 * `EXCHANGES:no_link -> SEBI:skipped:exchanges_settled_it -> ...`. NSE's own final Prospectus is
 * SEBI document 104637 (F-125), yet SEBI was never asked, and W-28 then escalated the same row to
 * BLOCKED_ALL: a chain saying "settled" under a state saying "every source failed".
 * Harness mirrors document-discovery-b1-chain.test.ts.
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

/** Both exchanges answer normally and fully cover the issue. */
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

const allBut = (...open: string[]) =>
  [
    'DRHP', 'RHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE', 'ANCHOR_ALLOCATION_REPORT',
    'ADDENDUM', 'BASIS_OF_ALLOTMENT_AD', 'PROSPECTUS',
  ]
    .filter((t) => !open.includes(t))
    .map(done);

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'item44-'));
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
    now: () => new Date('2026-10-02T06:00:00Z'),
    storeDir,
    sleep: async () => undefined,
    extractCoverText: async () => ({ usable: true, text: `${coverCompany} prospectus` }),
  });
  return { runner, documents, seen };
}

function rungsFor(attempts: { source: string; outcome: string }[], docType: string): string {
  return (
    attempts.find((a) => a.source === 'CHAIN' && a.outcome.startsWith(`rungs[${docType}]`))?.outcome ?? ''
  );
}

// PR #1464 fix round 1: the IPO carries its own CIN and dates, which bind a SEBI/company document to it.
const ACME_CIN = 'U12345MH2001PLC123456';
const ACME = {
  id: 'ipo-acme',
  companyName: 'Acme Industries Limited',
  symbol: 'ACME',
  segment: 'MAINBOARD',
  bseIpoNo: 7903,
  cin: ACME_CIN,
  openDate: '2026-09-17',
  closeDate: '2026-09-21',
  listingDate: '2026-09-24',
};

/** SEBI's Final Prospectus listing with one Acme row, dated as given, and its PDF. */
const sebiProspectus = (date: string) => ({
  'smid=12': html(
    `<table id="sample_1"><tr><td>${date}</td>` +
      '<td><a href="https://www.sebi.gov.in/filings/public-issues/sep-2026/acme-prospectus_104637.html" ' +
      'title="Acme Industries Limited - Prospectus">Acme Industries Limited - Prospectus</a></td></tr></table>'
  ),
  'acme-prospectus_104637.html': html(
    '<a href="https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/104637.pdf">Prospectus</a>'
  ),
  'attachdocs/sep-2026/104637.pdf': pdf(realisticPdf('P')),
});

describe('exchangeNoLinkDecision', () => {
  it('post-close publisher types escalate once the IPO is CLOSED or LISTED, never before', () => {
    expect(exchangeNoLinkDecision('PROSPECTUS', 'CLOSED')).toBe('due_after_close');
    expect(exchangeNoLinkDecision('PROSPECTUS', 'LISTED')).toBe('due_after_close');
    expect(exchangeNoLinkDecision('BASIS_OF_ALLOTMENT_AD', 'LISTED')).toBe('due_after_close');
    expect(exchangeNoLinkDecision('PROSPECTUS', 'OPEN')).toBe('may_settle');
    expect(exchangeNoLinkDecision('RHP', 'LISTED')).toBe('may_settle');
    expect(exchangeNoLinkDecision('PRICE_BAND_AD', 'PRE_OPEN')).toBe('may_settle');
  });
  it('fails closed on a stage it does not know: no silent escalation, a recorded reason', () => {
    expect(exchangeNoLinkDecision('PROSPECTUS', undefined)).toBe('stage_unknown');
    expect(exchangeNoLinkDecision('PROSPECTUS', 'WITHDRAWN')).toBe('stage_unknown');
  });
});

describe('Item 44: CLOSED IPO, both exchanges cover it cleanly, no Prospectus link', () => {
  it('asks SEBI and stores the final Prospectus from there', async () => {
    const { runner, documents, seen } = makeRunner(
      {
        ...CLEAN_EXCHANGES,
        'smid=12': html(
          '<table id="sample_1"><tr><td>Sep 22, 2026</td>' +
            '<td><a href="https://www.sebi.gov.in/filings/public-issues/sep-2026/acme-prospectus_104637.html" ' +
            'title="Acme Industries Limited - Prospectus">Acme Industries Limited - Prospectus</a></td></tr></table>'
        ),
        'acme-prospectus_104637.html': html(
          '<a href="https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/104637.pdf">Prospectus</a>'
        ),
        'attachdocs/sep-2026/104637.pdf': pdf(realisticPdf('P')),
      },
      `Acme Industries Limited CIN ${ACME_CIN}`
    );
    const closed: DiscoveryIpo = { ...ACME, stage: 'CLOSED' };

    const result = await runner.runIpo(closed, allBut('PROSPECTUS') as never);

    expect(result.due).toEqual(['PROSPECTUS']);
    expect(result.found).toEqual(['PROSPECTUS']);
    expect(result.blocked).toEqual([]);
    expect(documents.rows.find((d) => d.type === 'PROSPECTUS')?.exchange).toBe('SEBI');
    expect(seen.some((u) => u.includes('smid=12'))).toBe(true);
    const chain = rungsFor(result.attempts as never, 'PROSPECTUS');
    expect(chain.startsWith('rungs[PROSPECTUS]: EXCHANGES:no_link[due_after_close] -> SEBI:')).toBe(true);
    expect(chain).not.toContain('exchanges_settled_it');
  }, 60_000);

  it('refuses a same-name SEBI Prospectus whose cover CIN is another company (not stored)', async () => {
    const { runner, documents } = makeRunner(
      { ...CLEAN_EXCHANGES, ...sebiProspectus('Sep 22, 2026') },
      'Acme Industries Limited CIN U99999DL1990PLC000001'
    );
    const result = await runner.runIpo({ ...ACME, stage: 'CLOSED' }, allBut('PROSPECTUS') as never);
    expect(result.found).toEqual([]);
    expect(documents.rows.filter((d) => d.type === 'PROSPECTUS')).toEqual([]);
    expect(rungsFor(result.attempts as never, 'PROSPECTUS')).toContain('SEBI:refused:identity_cin_mismatch');
  }, 60_000);

  it('refuses a same-name SEBI Prospectus filed years before the IPO (not stored)', async () => {
    const { runner, documents } = makeRunner(
      { ...CLEAN_EXCHANGES, ...sebiProspectus('Mar 10, 2021') },
      'Acme Industries Limited prospectus'
    );
    const result = await runner.runIpo({ ...ACME, stage: 'CLOSED' }, allBut('PROSPECTUS') as never);
    expect(result.found).toEqual([]);
    expect(documents.rows.filter((d) => d.type === 'PROSPECTUS')).toEqual([]);
    expect(rungsFor(result.attempts as never, 'PROSPECTUS')).toContain('SEBI:refused:identity_date_outside_window');
  }, 60_000);

  it('fails closed when the IPO has neither a CIN nor dates to bind the document', async () => {
    const { runner, documents } = makeRunner(
      { ...CLEAN_EXCHANGES, ...sebiProspectus('Sep 22, 2026') },
      'Acme Industries Limited prospectus'
    );
    const bare: DiscoveryIpo = {
      ...ACME, cin: null, openDate: null, closeDate: null, listingDate: null, stage: 'CLOSED',
    };
    const result = await runner.runIpo(bare, allBut('PROSPECTUS') as never);
    expect(result.found).toEqual([]);
    expect(documents.rows.filter((d) => d.type === 'PROSPECTUS')).toEqual([]);
    expect(rungsFor(result.attempts as never, 'PROSPECTUS')).toContain('SEBI:refused:identity_unverified');
  }, 60_000);

  it('when SEBI has nothing either, the miss is one the chain concluded (no settled skip)', async () => {
    const { runner, seen } = makeRunner(
      {
        ...CLEAN_EXCHANGES,
        'smid=12': html('<table id="sample_1"></table>'),
        'HomeAction.do;jsessionid': html('<table id="sample_1"></table>'),
      },
      'Nowhere Industries Limited'
    );
    const closed: DiscoveryIpo = { ...ACME, id: 'ipo-nowhere', companyName: 'Nowhere Industries Limited', stage: 'CLOSED' };
    const result = await runner.runIpo(closed, allBut('PROSPECTUS') as never);
    expect(result.found).toEqual([]);
    expect(seen.some((u) => u.includes('smid=12'))).toBe(true);
    const chain = rungsFor(result.attempts as never, 'PROSPECTUS');
    expect(chain).toContain('EXCHANGES:no_link[due_after_close]');
    expect(chain).not.toContain('exchanges_settled_it');
  }, 60_000);
});

// Before close, a clean no_link still settles without SEBI: pinned unchanged by
// document-discovery-b1-chain.test.ts ('B-1 must not make EVERY clean no_link escalate', PRE_OPEN PRICE_BAND_AD).

describe('Item 44: rows concluded under the old rule get exactly one more try', () => {
  const settledChain = [
    {
      source: 'CHAIN',
      outcome:
        'rungs[PROSPECTUS]: EXCHANGES:no_link -> SEBI:skipped:exchanges_settled_it -> ' +
        'COMPANY:skipped:exchanges_settled_it -> VERIFIER:skipped:exchanges_settled_it',
    },
  ];
  const blocked = (settled: boolean): StateRow => ({
    docType: 'PROSPECTUS',
    state: 'BLOCKED_ALL',
    attempts: 38,
    nextRetryAt: new Date('2026-09-29T13:00:00Z'),
    blockedSinceAt: new Date('2026-09-23T00:00:00Z'),
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: new Date('2026-09-29T08:30:00Z'),
    attemptedAtStage: 'LISTED',
    lastChainSettledByExchanges: settled,
  });
  const plan = (row: StateRow) =>
    planIpoCycle({
      stage: 'LISTED',
      rows: [...(allBut('PROSPECTUS') as StateRow[]), row],
      options: { now: new Date('2026-10-02T09:00:00Z') },
    });

  it('reads the settled chain off last_attempt', () => {
    expect(chainSettledByExchanges(settledChain, 'PROSPECTUS')).toBe(true);
    expect(chainSettledByExchanges(settledChain, 'BASIS_OF_ALLOTMENT_AD')).toBe(false);
    expect(chainSettledByExchanges(null, 'PROSPECTUS')).toBe(false);
  });

  it('a LISTED BLOCKED_ALL Prospectus whose chain was settled is due again', () => {
    expect(plan(blocked(true)).due).toEqual(['PROSPECTUS']);
  });

  it('once a chain has asked SEBI it is not due again (OD-56 holds)', () => {
    expect(plan(blocked(false)).due).toEqual([]);
  });
});

describe('PR #1464 fix round 1 (MINOR 2, OD-65): the post-close escalation counts once per stage', () => {
  const escalatedChain = [
    {
      source: 'CHAIN',
      outcome:
        'rungs[PROSPECTUS]: EXCHANGES:no_link[due_after_close] -> SEBI:refused:identity_unverified -> ' +
        'COMPANY:skipped:no_company_url -> VERIFIER:skipped:no_verifier_url',
    },
  ];
  const row = (attemptedAtStage: string): StateRow => ({
    docType: 'PROSPECTUS',
    state: 'BLOCKED_ALL',
    attempts: 1,
    nextRetryAt: new Date('2026-10-02T05:00:00Z'),
    blockedSinceAt: new Date('2026-10-01T00:00:00Z'),
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: new Date('2026-10-01T08:30:00Z'),
    attemptedAtStage,
    lastChainEscalatedAfterClose: true,
  });
  const plan = (stage: 'CLOSED' | 'LISTED', r: StateRow) =>
    planIpoCycle({
      stage,
      rows: [...(allBut('PROSPECTUS') as StateRow[]), r],
      options: { now: new Date('2026-10-02T09:00:00Z') },
    });

  it('reads the escalated chain off last_attempt', () => {
    expect(chainEscalatedAfterClose(escalatedChain, 'PROSPECTUS')).toBe(true);
    expect(
      chainEscalatedAfterClose(
        [{ source: 'CHAIN', outcome: 'rungs[PROSPECTUS]: EXCHANGES:no_link -> SEBI:skipped:exchanges_settled_it' }],
        'PROSPECTUS'
      )
    ).toBe(false);
  });

  it('a CLOSED row that already asked SEBI at CLOSED is not due again in the same stage', () => {
    expect(plan('CLOSED', row('CLOSED')).due).toEqual([]);
  });

  it('the stage change makes it due again (attempted at CLOSED, IPO now LISTED)', () => {
    expect(plan('LISTED', row('CLOSED')).due).toEqual(['PROSPECTUS']);
  });

  it('a row escalated at an EARLIER stage is still due at CLOSED', () => {
    expect(plan('CLOSED', { ...row('OPEN') }).due).toEqual(['PROSPECTUS']);
  });
});

describe('Item 44 / F-159: the company rung never types an ABRIDGED prospectus as the Prospectus', () => {
  it('skips the real Himalayan Solar link shape, keeps the full Prospectus', async () => {
    const { parseCompanyHostLinks } = await import('../../../src/services/company-host-source.js');
    const links = parseCompanyHostLinks(
      '<a href="/wp-content/uploads/2026/09/Abridged-Prospectus_Himalayan_19092026.pdf">Abridged Prospectus</a>' +
        '<a href="/wp-content/uploads/2026/09/Prospectus_Himalayan.pdf">Prospectus</a>',
      'https://himalayansolar.co.in/investors/'
    );
    expect(links.map((l) => l.url)).toEqual(['https://himalayansolar.co.in/wp-content/uploads/2026/09/Prospectus_Himalayan.pdf']);
    expect(links[0].docType).toBe('PROSPECTUS');
  });
});
