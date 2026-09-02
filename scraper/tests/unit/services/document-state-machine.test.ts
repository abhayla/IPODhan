import { describe, it, expect } from 'vitest';
import {
  planIpoCycle,
  applyOutcome,
  computeNextRetryAt,
  decideSupersession,
  dueDocTypesForStage,
  notApplicableTypes,
  closedStates,
  needsReExtraction,
  isStaleInProgress,
  isStrictlyNewer,
  isInLiveWindow,
  STAGE_DOCUMENT_TYPES,
  RETRY_MINUTES,
  BLOCKED_FAST_LADDER_HOURS,
  IN_PROGRESS_STALE_MINUTES,
  CYCLE_BUDGET,
  LIVE_WINDOW_DAYS_AFTER_LISTING,
  type StateRow,
  type DocumentFetchStateValue,
} from '../../../src/services/document-state-machine.js';
import type { DocumentType } from '../../../src/services/document-types.js';

const NOW = new Date('2026-08-28T06:00:00Z');
const minutes = (n: number) => n * 60_000;

function row(
  docType: DocumentType,
  state: DocumentFetchStateValue,
  overrides: Partial<StateRow> = {}
): StateRow {
  return {
    docType,
    state,
    attempts: 1,
    nextRetryAt: null,
    blockedSinceAt: null,
    filingDate: null,
    extractorVersion: null,
    lastAttemptAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stage -> due types (test 51)
// ---------------------------------------------------------------------------

describe('T51 stage -> due document types', () => {
  it('accumulates, so a late-discovered IPO catches up in one pass (E1/F14)', () => {
    expect(dueDocTypesForStage('UPCOMING')).toEqual(['DRHP']);
    expect(dueDocTypesForStage('PRE_OPEN')).toEqual(['DRHP', ...STAGE_DOCUMENT_TYPES.PRE_OPEN]);
    expect(dueDocTypesForStage('OPEN')).toContain('ADDENDUM');
    expect(dueDocTypesForStage('OPEN')).toContain('RHP'); // still catching up
    expect(dueDocTypesForStage('CLOSED')).toContain('PROSPECTUS');
    // LISTED introduces nothing new, but everything earlier remains catch-up-able.
    expect(STAGE_DOCUMENT_TYPES.LISTED).toEqual([]);
    expect(dueDocTypesForStage('LISTED')).toEqual(dueDocTypesForStage('CLOSED'));
  });

  it('does not make the Prospectus due before close', () => {
    expect(dueDocTypesForStage('PRE_OPEN')).not.toContain('PROSPECTUS');
    expect(dueDocTypesForStage('OPEN')).not.toContain('PROSPECTUS');
  });
});

// ---------------------------------------------------------------------------
// §7.2 core: zero-cost cycles (tests 47, 48)
// ---------------------------------------------------------------------------

describe('T47 an IPO with nothing due costs ZERO network calls (§7.2)', () => {
  it('skips the IPO entirely when every due type is FOUND (extraction is WP C)', () => {
    const rows = dueDocTypesForStage('CLOSED').map((t) => row(t, 'FOUND'));
    const plan = planIpoCycle({ stage: 'CLOSED', rows, options: { now: NOW } });
    expect(plan.skipIpo).toBe(true);
    expect(plan.due).toEqual([]);
    expect(plan.reason).toContain('zero network calls');
  });

  it('does NOT skip once extraction is wired — FOUND becomes open again', () => {
    // The only change WP C needs: FOUND stops being terminal. No other edits.
    const rows = dueDocTypesForStage('CLOSED').map((t) => row(t, 'FOUND'));
    const plan = planIpoCycle({
      stage: 'CLOSED',
      rows,
      options: { now: NOW, extractionEnabled: true },
    });
    expect(plan.skipIpo).toBe(false);
    expect(plan.due.length).toBeGreaterThan(0);
  });

  it('skips when every open row is backing off, and resumes when the backoff expires', () => {
    const rows = dueDocTypesForStage('OPEN').map((t) =>
      row(t, 'NOT_YET_FILED', { nextRetryAt: new Date(NOW.getTime() + minutes(10)) })
    );
    expect(planIpoCycle({ stage: 'OPEN', rows, options: { now: NOW } }).skipIpo).toBe(true);

    const later = new Date(NOW.getTime() + minutes(31));
    const resumed = planIpoCycle({ stage: 'OPEN', rows, options: { now: later } });
    expect(resumed.skipIpo).toBe(false);
    expect(resumed.due.length).toBe(rows.length);
  });

  it('creates WANTED rows for types it has never seen', () => {
    const plan = planIpoCycle({ stage: 'PRE_OPEN', rows: [], options: { now: NOW } });
    expect(plan.skipIpo).toBe(false);
    expect(plan.missingRows).toEqual(dueDocTypesForStage('PRE_OPEN'));
    expect(plan.due).toEqual(plan.missingRows);
  });
});

describe('T48 NOT_YET_FILED is not a failure', () => {
  it('goes back on the 30-minute ladder, raises no alert, and clears any block', () => {
    const t = applyOutcome(row('ANCHOR_ALLOCATION_REPORT', 'WANTED'), 'no_link', NOW);
    expect(t.state).toBe('NOT_YET_FILED');
    expect(t.alert).toBe(false);
    expect(t.blockedSinceAt).toBeNull();
    expect(t.nextRetryAt!.getTime() - NOW.getTime()).toBe(minutes(RETRY_MINUTES.NOT_YET_FILED));
    expect(t.reason).toContain('not a failure');
  });

  it('is still retried every cycle, forever, without escalating', () => {
    let r = row('PROSPECTUS', 'NOT_YET_FILED', { attempts: 40 });
    for (let i = 0; i < 5; i++) {
      const t = applyOutcome(r, 'no_link', NOW);
      expect(t.state).toBe('NOT_YET_FILED');
      expect(t.alert).toBe(false);
      r = { ...r, state: t.state, nextRetryAt: t.nextRetryAt, blockedSinceAt: t.blockedSinceAt };
    }
  });
});

describe('T-403 r5: an incomplete rung chain concludes nothing', () => {
  it('leaves the row WANTED and retryable, and does not claim the filing is absent', () => {
    // The G4 guard used to downgrade `all_sources_failed` to `no_link` when the
    // chain ran short, i.e. it wrote NOT_YET_FILED - "the company has not filed
    // it" - because the CHAIN was broken. Two wrong claims in one: an outage
    // that did not happen, then an absence nobody observed.
    const t = applyOutcome(row('DRHP', 'WANTED'), 'chain_incomplete', NOW);
    expect(t.state).toBe('WANTED');
    expect(t.state).not.toBe('NOT_YET_FILED');
    expect(t.alert).toBe(false);
    expect(t.blockedSinceAt).toBeNull();
    expect(t.nextRetryAt).not.toBeNull();
    expect(t.nextRetryAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('does not clear an existing block into a clean slate silently', () => {
    // Coming from BLOCKED_ALL it still returns to WANTED - the chain told us
    // nothing, so the row goes back in the queue - but it raises no NEW alert.
    //
    // r6 (4): this test's NAME said "does not clear the block silently" while
    // its assertions checked only the state and the alert; the transition was
    // nulling `blockedSinceAt`, which is precisely the silent clearing. That
    // matters because `blockedSinceAt` is the outage clock: the BLOCKED_ALL
    // retry ladder measures from it, and the nightly `m_blocked_all_age` check
    // ages rows by it. A chain that concluded NOTHING must not reset either -
    // an unreachable document would otherwise look freshly blocked forever.
    const blockedSince = new Date(NOW.getTime() - minutes(30 * 60));
    const t = applyOutcome(
      row('RHP', 'BLOCKED_ALL', { blockedSinceAt: blockedSince }),
      'chain_incomplete',
      NOW
    );
    expect(t.state).toBe('WANTED');
    expect(t.alert).toBe(false);
    expect(t.blockedSinceAt).toEqual(blockedSince);
  });

  it('does not invent a block for a row that never had one', () => {
    const t = applyOutcome(row('RHP', 'WANTED', { blockedSinceAt: null }), 'chain_incomplete', NOW);
    expect(t.blockedSinceAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §7.3 retry ladder (test 49)
// ---------------------------------------------------------------------------

describe('T49 BLOCKED_ALL retry ladder', () => {
  it('alerts P2 ONCE on entry, not on every subsequent cycle', () => {
    const first = applyOutcome(row('RHP', 'WANTED'), 'all_sources_failed', NOW);
    expect(first.state).toBe('BLOCKED_ALL');
    expect(first.alert).toBe(true);

    const again = applyOutcome(
      row('RHP', 'BLOCKED_ALL', { blockedSinceAt: NOW }),
      'all_sources_failed',
      new Date(NOW.getTime() + minutes(30))
    );
    expect(again.alert).toBe(false);
  });

  it('retries every 30 min for the first 24 h, then every 6 h', () => {
    const fresh = computeNextRetryAt('BLOCKED_ALL', NOW, NOW);
    expect(fresh!.getTime() - NOW.getTime()).toBe(minutes(RETRY_MINUTES.BLOCKED_FRESH));

    const aged = new Date(NOW.getTime() + BLOCKED_FAST_LADDER_HOURS * 3_600_000);
    const slow = computeNextRetryAt('BLOCKED_ALL', aged, NOW);
    expect(slow!.getTime() - aged.getTime()).toBe(minutes(RETRY_MINUTES.BLOCKED_AGED));
  });

  it('measures the outage from the ORIGINAL block, not from the last attempt', () => {
    // Otherwise a row failing every 30 min would never reach the 24 h mark.
    const blockedSince = new Date(NOW.getTime() - 25 * 3_600_000);
    const t = applyOutcome(
      row('RHP', 'BLOCKED_ALL', { blockedSinceAt: blockedSince }),
      'all_sources_failed',
      NOW
    );
    expect(t.blockedSinceAt).toEqual(blockedSince);
    expect(t.nextRetryAt!.getTime() - NOW.getTime()).toBe(minutes(RETRY_MINUTES.BLOCKED_AGED));
  });

  it('keeps a blockedSinceAt inherited from a prior chain_incomplete cycle, even though the row is not currently BLOCKED_ALL (r7)', () => {
    // r6's guard was `row.state === 'BLOCKED_ALL' && row.blockedSinceAt`: a row
    // that passed through chain_incomplete (state WANTED) but still carries a
    // blockedSinceAt clock from an EARLIER all_sources_failed cycle had that
    // clock reset to `now` here, because its CURRENT state was WANTED, not
    // BLOCKED_ALL — silently losing the outage age chain_incomplete itself
    // took care to preserve.
    const blockedSince = new Date(NOW.getTime() - 25 * 3_600_000);
    const t = applyOutcome(row('RHP', 'WANTED', { blockedSinceAt: blockedSince }), 'all_sources_failed', NOW);
    expect(t.state).toBe('BLOCKED_ALL');
    expect(t.blockedSinceAt).toEqual(blockedSince);
    expect(t.nextRetryAt!.getTime() - NOW.getTime()).toBe(minutes(RETRY_MINUTES.BLOCKED_AGED));
  });

  it('never schedules a retry for a closed state', () => {
    for (const s of ['FOUND', 'EXTRACTED', 'SUPERSEDED', 'NOT_APPLICABLE', 'EXTRACT_FAILED'] as const) {
      expect(computeNextRetryAt(s, NOW)).toBeNull();
    }
  });

  it('a recovered BLOCKED_ALL goes straight to FOUND and stops retrying', () => {
    const t = applyOutcome(row('RHP', 'BLOCKED_ALL', { blockedSinceAt: NOW }), 'found', NOW);
    expect(t.state).toBe('FOUND');
    expect(t.nextRetryAt).toBeNull();
    expect(t.blockedSinceAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T50 supersession ordering
// ---------------------------------------------------------------------------

describe('T50 supersession is ordered by filing_date, not fetch order (E1/E8)', () => {
  it('an OLDER filing arriving second does NOT overwrite the newer one', () => {
    const d = decideSupersession(
      { docType: 'RHP', filingDate: '2026-08-12', sha256: 'aaa' },
      { docType: 'RHP', filingDate: '2026-08-11', sha256: 'bbb' }
    );
    expect(d.action).toBe('none');
    expect(d.reason).toContain('not newer');
  });

  it('a NEWER filing of the same type supersedes the old row (R4)', () => {
    const d = decideSupersession(
      { docType: 'RHP', filingDate: '2026-08-11', sha256: 'aaa' },
      { docType: 'RHP', filingDate: '2026-08-12', sha256: 'bbb' }
    );
    expect(d).toMatchObject({ action: 'supersede', supersededTypes: ['RHP'] });
  });

  it('a Prospectus supersedes the RHP and the price-band ad it outranks', () => {
    const d = decideSupersession(null, { docType: 'PROSPECTUS', filingDate: '2026-08-29' }, [
      'RHP',
      'PRICE_BAND_AD',
      'CORRIGENDUM',
    ]);
    expect(d.action).toBe('supersede');
    if (d.action === 'supersede') {
      expect(d.supersededTypes.sort()).toEqual(['CORRIGENDUM', 'PRICE_BAND_AD', 'RHP']);
    }
  });

  it('a non-superseding type supersedes nothing', () => {
    expect(decideSupersession(null, { docType: 'BIDDING_CENTERS', filingDate: '2026-08-29' }, ['RHP']).action)
      .toBe('none');
  });

  it('isStrictlyNewer: a null date never wins, and never loses to another null', () => {
    expect(isStrictlyNewer(null, '2026-08-01')).toBe(false);
    expect(isStrictlyNewer('2026-08-01', null)).toBe(true);
    expect(isStrictlyNewer(null, null)).toBe(false);
    expect(isStrictlyNewer('2026-08-01', '2026-08-01')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T52 / R9
// ---------------------------------------------------------------------------

describe('T52 / R9 a fixed-price issue marks the price-band ad NOT_APPLICABLE', () => {
  it('lists the impossible types and excludes them from due', () => {
    expect(notApplicableTypes({ isFixedPrice: true }).sort()).toEqual([
      'ANCHOR_ALLOCATION_REPORT',
      'PRICE_BAND_AD',
    ]);
    const plan = planIpoCycle({
      stage: 'PRE_OPEN',
      rows: [],
      issue: { isFixedPrice: true },
      options: { now: NOW },
    });
    expect(plan.due).not.toContain('PRICE_BAND_AD');
    expect(plan.due).not.toContain('ANCHOR_ALLOCATION_REPORT');
    expect(plan.toMarkNotApplicable.sort()).toEqual(['ANCHOR_ALLOCATION_REPORT', 'PRICE_BAND_AD']);
  });

  it('is never retried once marked', () => {
    const rows = [row('PRICE_BAND_AD', 'NOT_APPLICABLE'), row('ANCHOR_ALLOCATION_REPORT', 'NOT_APPLICABLE')];
    const plan = planIpoCycle({
      stage: 'PRE_OPEN',
      rows: [...rows, ...dueDocTypesForStage('PRE_OPEN').filter((t) => !['PRICE_BAND_AD', 'ANCHOR_ALLOCATION_REPORT'].includes(t)).map((t) => row(t, 'FOUND')), row('DRHP', 'FOUND')],
      issue: { isFixedPrice: true },
      options: { now: NOW },
    });
    expect(plan.skipIpo).toBe(true);
    expect(plan.toMarkNotApplicable).toEqual([]);
  });

  it('a BOOK-BUILT issue has no not-applicable types', () => {
    expect(notApplicableTypes({ isFixedPrice: false })).toEqual([]);
    expect(notApplicableTypes({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R1 .. R13 (tests 34-46)
// ---------------------------------------------------------------------------

describe('decision-matrix §7.6 — R1 to R13', () => {
  it('R1 a document found via NSE while BSE was down is FOUND; nothing retries BSE for it', () => {
    // Exchanges-first applies only while a document is still MISSING.
    const plan = planIpoCycle({
      stage: 'PRE_OPEN',
      rows: dueDocTypesForStage('PRE_OPEN').map((t) => row(t, 'FOUND')).concat(row('DRHP', 'FOUND')),
      options: { now: NOW },
    });
    expect(plan.due).not.toContain('RHP');
    expect(plan.skipIpo).toBe(true);
  });

  it('R2 the same document reachable on both exchanges: first verified wins, sha prevents a second copy', () => {
    const d = decideSupersession(
      { docType: 'RHP', filingDate: '2026-08-11', sha256: 'same' },
      { docType: 'RHP', filingDate: '2026-08-11', sha256: 'same' }
    );
    expect(d.action).toBe('update_url_only');
  });

  it('R3 URL changes but the hash is identical: no re-download, no re-extract, URL list only', () => {
    const d = decideSupersession(
      { docType: 'RHP', filingDate: '2026-08-11', sha256: 'abc123' },
      { docType: 'RHP', filingDate: '2026-08-14', sha256: 'abc123' } // even a later date
    );
    expect(d.action).toBe('update_url_only');
    expect(d.reason).toContain('no re-extract');
  });

  it('R4 URL AND hash change for the same type: new row, old deactivated, only if newer', () => {
    const newer = decideSupersession(
      { docType: 'RHP', filingDate: '2026-08-11', sha256: 'aaa' },
      { docType: 'RHP', filingDate: '2026-08-14', sha256: 'zzz' }
    );
    expect(newer.action).toBe('supersede');
    const older = decideSupersession(
      { docType: 'RHP', filingDate: '2026-08-14', sha256: 'aaa' },
      { docType: 'RHP', filingDate: '2026-08-11', sha256: 'zzz' }
    );
    expect(older.action).toBe('none');
  });

  it('R5 an extractor_version bump re-queues EXTRACTED rows exactly once', () => {
    const old = row('RHP', 'EXTRACTED', { extractorVersion: 'v1' });
    const opts = { extractionEnabled: true, extractorVersion: 'v2', now: NOW };
    expect(needsReExtraction(old, opts)).toBe(true);
    expect(planIpoCycle({ stage: 'PRE_OPEN', rows: [old], options: opts }).due).toContain('RHP');

    // Already on the current version: NOT re-queued (this is the "once" part).
    const current = row('RHP', 'EXTRACTED', { extractorVersion: 'v2' });
    expect(needsReExtraction(current, opts)).toBe(false);

    // And with extraction not yet wired (WP A+B), nothing is ever re-queued.
    expect(needsReExtraction(old, { extractorVersion: 'v2', now: NOW })).toBe(false);
  });

  it('R6 a row left mid-extraction by a crash is treated as FOUND again after 30 min', () => {
    expect(IN_PROGRESS_STALE_MINUTES).toBe(30);
    const stale = row('RHP', 'FOUND', { lastAttemptAt: new Date(NOW.getTime() - minutes(31)) });
    const fresh = row('RHP', 'FOUND', { lastAttemptAt: new Date(NOW.getTime() - minutes(5)) });
    expect(isStaleInProgress(stale, NOW)).toBe(true);
    expect(isStaleInProgress(fresh, NOW)).toBe(false);
    // No row is ever left stuck: a FOUND row with no attempt timestamp is not stale.
    expect(isStaleInProgress(row('RHP', 'FOUND'), NOW)).toBe(false);
  });

  it('R7 two overlapping cycles: the plan is a pure function of state, so it is idempotent', () => {
    // The lock itself is the runner's (Redis, per `ipo:<slug>`); what matters
    // here is that computing the plan twice cannot produce extra work.
    const rows = [row('RHP', 'FOUND'), row('PRICE_BAND_AD', 'NOT_YET_FILED')];
    const a = planIpoCycle({ stage: 'PRE_OPEN', rows, options: { now: NOW } });
    const b = planIpoCycle({ stage: 'PRE_OPEN', rows, options: { now: NOW } });
    expect(a).toEqual(b);
  });

  it('R8 re-pointed state rows keep their state, so documents are never re-fetched', () => {
    // The re-point itself is a repository UPDATE; the invariant the machine must
    // honour is that a FOUND row carried over to the survivor stays closed.
    const carriedOver = [row('RHP', 'FOUND'), row('DRHP', 'FOUND')];
    expect(planIpoCycle({ stage: 'UPCOMING', rows: carriedOver, options: { now: NOW } }).skipIpo).toBe(true);
  });

  it('R9 types impossible for the issue are NOT_APPLICABLE from the start', () => {
    expect(notApplicableTypes({ isFixedPrice: true })).toContain('PRICE_BAND_AD');
  });

  it('R10 an IPO listed more than 10 days ago is outside the live window', () => {
    expect(LIVE_WINDOW_DAYS_AFTER_LISTING).toBe(10);
    const listedRecently = new Date(NOW.getTime() - 3 * 86_400_000);
    const listedLongAgo = new Date(NOW.getTime() - 20 * 86_400_000);
    expect(isInLiveWindow({ status: 'LISTED', listingDate: listedRecently, now: NOW })).toBe(true);
    expect(isInLiveWindow({ status: 'LISTED', listingDate: listedLongAgo, now: NOW })).toBe(false);
    for (const s of ['UPCOMING', 'OPEN', 'CLOSED']) {
      expect(isInLiveWindow({ status: s, listingDate: null, now: NOW })).toBe(true);
    }
    // A LISTED IPO with no listing date is NOT assumed live — WP F owns history.
    expect(isInLiveWindow({ status: 'LISTED', listingDate: null, now: NOW })).toBe(false);
  });

  it('R11 EXTRACTED does not freeze field data — the machine governs documents only', () => {
    // The state machine has no opinion about band/dates/lot; nothing it exposes
    // can mark those closed. This asserts the boundary explicitly.
    const closed = closedStates({ extractionEnabled: true });
    expect(closed).not.toContain('WANTED');
    expect(closed).not.toContain('NOT_YET_FILED');
    expect(closed).not.toContain('BLOCKED_ALL');
    expect(Object.keys(STAGE_DOCUMENT_TYPES).length).toBe(5);
  });

  it('R12 the cycle budgets are explicit constants, not implicit behaviour', () => {
    expect(CYCLE_BUDGET.DISCOVERY_MS).toBe(60_000);
    expect(CYCLE_BUDGET.EXTRACTIONS_PER_CYCLE).toBe(1);
  });

  it('R13 flags off then on: state persists, so the job resumes exactly where it stopped', () => {
    // Turning the feature off changes nothing about the rows; when it comes back
    // the same plan is produced, with no re-fetch of anything already FOUND.
    const rows = [
      row('RHP', 'FOUND'),
      row('PRICE_BAND_AD', 'FOUND'),
      row('ANCHOR_ALLOCATION_REPORT', 'NOT_YET_FILED', { nextRetryAt: new Date(NOW.getTime() - minutes(1)) }),
      row('CORRIGENDUM', 'FOUND'),
      row('RATIOS_BASIS_ISSUE_PRICE', 'FOUND'),
      row('DRHP', 'FOUND'),
    ];
    const plan = planIpoCycle({ stage: 'PRE_OPEN', rows, options: { now: NOW } });
    expect(plan.due).toEqual(['ANCHOR_ALLOCATION_REPORT']);
    expect(plan.missingRows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

describe('F15 withdrawn issues', () => {
  it('stop fetching entirely and keep their documents', () => {
    const plan = planIpoCycle({
      stage: 'OPEN',
      rows: [row('RHP', 'WANTED')],
      issue: { withdrawn: true },
      options: { now: NOW },
    });
    // `due` is what costs network calls, and it is empty — fetching has stopped.
    expect(plan.due).toEqual([]);
    expect(plan.reason).toContain('withdrawn');

    // M3: this assertion used to read `skipIpo === true`, which locked in the
    // defect. Skipping straight away leaves every open row open forever — a
    // BLOCKED_ALL row would then fail the nightly age check every night with no
    // possible remedy. The first cycle after withdrawal CLOSES the open rows.
    expect(plan.skipIpo).toBe(false);
    expect(plan.toMarkNotApplicable).toEqual(['RHP']);
  });

  it('V-2: a BLOCKED_ALL row becomes NOT_APPLICABLE after ONE cycle', () => {
    // The previous test used a WANTED row, which is the easy case. BLOCKED_ALL
    // is the one that matters: it is the state that would otherwise stay blocked
    // forever on a withdrawn IPO and fail the nightly m_blocked_all_age check
    // every night, with no possible remedy.
    const blocked = row('RHP', 'BLOCKED_ALL');
    const first = planIpoCycle({
      stage: 'OPEN',
      rows: [blocked],
      issue: { withdrawn: true },
      options: { now: NOW },
    });
    expect(first.toMarkNotApplicable).toEqual(['RHP']);
    expect(first.skipIpo).toBe(false);
    expect(first.due).toEqual([]);

    // After that cycle wrote NOT_APPLICABLE, the next cycle is a pure skip.
    const second = planIpoCycle({
      stage: 'OPEN',
      rows: [row('RHP', 'NOT_APPLICABLE')],
      issue: { withdrawn: true },
      options: { now: NOW },
    });
    expect(second.skipIpo).toBe(true);
    expect(second.toMarkNotApplicable).toEqual([]);
  });

  it('skip only once every row is closed, so the marking happens exactly once', () => {
    const plan = planIpoCycle({
      stage: 'OPEN',
      rows: [row('RHP', 'NOT_APPLICABLE')],
      issue: { withdrawn: true },
      options: { now: NOW },
    });
    expect(plan.skipIpo).toBe(true);
    expect(plan.toMarkNotApplicable).toEqual([]);
  });
});

describe('F-3 a later filing closes the hunt for its drafts', () => {
  it('an RHP in hand supersedes an open DRHP instead of alerting on it', () => {
    // Observed live 2026-08-28: a CLOSED IPO whose RHP was FOUND went
    // BLOCKED_ALL on its DRHP and fired a P2, because SEBI's draft list no
    // longer shows a June-2026 draft. Nobody could act on that alert — the
    // document it wants has been replaced by one we already hold. An alert
    // nobody can act on is how real alerts come to be ignored.
    const plan = planIpoCycle({
      stage: 'CLOSED',
      rows: [row('RHP', 'FOUND'), row('DRHP', 'BLOCKED_ALL')],
      options: { now: NOW },
    });

    expect(plan.toMarkSuperseded).toEqual(['DRHP']);
    expect(plan.due).not.toContain('DRHP');
  });

  it('a PROSPECTUS in hand supersedes both the RHP and the DRHP', () => {
    const plan = planIpoCycle({
      stage: 'CLOSED',
      rows: [row('PROSPECTUS', 'FOUND'), row('RHP', 'NOT_YET_FILED'), row('DRHP', 'WANTED')],
      options: { now: NOW },
    });

    expect(plan.toMarkSuperseded.sort()).toEqual(['DRHP', 'RHP']);
    expect(plan.due).not.toContain('RHP');
    expect(plan.due).not.toContain('DRHP');
  });

  it('does NOT touch a draft we actually hold — supersession closes the hunt, not the document', () => {
    const plan = planIpoCycle({
      stage: 'CLOSED',
      rows: [row('RHP', 'FOUND'), row('DRHP', 'FOUND')],
      options: { now: NOW },
    });
    expect(plan.toMarkSuperseded).toEqual([]);
  });

  it('does nothing while the later filing is still being chased', () => {
    // The guard against over-firing: an RHP we do not have cannot supersede
    // anything, or a DRHP would be abandoned the moment the RHP row appeared.
    const plan = planIpoCycle({
      stage: 'OPEN',
      rows: [row('RHP', 'NOT_YET_FILED'), row('DRHP', 'WANTED')],
      options: { now: NOW },
    });
    expect(plan.toMarkSuperseded).toEqual([]);
    expect(plan.due).toContain('DRHP');
  });
});
