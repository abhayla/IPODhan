/**
 * Stage 4 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6, issue #258): "State machine - run 1 then run 2 - run 2 = 0 network calls; ESDS
 * DRHP NOT_YET_FILED".
 *
 * Drives the REAL `DocumentDiscoveryRunner` across two/three cycles against the REAL
 * `InMemoryDocumentFetchStateStore`, on the REAL captured Skyways payloads -- no network.
 *
 * Coverage note (see fixtures/stage-4/expected-state-machine.json): this repo has no captured
 * ESDS payload shaped for DocumentDiscoveryRunner (only an unrelated SEBI-detail HTML fixture),
 * so the NOT_YET_FILED-vs-settled-miss mechanism the gap-analysis names via ESDS is proven here
 * on Skyways at stage CLOSED instead -- the same mechanism (W-28), on the fixture this repo
 * actually has, not invented ESDS data.
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

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'documents');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stage-4', 'expected-state-machine.json'), 'utf8')
) as {
  run1: { networkCallsGreaterThan: number };
  run2: { networkCalls: number; due: unknown[]; supersededContains: string };
  run3: { skipped: boolean; networkCalls: number };
  closedStage: { notFoundContains: string; notYetFiledExcludes: string };
};

const SKYWAYS: DiscoveryIpo = {
  id: 'ipo-skyways',
  companyName: 'Skyways Air Services Ltd.',
  symbol: 'SKYWAYS',
  segment: 'MAINBOARD',
  stage: 'OPEN',
  bseIpoNo: 7903,
};

function json(text: string): HttpResponse {
  return { status: 200, contentType: 'application/json', body: Buffer.from(text), url: 'https://fixture' };
}

function fixtureFetcher(): HttpFetcher {
  return async (url) => {
    if (url.includes('IPO_HomePageDetail')) return json(fixture('bse-ipo-homepage.json'));
    if (url.includes('GetMkt_ISSUE_BBS_IPO')) return json(fixture('bse-skyways-core.json'));
    if (url.includes('symbol=SKYWAYS')) return json(fixture('nse-skyways.json'));
    return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
  };
}

function makeRunner() {
  const store = new InMemoryDocumentFetchStateStore();
  const counter = new NetworkCounter();
  const documents = { async upsertDocument() { return { id: 'unused' }; } };
  const runner = new DocumentDiscoveryRunner({
    fetcher: fixtureFetcher(),
    store,
    documents,
    counter,
    now: () => new Date('2026-08-28T06:00:00Z'),
    skipDownload: true,
  });
  return { runner, store };
}

describe('pipeline stage 4 - state machine (run N+1 costs nothing new)', () => {
  it('run 2 makes zero network calls and run 3 is a pure skip', async () => {
    const { runner, store } = makeRunner();

    const run1 = await runner.runIpo(SKYWAYS, []);
    expect(run1.networkCalls).toBeGreaterThan(GOLDEN.run1.networkCallsGreaterThan);

    const rowsAfter1 = await store.listForIpo(SKYWAYS.id);
    const asInput = (rows: Awaited<ReturnType<typeof store.listForIpo>>) =>
      rows.map((r) => ({
        docType: r.docType as never,
        state: r.state,
        attempts: r.attempts,
        nextRetryAt: r.nextRetryAt,
        blockedSinceAt: r.blockedSinceAt,
        filingDate: r.filingDate,
        extractorVersion: r.extractorVersion,
        lastAttemptAt: r.lastAttemptAt,
      }));

    const run2 = await runner.runIpo(SKYWAYS, asInput(rowsAfter1));
    expect(run2.networkCalls).toBe(GOLDEN.run2.networkCalls);
    expect(run2.due).toEqual(GOLDEN.run2.due);
    expect(run2.superseded).toContain(GOLDEN.run2.supersededContains);

    const rowsAfter2 = await store.listForIpo(SKYWAYS.id);
    const run3 = await runner.runIpo(SKYWAYS, asInput(rowsAfter2));
    expect(run3.skipped).toBe(GOLDEN.run3.skipped);
    expect(run3.networkCalls).toBe(GOLDEN.run3.networkCalls);
  });

  it('a settled miss on a DUE type at CLOSED is notFound, never notYetFiled (W-28)', async () => {
    const { runner } = makeRunner();
    const result = await runner.runIpo({ ...SKYWAYS, stage: 'CLOSED' }, []);

    expect(result.notFound).toContain(GOLDEN.closedStage.notFoundContains);
    expect(result.notYetFiled).not.toContain(GOLDEN.closedStage.notYetFiledExcludes);
  }, 30_000);
});
