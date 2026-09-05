/**
 * W-143 — CORRIGENDUM/ADDENDUM discovery gap.
 *
 * FACT (prod, 2026-09-05): 358 IPOs, `documents` table has 0 rows of type
 * CORRIGENDUM and 0 of type ADDENDUM — the enum has both, the classifier
 * (`document-classifier.ts`) correctly types them, and the discovery runner
 * (`document-discovery-runner.ts`) calls `parseBSEDocuments`/`parseNSEDocuments`
 * for every `due` type. The gap is upstream of all of that: `planIpoCycle`
 * (`document-state-machine.ts`) computes `notApplicable` — which unconditionally
 * includes every OPTIONAL_DOCUMENT_TYPES entry once `stage === 'LISTED'`
 * (`isPermanentlyPastDue`) — BEFORE checking whether a row exists or has ever
 * been attempted. Almost every one of the 358 IPOs was already LISTED the
 * first time this state machine ever saw it (T-403 shipped 2026-08/09, long
 * after most of these IPOs closed): CORRIGENDUM/ADDENDUM never enter `due`,
 * `missingRows` is never populated for them either (the `continue` at the top
 * of the loop fires first), and the type is marked NOT_APPLICABLE with ZERO
 * network calls, ZERO attempts, forever. The 355/358-empty `ipo_details`
 * finding is a separate, W-143-adjacent gap covered by
 * `w143-fixed-price-issue-type-gap.test.ts`.
 *
 * This test currently FAILS against `planIpoCycle` as written: a LISTED IPO
 * with no existing CORRIGENDUM/ADDENDUM row is marked NOT_APPLICABLE on sight,
 * never `due`. The fix must give a never-attempted optional type at least one
 * real due cycle before it can be retired as NOT_APPLICABLE.
 */
import { describe, it, expect } from 'vitest';
import { planIpoCycle, type StateRow } from '../../../src/services/document-state-machine.js';

const NOW = new Date('2026-09-05T06:00:00Z');

describe('W-143: a LISTED IPO must get at least one real attempt at an optional doc type', () => {
  it('does NOT mark CORRIGENDUM/ADDENDUM NOT_APPLICABLE on first sight of a LISTED IPO with no prior row', () => {
    // Simulates a historically-backfilled IPO: it is already LISTED and no
    // document_fetch_state row has EVER existed for CORRIGENDUM/ADDENDUM —
    // i.e. discovery has never once asked BSE/NSE whether either was filed.
    const rows: StateRow[] = [];

    const plan = planIpoCycle({ stage: 'LISTED', rows, options: { now: NOW } });

    // Current (buggy) behaviour: both land straight in toMarkNotApplicable and
    // never in `due` — the IPO is retired without a single fetch attempt.
    expect(plan.due).toContain('CORRIGENDUM');
    expect(plan.due).toContain('ADDENDUM');
    expect(plan.toMarkNotApplicable).not.toContain('CORRIGENDUM');
    expect(plan.toMarkNotApplicable).not.toContain('ADDENDUM');
  });

  it('only retires an optional type as NOT_APPLICABLE once it has actually been tried and come back empty', () => {
    // A row that HAS been attempted (state NOT_YET_FILED, at least one
    // attempt recorded) on a now-LISTED IPO is the legitimate NOT_APPLICABLE
    // case — the issuer had its whole window and never filed one.
    const rows: StateRow[] = [
      {
        docType: 'CORRIGENDUM',
        state: 'NOT_YET_FILED',
        attempts: 1,
        nextRetryAt: null,
        blockedSinceAt: null,
        filingDate: null,
        extractorVersion: null,
        lastAttemptAt: new Date('2026-08-01T00:00:00Z'),
      },
    ];

    const plan = planIpoCycle({ stage: 'LISTED', rows, options: { now: NOW } });
    expect(plan.toMarkNotApplicable).toContain('CORRIGENDUM');
  });
});
