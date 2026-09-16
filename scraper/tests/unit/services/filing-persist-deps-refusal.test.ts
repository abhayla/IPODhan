/**
 * F-101 defence in depth: `buildFilingPersistDeps` REFUSES to hand back a
 * dependency set that would write child rows with no provenance.
 *
 * The primary guard is the type — `childRowConsolidator` is required, so an
 * omission is a compile error. This throw catches what the type cannot: a cast,
 * a JS caller, or a `DataConsolidationOrchestrator` that stops exposing the
 * method. It is deliberately HERE and not at scraper startup: a boot-time
 * refusal would stop the whole production pipeline — subscriptions, GMP,
 * listings — over a filing-path wiring check.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@ipodhan/shared', () => {
  class StubRepo {}
  return {
    db: {},
    getRedisClient: () => ({}),
    filterProtectedFields: async () => ({ filtered: {} }),
    IPORepository: StubRepo,
    FinancialStatementsRepository: StubRepo,
    IpoValuationRepository: StubRepo,
    PromotersRepository: StubRepo,
    IpoIntermediariesRepository: StubRepo,
    BrlmTrackRecordRepository: StubRepo,
    FinancialDataRepository: StubRepo,
    FieldSourcesRepository: StubRepo,
    DataConflictsRepository: StubRepo,
    IpoRiskFactorsRepository: StubRepo,
    DocumentRepository: StubRepo,
  };
});
vi.mock('@ipodhan/shared/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: class {},
}));
vi.mock('../../../src/repositories/peer-company-repository.js', () => ({
  PeerCompanyRepository: class {},
}));

/** An orchestrator that has LOST the method — the shape the throw exists for. */
vi.mock('../../../src/services/data-consolidation-orchestrator.js', () => ({
  DataConsolidationOrchestrator: class {},
}));

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: { ENABLE_CHILD_TABLE_CONSOLIDATION: true },
}));

describe('buildFilingPersistDeps refuses a degraded dependency set', () => {
  it('throws, naming the flag and the missing dependency, instead of returning silently', async () => {
    const { buildFilingPersistDeps } = await import('../../../src/services/filing-persist-deps.js');
    expect(() => buildFilingPersistDeps({} as never)).toThrow(
      /ENABLE_CHILD_TABLE_CONSOLIDATION is ON but no childRowConsolidator/
    );
  });
});
