/**
 * #721 review round 2 (OD-131): the orchestrator door refuses an impossible lot on the INCOMING
 * record BEFORE consolidation, the way the #1229 date refusal does, so a refused lot is never
 * written AND gets no field_sources provenance row. The refusal cause reaches the caller
 * (`refusedLotFields`, which the field walk records) and the step ledger (B5 `refused`).
 *
 * Shape: a stored MAINBOARD IPO with band cap Rs300; a lot of 100 makes lot x cap Rs30,000, outside
 * the spec §1.2 row 4 MAINBOARD range (Rs10,000-Rs15,000). A lot of 45 (Rs13,500) is legal.
 *
 * REAL orchestrator + REAL DataConsolidationService; only repositories are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDiscoverySteps: vi.fn().mockResolvedValue(undefined),
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 100,
    CONSOLIDATION_PERCENTAGE: 100,
    MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100,
    ENABLED_SCRAPERS: [],
    ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
  logFeatureFlags: vi.fn(),
}));

import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';
import {
  walkFieldPlanForIPO,
  LOT_REFUSED_REASON,
  IDENTIFIER_REFUSED_REASON,
  type FieldPlanWalkDeps,
} from '../../../src/services/field-plan-walk.js';
import { IDENTIFIER_HELD_RULE } from '../../../src/services/identifier-refusal.js';

const IPO_ID = '00000000-0000-4000-8000-000000000721';

function provenanceRow(fieldName: string, source: string, value: unknown) {
  return {
    ipoId: IPO_ID, tableName: 'ipos', rowKey: '', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date('2026-09-10T00:00:00Z'), createdAt: new Date('2026-09-10T00:00:00Z'),
  } as any;
}

function harness(provenance: any[] = []) {
  const ipoRepository = {
    update: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: IPO_ID })),
  };
  const fieldSourcesRepository = {
    findByIPOId: vi.fn(async () => provenance),
    findByField: vi.fn(async () => null),
    trackFieldUpdate: vi.fn(async () => undefined),
  };
  const dataConflictsRepository = {
    logConflict: vi.fn(),
    upsertConflict: vi.fn(),
    autoResolveConverged: vi.fn(),
    findUnresolvedForIPO: vi.fn(async () => []),
    resolveConflict: vi.fn(),
  };
  const orchestrator = new DataConsolidationOrchestrator(
    ipoRepository as any,
    fieldSourcesRepository as any,
    dataConflictsRepository as any,
    null
  );
  return { orchestrator, ipoRepository, fieldSourcesRepository, dataConflictsRepository };
}


function storedMainboard() {
  return {
    id: IPO_ID,
    slug: 'lot-check-limited',
    companyName: 'Lot Check Limited',
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    status: 'UPCOMING',
    priceRangeMin: 290,
    priceRangeMax: 300,
    lotSize: null,
    listingExchanges: ['NSE', 'BSE'],
  } as any;
}

describe('#721 at the orchestrator door: lot refused before consolidation (OD-131)', () => {
  it('UPDATE: lot 100 x stored cap Rs300 is refused: not written, no provenance row, cause returned and ledgered', async () => {
    const { recordDiscoverySteps } = await import('../../../src/services/step-ledger-recorders.js');
    (recordDiscoverySteps as any).mockClear();
    const { orchestrator, ipoRepository, fieldSourcesRepository } = harness();
    const r = await orchestrator.consolidatedUpsertIPO(
      { companyName: 'Lot Check Limited', lotSize: 100 } as any, 'NSE', 100, storedMainboard(), ['lotSize']
    );
    expect(r.refusedLotFields).toEqual(['lotSize']);
    for (const c of ipoRepository.update.mock.calls) expect(c[1]).not.toHaveProperty('lotSize');
    const tracked = fieldSourcesRepository.trackFieldUpdate.mock.calls.map((c: any[]) => c[0].fieldName);
    expect(tracked).not.toContain('lotSize');
    expect((r.consolidation?.fieldResults ?? []).map((f: any) => f.fieldName)).not.toContain('lotSize');
    const ledger = (recordDiscoverySteps as any).mock.calls.at(-1)[1];
    expect(ledger.refused).toEqual([{ field: 'lotSize', rule: 'LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD' }]);
  });

  it('UPDATE: one write with BOTH a lot refusal and an identifier refusal reaches the result, the B5 ledger and the walk (#1376 x #721)', async () => {
    const { recordDiscoverySteps } = await import('../../../src/services/step-ledger-recorders.js');
    (recordDiscoverySteps as any).mockClear();
    const { orchestrator, ipoRepository } = harness();
    ipoRepository.update.mockImplementation((async (_id: string, _data: unknown, opts: any) => {
      opts?.onIdentifierRefused?.([{ fieldName: 'isin' }]);
    }) as any);
    const r = await orchestrator.consolidatedUpsertIPO(
      { companyName: 'Lot Check Limited', lotSize: 100, isin: 'INE000000721' } as any, 'NSE', 100, storedMainboard(), ['lotSize', 'isin']
    );
    expect(r.refusedLotFields).toEqual(['lotSize']);
    expect(r.refusedIdentifierFields).toEqual(['isin']);
    const ledger = (recordDiscoverySteps as any).mock.calls.at(-1)[1];
    expect(ledger.refused).toEqual([
      { field: 'lotSize', rule: 'LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD' },
      { field: 'isin', rule: IDENTIFIER_HELD_RULE },
    ]);

    const planRow = (fieldName: string) => ({
      id: 'plan-' + fieldName, ipoId: IPO_ID, tableName: 'ipos', rowKey: '', fieldName, rank1Source: 'NSE', rank2Source: null,
      rank3Source: null, state: 'PENDING' as const, chosenSource: null, chosenRank: null, attempts: 0, claimToken: 'tok-' + fieldName,
      manifestVersion: 2, policyOrigin: 'registry:2', reopenedUnderPolicy: null,
    });
    const queue: unknown[] = [planRow('lotSize'), planRow('isin')];
    const recorded: any[] = [];
    const d = {
      fieldPlanRepository: {
        claimNextDueField: vi.fn(async () => queue.shift() ?? null),
        recordOutcome: vi.fn(async (p: any) => { recorded.push(p); return { written: true }; }),
        releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
        restoreSettledAfterReopen: vi.fn(async () => ({ restored: true })),
      } as any,
      orchestrator: {
        consolidatedUpsertIPO: vi.fn(async () => r),
        consolidatedUpsertChildRows: vi.fn(),
      } as any,
      sourceFetchers: {
        NSE: vi.fn(async () => ({ outcome: 'SUPPLIED', value: 100, documentType: undefined, page: undefined })),
      } as any,
      ipoRepository: {
        findById: vi.fn(async () => ({
          id: IPO_ID, companyName: 'Lot Check Limited', symbol: null, isin: null, offeringType: 'IPO',
          openDate: '2026-09-25', segment: 'MAINBOARD', listingExchanges: ['NSE'],
        })),
      } as any,
      resolvePolicy: () => ({ ranks: ['NSE'], documentType: undefined, origin: { kind: 'registry', version: 2 }, na: false, incapable: {} }),
      logAdminConflict: vi.fn(async () => undefined),
    } as unknown as FieldPlanWalkDeps;
    await walkFieldPlanForIPO(IPO_ID, d, { deadlineMs: 1_000_000, now: () => 0 });
    const causes = recorded.map((x) => x.cause as string);
    expect(recorded.map((x) => x.state)).toEqual(['CHECK_FAILED', 'CHECK_FAILED']);
    expect(causes.some((c) => c.includes(`${LOT_REFUSED_REASON}: lotSize`))).toBe(true);
    expect(causes.some((c) => c.includes(`${IDENTIFIER_REFUSED_REASON}: isin`))).toBe(true);
  });

  it('UPDATE: a legal lot 45 (Rs13,500) is written with its provenance', async () => {
    const { orchestrator, ipoRepository, fieldSourcesRepository } = harness();
    const r = await orchestrator.consolidatedUpsertIPO(
      { companyName: 'Lot Check Limited', lotSize: 45 } as any, 'NSE', 100, storedMainboard(), ['lotSize']
    );
    expect(r.refusedLotFields).toBeUndefined();
    expect((ipoRepository.update.mock.calls[0][1] as any).lotSize).toBe(45);
    const tracked = fieldSourcesRepository.trackFieldUpdate.mock.calls.map((c: any[]) => c[0].fieldName);
    expect(tracked).toContain('lotSize');
  });

  it('CREATE: an impossible lot (no segment, lot 100 x Rs300) gets no provenance row; the band does', async () => {
    const { orchestrator, ipoRepository, fieldSourcesRepository } = harness();
    const r = await orchestrator.consolidatedUpsertIPO(
      { companyName: 'Lot Check Limited', offeringType: 'IPO', lotSize: 100, priceRangeMin: 290, priceRangeMax: 300 } as any,
      'NSE', 100, null
    );
    expect(r.refusedLotFields).toEqual(['lotSize']);
    expect((ipoRepository.create.mock.calls[0][0] as any).lotSize ?? null).toBeNull();
    const tracked = fieldSourcesRepository.trackFieldUpdate.mock.calls.map((c: any[]) => c[0].fieldName);
    expect(tracked).not.toContain('lotSize');
    // The refused lot never reached consolidation (the step that writes provenance); the band did.
    const considered = (r.consolidation?.fieldResults ?? []).map((f: any) => f.fieldName);
    expect(considered).not.toContain('lotSize');
    expect(considered).toContain('priceRangeMax');
  });

  it('an ADMIN write is never refused (W-14 exemption)', async () => {
    const { orchestrator, ipoRepository } = harness();
    await orchestrator.consolidatedUpsertIPO(
      { companyName: 'Lot Check Limited', lotSize: 100 } as any, 'ADMIN' as any, 100, storedMainboard(), ['lotSize']
    );
    expect((ipoRepository.update.mock.calls[0][1] as any).lotSize).toBe(100);
  });
});
