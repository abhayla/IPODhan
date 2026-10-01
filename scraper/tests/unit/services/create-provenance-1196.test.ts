/**
 * #1196: every ipos create writes a field_sources row for every column it sets.
 *
 * Measured on ipodhan_staging 2026-09-26: 47 of 396 IPOs have no companyName provenance; the 6 recent
 * ones were all created by one Chittorgarh discovery cycle and got rows only for the fields later
 * writers touched. Mechanism: the LIVE create door (`DataConsolidationOrchestrator.consolidatedUpsertIPO`)
 * consolidates with ipoId 'new' (provenance is skipped for 'new') and then calls `ipoRepository.create`
 * without tracking; `upsertIPO`'s create door (T-292) did track. Spec basis: OD-88 ("every column the
 * check writes carries its field_sources row").
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDiscoverySteps: vi.fn().mockResolvedValue(undefined),
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true, ENABLE_CONFLICT_DETECTION: false, ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false, DEBUG_DATA_FLOW: false, ENABLE_EARLY_DETECTION: false, SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 0, CONSOLIDATION_PERCENTAGE: 100, MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100, ENABLED_SCRAPERS: [], ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
}));
vi.mock('../../../src/services/step-ledger.js', () => ({ initStepLedger: vi.fn().mockResolvedValue(undefined) }));

import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';
import { createProvenanceFields } from '../../../src/services/create-provenance.js';

const inert = () =>
  new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : vi.fn(async () => (String(p) === 'findByField' ? null : []))) }) as any;

describe('#1196: the live create door writes provenance for every column it sets', () => {
  it('a Chittorgarh discovery create tracks companyName (and every other set column) under CHITTORGARH', async () => {
    const ipoRepository = {
      create: vi.fn(async (data: Record<string, unknown>) => ({ id: '00000000-0000-4000-8000-000000001196', ...data })),
      bindSourceKeys: vi.fn(async () => undefined),
    };
    const fieldSources = new Proxy(
      { bulkTrackFieldUpdates: vi.fn(async (_id: string, _t: string, f: unknown[]) => f.length) } as Record<string, unknown>,
      { get: (t, p) => (p in t ? t[p as string] : p === 'then' ? undefined : vi.fn(async () => (String(p) === 'findByField' ? null : []))) }
    ) as any;
    const orchestrator = new DataConsolidationOrchestrator(ipoRepository as any, fieldSources, inert(), null);
    await orchestrator.consolidatedUpsertIPO(
      { companyName: 'Acme India Industries Ltd', status: 'UPCOMING', segment: 'SME', offeringType: 'IPO' } as any,
      'CHITTORGARH' as any,
      90,
      null
    );
    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    const calls = (fieldSources.bulkTrackFieldUpdates as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length, 'the create must write provenance').toBe(1);
    const [ipoId, table, fields] = calls[0] as [string, string, Array<{ fieldName: string; source: string }>];
    expect(ipoId).toBe('00000000-0000-4000-8000-000000001196');
    expect(table).toBe('ipos');
    expect(fields).toContainEqual(expect.objectContaining({ fieldName: 'companyName', source: 'CHITTORGARH' }));
  });

  it('createProvenanceFields: every set column, never bookkeeping keys or empty values', () => {
    const f = createProvenanceFields({ companyName: 'X', slug: 'x', createdAt: new Date(), updatedAt: new Date(), id: 'i', lotSize: null, issueSize: undefined, status: 'UPCOMING' }, 'NSE' as any);
    expect(f.map((r) => r.fieldName).sort()).toEqual(['companyName', 'status']);
    expect(f.every((r) => r.source === 'NSE' && r.previousValue === null)).toBe(true);
  });
});
