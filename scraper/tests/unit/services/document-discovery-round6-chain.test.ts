import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import logger from '../../../src/utils/logger.js';

/**
 * T-403 round 6 — the behavioural half of the Class-1 fix.
 *
 * THE ROW THIS PINS. A mainboard IPO that has dropped off (or never reached)
 * the BSE board, with NSE answering normally: nothing FAILED, so the chain
 * records `EXCHANGES:no_link`, but BSE plainly did not cover the issue, so the
 * exchanges may not SETTLE the type. For a type SEBI does not serve, with no
 * company website and no verifier URL on the row, all three escalation rungs are
 * skipped and `escalateBeyondExchanges` returns null.
 *
 * Before round 6 the caller acted only on `found`/`failed`, so the
 * pre-escalation `outcome = 'no_link'` survived and the row was written
 * NOT_YET_FILED — "the company has not filed it" — with no retry and no alert,
 * on a chain in which not one rung answered the question. Reachable for every
 * production row until `verifier_url` is populated.
 */

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');

const json = (body: string, url = 'https://x/api'): HttpResponse => ({
  status: 200,
  contentType: 'application/json',
  body: Buffer.from(body),
  url,
});

/**
 * BSE answers with a real board that does not list this company (`not_on_board`
 * — a fact, not a failure), NSE answers with an issue that carries no document
 * links at all.
 */
const BSE_ANSWERS_WITHOUT_THIS_IPO = {
  IPO_HomePageDetail: json(fixture('bse-ipo-homepage.json')),
  'ipo-detail': json(JSON.stringify({ issueInfo: { dataList: [] } })),
};

let storeDir: string;
beforeEach(async () => {
  storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-r6-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

function makeRunner() {
  const seen: string[] = [];
  const fetcher: HttpFetcher = async (url) => {
    seen.push(url);
    for (const [needle, response] of Object.entries(BSE_ANSWERS_WITHOUT_THIS_IPO)) {
      if (url.includes(needle)) return response;
    }
    return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
  };
  const store = new InMemoryDocumentFetchStateStore();
  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store,
    documents: { async upsertDocument() { return { id: 'doc-1' }; } } as never,
    counter: new NetworkCounter(),
    now: () => new Date('2026-08-28T06:00:00Z'),
    storeDir,
    sleep: async () => undefined,
    extractCoverText: async () => ({ usable: false }),
  });
  return { runner, store, seen };
}

/** The `rungs[...]` line the runner writes for one document type. */
const rungsFor = (attempts: { source: string; outcome: string }[], docType: string) =>
  attempts.find((a) => a.source === 'CHAIN' && a.outcome.startsWith(`rungs[${docType}]`))?.outcome ??
  '';

const NO_ESCALATION_POSSIBLE = (chain: string) =>
  chain.includes('EXCHANGES:no_link') &&
  chain.includes('SEBI:skipped') &&
  chain.includes('COMPANY:skipped') &&
  chain.includes('VERIFIER:skipped');

describe('a chain in which no rung answered concludes nothing', () => {
  it('leaves the row WANTED and retryable — never NOT_YET_FILED', async () => {
    const { runner, store } = makeRunner();
    const errorSpy = vi.spyOn(logger, 'error');

    const ipo: DiscoveryIpo = {
      id: 'ipo-r6',
      companyName: 'Nowhere Industries Limited', // not on the BSE board fixture
      symbol: 'NOWHERE',
      segment: 'MAINBOARD',
      stage: 'OPEN',
      bseIpoNo: null,
      companyWebsite: null,
      verifierUrl: null,
    };

    const result = await runner.runIpo(ipo, []);
    const rows = await store.listForIpo('ipo-r6');

    // The exchanges answered (NSE ok) and nothing failed, but BSE did not cover
    // the issue, so no exchange-served type may settle either.
    const bse = result.attempts.filter((a) => a.source === 'BSE').map((a) => a.outcome);
    expect(bse).toContain('not_on_board');
    expect(result.attempts.some((a) => a.source === 'NSE' && a.outcome === 'ok')).toBe(true);

    const allRungsSkipped = rows.filter((r) =>
      NO_ESCALATION_POSSIBLE(rungsFor(result.attempts, r.docType))
    );
    // The scenario must actually occur, or the assertions below prove nothing.
    expect(allRungsSkipped.length).toBeGreaterThan(0);

    for (const row of allRungsSkipped) {
      expect(row.state).toBe('WANTED');
      expect(row.state).not.toBe('NOT_YET_FILED');
      expect(row.nextRetryAt).not.toBeNull();
      // chain_incomplete is not a block — nothing was learned about an outage,
      // so there is nothing to age. A prior BLOCKED_ALL clock would have been
      // preserved (document-state-machine.ts `chain_incomplete` case); this is
      // this row's FIRST cycle, so it has none to preserve.
      expect(row.blockedSinceAt).toBeNull();
      // chain_incomplete never carries a P2 page — that is BLOCKED_ALL's signal
      // alone (transition.alert, document-discovery-runner.ts). Scoped to THIS
      // row's docType: other docTypes on the same IPO legitimately hit a real
      // SEBI failure (http_error, not skipped) and DO block — that is correct
      // and must not be masked by a blanket "nothing blocked" assertion.
      expect(result.blocked).not.toContain(row.docType);
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ docType: row.docType }),
        'Document BLOCKED_ALL — every source failed (P2)'
      );
    }
  }, 60_000);

  it('claims absence for NO type on this IPO — not one rung answered for any of them', async () => {
    const { runner, store } = makeRunner();

    await runner.runIpo(
      {
        id: 'ipo-r6b',
        companyName: 'Nowhere Industries Limited',
        symbol: 'NOWHERE',
        segment: 'MAINBOARD',
        stage: 'OPEN',
        bseIpoNo: null,
        companyWebsite: null,
        verifierUrl: null,
      },
      []
    );

    const states = (await store.listForIpo('ipo-r6b')).map((r) => r.state);
    expect(states.length).toBeGreaterThan(0);
    expect(states).not.toContain('NOT_YET_FILED');
  }, 60_000);
});
