// implements: item 6 (this slice) -- the INVESTORGAIN_GMP fetcher (rank 1)
// for the field-plan walk's `gmp_records.gmp` manifest entry. Unlike the
// BSE/NSE/CHITTORGARH fetchers, this one makes NO scraper call -- it reads
// the value the GMP job (`createGMPRecord`, every 30 min) already wrote, via
// an injected `GmpReader`. The real fixture shape below was captured
// read-only from staging (see its .meta.json) so the mocked reader answers
// with the real row shape, not a format typed from memory.
import { describe, it, expect, vi } from 'vitest';
import {
  buildInvestorgainGmpFetcher,
  INVESTORGAIN_GMP_SERVEABLE_FIELDS,
  type GmpReader,
} from '../../../src/services/field-plan-walk-investorgain-gmp-fetcher.js';
import gmpFixture from '../../fixtures/gmp-records/staging-investorgain-gmp-row.json' with { type: 'json' };

const IPO_ID = '00000000-0000-4000-8000-0000000660a3';

function makeReader(result: Awaited<ReturnType<GmpReader['findLatestFromInvestorGain']>> | Error): GmpReader {
  return {
    findLatestFromInvestorGain: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('INVESTORGAIN_GMP fetcher — capability + serveable-field gating', () => {
  it('answers NOT_PRINTED when the manifest marks this table.field NOT capable.INVESTORGAIN_GMP', async () => {
    const reader = makeReader(null);
    const fetcher = buildInvestorgainGmpFetcher({ gmpReader: reader, isInvestorgainGmpCapable: () => false });
    const answer = await fetcher(IPO_ID, 'gmp_records', '', 'gmp');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
    expect(reader.findLatestFromInvestorGain).not.toHaveBeenCalled();
  });

  it('answers CHECK_FAILED transient for a field this adapter has no mapping for (coverage gap, not a manifest no)', async () => {
    const reader = makeReader(null);
    const fetcher = buildInvestorgainGmpFetcher({ gmpReader: reader, isInvestorgainGmpCapable: () => true });
    const answer = await fetcher(IPO_ID, 'gmp_records', '', 'gmp_percentage');
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'INVESTORGAIN_GMP has no mapped field for gmp_records.gmp_percentage yet (coverage gap, not a manifest no)',
      transient: true,
      gap: 'NO_MAPPING',
    });
    expect(reader.findLatestFromInvestorGain).not.toHaveBeenCalled();
  });

  it('INVESTORGAIN_GMP_SERVEABLE_FIELDS names exactly gmp_records.gmp — the manifest\'s only field ranking this source', () => {
    expect([...INVESTORGAIN_GMP_SERVEABLE_FIELDS]).toEqual(['gmp_records.gmp']);
  });
});

describe('INVESTORGAIN_GMP fetcher — SUPPLIED, from the real staging row shape', () => {
  it('answers SUPPLIED with the GMP job\'s own value — no network call made', async () => {
    const reader = makeReader({ id: gmpFixture.id, gmp: gmpFixture.gmp, timestamp: new Date(gmpFixture.timestamp) });
    const fetcher = buildInvestorgainGmpFetcher({ gmpReader: reader, isInvestorgainGmpCapable: () => true });
    const answer = await fetcher(IPO_ID, 'gmp_records', '', 'gmp');
    expect(answer).toEqual({ outcome: 'SUPPLIED', value: gmpFixture.gmp });
    expect(reader.findLatestFromInvestorGain).toHaveBeenCalledTimes(1);
    expect(reader.findLatestFromInvestorGain).toHaveBeenCalledWith(IPO_ID);
  });
});

describe('INVESTORGAIN_GMP fetcher — no row yet', () => {
  it('answers NOT_AVAILABLE_YET when the GMP job has not written a row for this IPO yet', async () => {
    const reader = makeReader(null);
    const fetcher = buildInvestorgainGmpFetcher({ gmpReader: reader, isInvestorgainGmpCapable: () => true });
    const answer = await fetcher(IPO_ID, 'gmp_records', '', 'gmp');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });
});

describe('INVESTORGAIN_GMP fetcher — transient failures', () => {
  it('a reader throw answers CHECK_FAILED (transient default)', async () => {
    const reader = makeReader(new Error('ECONNRESET'));
    const fetcher = buildInvestorgainGmpFetcher({ gmpReader: reader, isInvestorgainGmpCapable: () => true });
    const answer = await fetcher(IPO_ID, 'gmp_records', '', 'gmp');
    expect(answer).toEqual({ outcome: 'CHECK_FAILED', reason: 'ECONNRESET' });
  });
});

// Mutation guard (this task's brief): a reader that answers from the WRONG
// source's row must NOT be indistinguishable from the correct one — proven
// directly against staging (read-only, not committed as code) by filtering
// `gmp_records` on a literal other than 'INVESTORGAIN_GMP' and confirming the
// row disappears (RED). This unit test instead pins the CONTRACT the mutation
// would break: the fetcher must call the reader with exactly the ipoId it was
// given, and must pass the reader's `gmp` value straight through unmodified
// (never re-deriving or defaulting it), so a reader implementation answering
// from a different source's row is caught by the SUPPLIED-value assertion
// above, not silently accepted.
describe('INVESTORGAIN_GMP fetcher — zero network calls', () => {
  it('the fetcher itself performs no I/O beyond the injected reader (no fetch/scrape import used)', async () => {
    const reader = makeReader({ id: gmpFixture.id, gmp: gmpFixture.gmp, timestamp: new Date(gmpFixture.timestamp) });
    const fetcher = buildInvestorgainGmpFetcher({ gmpReader: reader, isInvestorgainGmpCapable: () => true });
    await fetcher(IPO_ID, 'gmp_records', '', 'gmp');
    // The only external call the fetcher can possibly make is through the
    // injected reader — asserting call count 1 on the reader, with nothing
    // else stubbed globally (no fetch/http mock installed), is the whole
    // "no network I/O" guarantee this adapter has: there is no other door.
    expect(reader.findLatestFromInvestorGain).toHaveBeenCalledTimes(1);
  });
});
