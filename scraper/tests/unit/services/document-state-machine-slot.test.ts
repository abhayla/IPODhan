/**
 * F-151 / #943 (item 7): an open document is attempted AT MOST ONCE per OD-19
 * data slot (00:00, 08:00, 14:00 IST), and again only in the next slot or when
 * a stage change makes a new document type due. No elapsed-time retry timer
 * (spec §2.1 "The timed backoff retry is removed", OD-21, OD-33, §2.5.1).
 *
 * Every test drives the REAL applyOutcome + planIpoCycle: an attempt is
 * applied, its transition written onto the row exactly as the runner persists
 * it, and the due-computation is asked again later in the same slot.
 */
import { describe, it, expect } from 'vitest';
import {
  applyOutcome,
  planIpoCycle,
  dueDocTypesForStage,
  NOT_FOUND_MAX_ATTEMPTS,
  type AttemptOutcome,
  type StateRow,
  type DocumentFetchStateValue,
} from '../../../src/services/document-state-machine.js';
import { nextDataJobSlotBoundary } from '@ipodhan/shared/scheduler/data-job-slots';
import type { DocumentType } from '../../../src/services/document-types.js';

const MIN = 60_000;
// 2026-09-24 08:15 IST: the first wake of the 08:00 IST slot.
const SLOT_WAKE = new Date('2026-09-24T02:45:00Z');
// 14:00 IST the same day = 08:30Z: the next slot.
const NEXT_SLOT = new Date('2026-09-24T08:30:00Z');

function row(docType: DocumentType, state: DocumentFetchStateValue, overrides: Partial<StateRow> = {}): StateRow {
  return {
    docType,
    state,
    attempts: 0,
    nextRetryAt: null,
    blockedSinceAt: null,
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: null,
    ...overrides,
  };
}

/** Apply one attempt and persist it onto the row the way the runner does. */
function attempt(r: StateRow, outcome: AttemptOutcome, at: Date, stage: 'PRE_OPEN' | 'OPEN' | 'CLOSED' = 'PRE_OPEN'): StateRow {
  const t = applyOutcome(r, outcome, at, { stage });
  return {
    ...r,
    state: t.state,
    nextRetryAt: t.nextRetryAt,
    blockedSinceAt: t.blockedSinceAt,
    attempts: r.attempts + 1,
    lastAttemptAt: at,
  };
}

function isDue(r: StateRow, at: Date, stage: 'UPCOMING' | 'PRE_OPEN' | 'OPEN' | 'CLOSED' = 'PRE_OPEN'): boolean {
  return planIpoCycle({ stage, rows: [r], options: { now: at } }).due.includes(r.docType);
}

// Each open state and the outcome that produces it.
const OPEN_CASES: Array<{ label: string; outcome: AttemptOutcome; expectState: DocumentFetchStateValue }> = [
  { label: 'NOT_YET_FILED', outcome: 'no_link', expectState: 'NOT_YET_FILED' },
  { label: 'NOT_FOUND (persisted WANTED)', outcome: 'no_link', expectState: 'NOT_FOUND' },
  { label: 'BLOCKED_ALL', outcome: 'all_sources_failed', expectState: 'BLOCKED_ALL' },
  { label: 'WANTED (chain incomplete)', outcome: 'chain_incomplete', expectState: 'WANTED' },
];

describe('F-151: one attempt per data slot, no elapsed-time retry', () => {
  it('SLOT_WAKE and NEXT_SLOT are the slot boundaries the tests assume', () => {
    expect(nextDataJobSlotBoundary(SLOT_WAKE).toISOString()).toBe(NEXT_SLOT.toISOString());
  });

  for (const c of OPEN_CASES) {
    it(`${c.label}: not due again at +30 and +60 min in the same slot; due at the next slot`, () => {
      // NOT_FOUND is decided by stage: a PRE_OPEN DRHP miss is a discovery miss (W-28).
      const docType: DocumentType = c.expectState === 'NOT_FOUND' ? 'DRHP' : c.expectState === 'NOT_YET_FILED' ? 'CORRIGENDUM' : 'ANCHOR_ALLOCATION_REPORT';
      const stage = c.expectState === 'NOT_FOUND' ? 'OPEN' : 'PRE_OPEN';
      const start = row(docType, 'WANTED');
      expect(isDue(start, SLOT_WAKE, stage)).toBe(true);

      const after = attempt(start, c.outcome, SLOT_WAKE, stage);
      expect(after.state).toBe(c.expectState);

      expect(isDue(after, new Date(SLOT_WAKE.getTime() + 30 * MIN), stage)).toBe(false);
      expect(isDue(after, new Date(SLOT_WAKE.getTime() + 60 * MIN), stage)).toBe(false);
      // The last wake of the slot (13:45 IST).
      expect(isDue(after, new Date(NEXT_SLOT.getTime() - 15 * MIN), stage)).toBe(false);
      // The next slot's first instant.
      expect(isDue(after, NEXT_SLOT, stage)).toBe(true);
      // The value written names the next slot, never now + N minutes.
      expect(after.nextRetryAt?.toISOString()).toBe(NEXT_SLOT.toISOString());
    });
  }

  it('a BLOCKED_ALL row more than a day old is also tried once per slot (no 6-hour ladder)', () => {
    const since = new Date(SLOT_WAKE.getTime() - 48 * 60 * MIN);
    const after = attempt(row('RHP', 'BLOCKED_ALL', { blockedSinceAt: since, attempts: 30 }), 'all_sources_failed', SLOT_WAKE);
    expect(after.blockedSinceAt).toEqual(since);
    expect(after.nextRetryAt?.toISOString()).toBe(NEXT_SLOT.toISOString());
  });

  it('a stage change makes the new stage\'s document types due at once, inside the same slot', () => {
    const attempted = attempt(row('RHP', 'WANTED'), 'no_link', SLOT_WAKE);
    const later = new Date(SLOT_WAKE.getTime() + 30 * MIN);
    // Same stage: nothing new.
    const same = planIpoCycle({ stage: 'PRE_OPEN', rows: [attempted], options: { now: later } });
    expect(same.due).not.toContain('RHP');
    // PRE_OPEN -> OPEN: ADDENDUM becomes due in this same slot.
    const changed = planIpoCycle({ stage: 'OPEN', rows: [attempted], options: { now: later } });
    expect(changed.due).toContain('ADDENDUM');
    expect(changed.due).not.toContain('RHP');
    expect(dueDocTypesForStage('OPEN')).toContain('ADDENDUM');
  });

  it('a row carrying a legacy elapsed-time next_retry_at (not a slot start) is not blocked by it', () => {
    // Written by the removed timer: 23 minutes into the future, not a slot boundary.
    const legacy = row('RHP', 'NOT_YET_FILED', { attempts: 3, nextRetryAt: new Date(SLOT_WAKE.getTime() + 23 * MIN) });
    expect(isDue(legacy, SLOT_WAKE)).toBe(true);
    const legacyBlocked = row('RHP', 'BLOCKED_ALL', {
      attempts: 9,
      blockedSinceAt: new Date(SLOT_WAKE.getTime() - 30 * 60 * MIN),
      nextRetryAt: new Date(SLOT_WAKE.getTime() + 5 * 60 * MIN),
    });
    expect(isDue(legacyBlocked, SLOT_WAKE)).toBe(true);
  });

  it(`NOT_FOUND escalates to BLOCKED_ALL after ${NOT_FOUND_MAX_ATTEMPTS} slots, one attempt per slot`, () => {
    let r = row('DRHP', 'WANTED');
    let at = SLOT_WAKE;
    const states: string[] = [];
    for (let slot = 1; slot <= NOT_FOUND_MAX_ATTEMPTS; slot++) {
      expect(isDue(r, at, 'OPEN')).toBe(true);
      r = attempt(r, 'no_link', at, 'OPEN');
      states.push(r.state);
      // Same slot, 30 min later: not attempted again.
      expect(isDue(r, new Date(at.getTime() + 30 * MIN), 'OPEN')).toBe(false);
      at = new Date(nextDataJobSlotBoundary(at).getTime() + 15 * MIN);
    }
    expect(states).toEqual([...Array(NOT_FOUND_MAX_ATTEMPTS - 1).fill('NOT_FOUND'), 'BLOCKED_ALL']);
    expect(r.attempts).toBe(NOT_FOUND_MAX_ATTEMPTS);
  });
});
