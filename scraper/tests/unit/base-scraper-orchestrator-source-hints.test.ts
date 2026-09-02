import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T-403 round 5, Class 2: a write hung on ONE branch of a feature-flag if/else.
 *
 * `recordDocumentSourceHints` - the only writer of `ipos.verifier_url`, and
 * therefore the only thing that makes the verifier rung reachable at all - sat
 * inside the `else` branch of `if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION)`,
 * under a comment claiming "one choke point". The flag is ON in production, so
 * the column stayed NULL for every IPO and the verifier rung logged
 * `skipped:no_verifier_url` forever - the H-1 symptom surviving its own fix.
 *
 * The root cause is not the misplaced call: it is that NO test drove processIPO
 * with the flag ON. This file is that matrix - {consolidation ON, OFF} x {a new
 * IPO, an existing IPO whose every field is protected}. The all-protected case
 * matters because it returns EARLY, before the upsert: the hint is bookkeeping
 * about where the IPO's documents live, not part of the IPO payload, so
 * protecting the payload must not suppress it.
 */

const mockFindBySlug = vi.fn();
const mockFindByNormalizedName = vi.fn();
const mockIsIPOLocked = vi.fn();
const mockFilterProtectedFields = vi.fn();
const mockUpdate = vi.fn();
const mockRecordHints = vi.fn();
const mockConsolidatedUpsert = vi.fn();

const flags = { ENABLE_DATA_CONSOLIDATION: false, DEBUG_DATA_FLOW: false };

vi.mock('../../src/config/feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/feature-flags.js')>();
  return { ...actual, FEATURE_FLAGS: flags };
});

vi.mock('@ipodhan/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared')>();
  return {
    ...actual,
    db: {},
    getRedisClient: () => ({}),
    IPORepository: vi.fn().mockImplementation(() => ({
      findBySlug: mockFindBySlug,
      findByNormalizedName: mockFindByNormalizedName,
      findByFuzzyName: vi.fn().mockResolvedValue(null),
      update: mockUpdate,
      updateDocumentSourceHints: vi.fn().mockResolvedValue({ id: 'x', slug: 'x' }),
    })),
    SubscriptionRepository: vi.fn().mockImplementation(() => ({})),
    ScraperLogRepository: vi.fn().mockImplementation(() => ({
      create: vi.fn().mockResolvedValue({}),
      getRecentLogs: vi.fn().mockResolvedValue([]),
    })),
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
    createFieldProtectionService: vi.fn().mockReturnValue({
      isIPOLocked: mockIsIPOLocked,
      filterProtectedFields: mockFilterProtectedFields,
      isFieldProtected: vi.fn().mockResolvedValue({ isProtected: false }),
    }),
  };
});

vi.mock('../../src/services/data-persister.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/data-persister.js')>();
  return {
    ...actual,
    recordDocumentSourceHints: mockRecordHints,
    upsertIPO: vi.fn().mockResolvedValue('ipo-upserted-id'),
  };
});

vi.mock('../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({
    invalidateAfterScrape: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/scraper-metrics-tracker.js', () => ({
  ScraperMetricsTracker: vi.fn().mockImplementation(() => ({
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    shouldSendAlert: vi.fn().mockResolvedValue({ sendAlert: false, reason: null }),
    getMetrics: vi.fn().mockResolvedValue({ success: 0, failure: 0, rate: 100 }),
    getConsecutiveFailures: vi.fn().mockResolvedValue(0),
    markAlertSent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/alerting-service.js', () => ({
  AlertingService: vi.fn().mockImplementation(() => ({
    getRecentErrors: vi.fn().mockReturnValue([]),
    sendAlert: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/data-consolidation-orchestrator.js', () => ({
  DataConsolidationOrchestrator: vi.fn().mockImplementation(() => ({
    consolidatedUpsertIPO: mockConsolidatedUpsert,
  })),
}));

vi.mock('../../src/services/scraper-failure-tracker.js', () => ({
  scraperFailureTracker: { recordSuccess: vi.fn(), recordFailure: vi.fn() },
}));

vi.mock('../../src/services/selector-degradation-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/services/selector-degradation-monitor.js')
  >();
  return {
    ...actual,
    evaluateAndRecordDegradation: vi
      .fn()
      .mockResolvedValue({ coldStart: true, degraded: false, reasons: [] }),
  };
});

const COMPANY = 'Acme Industries Limited';
const VERIFIER = 'https://www.chittorgarh.com/ipo/acme-ipo/9999/';

async function runOnce() {
  const { BaseScraperOrchestrator } = await import('../../src/base/BaseScraperOrchestrator.js');

  const raw = {
    companyName: 'Acme Industries Limited',
    offeringType: 'IPO',
    segment: 'MAINBOARD',
    status: 'UPCOMING',
    verifierUrl: VERIFIER,
  };

  class TestOrchestrator extends BaseScraperOrchestrator<any> {
    protected getScraperName() {
      return 'CHITTORGARH' as const;
    }
    protected async scrapeData() {
      return { ipos: [raw], subscriptions: [] };
    }
    protected validateIPO(ipo: any) {
      return { success: true as const, data: ipo };
    }
  }

  return new TestOrchestrator().run();
}

describe('T-403 r5 Class 2: the verifier-URL hint is written on EVERY exit of processIPO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsIPOLocked.mockResolvedValue(false);
    mockUpdate.mockResolvedValue({ id: 'ipo-upserted-id' });
    mockConsolidatedUpsert.mockResolvedValue({
      ipoId: 'ipo-consolidated-id',
      isNew: true,
      skipped: false,
      locked: false,
    });
  });

  for (const consolidation of [true, false]) {
    describe(`ENABLE_DATA_CONSOLIDATION = ${consolidation}`, () => {
      beforeEach(() => {
        flags.ENABLE_DATA_CONSOLIDATION = consolidation;
      });

      it('writes the hint for a NEW IPO', async () => {
        mockFindBySlug.mockResolvedValue(null);
        mockFindByNormalizedName.mockResolvedValue(null);

        await runOnce();

        expect(mockRecordHints).toHaveBeenCalledWith(
          expect.anything(),
          consolidation ? 'ipo-consolidated-id' : 'ipo-upserted-id',
          expect.objectContaining({ verifierUrl: VERIFIER })
        );
      }, 20000);

      it('writes the hint for an EXISTING IPO whose every field is protected', async () => {
        // This exit returns before the upsert. The hint is not part of the
        // protected payload - it records where this IPO's documents live - so
        // the early return must not swallow it.
        mockFindBySlug.mockResolvedValue({ id: 'ipo-existing-id', companyName: COMPANY });
        mockFindByNormalizedName.mockResolvedValue({
          id: 'ipo-existing-id',
          companyName: COMPANY,
        });
        mockFilterProtectedFields.mockResolvedValue({ filtered: {} });

        await runOnce();

        expect(mockRecordHints).toHaveBeenCalledWith(
          expect.anything(),
          'ipo-existing-id',
          expect.objectContaining({ verifierUrl: VERIFIER })
        );
      }, 20000);
    });
  }
});

