/**
 * listed-rotation-stall-null-fetch-state — proves `runIpo` never leaves an
 * IPO with ZERO `document_fetch_state` rows after a visit.
 *
 * Root cause: `document-cycle.ts`'s LISTED-tier candidate order sorts by
 * `MAX(document_fetch_state.last_attempt_at)` (NULLS FIRST). An IPO that is
 * visited but ends the cycle with no fetch-state row at all sorts first
 * again next cycle, forever, starving every LISTED row behind it. Two ways
 * that used to happen: (1) `plan.skipIpo` true with no prior fetch-state
 * history (the withdrawn/postponed-before-first-touch path), and (2) an
 * exception thrown by the network/discovery section AFTER the plan is
 * computed but BEFORE the per-`due`-type loop's first `ensureRow` call.
 *
 * These tests drive the REAL `DocumentDiscoveryRunner.runIpo` (not a mock)
 * against the same `InMemoryDocumentFetchStateStore` seam
 * `document-discovery-runner.test.ts` uses, so the rotation-stamp guarantee
 * is proven against the production code path, not an approximation of it.
 */
import { describe, it, expect } from 'vitest';
import {
  DocumentDiscoveryRunner,
  type DiscoveryIpo,
  type HttpFetcher,
} from '../../../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { NetworkCounter } from '../../../src/utils/network-counter.js';

const NOW = new Date('2026-09-06T06:00:00Z');

function makeRunner(fetcher: HttpFetcher) {
  const store = new InMemoryDocumentFetchStateStore();
  const counter = new NetworkCounter();
  const documents = {
    async upsertDocument(doc: Record<string, unknown>) {
      return { id: 'doc-1' };
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
  return { runner, store, counter };
}

const throwingFetcher: HttpFetcher = async () => {
  throw new Error('exchange payload shaped unexpectedly');
};

describe('listed-rotation-stall-null-fetch-state — rotation-stamp guard', () => {
  it('stamps a fetch-state row when the network/discovery section throws mid-run', async () => {
    const { runner, store } = makeRunner(throwingFetcher);
    const ipo: DiscoveryIpo = {
      id: 'ipo-augmont',
      companyName: 'Augmont Enterprises Ltd.',
      symbol: 'AUGMONT',
      segment: 'MAINBOARD',
      stage: 'LISTED',
    };

    // The fetch section throws; runIpo must rethrow (callers already have a
    // non-fatal catch — this test proves the ORIGINAL error still surfaces)
    // but must not leave the IPO with zero rows on the way out.
    await expect(runner.runIpo(ipo, [])).rejects.toThrow('exchange payload shaped unexpectedly');

    const rows = await store.listForIpo(ipo.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].lastAttemptAt).toEqual(NOW);
    // A rotation stamp is not a real fetch attempt — the retry ladder must
    // not mistake it for one.
    expect(rows[0].attempts).toBe(0);
  });

  it('stamps a fetch-state row when skipIpo is true but the IPO has never been touched', async () => {
    // Withdrawn issues short-circuit in `planIpoCycle` before any network
    // call — reachable with `rows: []` when a withdrawn IPO is visited for
    // the very first time (its `toMarkNotApplicable` is derived from the
    // (empty) existing rows, so nothing gets marked either).
    const { runner, store } = makeRunner(throwingFetcher);
    const ipo: DiscoveryIpo = {
      id: 'ipo-withdrawn-first-touch',
      companyName: 'Withdrawn Co Ltd.',
      symbol: 'WDCO',
      segment: 'MAINBOARD',
      stage: 'CLOSED',
      issue: { withdrawn: true },
    };

    const result = await runner.runIpo(ipo, []);
    expect(result.skipped).toBe(true);

    const rows = await store.listForIpo(ipo.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].lastAttemptAt).toEqual(NOW);
  });

  it('does NOT double-stamp when the IPO already has fetch-state history and is genuinely complete', async () => {
    const { runner, store } = makeRunner(throwingFetcher);
    const ipo: DiscoveryIpo = {
      id: 'ipo-already-complete',
      companyName: 'Already Complete Ltd.',
      symbol: 'DONE',
      segment: 'MAINBOARD',
      stage: 'CLOSED',
      issue: { withdrawn: true },
    };
    // Seed one already-closed row so `existingRows` is non-empty — the
    // withdrawn branch's `stillOpen` is then empty and `skipIpo` is true for
    // a LEGITIMATE reason (already closed), not a never-touched IPO.
    const seeded = await store.ensureRow(ipo.id, 'DRHP');
    await store.update(seeded.id, { state: 'NOT_APPLICABLE', lastAttemptAt: NOW });

    const existingRows = (await store.listForIpo(ipo.id)).map((r) => ({
      docType: r.docType as never,
      state: r.state,
      attempts: r.attempts,
      nextRetryAt: r.nextRetryAt,
      blockedSinceAt: r.blockedSinceAt,
      filingDate: r.filingDate,
      extractorVersion: r.extractorVersion,
      lastAttemptAt: r.lastAttemptAt,
    }));

    const result = await runner.runIpo(ipo, existingRows);
    expect(result.skipped).toBe(true);

    const rows = await store.listForIpo(ipo.id);
    // Only the one seeded row — the guard must not manufacture a second row
    // for an IPO that already has real history.
    expect(rows.length).toBe(1);
  });
});
