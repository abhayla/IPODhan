/**
 * Item 24 (#795) — the stage-gate deadlock.
 *
 * `deriveLifecycleStage` promoted UPCOMING -> PRE_OPEN only when a price band
 * was already present, but `PRICE_BAND_AD` — the document that SUPPLIES the
 * band — is first due at PRE_OPEN. No band -> stays UPCOMING -> the ad is never
 * due -> no band. The gate required the output of the work it gated.
 *
 * Failure class: `stage gate requires the value the gated work would supply`.
 */
import { describe, it, expect } from 'vitest';
import { deriveLifecycleStage, PRE_OPEN_WINDOW_DAYS } from '../../../src/scheduler/stage-reconciler';
import { notApplicableTypes, dueDocTypesForStage } from '../../../src/services/document-state-machine';
// The SECOND implementation of the same rule (scripts/lib). Imported here so the
// parity test below cannot be satisfied by updating only one of them.
// @ts-expect-error -- plain .mjs, no type declarations ship with it.
import { deriveStage } from '../../../../scripts/lib/ipo-stage-completeness.mjs';

/** A date `days` from `today`, as the YYYY-MM-DD string the `ipos` rows carry. */
function isoDaysFrom(today: Date, days: number): string {
  return new Date(today.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TODAY = new Date('2026-09-19T00:00:00Z');

describe('item 24 — UPCOMING promotes on facts the pipeline cannot suppress', () => {
  // TEST 1
  it('promotes to PRE_OPEN with a NULL band when open_date is inside the window', () => {
    expect(
      deriveLifecycleStage(
        { status: 'UPCOMING', priceRangeMin: null, offeringType: 'IPO', openDate: isoDaysFrom(TODAY, 3) },
        { today: TODAY }
      )
    ).toBe('PRE_OPEN');
  });

  // TEST 2
  it('promotes to PRE_OPEN with a NULL band and a NULL open_date when an RHP is on file', () => {
    expect(
      deriveLifecycleStage(
        {
          status: 'UPCOMING',
          priceRangeMin: null,
          offeringType: 'IPO',
          openDate: null,
          hasRhpOnFile: true,
        },
        { today: TODAY }
      )
    ).toBe('PRE_OPEN');
  });

  // TEST 3 — the load-bearing clause: no usable signal must be VISIBLE, not silent.
  it('stays UPCOMING and REPORTS unresolved when no signal is usable', () => {
    const unresolved: { id?: string; reason: string }[] = [];
    const stage = deriveLifecycleStage(
      {
        id: 'ipo-no-signal',
        status: 'UPCOMING',
        priceRangeMin: null,
        offeringType: 'IPO',
        openDate: null,
        hasRhpOnFile: false,
      },
      { today: TODAY, onUnresolved: (r) => unresolved.push(r) }
    );
    expect(stage).toBe('UPCOMING');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe('ipo-no-signal');
    expect(unresolved[0].reason).toMatch(/no promotion signal/i);
  });

  // TEST 4 — the window must not promote everything.
  it('stays UPCOMING when open_date is far outside the window', () => {
    const unresolved: { reason: string }[] = [];
    expect(
      deriveLifecycleStage(
        {
          status: 'UPCOMING',
          priceRangeMin: null,
          offeringType: 'IPO',
          openDate: isoDaysFrom(TODAY, 30),
          hasRhpOnFile: false,
        },
        { today: TODAY, onUnresolved: (r) => unresolved.push(r) }
      )
    ).toBe('UPCOMING');
    // Far-out is a KNOWN state, not an unresolved one — it must not be reported.
    expect(unresolved).toHaveLength(0);
  });

  it('the window boundary is N days and it is exactly 7', () => {
    expect(PRE_OPEN_WINDOW_DAYS).toBe(7);
    const at = (d: number) =>
      deriveLifecycleStage(
        { status: 'UPCOMING', priceRangeMin: null, offeringType: 'IPO', openDate: isoDaysFrom(TODAY, d) },
        { today: TODAY }
      );
    expect(at(7)).toBe('PRE_OPEN');
    expect(at(8)).toBe('UPCOMING');
  });

  it('never promotes an offering type that cannot file a price band ad', () => {
    for (const t of ['OFS', 'NCD', 'RIGHTS', 'TENDER', 'INVITS', 'BUYBACK', 'REITS'] as const) {
      expect(
        deriveLifecycleStage(
          { status: 'UPCOMING', priceRangeMin: null, offeringType: t, openDate: isoDaysFrom(TODAY, 1) },
          { today: TODAY }
        ),
        `offeringType=${t}`
      ).toBe('UPCOMING');
    }
  });

  it('keeps the band signal (harmless) and every pre-item-24 mapping', () => {
    expect(deriveLifecycleStage({ status: 'UPCOMING', priceRangeMin: 120 }, { today: TODAY })).toBe('PRE_OPEN');
    expect(deriveLifecycleStage({ status: 'UPCOMING', priceRangeMin: 0 }, { today: TODAY })).toBe('UPCOMING');
    expect(deriveLifecycleStage({ status: 'LISTED', priceRangeMin: 100 }, { today: TODAY })).toBe('LISTED');
    expect(deriveLifecycleStage({ status: 'CLOSED', priceRangeMin: 100 }, { today: TODAY })).toBe('CLOSED');
    expect(deriveLifecycleStage({ status: 'OPEN', priceRangeMin: 100 }, { today: TODAY })).toBe('OPEN');
  });

  it('is null-safe on an unparseable or empty open_date', () => {
    for (const bad of ['', 'not-a-date', null, undefined]) {
      expect(
        deriveLifecycleStage(
          { status: 'UPCOMING', priceRangeMin: null, offeringType: 'IPO', openDate: bad as string | null },
          { today: TODAY }
        ),
        `openDate=${String(bad)}`
      ).toBe('UPCOMING');
    }
  });

  it('defaults a missing offeringType to IPO — the document cycle only ever loads IPO rows', () => {
    expect(
      deriveLifecycleStage(
        { status: 'UPCOMING', priceRangeMin: null, openDate: isoDaysFrom(TODAY, 2) },
        { today: TODAY }
      )
    ).toBe('PRE_OPEN');
  });
});

describe('item 24 — the offering-type guard on notApplicableTypes', () => {
  // TEST 5
  it('marks PRICE_BAND_AD not applicable for a non-IPO with a NULL band', () => {
    for (const t of ['OFS', 'NCD', 'RIGHTS', 'TENDER', 'INVITS', 'BUYBACK', 'REITS'] as const) {
      const na = notApplicableTypes({ offeringType: t });
      expect(na, `offeringType=${t}`).toContain('PRICE_BAND_AD');
      expect(na, `offeringType=${t}`).toContain('ANCHOR_ALLOCATION_REPORT');
    }
  });

  it('leaves an IPO with a NULL band free to hunt the price band ad', () => {
    expect(notApplicableTypes({ offeringType: 'IPO' })).not.toContain('PRICE_BAND_AD');
    expect(notApplicableTypes({})).not.toContain('PRICE_BAND_AD');
  });

  it('keeps the pre-existing fixed-price and withdrawn guards intact', () => {
    expect(notApplicableTypes({ isFixedPrice: true })).toEqual(['PRICE_BAND_AD', 'ANCHOR_ALLOCATION_REPORT']);
    expect(notApplicableTypes({ withdrawn: true, offeringType: 'IPO' }).length).toBeGreaterThan(5);
  });

  // TEST 6 — pins the link the deadlock broke.
  it('dueDocTypesForStage(PRE_OPEN) includes PRICE_BAND_AD', () => {
    expect(dueDocTypesForStage('PRE_OPEN')).toContain('PRICE_BAND_AD');
    expect(dueDocTypesForStage('UPCOMING')).not.toContain('PRICE_BAND_AD');
  });
});

// TEST 7 — the two implementations of one rule must not drift again.
describe('item 24 — TS/MJS parity on the stage rule', () => {
  // Each row carries its EXPECTED stage under the new rule. Comparing both
  // implementations against a fixed expectation (rather than only against each
  // other) is what lets this test fail: two implementations that both still
  // carry the OLD rule agree with each other but not with `expect`.
  const PARITY_ROWS: (Record<string, unknown> & { expect: string })[] = [
    { status: 'LISTED', price_range_min: 100, expect: 'LISTED' },
    { status: 'CLOSED', price_range_min: 100, expect: 'CLOSED' },
    { status: 'OPEN', price_range_min: 100, expect: 'OPEN' },
    { status: 'UPCOMING', price_range_min: 120, expect: 'PRE_OPEN' },
    { status: 'UPCOMING', price_range_min: 0, expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, expect: 'UPCOMING' },
    { status: 'WITHDRAWN', price_range_min: null, expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, 3), expect: 'PRE_OPEN' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, 7), expect: 'PRE_OPEN' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, 8), expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, 30), expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'OFS', open_date: isoDaysFrom(TODAY, 1), expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'NCD', open_date: isoDaysFrom(TODAY, 1), expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: null, has_rhp_on_file: true, expect: 'PRE_OPEN' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: null, has_rhp_on_file: false, expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: 'not-a-date', expect: 'UPCOMING' },
  ];

  it('agrees row by row, and both agree with the new rule', () => {
    for (const row of PARITY_ROWS) {
      const ts = deriveLifecycleStage(
        {
          status: row.status as string,
          priceRangeMin: row.price_range_min as number | null,
          offeringType: row.offering_type as string | undefined,
          openDate: row.open_date as string | null | undefined,
          hasRhpOnFile: row.has_rhp_on_file as boolean | undefined,
        },
        { today: TODAY }
      );
      const mjs = deriveStage(row, { today: TODAY });
      expect(ts, `TS on row ${JSON.stringify(row)}`).toBe(row.expect);
      expect(mjs, `MJS on row ${JSON.stringify(row)}`).toBe(ts);
    }
  });
});
