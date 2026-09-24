/**
 * Round 2 of #943 (Tier A review MAJOR): a LISTED IPO's open document row is
 * attempted ONCE after the IPO entered LISTED, and again only when a NEW
 * document row or document appears for it (OD-56 "once per STAGE CHANGE, never
 * more", §2.5.1 "never on a backoff timer", OD-81 event 2). Such a row is not a
 * candidate afterwards, so it never holds the data slot open; LISTED rows that
 * ARE due stay in the completion condition, and the due set converges.
 *
 * Drives the REAL planIpoCycle, applyOutcome, orderAndCapCandidates and
 * summarize. `attempt()` writes the transition onto the row exactly as the
 * runner persists it (document-discovery-runner.ts: attemptedAtStage is the
 * stage of a concluded attempt).
 */
import { describe, it, expect } from 'vitest';
import {
  applyOutcome,
  planIpoCycle,
  listedRowDue,
  type StateRow,
  type AttemptOutcome,
} from '../../../src/services/document-state-machine.js';
import { orderAndCapCandidates, summarize } from '../../../src/services/document-cycle.js';
import type { DiscoveryIpo } from '../../../src/services/document-discovery-runner.js';
import type { LifecycleStage } from '../../../src/scheduler/stage-reconciler.js';

const HOUR = 3_600_000;
// 2026-09-24 08:15 IST (first wake of the 08:00 slot) and later slots.
const SLOT_08 = new Date('2026-09-24T02:45:00Z');
const SLOT_14 = new Date('2026-09-24T08:45:00Z');
const SLOT_00_NEXT_DAY = new Date('2026-09-24T18:45:00Z');

function blocked(docType: StateRow['docType'], overrides: Partial<StateRow> = {}): StateRow {
  return {
    docType,
    state: 'BLOCKED_ALL',
    attempts: 5,
    nextRetryAt: null,
    blockedSinceAt: new Date('2026-09-20T00:00:00Z'),
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: new Date('2026-09-20T00:00:00Z'),
    attemptedAtStage: 'CLOSED',
    ...overrides,
  };
}

function attempt(
  row: StateRow,
  stage: LifecycleStage,
  now: Date,
  outcome: AttemptOutcome = 'all_sources_failed'
): StateRow {
  const t = applyOutcome(row, outcome, now, { stage });
  return {
    ...row,
    state: t.state,
    nextRetryAt: t.nextRetryAt,
    blockedSinceAt: t.blockedSinceAt,
    attempts: row.attempts + 1,
    lastAttemptAt: now,
    attemptedAtStage: outcome === 'chain_incomplete' ? row.attemptedAtStage : stage,
  };
}

/** Every LISTED-stage doc type as a BLOCKED_ALL row attempted while CLOSED. */
function listedRows(): StateRow[] {
  return [blocked('PROSPECTUS'), blocked('BASIS_OF_ALLOTMENT_AD')];
}

function presentOthers(rows: StateRow[]): StateRow[] {
  // Earlier-stage types FOUND so only the two post-close rows are in play.
  const found = ['DRHP', 'RHP', 'PRICE_BAND_AD', 'RATIOS_BASIS_ISSUE_PRICE', 'ANCHOR_ALLOCATION_REPORT'].map(
    (t) => ({ ...blocked(t as StateRow['docType']), state: 'FOUND' as const })
  );
  const notApplicable = ['CORRIGENDUM', 'ADDENDUM'].map((t) => ({
    ...blocked(t as StateRow['docType']),
    state: 'NOT_APPLICABLE' as const,
  }));
  return [...found, ...notApplicable, ...rows];
}

describe('LISTED row attempted once after entering LISTED (round 2 of #943)', () => {
  it('is due on the first slot after entering LISTED, not in the next slot, and due again when a new document row appears', () => {
    let rows = presentOthers(listedRows());
    const first = planIpoCycle({ stage: 'LISTED', rows, options: { now: SLOT_08 } });
    expect(first.due.sort()).toEqual(['BASIS_OF_ALLOTMENT_AD', 'PROSPECTUS']);

    rows = rows.map((r) => (first.due.includes(r.docType) ? attempt(r, 'LISTED', SLOT_08) : r));

    // Later wake in the same slot, the next slot, and the next day: nothing due, zero calls.
    for (const now of [new Date(SLOT_08.getTime() + HOUR), SLOT_14, SLOT_00_NEXT_DAY]) {
      const p = planIpoCycle({ stage: 'LISTED', rows, options: { now } });
      expect(p.due).toEqual([]);
      expect(p.skipIpo).toBe(true);
    }

    // A doc type first seen (no row yet) is due at once.
    const withoutProspectusRow = rows.filter((r) => r.docType !== 'PROSPECTUS');
    const newRow = planIpoCycle({ stage: 'LISTED', rows: withoutProspectusRow, options: { now: SLOT_14 } });
    expect(newRow.due).toEqual(['PROSPECTUS']);
    expect(newRow.missingRows).toEqual(['PROSPECTUS']);
  });

  it('is due again when a document for the IPO was first seen after the row was last attempted (OD-81 event 2), and only then', () => {
    let rows = presentOthers(listedRows()).map((r) =>
      r.state === 'BLOCKED_ALL' ? attempt(r, 'LISTED', SLOT_08) : r
    );
    const before = planIpoCycle({
      stage: 'LISTED',
      rows,
      options: { now: SLOT_14, newestDocumentSeenAt: new Date(SLOT_08.getTime() - HOUR) },
    });
    expect(before.due).toEqual([]);

    const after = planIpoCycle({
      stage: 'LISTED',
      rows,
      options: { now: SLOT_14, newestDocumentSeenAt: new Date(SLOT_08.getTime() + HOUR) },
    });
    expect(after.due.sort()).toEqual(['BASIS_OF_ALLOTMENT_AD', 'PROSPECTUS']);

    rows = rows.map((r) => (after.due.includes(r.docType) ? attempt(r, 'LISTED', SLOT_14) : r));
    const settled = planIpoCycle({
      stage: 'LISTED',
      rows,
      options: { now: SLOT_00_NEXT_DAY, newestDocumentSeenAt: new Date(SLOT_08.getTime() + HOUR) },
    });
    expect(settled.due).toEqual([]);
  });

  it('a chain that concluded nothing does not count as the LISTED attempt', () => {
    const r = attempt(blocked('PROSPECTUS'), 'LISTED', SLOT_08, 'chain_incomplete');
    expect(r.attemptedAtStage).toBe('CLOSED');
    expect(listedRowDue(r, null)).toBe(true);
    // Not re-attempted in the same slot, but due in the next one.
    const boa = attempt(blocked('BASIS_OF_ALLOTMENT_AD'), 'LISTED', SLOT_08);
    expect(planIpoCycle({ stage: 'LISTED', rows: presentOthers([r, boa]), options: { now: SLOT_14 } }).due).toEqual([
      'PROSPECTUS',
    ]);
  });
});

function listedIpo(id: string, rows: StateRow[], now: Date): DiscoveryIpo & { rows: StateRow[] } {
  const plan = planIpoCycle({ stage: 'LISTED', rows, options: { now } });
  return {
    id,
    companyName: id,
    symbol: null,
    segment: 'MAINBOARD',
    stage: 'LISTED',
    alreadyComplete: plan.skipIpo,
    precomputedPlan: plan,
    lastActivityAt: rows.reduce<Date | null>(
      (m, r) => (r.lastAttemptAt && (!m || r.lastAttemptAt > m) ? r.lastAttemptAt : m),
      null
    ),
    rows,
  } as DiscoveryIpo & { rows: StateRow[] };
}

describe('data slot completion with LISTED rows', () => {
  it('logs complete when every LISTED row was already attempted at LISTED (not due)', () => {
    const rows = presentOthers(listedRows()).map((r) =>
      r.state === 'BLOCKED_ALL' ? attempt(r, 'LISTED', SLOT_08) : r
    );
    const ipos = Array.from({ length: 5 }, (_, i) => listedIpo(`ipo-${i}`, rows, SLOT_14));
    const { candidates, listedDeferred, listedComplete } = orderAndCapCandidates(ipos, 2);
    expect(candidates).toHaveLength(0);
    expect(listedDeferred).toBe(0);
    expect(listedComplete).toBe(5);
    const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap: 2, deferred: listedDeferred });
    expect(s.slotComplete).toBe(true);
    expect(s.incompletePasses).toEqual([]);
  });

  it.each([
    [52, 2],
    [7, 2],
    [10, 3],
  ])('converges: %i LISTED IPOs with cap %i per wake are all attempted in ceil(N/C) wakes, then the slot completes', (n, cap) => {
    const store = new Map<string, StateRow[]>();
    for (let i = 0; i < n; i++) store.set(`ipo-${String(i).padStart(3, '0')}`, presentOthers(listedRows()));

    const wakesNeeded = Math.ceil(n / cap);
    const attemptsPerIpo = new Map<string, number>();
    let completeAtWake = -1;
    // Wakes 30 minutes apart; they cross slot boundaries when N/C > 16, which is
    // exactly the backlog case that must still converge.
    for (let w = 0; w < wakesNeeded + 3; w++) {
      const now = new Date(SLOT_08.getTime() + w * 30 * 60_000);
      const ipos = [...store.entries()].map(([id, rows]) => listedIpo(id, rows, now));
      const { candidates, listedDeferred } = orderAndCapCandidates(ipos, cap);
      for (const c of candidates) {
        const plan = c.precomputedPlan!;
        const rows = store.get(c.id)!;
        store.set(
          c.id,
          rows.map((r) => (plan.due.includes(r.docType) ? attempt(r, 'LISTED', now) : r))
        );
        attemptsPerIpo.set(c.id, (attemptsPerIpo.get(c.id) ?? 0) + 1);
      }
      const s = summarize([], 100, false, { blocked: 0, failed: 0 }, { cap, deferred: listedDeferred });
      if (w < wakesNeeded - 1) expect(s.slotComplete).toBe(false);
      if (s.slotComplete && completeAtWake < 0) completeAtWake = w;
    }
    // The wake after the last capped batch has nothing due and logs complete.
    expect(completeAtWake).toBe(wakesNeeded - 1);
    expect(attemptsPerIpo.size).toBe(n);
    // Each IPO attempted exactly once after entering LISTED, never again.
    expect([...attemptsPerIpo.values()].every((v) => v === 1)).toBe(true);
  });
});
