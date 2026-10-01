// implements: #1376 round 2 (OD-62/OD-99) -- the field walk records an identifier the orchestrator dropped
// (another row of the same offering holds it) as a validation refusal carrying IDENTIFIER_REFUSED_REASON,
// never the generic "no field result returned". Class: cin, isin and symbol, any source.
import { describe, it, expect, vi } from 'vitest';
import {
  walkFieldPlanForIPO,
  IDENTIFIER_REFUSED_REASON,
  type FieldFetcher,
  type FieldPlanWalkDeps,
} from '../../../src/services/field-plan-walk.js';
import { IDENTIFIER_HELD_RULE } from '../../../src/services/identifier-refusal.js';
import { planDiscoverySteps } from '../../../src/services/step-ledger-recorders.js';
import { consolidatedUpsertResultFixture } from '../../helpers/consolidation-result-fixture.js';

const IPO_ID = '00000000-0000-4000-8000-000000137602';

function planRow(fieldName: string) {
  return {
    id: 'plan-1376', ipoId: IPO_ID, tableName: 'ipos', rowKey: '', fieldName, rank1Source: 'NSE', rank2Source: null,
    rank3Source: null, state: 'PENDING' as const, chosenSource: null, chosenRank: null, attempts: 0, claimToken: 'tok-1376',
    manifestVersion: 2, policyOrigin: 'registry:2', reopenedUnderPolicy: null,
  };
}

function setup(fieldName: string, refused: string[] | undefined) {
  const recorded: any[] = [];
  const queue: unknown[] = [planRow(fieldName)];
  const d = {
    fieldPlanRepository: {
      claimNextDueField: vi.fn(async () => queue.shift() ?? null),
      recordOutcome: vi.fn(async (p: any) => { recorded.push(p); return { written: true }; }),
      releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
      restoreSettledAfterReopen: vi.fn(async () => ({ restored: true })),
    } as any,
    orchestrator: {
      consolidatedUpsertIPO: vi.fn(async () =>
        consolidatedUpsertResultFixture({ ipoId: IPO_ID, fieldResults: [] as never, ...(refused ? { refusedIdentifierFields: refused } : {}) })
      ),
      consolidatedUpsertChildRows: vi.fn(),
    } as any,
    sourceFetchers: {
      NSE: vi.fn(async () => ({ outcome: 'SUPPLIED', value: 'INE137601015', documentType: undefined, page: undefined })) as FieldFetcher,
    } as any,
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'Refused Id Ltd', symbol: null, isin: null, offeringType: 'IPO',
        openDate: '2026-09-25', segment: 'MAINBOARD', listingExchanges: ['NSE'],
      })),
    } as any,
    resolvePolicy: () => ({ ranks: ['NSE'], documentType: undefined, origin: { kind: 'registry', version: 2 }, na: false, incapable: {} }),
    logAdminConflict: vi.fn(async () => undefined),
  } as unknown as FieldPlanWalkDeps;
  return { d, recorded };
}
const budget = () => ({ deadlineMs: 1_000_000, now: () => 0 });

describe('#1376 the walk maps refusedIdentifierFields to IDENTIFIER_REFUSED_REASON', () => {
  it.each(['isin', 'cin', 'symbol'])('a refused %s -> CHECK_FAILED / FAILED_VALIDATION carrying the reason', async (field) => {
    const { d, recorded } = setup(field, [field]);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION' });
    expect(recorded[0].cause).toBe(`rank1:NSE:VALIDATION_REFUSED:${IDENTIFIER_REFUSED_REASON}: ${field}`);
  });

  it('no refusedIdentifierFields -> the generic reason (the mapping needs the orchestrator to say so)', async () => {
    const { d, recorded } = setup('isin', undefined);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0].cause).toMatch(/no field result returned/);
  });
});

describe('#1376 the B5 step records the refusal', () => {
  const base = { source: 'NSE', created: false, fields: ['isin'], consolidated: true, conflictsDetected: 0, conflictsBySeverity: {}, fieldSourcesWritten: true };
  it('B5 evidence carries refused [{field, rule}]', () => {
    const b5 = planDiscoverySteps({ ...base, refused: [{ field: 'isin', rule: IDENTIFIER_HELD_RULE }] } as never).find((w) => w.stepId === 'B5');
    expect(b5?.evidence).toMatchObject({ refused: [{ field: 'isin', rule: IDENTIFIER_HELD_RULE }] });
  });
  it('B5 evidence has no refused key when nothing was refused', () => {
    const b5 = planDiscoverySteps(base as never).find((w) => w.stepId === 'B5');
    expect(b5?.evidence).not.toHaveProperty('refused');
  });
});
