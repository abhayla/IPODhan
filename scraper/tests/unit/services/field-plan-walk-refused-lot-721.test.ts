// implements: #721 review r2 -- walk-level pin for refusedLotFields. The orchestrator refuses an
// impossible lot (spec §1.2 row 4) before consolidation; the field walk must record it as a
// validation refusal carrying LOT_REFUSED_REASON, never the generic "no field result returned".
// Class: every lot_size write the walk sends through the orchestrator door, any source.
import { describe, it, expect, vi } from 'vitest';
import {
  walkFieldPlanForIPO,
  LOT_REFUSED_REASON,
  type FieldFetcher,
  type FieldPlanWalkDeps,
} from '../../../src/services/field-plan-walk.js';
import { consolidatedUpsertResultFixture } from '../../helpers/consolidation-result-fixture.js';

const IPO_ID = '00000000-0000-4000-8000-000000000721';

function planRow(over: Record<string, unknown> = {}) {
  return {
    id: 'plan-721',
    ipoId: IPO_ID,
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'lot_size',
    rank1Source: 'CHITTORGARH',
    rank2Source: null,
    rank3Source: null,
    state: 'PENDING' as const,
    chosenSource: null,
    chosenRank: null,
    attempts: 0,
    claimToken: 'tok-721',
    manifestVersion: 2,
    policyOrigin: 'registry:2',
    reopenedUnderPolicy: null,
    ...over,
  };
}

function setup(row: unknown, refused: string[] | undefined, fieldResults: unknown[] = []) {
  const recorded: any[] = [];
  const restored: any[] = [];
  const logAdminConflict = vi.fn(async () => undefined);
  const orchestrator = {
    consolidatedUpsertIPO: vi.fn(async () =>
      consolidatedUpsertResultFixture({
        ipoId: IPO_ID,
        fieldResults: fieldResults as never,
        ...(refused ? { refusedLotFields: refused } : {}),
      })
    ),
    consolidatedUpsertChildRows: vi.fn(),
  };
  const queue = [row];
  const d = {
    fieldPlanRepository: {
      claimNextDueField: vi.fn(async () => queue.shift() ?? null),
      recordOutcome: vi.fn(async (p: any) => {
        recorded.push(p);
        return { written: true };
      }),
      releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
      restoreSettledAfterReopen: vi.fn(async (p: any) => {
        restored.push(p);
        return { restored: true };
      }),
    } as any,
    orchestrator: orchestrator as any,
    sourceFetchers: {
      CHITTORGARH: vi.fn(async () => ({ outcome: 'SUPPLIED', value: 100, documentType: 'RHP', page: 1 })) as FieldFetcher,
    } as any,
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'Refused Lot Ltd', symbol: 'RDL', isin: 'INE000A01240',
        offeringType: 'IPO', openDate: '2026-09-25', segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'],
      })),
    } as any,
    resolvePolicy: () => ({
      ranks: ['CHITTORGARH', 'DOC'],
      documentType: undefined,
      origin: { kind: 'registry', version: 2 },
      na: false,
      incapable: {},
    }),
    logAdminConflict,
  } as unknown as FieldPlanWalkDeps;
  return { d, recorded, restored, logAdminConflict, orchestrator };
}

const budget = () => ({ deadlineMs: 1_000_000, now: () => 0 });
describe('#721 the walk maps refusedLotFields to LOT_REFUSED_REASON', () => {
  it('a refused lotSize -> CHECK_FAILED / FAILED_VALIDATION carrying LOT_REFUSED_REASON, not "no field result returned"', async () => {
    const { d, recorded } = setup(planRow(), ['lotSize']);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION' });
    expect(recorded[0].cause).toBe(`rank1:CHITTORGARH:VALIDATION_REFUSED:${LOT_REFUSED_REASON}: lotSize`);
  });

  it('no refusedLotFields -> the generic reason (the mapping needs the orchestrator to say so)', async () => {
    const { d, recorded } = setup(planRow(), undefined);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0].cause).toMatch(/no field result returned/);
  });
});
