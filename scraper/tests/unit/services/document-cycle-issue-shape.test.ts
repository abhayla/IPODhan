import { describe, it, expect } from 'vitest';
import { deriveIssueShape } from '../../../src/services/document-cycle.js';
import {
  planIpoCycle,
  notApplicableTypes,
  type StateRow,
} from '../../../src/services/document-state-machine.js';
import { DOCUMENT_TYPES } from '../../../src/services/document-types.js';

/**
 * T-403 round 1, M2 and M3.
 *
 * M2 (R9 was dead): `loadCandidateIpos` never populated `DiscoveryIpo.issue`, so
 * `notApplicableTypes` could never fire. A fixed-price issue would be asked for a
 * price-band advertisement and an anchor report every 30 minutes forever, find
 * neither, and drift into BLOCKED_ALL — a self-inflicted alert drowning the real ones.
 *
 * M3 (withdrawal never terminated): the withdrawn branch skipped the IPO without
 * closing its rows, so a BLOCKED_ALL row stayed blocked forever and the nightly
 * m_blocked_all_age check would fail every night with no possible remedy.
 */

const NOW = new Date('2026-08-28T06:00:00Z');

function row(docType: string, state: StateRow['state']): StateRow {
  return {
    docType: docType as never,
    state,
    attempts: 1,
    nextRetryAt: null,
    blockedSinceAt: state === 'BLOCKED_ALL' ? new Date('2026-08-20T00:00:00Z') : null,
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: null,
  };
}

describe('M2 — deriveIssueShape makes R9 reachable', () => {
  it('flags a FIXED-PRICE issue (min === max)', () => {
    const shape = deriveIssueShape({ status: 'UPCOMING', price_range_min: 100, price_range_max: 100 });
    expect(shape.isFixedPrice).toBe(true);
    expect(shape.withdrawn).toBe(false);
  });

  it('does NOT flag a book-built issue, nor one with no band yet', () => {
    expect(deriveIssueShape({ status: 'OPEN', price_range_min: 131, price_range_max: 138 }).isFixedPrice).toBe(false);
    expect(deriveIssueShape({ status: 'UPCOMING', price_range_min: null, price_range_max: null }).isFixedPrice).toBe(false);
    // A zero band is missing data, not a fixed price.
    expect(deriveIssueShape({ status: 'UPCOMING', price_range_min: 0, price_range_max: 0 }).isFixedPrice).toBe(false);
  });

  it('handles the numeric-as-string shape Postgres returns for NUMERIC columns', () => {
    expect(deriveIssueShape({ status: 'OPEN', price_range_min: '100.00', price_range_max: '100.00' }).isFixedPrice).toBe(true);
    expect(deriveIssueShape({ status: 'OPEN', price_range_min: '131.00', price_range_max: '138.00' }).isFixedPrice).toBe(false);
  });

  it('END TO END: a fixed-price issue never has PRICE_BAND_AD or the anchor report due', () => {
    const shape = deriveIssueShape({ status: 'UPCOMING', price_range_min: 100, price_range_max: 100 });
    const plan = planIpoCycle({ stage: 'PRE_OPEN', rows: [], issue: shape, options: { now: NOW } });

    expect(plan.due).not.toContain('PRICE_BAND_AD');
    expect(plan.due).not.toContain('ANCHOR_ALLOCATION_REPORT');
    expect(plan.toMarkNotApplicable.sort()).toEqual(['ANCHOR_ALLOCATION_REPORT', 'PRICE_BAND_AD']);
    // ...while the RHP still is.
    expect(plan.due).toContain('RHP');
  });

  it('END TO END: a book-built issue still has both due (no false NOT_APPLICABLE)', () => {
    const shape = deriveIssueShape({ status: 'UPCOMING', price_range_min: 131, price_range_max: 138 });
    const plan = planIpoCycle({ stage: 'PRE_OPEN', rows: [], issue: shape, options: { now: NOW } });
    expect(plan.due).toContain('PRICE_BAND_AD');
    expect(plan.due).toContain('ANCHOR_ALLOCATION_REPORT');
    expect(plan.toMarkNotApplicable).toEqual([]);
  });
});

describe('M3 — withdrawal CLOSES open rows once, then skips', () => {
  it('marks every still-open type NOT_APPLICABLE, including a stuck BLOCKED_ALL', () => {
    const shape = deriveIssueShape({ status: 'WITHDRAWN', price_range_min: 131, price_range_max: 138 });
    expect(shape.withdrawn).toBe(true);
    expect(notApplicableTypes(shape)).toEqual([...DOCUMENT_TYPES]);

    const plan = planIpoCycle({
      stage: 'OPEN',
      rows: [row('RHP', 'BLOCKED_ALL'), row('PRICE_BAND_AD', 'NOT_YET_FILED'), row('CORRIGENDUM', 'FOUND')],
      issue: shape,
      options: { now: NOW },
    });

    // The two OPEN rows are closed; the FOUND one is left alone (documents are kept).
    expect(plan.toMarkNotApplicable.sort()).toEqual(['PRICE_BAND_AD', 'RHP']);
    expect(plan.due).toEqual([]);
    // Not skipped on this cycle — there is closing work to do.
    expect(plan.skipIpo).toBe(false);
    expect(plan.reason).toContain('closing 2 open row(s)');
  });

  it('skips with ZERO work once every row is already closed — the marking happens ONCE', () => {
    const shape = deriveIssueShape({ status: 'WITHDRAWN', price_range_min: null, price_range_max: null });
    const plan = planIpoCycle({
      stage: 'OPEN',
      rows: [row('RHP', 'NOT_APPLICABLE'), row('CORRIGENDUM', 'FOUND')],
      issue: shape,
      options: { now: NOW },
    });
    expect(plan.toMarkNotApplicable).toEqual([]);
    expect(plan.due).toEqual([]);
    expect(plan.skipIpo).toBe(true);
  });

  it('POSTPONED is treated the same as WITHDRAWN (F15 names both)', () => {
    expect(deriveIssueShape({ status: 'POSTPONED' }).withdrawn).toBe(true);
  });

  it('a withdrawn IPO makes NO network calls even while closing rows', () => {
    const plan = planIpoCycle({
      stage: 'OPEN',
      rows: [row('RHP', 'BLOCKED_ALL')],
      issue: { withdrawn: true },
      options: { now: NOW },
    });
    // `due` is what costs requests. Closing rows is a pure database write.
    expect(plan.due).toEqual([]);
    expect(plan.toMarkNotApplicable).toEqual(['RHP']);
  });
});
