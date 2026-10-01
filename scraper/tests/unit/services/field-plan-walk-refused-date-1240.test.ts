// implements: #1240 (follow-up of #1229 / PR #1239) -- walk-level pin for refusedDateFields.
// The orchestrator's merged-record date rule reports the fields it refused; the field walk must record
// each one as a validation failure carrying DATE_REFUSED_REASON (never the generic "no field result
// returned"), and a refusal on an override-reopened row must NOT take the priority-loss branch (no
// admin conflict, no OVERRIDE_SOURCE_LOST_TO_PRIORITY restore).
// Class: every refused date field on the singleton-ipos pull path (listing_date, open_date, close_date,
// allotment_date, ... any source, reopened or not).
import { describe, it, expect, vi } from 'vitest';
import {
  walkFieldPlanForIPO,
  DATE_REFUSED_REASON,
  type FieldFetcher,
  type FieldPlanWalkDeps,
} from '../../../src/services/field-plan-walk.js';
import { consolidatedUpsertResultFixture } from '../../helpers/consolidation-result-fixture.js';

const IPO_ID = '00000000-0000-4000-8000-000000001240';

function planRow(over: Record<string, unknown> = {}) {
  return {
    id: 'plan-1240',
    ipoId: IPO_ID,
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'listing_date',
    rank1Source: 'CHITTORGARH',
    rank2Source: null,
    rank3Source: null,
    state: 'PENDING' as const,
    chosenSource: null,
    chosenRank: null,
    attempts: 0,
    claimToken: 'tok-1240',
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
        ...(refused ? { refusedDateFields: refused } : {}),
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
      CHITTORGARH: vi.fn(async () => ({ outcome: 'SUPPLIED', value: '2026-09-20', documentType: 'RHP', page: 1 })) as FieldFetcher,
    } as any,
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'Refused Date Ltd', symbol: 'RDL', isin: 'INE000A01240',
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

describe('#1240 the walk maps refusedDateFields to DATE_REFUSED_REASON', () => {
  it('a refused listingDate on a normal row -> CHECK_FAILED / FAILED_VALIDATION carrying DATE_REFUSED_REASON, not "no field result returned"', async () => {
    const { d, recorded } = setup(planRow(), ['listingDate']);
    const result = await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION' });
    // #1379: a refusal now names its rank and source (the next rank is tried; DOC has no fetcher here).
    expect(recorded[0].cause).toBe(`rank1:CHITTORGARH:VALIDATION_REFUSED:${DATE_REFUSED_REASON}: listingDate`);
    expect(recorded[0].cause).not.toMatch(/no field result returned/);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(result.fieldsSupplied).toBe(0);
  });

  it('a refusal for a DIFFERENT field does not mask this one: no field result -> the generic reason (mapping is per field)', async () => {
    const { d, recorded } = setup(planRow(), ['closeDate']);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded).toHaveLength(1);
    expect(recorded[0].cause).toMatch(/no field result returned/);
    expect(recorded[0].cause).not.toContain(DATE_REFUSED_REASON);
  });

  it('no refusedDateFields at all -> unchanged generic reason (the mapping needs the orchestrator to say so)', async () => {
    const { d, recorded } = setup(planRow(), undefined);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0].cause).toMatch(/no field result returned/);
  });

  it('a refused date on an override-REOPENED settled row skips the reopened-loss branch: no admin conflict, no restore, recorded as a validation failure', async () => {
    const { d, recorded, restored, logAdminConflict } = setup(
      planRow({ state: 'PENDING', chosenSource: 'DOC', chosenRank: 2, reopenedUnderPolicy: 'override:swap' }),
      ['listingDate']
    );
    (d as any).resolvePolicy = () => ({
      ranks: ['CHITTORGARH', 'DOC'],
      documentType: undefined,
      origin: { kind: 'override', id: 'swap', expiresAt: '2026-10-24T00:00:00Z' },
      na: false,
      incapable: {},
    });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(logAdminConflict).not.toHaveBeenCalled();
    expect(restored).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION' });
    expect(recorded[0].cause).toContain(DATE_REFUSED_REASON);
    expect(recorded[0].cause).not.toMatch(/OVERRIDE_SOURCE_LOST_TO_PRIORITY/);
  });

  it('control: a REAL priority loss on the same reopened row still takes the reopened-loss branch (the exemption is only for refusals)', async () => {
    const { d, recorded, restored, logAdminConflict } = setup(
      planRow({ state: 'PENDING', chosenSource: 'DOC', chosenRank: 2, reopenedUnderPolicy: 'override:swap' }),
      undefined,
      [{ fieldName: 'listingDate', finalValue: '2026-09-22', chosenSource: 'DRHP', hadConflict: false }]
    );
    (d as any).resolvePolicy = () => ({
      ranks: ['CHITTORGARH', 'DOC'],
      documentType: undefined,
      origin: { kind: 'override', id: 'swap', expiresAt: '2026-10-24T00:00:00Z' },
      na: false,
      incapable: {},
    });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(logAdminConflict).toHaveBeenCalledTimes(1);
    expect(restored).toHaveLength(1);
    expect(recorded).toHaveLength(0);
  });
});
