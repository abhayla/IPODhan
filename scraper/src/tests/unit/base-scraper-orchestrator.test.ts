/**
 * Unit Tests: BaseScraperOrchestrator
 *
 * Tests the template method pattern and protection enforcement.
 * Ensures protection logic cannot be bypassed.
 *
 * @module scraper/src/tests/unit/base-scraper-orchestrator.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../../base/BaseScraperOrchestrator.js';

// Mock dependencies
vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: vi.fn(() => mockRedis),
  IPORepository: vi.fn(() => mockIPORepository),
  SubscriptionRepository: vi.fn(() => mockSubscriptionRepository),
  ScraperLogRepository: vi.fn(() => mockScraperLogRepository),
}));

vi.mock('@web/lib/admin/field-protection-checker', () => ({
  isIPOLocked: vi.fn(),
  isFieldProtected: vi.fn(),
  filterProtectedFields: vi.fn(),
}));

vi.mock('../../services/data-persister.js', () => ({
  upsertIPO: vi.fn(),
  createSubscriptionSnapshot: vi.fn(),
}));

vi.mock('../../scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn(() => mockCacheInvalidator),
}));

vi.mock('../../services/scraper-failure-tracker.js', () => ({
  scraperFailureTracker: mockFailureTracker,
}));

vi.mock('../../services/scraper-metrics-tracker.js', () => ({
  ScraperMetricsTracker: vi.fn(() => mockMetricsTracker),
}));

vi.mock('../../services/alerting-service.js', () => ({
  AlertingService: vi.fn(() => mockAlertingService),
}));

// Mock implementations
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

const mockIPORepository = {
  findBySlug: vi.fn(),
  upsert: vi.fn(),
};

const mockSubscriptionRepository = {
  create: vi.fn(),
};

const mockScraperLogRepository = {
  create: vi.fn(),
  getRecentLogs: vi.fn(() => []),
};

const mockCacheInvalidator = {
  invalidateAfterScrape: vi.fn(),
};

const mockFailureTracker = {
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  shouldTriggerFallback: vi.fn(() => false),
};

const mockMetricsTracker = {
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  shouldSendAlert: vi.fn(() => ({ sendAlert: false })),
  getMetrics: vi.fn(() => ({ rate: 0.95 })),
  getConsecutiveFailures: vi.fn(() => 0),
  markAlertSent: vi.fn(),
};

const mockAlertingService = {
  sendAlert: vi.fn(),
  getRecentErrors: vi.fn(() => []),
};

// Test orchestrator implementation
class TestScraperOrchestrator extends BaseScraperOrchestrator<any, any> {
  private scrapedData: ScrapedData<any, any>;
  private validationResults: { [key: string]: boolean } = {};

  constructor(scrapedData: ScrapedData<any, any>, validationResults: { [key: string]: boolean } = {}) {
    super();
    this.scrapedData = scrapedData;
    this.validationResults = validationResults;
  }

  protected getScraperName(): any {
    return 'TEST';
  }

  protected async scrapeData(): Promise<ScrapedData<any, any>> {
    return this.scrapedData;
  }

  protected validateIPO(ipo: any): { success: boolean; data?: any; error?: any } {
    const isValid = this.validationResults[ipo.companyName] !== false;
    return {
      success: isValid,
      data: isValid ? ipo : undefined,
      error: isValid ? undefined : { issues: ['Validation failed'] }
    };
  }

  protected validateSubscription(sub: any): { success: boolean; data?: any; error?: any } {
    return {
      success: true,
      data: sub
    };
  }
}

describe('BaseScraperOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('run() - Template Method', () => {
    it('should execute complete orchestration flow', async () => {
      const scrapedData = {
        ipos: [
          { companyName: 'Test Company', status: 'OPEN', slug: 'test-company' }
        ],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock protection checks
      const { isIPOLocked, filterProtectedFields } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(false);
      vi.mocked(filterProtectedFields).mockResolvedValue(scrapedData.ipos[0]);

      // Mock upsert
      const { upsertIPO } = await import('../../services/data-persister.js');
      vi.mocked(upsertIPO).mockResolvedValue('test-id');

      const result = await orchestrator.run();

      expect(result.success).toBe(true);
      expect(result.iposProcessed).toBe(1);
      expect(result.iposFailed).toBe(0);
      expect(result.iposSkipped).toBe(0);
    });

    it('should skip IPO when IPO-level lock is enabled', async () => {
      const scrapedData = {
        ipos: [
          { companyName: 'Locked Company', status: 'OPEN', slug: 'locked-company' }
        ],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock existing IPO
      mockIPORepository.findBySlug.mockResolvedValue({
        id: 'locked-ipo-id',
        companyName: 'Locked Company'
      });

      // Mock IPO lock enabled
      const { isIPOLocked } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(true);

      const result = await orchestrator.run();

      expect(result.iposSkipped).toBe(1);
      expect(result.iposProcessed).toBe(0);
      expect(result.iposInserted).toBe(0);
      expect(result.iposUpdated).toBe(0);
    });

    it('should filter protected fields before upsert', async () => {
      const scrapedData = {
        ipos: [
          {
            companyName: 'Protected Company',
            status: 'OPEN',
            slug: 'protected-company',
            lotSize: 3000,
            priceRangeMin: 100,
            priceRangeMax: 120
          }
        ],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock existing IPO
      mockIPORepository.findBySlug.mockResolvedValue({
        id: 'protected-ipo-id',
        companyName: 'Protected Company'
      });

      // Mock protection checks
      const { isIPOLocked, filterProtectedFields } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(false);

      // Simulate filtering out lotSize field
      vi.mocked(filterProtectedFields).mockResolvedValue({
        companyName: 'Protected Company',
        status: 'OPEN',
        slug: 'protected-company',
        priceRangeMin: 100,
        priceRangeMax: 120
        // lotSize removed (protected)
      });

      // Mock upsert
      const { upsertIPO } = await import('../../services/data-persister.js');
      vi.mocked(upsertIPO).mockResolvedValue('protected-ipo-id');

      const result = await orchestrator.run();

      expect(result.fieldsProtected).toBeGreaterThan(0);
      expect(result.iposProcessed).toBe(1);
      expect(vi.mocked(filterProtectedFields)).toHaveBeenCalledWith(
        'protected-ipo-id',
        'ipos',
        expect.objectContaining({ companyName: 'Protected Company' }),
        'TEST'
      );
    });

    it('should skip IPO when all fields are protected', async () => {
      const scrapedData = {
        ipos: [
          {
            companyName: 'Fully Protected Company',
            status: 'OPEN',
            slug: 'fully-protected'
          }
        ],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock existing IPO
      mockIPORepository.findBySlug.mockResolvedValue({
        id: 'fully-protected-id',
        companyName: 'Fully Protected Company'
      });

      // Mock protection checks
      const { isIPOLocked, filterProtectedFields } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(false);

      // All fields filtered out
      vi.mocked(filterProtectedFields).mockResolvedValue({});

      const result = await orchestrator.run();

      expect(result.iposSkipped).toBe(1);
      expect(result.iposProcessed).toBe(0);
    });

    it('should handle validation failures', async () => {
      const scrapedData = {
        ipos: [
          { companyName: 'Invalid Company', status: 'INVALID', slug: 'invalid' }
        ],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData, {
        'Invalid Company': false  // Mark as invalid
      });

      const result = await orchestrator.run();

      expect(result.iposFailed).toBe(1);
      expect(result.iposProcessed).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should process subscriptions for OPEN IPOs', async () => {
      const scrapedData = {
        ipos: [
          { companyName: 'Open IPO', status: 'OPEN', slug: 'open-ipo' }
        ],
        subscriptions: [
          { ipoCompanyName: 'Open IPO', totalSubscription: 5.5 }
        ]
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock protection checks
      const { isIPOLocked, filterProtectedFields, isFieldProtected } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(false);
      vi.mocked(filterProtectedFields).mockResolvedValue(scrapedData.ipos[0]);
      vi.mocked(isFieldProtected).mockResolvedValue({ protected: false, autoProtected: false });

      // Mock upsert
      const { upsertIPO, createSubscriptionSnapshot } = await import('../../services/data-persister.js');
      vi.mocked(upsertIPO).mockResolvedValue('open-ipo-id');
      vi.mocked(createSubscriptionSnapshot).mockResolvedValue(undefined);

      const result = await orchestrator.run();

      expect(result.subscriptionsCreated).toBe(1);
      expect(vi.mocked(createSubscriptionSnapshot)).toHaveBeenCalledWith(
        expect.anything(),
        'open-ipo-id',
        expect.objectContaining({ totalSubscription: 5.5 })
      );
    });

    it('should skip subscriptions when protected', async () => {
      const scrapedData = {
        ipos: [
          { companyName: 'Open IPO', status: 'OPEN', slug: 'open-ipo' }
        ],
        subscriptions: [
          { ipoCompanyName: 'Open IPO', totalSubscription: 5.5 }
        ]
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock existing IPO
      mockIPORepository.findBySlug.mockResolvedValue({
        id: 'open-ipo-id',
        companyName: 'Open IPO'
      });

      // Mock protection checks
      const { isIPOLocked, filterProtectedFields, isFieldProtected } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(false);
      vi.mocked(filterProtectedFields).mockResolvedValue(scrapedData.ipos[0]);

      // Subscription protected
      vi.mocked(isFieldProtected).mockResolvedValue({ protected: true, autoProtected: false });

      // Mock upsert
      const { upsertIPO } = await import('../../services/data-persister.js');
      vi.mocked(upsertIPO).mockResolvedValue('open-ipo-id');

      const result = await orchestrator.run();

      expect(result.subscriptionsSkipped).toBe(1);
      expect(result.subscriptionsCreated).toBe(0);
    });

    it('should log success metrics', async () => {
      const scrapedData = {
        ipos: [
          { companyName: 'Success Company', status: 'UPCOMING', slug: 'success' }
        ],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock protection checks
      const { isIPOLocked, filterProtectedFields } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(false);
      vi.mocked(filterProtectedFields).mockResolvedValue(scrapedData.ipos[0]);

      // Mock upsert
      const { upsertIPO } = await import('../../services/data-persister.js');
      vi.mocked(upsertIPO).mockResolvedValue('success-id');

      await orchestrator.run();

      expect(mockFailureTracker.recordSuccess).toHaveBeenCalledWith('TEST');
      expect(mockMetricsTracker.recordSuccess).toHaveBeenCalledWith('TEST');
      expect(mockScraperLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'TEST',
          status: 'SUCCESS'
        })
      );
    });

    it('should log failure metrics on error', async () => {
      const scrapedData = {
        ipos: [],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Force scrapeData to throw error
      vi.spyOn(orchestrator as any, 'scrapeData').mockRejectedValue(new Error('Scrape failed'));

      const result = await orchestrator.run();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(mockFailureTracker.recordFailure).toHaveBeenCalled();
      expect(mockMetricsTracker.recordFailure).toHaveBeenCalledWith('TEST');
      expect(mockScraperLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'TEST',
          status: 'FAILURE'
        })
      );
    });

    it('should invalidate caches after successful scrape', async () => {
      const scrapedData = {
        ipos: [
          { companyName: 'Company A', status: 'OPEN', slug: 'company-a' },
          { companyName: 'Company B', status: 'UPCOMING', slug: 'company-b' }
        ],
        subscriptions: []
      };

      const orchestrator = new TestScraperOrchestrator(scrapedData);

      // Mock protection checks
      const { isIPOLocked, filterProtectedFields } = await import('@web/lib/admin/field-protection-checker');
      vi.mocked(isIPOLocked).mockResolvedValue(false);
      vi.mocked(filterProtectedFields).mockImplementation(async (_, __, data) => data);

      // Mock upsert
      const { upsertIPO } = await import('../../services/data-persister.js');
      vi.mocked(upsertIPO).mockResolvedValue('test-id');

      await orchestrator.run();

      expect(mockCacheInvalidator.invalidateAfterScrape).toHaveBeenCalledWith(
        'TEST',
        expect.arrayContaining(['company-a', 'company-b'])
      );
    });
  });
});
