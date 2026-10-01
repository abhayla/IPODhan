/**
 * #721: the consolidation orchestrator's create and update doors (consolidatedUpsertIPO, the live
 * Phase-1 door) run the spec §1.2 row 4 lot-economics check before writing `ipos`.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDiscoverySteps: vi.fn().mockResolvedValue(undefined),
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/step-ledger.js', () => ({ initStepLedger: vi.fn().mockResolvedValue(undefined) }));
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

import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';

const inert = () =>
  new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : vi.fn(async () => (String(p) === 'findByField' ? null : []))) }) as any;

function repo() {
  return {
    bindSourceKeys: vi.fn(async () => undefined),
    findByNormalizedName: vi.fn(async () => null),
    findBySlug: vi.fn(async () => null),
    findByFuzzyName: vi.fn(async () => null),
    findByIsin: vi.fn(async () => null),
    findBySymbol: vi.fn(async () => null),
    update: vi.fn(async (id: string, data: Record<string, any>) => ({ ...data, id })),
    create: vi.fn(async (values: Record<string, any>) => ({ ...values, id: 'new-row' })),
  };
}

const scraped = (o: Record<string, any>) =>
  ({ companyName: 'Lot Check Limited', offeringType: 'IPO', status: 'UPCOMING', listingExchange: 'BSE', ...o }) as any;

describe('consolidatedUpsertIPO lot economics (#721)', () => {
  it('CREATE: an impossible lot (no segment, lot 100 x Rs300 = Rs30,000) is not written; the band is', async () => {
    const r = repo();
    const o = new DataConsolidationOrchestrator(r as any, inert(), inert(), null);
    await o.consolidatedUpsertIPO(scraped({ lotSize: 100, priceRangeMin: 290, priceRangeMax: 300 }), 'BSE', 100, null);
    expect(r.create).toHaveBeenCalledTimes(1);
    const [values] = r.create.mock.calls[0] as any[];
    expect(values).not.toHaveProperty('lotSize');
    expect(Number(values.priceRangeMax)).toBe(300);
  });

  it('CREATE: a legal lot (lot 50 x Rs290 = Rs14,500) is written', async () => {
    const r = repo();
    const o = new DataConsolidationOrchestrator(r as any, inert(), inert(), null);
    await o.consolidatedUpsertIPO(scraped({ lotSize: 50, priceRangeMin: 280, priceRangeMax: 290 }), 'BSE', 100, null);
    const [values] = r.create.mock.calls[0] as any[];
    expect(Number(values.lotSize)).toBe(50);
  });
});
