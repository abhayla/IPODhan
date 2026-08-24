import { describe, it, expect } from 'vitest';
import {
  isAllotmentPlausible,
  isDateSequenceCoherent,
} from '../../../src/services/ipo-date-plausibility.js';

describe('isAllotmentPlausible (#41 — allotment must sit inside (close, listing))', () => {
  it('accepts an allotment date strictly between close and listing', () => {
    expect(isAllotmentPlausible('2024-05-10', '2024-05-08', '2024-05-14')).toBe(true);
  });

  it('rejects an allotment date at/before the close date', () => {
    expect(isAllotmentPlausible('2024-05-08', '2024-05-08', '2024-05-14')).toBe(false); // == close
    expect(isAllotmentPlausible('2024-05-01', '2024-05-08', '2024-05-14')).toBe(false); // before close
  });

  it('rejects an allotment date at/after the listing date', () => {
    expect(isAllotmentPlausible('2024-05-14', '2024-05-08', '2024-05-14')).toBe(false); // == listing
    expect(isAllotmentPlausible('2024-06-01', '2024-05-08', '2024-05-14')).toBe(false); // after listing
  });

  it('rejects the real #41 name-collision case (allotment years before the IPO opened)', () => {
    // WINDLAS-shape: open/close 2026 but a collided historical allotment in 2021
    expect(isAllotmentPlausible('2021-08-01', '2026-05-08', '2026-05-14')).toBe(false);
  });

  it('applies only the present bound when the other is null', () => {
    expect(isAllotmentPlausible('2024-05-10', '2024-05-08', null)).toBe(true); // after close, no listing bound
    expect(isAllotmentPlausible('2024-05-01', '2024-05-08', null)).toBe(false); // before close
    expect(isAllotmentPlausible('2024-05-10', null, '2024-05-14')).toBe(true); // before listing, no close bound
    expect(isAllotmentPlausible('2024-05-20', null, '2024-05-14')).toBe(false); // after listing
  });

  it('is unverifiable (returns false) when the allotment itself is unparseable or no bounds exist', () => {
    expect(isAllotmentPlausible(null, '2024-05-08', '2024-05-14')).toBe(false);
    expect(isAllotmentPlausible('not-a-date', '2024-05-08', '2024-05-14')).toBe(false);
    expect(isAllotmentPlausible('2024-05-10', null, null)).toBe(false); // no bound → cannot confirm → skip
  });
});

describe('isDateSequenceCoherent (#52 — open ≤ close < allotment < listing)', () => {
  it('accepts a coherent sequence', () => {
    const r = isDateSequenceCoherent({
      openDate: '2024-05-06',
      closeDate: '2024-05-08',
      allotmentDate: '2024-05-10',
      listingDate: '2024-05-14',
    });
    expect(r.ok).toBe(true);
  });

  it('flags close_date AFTER allotment_date (the 7 #52 rows)', () => {
    const r = isDateSequenceCoherent({
      openDate: '2026-04-01',
      closeDate: '2026-05-01',
      allotmentDate: '2020-10-01', // historical allotment merged onto a 2026 open/close
      listingDate: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/close/i);
  });

  it('flags open_date AFTER close_date', () => {
    const r = isDateSequenceCoherent({
      openDate: '2024-05-10',
      closeDate: '2024-05-08',
      allotmentDate: null,
      listingDate: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/open/i);
  });

  it('flags allotment AFTER listing', () => {
    const r = isDateSequenceCoherent({
      openDate: '2024-05-06',
      closeDate: '2024-05-08',
      allotmentDate: '2024-05-20',
      listingDate: '2024-05-14',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/allot|listing/i);
  });

  it('ignores pairs where one side is null (partial data is not incoherent)', () => {
    expect(isDateSequenceCoherent({ openDate: '2024-05-06', closeDate: null, allotmentDate: null, listingDate: null }).ok).toBe(true);
    expect(isDateSequenceCoherent({ openDate: null, closeDate: null, allotmentDate: null, listingDate: null }).ok).toBe(true);
  });

  it('flags close_date AT/AFTER listing_date even when allotment is null (T-299 P2-7, kwality-walls shape)', () => {
    // open 2026-04-23, close 2026-05-07, allotment null, listing 2026-02-16 — the
    // IPO would list before it closes. Neither existing close/allot nor
    // allot/listing check fires because allotment is null.
    const r = isDateSequenceCoherent({
      openDate: '2026-04-23',
      closeDate: '2026-05-07',
      allotmentDate: null,
      listingDate: '2026-02-16',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/close|listing/i);
  });

  it('flags a listing_date with no open_date at all (T-309 presence-coherence, priority-jewels-ltd shape)', () => {
    // Real prod row: open_date=NULL, close_date=NULL, listing_date=2026-09-04 —
    // an IPO cannot be scheduled to list before it is even scheduled to open.
    const r = isDateSequenceCoherent({
      openDate: null,
      closeDate: null,
      allotmentDate: null,
      listingDate: '2026-09-04',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/listing_date present without open_date/);
  });

  it('does not flag a present open_date + listing_date with close/allotment absent', () => {
    expect(isDateSequenceCoherent({ openDate: '2026-04-23', closeDate: null, allotmentDate: null, listingDate: '2026-05-14' }).ok).toBe(true);
  });

  it('flags close_date AT/AFTER listing_date via a REAL close-vs-listing rule, not the open-vs-listing shape-lock (T-306 F1)', () => {
    // open is absent, so the pre-existing `open > listing` check cannot fire at
    // all — this isolates whether a dedicated close-vs-listing comparison exists.
    const r = isDateSequenceCoherent({
      openDate: null,
      closeDate: '2026-05-07',
      allotmentDate: null,
      listingDate: '2026-02-16',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/close.*listing|listing.*close/i);
  });

  it('accepts close_date strictly before listing_date when open/allotment are absent', () => {
    const r = isDateSequenceCoherent({
      openDate: null,
      closeDate: '2026-02-10',
      allotmentDate: null,
      listingDate: '2026-02-16',
    });
    expect(r.ok).toBe(true);
  });
});
