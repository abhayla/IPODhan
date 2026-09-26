/**
 * Stage 2 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6, issue #258): "Resolve document links - captured GetMkt_ISSUE_BBS_IPO + ipo-detail
 * payloads - document-discovery-runner (T-403) with network stubbed - typed links: Skyways
 * RHP/PBA/CORRIGENDUM/ADDENDUM, 3 BRLMs".
 *
 * Drives the REAL `DocumentDiscoveryRunner` (src/services/document-discovery-runner.ts,
 * merged from the T-403 branch in PR #266/ce9fb4ff) against the REAL captured BSE/NSE payloads
 * in tests/fixtures/documents/ -- no network. `skipDownload: true` isolates link RESOLUTION
 * (this stage) from download+verify+store (stage 3, its own file).
 *
 * See fixtures/stage-2/expected-resolve-links.json for how these values relate to the deeper,
 * pre-existing document-discovery-runner.test.ts suite this reuses rather than duplicates.
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
  readFileSync(join(__dirname, 'fixtures', 'stage-2', 'expected-resolve-links.json'), 'utf8')
) as { skywaysMainboard: { leadManagers: string[]; foundContains: string[]; minFoundCount: number } };

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

describe('pipeline stage 2 - resolve document links', () => {
  it('resolves Skyways RHP/PBA/CORRIGENDUM/ADDENDUM and all three BRLMs, offline', async () => {
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

    const result = await runner.runIpo(SKYWAYS, []);

    expect(result.leadManagers).toEqual(GOLDEN.skywaysMainboard.leadManagers);
    expect(result.found).toEqual(expect.arrayContaining(GOLDEN.skywaysMainboard.foundContains));
    expect(result.found.length).toBeGreaterThanOrEqual(GOLDEN.skywaysMainboard.minFoundCount);

    const foundRows = store.all().filter((r) => r.state === 'FOUND');
    expect(foundRows.length).toBeGreaterThanOrEqual(GOLDEN.skywaysMainboard.minFoundCount);
  });
});
