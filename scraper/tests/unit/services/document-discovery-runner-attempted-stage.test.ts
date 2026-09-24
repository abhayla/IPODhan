/**
 * Item 7 (F-151/F-152, OD-56/OD-62, #957) — `attempted_at_stage` must record
 * only a CONCLUDED search, never an unfinished one.
 *
 * Class: every LISTED document row whose search hit `chain_incomplete` (the
 * rung chain ran out mid-IPO — nobody answered). If such a row got
 * `attempted_at_stage` written anyway, `listedRowDue` (document-state-machine.ts)
 * would treat it as "already tried at LISTED" and never retry it again after
 * listing — the exact defect this pin exists to catch.
 *
 * These tests drive the REAL `DocumentDiscoveryRunner.runIpo` (not a
 * synthetic `attempt()` helper) against `InMemoryDocumentFetchStateStore`,
 * the same seam `document-discovery-runner.test.ts` and
 * `document-discovery-round6-chain.test.ts` use.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  type DiscoveryIpo,
  type HttpFetcher,
  type HttpResponse,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';
import { nextDataJobSlotBoundary } from '@ipodhan/shared/scheduler/data-job-slots';

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');
const NOW = new Date('2026-09-24T06:00:00Z');

const json = (body: string, url = 'https://x/api'): HttpResponse => ({
  status: 200,
  contentType: 'application/json',
  body: Buffer.from(body),
  url,
});

function makeRunner(fetcher: HttpFetcher) {
  const store = new InMemoryDocumentFetchStateStore();
  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store,
    documents: { async upsertDocument() { return { id: 'doc-1' }; } } as never,
    counter: new NetworkCounter(),
    now: () => NOW,
    skipDownload: true,
  });
  return { runner, store };
}

describe('attempted_at_stage is written only on a concluded search (item 7, #957)', () => {
  it('does NOT write attempted_at_stage on a chain_incomplete outcome, and sets the next attempt to the next data-slot start', async () => {
    // Same shape as document-discovery-round6-chain.test.ts: BSE answers with
    // a real board that does not cover this issue (a fact, not a failure),
    // NSE answers 200 with an empty issueInfo (no doc links) — nothing
    // FAILED, so EXCHANGES:no_link, but with no company website and no
    // verifier URL every escalation rung is skipped. Nobody answered ->
    // chain_incomplete.
    const fetcher: HttpFetcher = async (url) => {
      if (url.includes('IPO_HomePageDetail')) return json(fixture('bse-ipo-homepage.json'));
      if (url.includes('ipo-detail')) return json(JSON.stringify({ issueInfo: { dataList: [] } }));
      return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
    };
    const { runner, store } = makeRunner(fetcher);

    const ipo: DiscoveryIpo = {
      id: 'ipo-item7-incomplete',
      companyName: 'Nowhere Industries Limited', // not on the BSE board fixture
      symbol: 'NOWHERE7',
      segment: 'MAINBOARD',
      stage: 'LISTED',
      bseIpoNo: null,
      companyWebsite: null,
      verifierUrl: null,
    };

    const result = await runner.runIpo(ipo, []);

    // The scenario must actually occur, or the assertions below prove nothing.
    const chainIncompleteRow = (
      result.attempts.filter(
        (a) =>
          a.source === 'CHAIN' &&
          a.outcome.includes('EXCHANGES:no_link') &&
          a.outcome.includes('SEBI:skipped') &&
          a.outcome.includes('COMPANY:skipped') &&
          a.outcome.includes('VERIFIER:skipped')
      )
    );
    expect(chainIncompleteRow.length).toBeGreaterThan(0);

    const rows = await store.listForIpo(ipo.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state).toBe('WANTED');
      // The class this test pins: an unfinished search must NOT stamp the stage.
      expect(row.attemptedAtStage ?? null).toBeNull();
      // The next attempt is the next data-job slot boundary, never a
      // fixed-delay retry timer (F-151/F-152, OD-56).
      expect(row.nextRetryAt).toEqual(nextDataJobSlotBoundary(NOW));
    }
  }, 60_000);

  it('DOES write attempted_at_stage (the IPO current stage) when the search concludes', async () => {
    // Skyways real BSE core payload — the exchange settles it, some types are
    // found and some are settled misses; either way the search CONCLUDED.
    const fetcher: HttpFetcher = async (url) => {
      if (url.includes('IPO_HomePageDetail')) return json(fixture('bse-ipo-homepage.json'));
      if (url.includes('GetMkt_ISSUE_BBS_IPO')) return json(fixture('bse-skyways-core.json'));
      if (url.includes('symbol=SKYWAYS')) return json(fixture('nse-skyways.json'));
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    const { runner, store } = makeRunner(fetcher);

    const ipo: DiscoveryIpo = {
      id: 'ipo-item7-concluded',
      companyName: 'Skyways Air Services Ltd.',
      symbol: 'SKYWAYS',
      segment: 'MAINBOARD',
      stage: 'LISTED',
      bseIpoNo: 7903,
    };

    const result = await runner.runIpo(ipo, []);
    expect(result.found.length).toBeGreaterThan(0);
    expect(result.notFound.length).toBeGreaterThan(0);

    const rows = await store.listForIpo(ipo.id);
    expect(rows.length).toBeGreaterThan(0);
    // Every row this cycle CONCLUDED — found, or a settled NOT_FOUND miss —
    // gets the stage stamp. (DRHP is a separate, legitimate chain_incomplete
    // on this fixture — Skyways' BSE/NSE payloads never serve a DRHP link and
    // no verifier URL exists to escalate to — and correctly stays unstamped,
    // which is the negative case the first test in this file pins directly.)
    const concludedTypes = [...result.found, ...result.notFound];
    expect(concludedTypes.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (!concludedTypes.includes(row.docType)) continue;
      expect(row.attemptedAtStage).toBe('LISTED');
    }
  }, 30_000);
});
