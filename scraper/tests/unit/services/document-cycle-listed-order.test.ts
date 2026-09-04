/**
 * W-122 — the document cycle walks OPEN/CLOSED/UPCOMING before LISTED backfill.
 *
 * Found live 2026-09-03: `loadCandidateIpos()` had NO `ORDER BY`, so each
 * cycle walked candidates in arbitrary table order and stopped at its
 * network/spawn budget after a handful of IPOs. Deepa Jewellers (CLOSED,
 * lists 8 Sep — its Prospectus becomes due the moment it leaves the board)
 * had zero documents rows after six cycles while months-old LISTED IPOs
 * (pure backfill, never urgent) were processed first.
 *
 * `orderAndCapCandidates` is the pure, unit-testable seam `loadCandidateIpos`
 * calls after fetching rows: it decides both the walk order (OPEN, CLOSED,
 * UPCOMING by open date ascending, LISTED by listing date descending,
 * WITHDRAWN/POSTPONED last) and the per-cycle LISTED cap. `loadCandidateIpos`'s
 * SQL `ORDER BY` is written to already match this rank so a degraded DB round
 * trip is never the reason a live IPO sits behind stale backfill, but THIS
 * function is the source of truth the tests exercise directly — no database
 * needed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  orderAndCapCandidates,
  getListedCap,
  DEFAULT_LISTED_CAP,
} from '../../../src/services/document-cycle.js';
import type { DiscoveryIpo } from '../../../src/services/document-discovery-runner.js';

function ipo(over: Partial<DiscoveryIpo> & { id: string; stage: DiscoveryIpo['stage'] }): DiscoveryIpo {
  return {
    companyName: `Company ${over.id}`,
    symbol: null,
    segment: 'MAINBOARD',
    issue: { isFixedPrice: false, withdrawn: false },
    ...over,
  };
}

describe('W-122 — orderAndCapCandidates ordering', () => {
  it('orders OPEN, CLOSED, UPCOMING (by open date asc), LISTED (by listing date desc), WITHDRAWN last — from a shuffled input', () => {
    const withdrawn = ipo({ id: 'withdrawn-1', stage: 'UPCOMING', issue: { isFixedPrice: false, withdrawn: true } });
    const open = ipo({ id: 'open-1', stage: 'OPEN' });
    const closed = ipo({ id: 'closed-1', stage: 'CLOSED' });
    const upcomingSoon = ipo({ id: 'upcoming-soon', stage: 'UPCOMING', openDate: '2026-09-10' });
    const upcomingLater = ipo({ id: 'upcoming-later', stage: 'UPCOMING', openDate: '2026-09-20' });
    const listedRecent = ipo({ id: 'listed-recent', stage: 'LISTED', listingDate: '2026-09-01' });
    const listedOld = ipo({ id: 'listed-old', stage: 'LISTED', listingDate: '2026-01-01' });

    // Deliberately shuffled — the sort, not insertion order, must decide.
    const shuffled = [
      listedOld,
      withdrawn,
      upcomingLater,
      listedRecent,
      closed,
      upcomingSoon,
      open,
    ];

    const { candidates } = orderAndCapCandidates(shuffled, 10);

    expect(candidates.map((c) => c.id)).toEqual([
      'open-1',
      'closed-1',
      'upcoming-soon', // soonest open_date first
      'upcoming-later',
      'listed-recent', // most recent listing_date first
      'listed-old',
      'withdrawn-1',
    ]);
  });

  it('PRE_OPEN (an UPCOMING sub-stage) sorts in the same UPCOMING bucket, never ahead of OPEN/CLOSED', () => {
    const open = ipo({ id: 'open-1', stage: 'OPEN' });
    const preOpen = ipo({ id: 'pre-open-1', stage: 'PRE_OPEN' });
    const closed = ipo({ id: 'closed-1', stage: 'CLOSED' });

    const { candidates } = orderAndCapCandidates([preOpen, closed, open], 10);

    expect(candidates.map((c) => c.id)).toEqual(['open-1', 'closed-1', 'pre-open-1']);
  });

  it('is a stable tie-break by id when rank and date both match, so order does not reshuffle cycle to cycle', () => {
    const a = ipo({ id: 'aaa', stage: 'UPCOMING' });
    const b = ipo({ id: 'bbb', stage: 'UPCOMING' });
    const c = ipo({ id: 'ccc', stage: 'UPCOMING' });

    const { candidates } = orderAndCapCandidates([c, a, b], 10);

    expect(candidates.map((x) => x.id)).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('a LISTED row with no listing_date sorts after every dated LISTED row', () => {
    const dated = ipo({ id: 'dated', stage: 'LISTED', listingDate: '2026-01-01' });
    const undated = ipo({ id: 'undated', stage: 'LISTED', listingDate: null });

    const { candidates } = orderAndCapCandidates([undated, dated], 10);

    expect(candidates.map((c) => c.id)).toEqual(['dated', 'undated']);
  });

  it('an UPCOMING row with no open_date sorts after every dated UPCOMING row', () => {
    const dated = ipo({ id: 'dated', stage: 'UPCOMING', openDate: '2026-09-10' });
    const undated = ipo({ id: 'undated', stage: 'UPCOMING', openDate: null });

    const { candidates } = orderAndCapCandidates([undated, dated], 10);

    expect(candidates.map((c) => c.id)).toEqual(['dated', 'undated']);
  });
});

describe('W-122 — orderAndCapCandidates per-cycle LISTED cap', () => {
  it('with a cap of 1 and three LISTED rows, exactly one LISTED candidate survives and 2 are reported deferred', () => {
    const listed1 = ipo({ id: 'listed-1', stage: 'LISTED', listingDate: '2026-09-01' });
    const listed2 = ipo({ id: 'listed-2', stage: 'LISTED', listingDate: '2026-08-01' });
    const listed3 = ipo({ id: 'listed-3', stage: 'LISTED', listingDate: '2026-07-01' });

    const { candidates, listedDeferred } = orderAndCapCandidates([listed3, listed1, listed2], 1);

    expect(candidates.map((c) => c.id)).toEqual(['listed-1']); // most-recent-first survivor
    expect(listedDeferred).toBe(2);
  });

  it('a cap of 0 defers every LISTED candidate and processes none', () => {
    const listed1 = ipo({ id: 'listed-1', stage: 'LISTED', listingDate: '2026-09-01' });
    const listed2 = ipo({ id: 'listed-2', stage: 'LISTED', listingDate: '2026-08-01' });

    const { candidates, listedDeferred } = orderAndCapCandidates([listed1, listed2], 0);

    expect(candidates).toEqual([]);
    expect(listedDeferred).toBe(2);
  });

  it('the cap NEVER removes OPEN/CLOSED/UPCOMING/WITHDRAWN candidates — only LISTED is ever deferred', () => {
    const open = ipo({ id: 'open-1', stage: 'OPEN' });
    const closed = ipo({ id: 'closed-1', stage: 'CLOSED' });
    const upcoming = ipo({ id: 'upcoming-1', stage: 'UPCOMING' });
    const withdrawn = ipo({ id: 'withdrawn-1', stage: 'UPCOMING', issue: { isFixedPrice: false, withdrawn: true } });
    const listed1 = ipo({ id: 'listed-1', stage: 'LISTED' });
    const listed2 = ipo({ id: 'listed-2', stage: 'LISTED' });
    const listed3 = ipo({ id: 'listed-3', stage: 'LISTED' });

    const { candidates, listedDeferred } = orderAndCapCandidates(
      [listed1, withdrawn, listed2, upcoming, listed3, closed, open],
      1
    );

    // Every non-LISTED candidate survives regardless of the cap.
    expect(candidates.map((c) => c.id)).toContain('open-1');
    expect(candidates.map((c) => c.id)).toContain('closed-1');
    expect(candidates.map((c) => c.id)).toContain('upcoming-1');
    expect(candidates.map((c) => c.id)).toContain('withdrawn-1');
    // Exactly one of the three LISTED candidates survives; the other two are deferred.
    expect(candidates.filter((c) => c.stage === 'LISTED')).toHaveLength(1);
    expect(listedDeferred).toBe(2);
    expect(candidates).toHaveLength(5);
  });

  it('a negative or non-numeric cap falls back to DEFAULT_LISTED_CAP rather than un-bounding or throwing', () => {
    const listed = Array.from({ length: 5 }, (_, i) => ipo({ id: `listed-${i}`, stage: 'LISTED' }));

    const { candidates: withNegative } = orderAndCapCandidates(listed, -1);
    expect(withNegative).toHaveLength(DEFAULT_LISTED_CAP);

    const { candidates: withNaN } = orderAndCapCandidates(listed, Number.NaN);
    expect(withNaN).toHaveLength(DEFAULT_LISTED_CAP);
  });
});

describe('W-122 — getListedCap() env parsing', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.DOCUMENT_CYCLE_LISTED_CAP;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('defaults to DEFAULT_LISTED_CAP when unset', () => {
    expect(getListedCap()).toBe(DEFAULT_LISTED_CAP);
  });

  it('defaults to DEFAULT_LISTED_CAP when blank', () => {
    process.env.DOCUMENT_CYCLE_LISTED_CAP = '   ';
    expect(getListedCap()).toBe(DEFAULT_LISTED_CAP);
  });

  it('parses a valid non-negative integer, including 0 (no LISTED backfill)', () => {
    process.env.DOCUMENT_CYCLE_LISTED_CAP = '1';
    expect(getListedCap()).toBe(1);

    process.env.DOCUMENT_CYCLE_LISTED_CAP = '0';
    expect(getListedCap()).toBe(0);

    process.env.DOCUMENT_CYCLE_LISTED_CAP = '7';
    expect(getListedCap()).toBe(7);
  });

  it('falls back to DEFAULT_LISTED_CAP for a negative or non-numeric value', () => {
    process.env.DOCUMENT_CYCLE_LISTED_CAP = '-3';
    expect(getListedCap()).toBe(DEFAULT_LISTED_CAP);

    process.env.DOCUMENT_CYCLE_LISTED_CAP = 'not-a-number';
    expect(getListedCap()).toBe(DEFAULT_LISTED_CAP);
  });

  it('truncates a fractional value to an integer', () => {
    process.env.DOCUMENT_CYCLE_LISTED_CAP = '2.9';
    expect(getListedCap()).toBe(2);
  });
});
