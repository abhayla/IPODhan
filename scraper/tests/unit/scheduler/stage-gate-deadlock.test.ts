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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deriveLifecycleStage,
  planStageReconciliation,
  PRE_OPEN_WINDOW_DAYS,
  type ReconcilerIpoRow,
} from '../../../src/scheduler/stage-reconciler';
import { RECONCILER_PRESENCE_SQL } from '../../../src/scheduler/jobs/stage-reconciler-job';
import { CANDIDATE_IPOS_SQL } from '../../../src/services/document-cycle';
import {
  HELD_STATES,
  heldStatesSqlList,
} from '../../../src/services/document-state-machine';
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

  // TEST 4b (round 2) — the window needs a LOWER bound. Round 1 had `days <= N`
  // with no `days >= 0`, so a row stuck at UPCOMING with an open_date long past
  // promoted forever, and NOT_YET_FILED retries every 30 minutes with NO attempt
  // cap (unlike NOT_FOUND, capped at 5). A reviewer's `days >= 0` mutation left
  // all 14 round-1 tests green: the suite was blind to the window's lower half.
  it('stays UPCOMING when open_date is in the PAST — the window has a lower bound', () => {
    for (const past of [-1, -90, -1900]) {
      expect(
        deriveLifecycleStage(
          {
            status: 'UPCOMING',
            priceRangeMin: null,
            offeringType: 'IPO',
            openDate: isoDaysFrom(TODAY, past),
            hasRhpOnFile: false,
          },
          { today: TODAY }
        ),
        `openDate = today ${past} days`
      ).toBe('UPCOMING');
    }
  });

  // TEST 4c (round 2) — the boundary is an IST CALENDAR-DAY difference, not a raw
  // millisecond delta and not a UTC calendar day. Round 1 floored
  // `open(UTC midnight) - new Date()`, so the same open_date gave PRE_OPEN at
  // 23:30 IST and UPCOMING at 05:30 IST — the window drifted 7 vs 8 days by hour
  // of day (.claude/rules/ist-timezone.md).
  //
  // The load-bearing instant is 19:00Z. At 19:00Z the IST date has ALREADY rolled
  // over (00:30 IST the next day) while the UTC date has not, so it is the only
  // kind of instant at which an IST-day rule and a UTC-day rule disagree. An
  // earlier version of this test used 00:00Z and 18:00Z — both inside the same
  // UTC day — and consequently passed with the IST offset set to zero. Two
  // mutants survived it. Absolute expectations below, not instant-vs-instant
  // agreement: a rule that is uniformly wrong agrees with itself.
  it('evaluates the window on an IST calendar day, not a UTC day or a ms delta', () => {
    const at = (today: Date, openDate: string) =>
      deriveLifecycleStage(
        { status: 'UPCOMING', priceRangeMin: null, offeringType: 'IPO', openDate },
        { today }
      );

    // Every instant below, with its IST wall-clock and the IST calendar day it
    // falls on. The verdict is a function of the IST DAY alone.
    const istMorning = new Date('2026-09-19T00:00:00Z'); // 05:30 IST, 19 Sep
    const istNight = new Date('2026-09-19T18:00:00Z'); //  23:30 IST, 19 Sep
    const afterIstRollover = new Date('2026-09-19T19:00:00Z'); // 00:30 IST, 20 Sep

    // --- Within IST day 19 Sep: +7 is in, +8 is out, at BOTH ends of the day.
    for (const today of [istMorning, istNight]) {
      expect(at(today, '2026-09-26'), `+7 at ${today.toISOString()}`).toBe('PRE_OPEN');
      expect(at(today, '2026-09-27'), `+8 at ${today.toISOString()}`).toBe('UPCOMING');
    }

    // --- 19:00Z is IST 20 Sep, so the SAME open_date is one day nearer. This is
    // the assertion a UTC-day or zero-offset rule cannot satisfy: it still reads
    // 19 Sep and so still calls 2026-09-27 eight days out.
    expect(at(afterIstRollover, '2026-09-27'), '+7 in IST terms after rollover').toBe('PRE_OPEN');
    expect(at(afterIstRollover, '2026-09-28'), '+8 in IST terms after rollover').toBe('UPCOMING');

    // --- The lower bound moves with the IST day too: at IST 20 Sep, an open_date
    // of 19 Sep is in the PAST and must not promote, though a UTC-day rule reads
    // it as today.
    expect(at(afterIstRollover, '2026-09-19'), 'yesterday in IST').toBe('UPCOMING');
    expect(at(istNight, '2026-09-19'), 'today in IST').toBe('PRE_OPEN');
  });

  // A `Date` INSTANT for open_date (rather than the YYYY-MM-DD string the column
  // carries) must be reduced to its IST calendar day as well — the two input
  // shapes must not disagree about the same moment.
  it('reduces a Date-valued open_date to its IST calendar day', () => {
    const today = new Date('2026-09-19T00:00:00Z'); // IST 19 Sep
    const stageFor = (openDate: string | Date) =>
      deriveLifecycleStage(
        { status: 'UPCOMING', priceRangeMin: null, offeringType: 'IPO', openDate },
        { today }
      );
    // 2026-09-26T19:00:00Z is 27 Sep 00:30 IST — an IST day 8 out, so UPCOMING.
    expect(stageFor(new Date('2026-09-26T19:00:00Z'))).toBe('UPCOMING');
    // 2026-09-26T18:00:00Z is 26 Sep 23:30 IST — an IST day 7 out, so PRE_OPEN.
    expect(stageFor(new Date('2026-09-26T18:00:00Z'))).toBe('PRE_OPEN');
  });

  // M2 (round 2) — a non-band-bearing type with no signal was returned before the
  // report block, so it produced ZERO reports and was as invisible as the bug
  // being fixed. It is reported with a DISTINCT reason: an operator must be able
  // to tell "cannot advance, needs data" from "will never advance, by design".
  it('reports a non-band-bearing type as unresolved, with a distinct reason', () => {
    const unresolved: { id?: string; reason: string }[] = [];
    const stage = deriveLifecycleStage(
      {
        id: 'ofs-no-signal',
        status: 'UPCOMING',
        priceRangeMin: null,
        offeringType: 'OFS',
        openDate: null,
        hasRhpOnFile: false,
      },
      { today: TODAY, onUnresolved: (r) => unresolved.push(r) }
    );
    expect(stage).toBe('UPCOMING');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe('ofs-no-signal');
    expect(unresolved[0].reason).toMatch(/offering type/i);
    // Distinct from the band-bearing no-signal reason, so the two never merge.
    expect(unresolved[0].reason).not.toMatch(/no promotion signal/i);
  });

  // M2 — a non-band-bearing type that DOES have a usable date is resolved, not
  // reported: it is simply never promoted. Only the no-signal case is noise-free.
  it('does not report a non-band-bearing type that has an open_date', () => {
    const unresolved: { reason: string }[] = [];
    expect(
      deriveLifecycleStage(
        {
          status: 'UPCOMING',
          priceRangeMin: null,
          offeringType: 'OFS',
          openDate: isoDaysFrom(TODAY, 1),
        },
        { today: TODAY, onUnresolved: (r) => unresolved.push(r) }
      )
    ).toBe('UPCOMING');
    expect(unresolved).toHaveLength(0);
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
    // --- Round 2 rows. Without these the table exercised none of the round-2
    // guards, so a drift in ONE implementation still agreed with the other:
    // verified by mutation, deleting `days >= 0` from the .mjs alone left this
    // test green. A parity table only pins the behaviours it actually covers.
    // C2 - the lower bound, in both implementations.
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, -1), expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, -90), expect: 'UPCOMING' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, -1900), expect: 'UPCOMING' },
    // C2 - a past open_date must not be rescued by the band signal either way.
    { status: 'UPCOMING', price_range_min: 120, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, -5), expect: 'PRE_OPEN' },
    // The exact boundary, from both sides, so an off-by-one drifts visibly.
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, 0), expect: 'PRE_OPEN' },
    { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, 6), expect: 'PRE_OPEN' },
    // A non-band-bearing type with an RHP on file: the offering-type guard is
    // checked FIRST in both, so the RHP must not rescue it.
    { status: 'UPCOMING', price_range_min: null, offering_type: 'OFS', open_date: null, has_rhp_on_file: true, expect: 'UPCOMING' },
    // A non-band-bearing type with a band present: same - the guard wins.
    { status: 'UPCOMING', price_range_min: 120, offering_type: 'OFS', open_date: null, expect: 'UPCOMING' },
  ];

  // The IST-day rule must hold in BOTH implementations: an instant past 18:30Z is
  // already the next IST calendar day, and a .mjs still measuring a raw ms delta
  // would disagree only there. None of the rows above run at such an instant.
  it('agrees on the IST calendar-day boundary at an instant where IST and UTC differ', () => {
    const afterIstRollover = new Date('2026-09-19T19:00:00Z'); // 00:30 IST, 20 Sep
    for (const [openDate, expected] of [
      ['2026-09-27', 'PRE_OPEN'],
      ['2026-09-28', 'UPCOMING'],
      ['2026-09-19', 'UPCOMING'],
    ] as [string, string][]) {
      const ts = deriveLifecycleStage(
        { status: 'UPCOMING', priceRangeMin: null, offeringType: 'IPO', openDate },
        { today: afterIstRollover }
      );
      const mjs = deriveStage(
        { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: openDate },
        { today: afterIstRollover }
      );
      expect(ts, `TS on ${openDate}`).toBe(expected);
      expect(mjs, `MJS on ${openDate}`).toBe(ts);
    }
  });

  // Both implementations must REPORT the same unresolved rows with the same
  // reason class - the report is the load-bearing half of the rule, and a
  // drifting reason is a signal an operator can no longer act on.
  it('agrees on which rows are reported unresolved, and with which reason class', () => {
    const cases: [Record<string, unknown>, RegExp | null][] = [
      // band-bearing, no signal at all -> reported, "no promotion signal"
      [{ status: 'UPCOMING', price_range_min: null, offering_type: 'IPO' }, /no promotion signal/i],
      // non-band-bearing, no signal -> reported, DISTINCT "offering type" reason
      [{ status: 'UPCOMING', price_range_min: null, offering_type: 'OFS' }, /offering type/i],
      // known far-off -> resolved, never reported
      [
        { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, 30) },
        null,
      ],
      // past open_date -> resolved (we know the date), never reported
      [
        { status: 'UPCOMING', price_range_min: null, offering_type: 'IPO', open_date: isoDaysFrom(TODAY, -90) },
        null,
      ],
    ];
    for (const [row, pattern] of cases) {
      const tsReports: { reason: string }[] = [];
      deriveLifecycleStage(
        {
          status: row.status as string,
          priceRangeMin: row.price_range_min as number | null,
          offeringType: row.offering_type as string | undefined,
          openDate: row.open_date as string | null | undefined,
        },
        { today: TODAY, onUnresolved: (r) => tsReports.push(r) }
      );
      const mjsReports: { reason: string }[] = [];
      deriveStage(row, { today: TODAY, onUnresolved: (r: { reason: string }) => mjsReports.push(r) });

      expect(tsReports.length, `TS report count on ${JSON.stringify(row)}`).toBe(pattern ? 1 : 0);
      expect(mjsReports.length, `MJS report count on ${JSON.stringify(row)}`).toBe(tsReports.length);
      if (pattern) {
        expect(tsReports[0].reason, `TS reason on ${JSON.stringify(row)}`).toMatch(pattern);
        expect(mjsReports[0].reason, `MJS reason on ${JSON.stringify(row)}`).toMatch(pattern);
      }
    }
  });

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

// ---------------------------------------------------------------------------
// Round 2 — the findings that are about WIRING, not about the pure rule.
// A rule that is correct and unreached is a rule that does nothing in production.
// ---------------------------------------------------------------------------

describe('item 24 round 2 — C1: planStageReconciliation threads the same facts', () => {
  const row = (over: Partial<ReconcilerIpoRow>): ReconcilerIpoRow => ({
    id: 'r1',
    companyName: 'Anand Seamless',
    status: 'UPCOMING',
    priceRangeMin: null,
    offeringType: 'IPO',
    presence: {},
    ...over,
  });

  // The measured defect: reconciler-job said UPCOMING while document-cycle said
  // PRE_OPEN for the SAME IPO at the SAME instant, because planStageReconciliation
  // called deriveLifecycleStage(row) with no opts — dropping the injected `today`
  // — while the new fields rode on the row it never selected.
  it('agrees with a direct deriveLifecycleStage call on the same row and instant', () => {
    for (const over of [
      { openDate: isoDaysFrom(TODAY, 3) },
      { openDate: isoDaysFrom(TODAY, 30) },
      { openDate: isoDaysFrom(TODAY, -90) },
      { openDate: null, hasRhpOnFile: true },
      { openDate: null, hasRhpOnFile: false },
      { openDate: isoDaysFrom(TODAY, 1), offeringType: 'OFS' },
    ] as Partial<ReconcilerIpoRow>[]) {
      const r = row(over);
      const planned = planStageReconciliation([r], { today: TODAY })[0].stage;
      const direct = deriveLifecycleStage(r, { today: TODAY });
      expect(planned, `row ${JSON.stringify(over)}`).toBe(direct);
    }
  });

  // The injected clock must reach the stage call, not only the stale-CLOSED check.
  it('honours the injected `today` — a far-future clock demotes a row it would otherwise promote', () => {
    const r = row({ openDate: isoDaysFrom(TODAY, 3) });
    expect(planStageReconciliation([r], { today: TODAY })[0].stage).toBe('PRE_OPEN');
    // 60 days later that same open_date is in the PAST — lower bound applies.
    const later = new Date(TODAY.getTime() + 60 * 24 * 60 * 60 * 1000);
    expect(planStageReconciliation([r], { today: later })[0].stage).toBe('UPCOMING');
  });

  // The stage decides dueFetches, so a threaded promotion must actually change
  // the work the ledger records — otherwise the threading is cosmetic.
  it('a promoted row gains the PRE_OPEN fetch kinds in dueFetches', () => {
    const due = planStageReconciliation([row({ openDate: isoDaysFrom(TODAY, 3) })], {
      today: TODAY,
    })[0].dueFetches;
    expect(due).toContain('docPriceBandAd');
  });

  // C1, the SQL half: the job's own query must select the columns the rule reads.
  // A perfectly threaded mapper over a query that never selects open_date still
  // derives UPCOMING for everything.
  it('RECONCILER_PRESENCE_SQL selects every column the stage rule reads', () => {
    for (const col of ['i.open_date', 'i.offering_type', 'has_rhp_on_file']) {
      expect(RECONCILER_PRESENCE_SQL, `missing ${col}`).toContain(col);
    }
  });
});

describe('item 24 round 2 — M1: onUnresolved is wired at every live call site', () => {
  // Round 1 shipped the load-bearing final clause with ZERO production callers:
  // `grep -rn onUnresolved` outside tests returned only the definition and the
  // one call site inside deriveLifecycleStage itself. An unresolved issue was
  // still silently stalled in production — the exact bug the clause exists to fix.
  const CALL_SITES = [
    'scraper/src/services/document-cycle.ts',
    'scraper/scripts/run-document-discovery.ts',
    'scraper/src/scheduler/stage-reconciler.ts',
  ];

  it('every file that calls deriveLifecycleStage passes onUnresolved', () => {
    for (const rel of CALL_SITES) {
      const src = readFileSync(resolve(__dirname, '../../../..', rel), 'utf8');
      expect(src, `${rel} does not call deriveLifecycleStage`).toContain('deriveLifecycleStage');
      expect(src, `${rel} calls deriveLifecycleStage without wiring onUnresolved`).toContain(
        'onUnresolved'
      );
    }
  });

  it('planStageReconciliation surfaces unresolved rows to its caller', () => {
    const unresolved: { id?: string; reason: string }[] = [];
    planStageReconciliation(
      [
        {
          id: 'stalled',
          companyName: 'Liqvd Digital',
          status: 'UPCOMING',
          priceRangeMin: null,
          offeringType: 'IPO',
          openDate: null,
          hasRhpOnFile: false,
          presence: {},
        },
      ],
      { today: TODAY, onUnresolved: (r) => unresolved.push(r) }
    );
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe('stalled');
  });
});

describe('item 24 round 2 — N1: HELD_STATES has one definition', () => {
  // The same three states were written out as an inline SQL string list in two
  // query files with no import — the `one-concept-several-definitions` class this
  // very commit claims to close. Both queries must now be BUILT from the export.
  it('HELD_STATES is exported and holds exactly the three held states', () => {
    expect([...HELD_STATES].sort()).toEqual(['EXTRACTED', 'EXTRACT_FAILED', 'FOUND']);
  });

  it('no query file hard-codes the held-state list', () => {
    for (const rel of [
      'scraper/src/services/document-cycle.ts',
      'scraper/scripts/run-document-discovery.ts',
    ]) {
      const src = readFileSync(resolve(__dirname, '../../../..', rel), 'utf8');
      expect(src, `${rel} still hard-codes the held-state list`).not.toMatch(
        /'FOUND',\s*'EXTRACTED',\s*'EXTRACT_FAILED'/
      );
      // The query must be BUILT from the single definition, not merely free of the
      // old literal — a file that deleted the IN(...) clause entirely would also
      // pass the negative assertion above.
      expect(src, `${rel} does not build its query from HELD_STATES`).toContain(
        'heldStatesSqlList()'
      );
    }
  });

  it('the SQL both queries embed is derived from HELD_STATES', () => {
    expect(CANDIDATE_IPOS_SQL).toContain(heldStatesSqlList());
    for (const state of HELD_STATES) expect(CANDIDATE_IPOS_SQL).toContain(`'${state}'`);
  });
});
