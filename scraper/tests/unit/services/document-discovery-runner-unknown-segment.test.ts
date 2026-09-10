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

/**
 * Item 2 slice 3a: `fetchNseIssueInfo` MUST NOT silently default an
 * unknown/null `segment` to the mainboard 'EQ' NSE series — a real SME IPO
 * would then be queried against the wrong series. This proves the runner
 * records an `unknown_segment` attempt and never issues the NSE request at
 * all when segment is unknown.
 */

const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const json = (text: string, status = 200): HttpResponse => ({
  status,
  contentType: 'application/json',
  body: Buffer.from(text),
  url: 'https://fixture',
});

const NOW = new Date('2026-08-28T06:00:00Z');

const UNKNOWN_SEGMENT_IPO: DiscoveryIpo = {
  id: 'ipo-unknown-segment',
  companyName: 'Unknown Segment Co Ltd.',
  symbol: 'UNKCO',
  segment: null,
  stage: 'OPEN',
};

function makeRunner(fetcher: HttpFetcher) {
  const store = new InMemoryDocumentFetchStateStore();
  const counter = new NetworkCounter();
  const documents = {
    upserted: [] as unknown[],
    async upsertDocument(doc: Record<string, unknown>) {
      this.upserted.push(doc);
      return { id: `doc-${this.upserted.length}` };
    },
  };
  const runner = new DocumentDiscoveryRunner({
    fetcher,
    store,
    documents,
    counter,
    now: () => NOW,
    skipDownload: true,
  });
  return { runner };
}

describe('DocumentDiscoveryRunner — unknown segment (item 2 slice 3a)', () => {
  it('never requests NSE and records unknown_segment when segment is null', async () => {
    const requestedUrls: string[] = [];
    const fetcher: HttpFetcher = async (url) => {
      requestedUrls.push(url);
      if (url.includes('IPO_HomePageDetail')) return json(fixture('bse-ipo-homepage.json'));
      if (url.includes('GetMkt_ISSUE_BBS_IPO')) return json(fixture('bse-skyways-core.json'));
      return { status: 404, contentType: 'text/html', body: Buffer.from('nope'), url };
    };
    const { runner } = makeRunner(fetcher);

    const result = await runner.runIpo(UNKNOWN_SEGMENT_IPO, []);

    expect(requestedUrls.some((u) => u.includes('symbol=UNKCO'))).toBe(false);
    const nseUnknownAttempt = result.attempts.find(
      (a) => a.source === 'NSE' && a.outcome === 'unknown_segment'
    );
    expect(nseUnknownAttempt).toBeDefined();
  });
});
