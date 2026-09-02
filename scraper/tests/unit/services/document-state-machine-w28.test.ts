import { describe, it, expect } from 'vitest';
import {
  applyOutcome,
  planIpoCycle,
  toPersistedState,
  NOT_FOUND_MAX_ATTEMPTS,
  RETRY_MINUTES,
  type StateRow,
} from '../../../src/services/document-state-machine.js';

/**
 * W-28 — what a MISS means depends on the stage.
 *
 * The DEEPA walk (2026-09-02) recorded `NOT_YET_FILED` for a DRHP on an UPCOMING
 * IPO after EXCHANGES:no_link -> SEBI miss -> COMPANY:skipped -> VERIFIER:skipped.
 * The issuer filed that DRHP months earlier; the row was saying "the company has
 * not filed it", which the E12 badge renders verbatim and the scheduler reads as
 * "just wait". These tests pin the three distinct meanings apart.
 */

const NOW = new Date('2026-09-02T12:00:00Z');

const row = (over: Partial<StateRow> = {}): StateRow => ({
  docType: 'DRHP',
  state: 'WANTED',
  attempts: 0,
  nextRetryAt: null,
  blockedSinceAt: null,
  filingDate: null,
  extractorVersion: null,
  lastAttemptAt: null,
  ...over,
});

const minutesFrom = (d: Date | null) =>
  d === null ? null : Math.round((d.getTime() - NOW.getTime()) / 60_000);

describe('W-28 — a due filing that no source carried is NOT_FOUND, not NOT_YET_FILED', () => {
  it('UPCOMING + DRHP miss -> NOT_FOUND with a backoff, never NOT_YET_FILED', () => {
    const t = applyOutcome(row(), 'no_link', NOW, { stage: 'UPCOMING' });
    expect(t.state).toBe('NOT_FOUND');
    expect(t.state).not.toBe('NOT_YET_FILED');
    expect(minutesFrom(t.nextRetryAt)).toBe(RETRY_MINUTES.NOT_FOUND);
    expect(t.alert).toBe(false);
    expect(t.reason).toMatch(/discovery miss/i);
  });

  it('PRE_OPEN + CORRIGENDUM miss -> NOT_YET_FILED (an optional filing may never exist)', () => {
    const t = applyOutcome(row({ docType: 'CORRIGENDUM' }), 'no_link', NOW, { stage: 'PRE_OPEN' });
    expect(t.state).toBe('NOT_YET_FILED');
    expect(minutesFrom(t.nextRetryAt)).toBe(RETRY_MINUTES.NOT_YET_FILED);
  });

  it('LISTED + CORRIGENDUM miss -> NOT_APPLICABLE, terminal, never retried (A6/W-40)', () => {
    const t = applyOutcome(row({ docType: 'CORRIGENDUM' }), 'no_link', NOW, { stage: 'LISTED' });
    expect(t.state).toBe('NOT_APPLICABLE');
    expect(t.nextRetryAt).toBeNull();
    expect(t.alert).toBe(false);
  });

  it('a filing not yet DUE at this stage is still NOT_YET_FILED', () => {
    const t = applyOutcome(row({ docType: 'PROSPECTUS' }), 'no_link', NOW, { stage: 'UPCOMING' });
    expect(t.state).toBe('NOT_YET_FILED');
  });

  it('counts attempts and escalates to BLOCKED_ALL with an alert after N misses', () => {
    let current = row();
    for (let i = 1; i < NOT_FOUND_MAX_ATTEMPTS; i++) {
      const step = applyOutcome(current, 'no_link', NOW, { stage: 'UPCOMING' });
      expect(step.state).toBe('NOT_FOUND');
      expect(step.alert).toBe(false);
      current = row({ state: step.state, attempts: i, blockedSinceAt: step.blockedSinceAt });
    }
    const final = applyOutcome(current, 'no_link', NOW, { stage: 'UPCOMING' });
    expect(final.state).toBe('BLOCKED_ALL');
    expect(final.alert).toBe(true);
    expect(final.blockedSinceAt).toEqual(NOW);
    expect(final.nextRetryAt).not.toBeNull();
  });

  it('does not re-alert once the row is already BLOCKED_ALL', () => {
    const t = applyOutcome(
      row({ state: 'BLOCKED_ALL', attempts: NOT_FOUND_MAX_ATTEMPTS, blockedSinceAt: NOW }),
      'no_link',
      NOW,
      { stage: 'UPCOMING' }
    );
    expect(t.state).toBe('BLOCKED_ALL');
    expect(t.alert).toBe(false);
  });

  it('NOT_FOUND persists as WANTED until the DB enum gains a member — still open, still backed off', () => {
    expect(toPersistedState('NOT_FOUND')).toBe('WANTED');
    expect(toPersistedState('NOT_YET_FILED')).toBe('NOT_YET_FILED');
    expect(toPersistedState('BLOCKED_ALL')).toBe('BLOCKED_ALL');
  });

  it('a NOT_FOUND row is still re-planned once its backoff expires', () => {
    const plan = planIpoCycle({
      stage: 'UPCOMING',
      rows: [row({ state: 'WANTED', nextRetryAt: new Date(NOW.getTime() - 60_000) })],
      options: { now: NOW },
    });
    expect(plan.due).toContain('DRHP');
    expect(plan.skipIpo).toBe(false);
  });
});

describe('W-40 — a LISTED IPO stops generating fetches for optional filings', () => {
  it('marks CORRIGENDUM and ADDENDUM NOT_APPLICABLE and never calls them due', () => {
    const plan = planIpoCycle({
      stage: 'LISTED',
      rows: [
        row({ docType: 'CORRIGENDUM', state: 'NOT_YET_FILED' }),
        row({ docType: 'ADDENDUM', state: 'NOT_YET_FILED' }),
      ],
      options: { now: NOW },
    });
    expect(plan.toMarkNotApplicable).toEqual(
      expect.arrayContaining(['CORRIGENDUM', 'ADDENDUM'])
    );
    expect(plan.due).not.toContain('CORRIGENDUM');
    expect(plan.due).not.toContain('ADDENDUM');
  });

  it('and once they are closed the IPO skips entirely — zero network calls', () => {
    const rows = [
      row({ docType: 'DRHP', state: 'EXTRACTED' }),
      row({ docType: 'RHP', state: 'EXTRACTED' }),
      row({ docType: 'PROSPECTUS', state: 'EXTRACTED' }),
      row({ docType: 'PRICE_BAND_AD', state: 'EXTRACTED' }),
      row({ docType: 'RATIOS_BASIS_ISSUE_PRICE', state: 'EXTRACTED' }),
      row({ docType: 'ANCHOR_ALLOCATION_REPORT', state: 'EXTRACTED' }),
      row({ docType: 'BASIS_OF_ALLOTMENT_AD', state: 'EXTRACTED' }),
      row({ docType: 'CORRIGENDUM', state: 'NOT_APPLICABLE' }),
      row({ docType: 'ADDENDUM', state: 'NOT_APPLICABLE' }),
    ];
    const plan = planIpoCycle({ stage: 'LISTED', rows, options: { now: NOW } });
    expect(plan.skipIpo).toBe(true);
    expect(plan.due).toEqual([]);
  });
});
