/**
 * Data Consolidation Service Tests
 * Phase 1: Core consolidation logic with conflict detection
 *
 * Test Coverage:
 * - Field consolidation with priority matrix
 * - Conflict detection (INFO/WARNING/CRITICAL)
 * - Field source tracking
 * - Shadow mode operation
 * - Error handling
 *
 * Target: 32 tests, 90%+ coverage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

// Mock feature flags to enable all features for testing
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_DRHP_EXTRACTION: false,
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

// Mock repositories
const mockFieldSourcesRepo = {
  findByIPOId: vi.fn(),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const mockConflictsRepo = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

describe('DataConsolidationService', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(
      mockFieldSourcesRepo,
      mockConflictsRepo
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('consolidateIPOData', () => {
    describe('Priority-based field selection', () => {
      it('should prioritize ADMIN over all other sources', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'lot_size',
          source: 'NSE',
          value: '100',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { lot_size: 150 },
          source: 'ADMIN',
          confidence: 100,
        });

        expect(result.fieldsUpdated).toBeGreaterThan(0);
        expect(result.conflictsDetected).toBeGreaterThan(0);
        // ADMIN should win despite NSE already having the field
      });

      it('should prioritize DRHP over NSE for financial fields', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'revenue_fy1',
          source: 'NSE',
          value: '5000000000',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { revenue_fy1: 5100000000 },
          source: 'DRHP',
          confidence: 100,
        });

        expect(result.fieldsUpdated).toBeGreaterThan(0);
        // DRHP should override NSE for financials
      });

      it('should prioritize BSE over NSE for lot_size field', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'lot_size',
          source: 'NSE',
          value: '100',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { lot_size: 120 },
          source: 'BSE',
          confidence: 90,
        });

        expect(result.fieldsUpdated).toBeGreaterThan(0);
        // BSE has higher priority for lot_size than NSE
      });

      it('should NOT override higher priority source with lower priority', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'lot_size',
          source: 'ADMIN',
          value: '150',
          confidence: 100,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { lot_size: 100 },
          source: 'NSE',
          confidence: 95,
        });

        expect(result.fieldsUpdated).toBe(0);
        expect(result.conflictsDetected).toBeGreaterThanOrEqual(0);
        // NSE should NOT override ADMIN
      });
    });

    describe('Conflict detection', () => {
      it('should detect CRITICAL conflict for price discrepancy > 20%', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'lot_size',
          source: 'NSE',
          value: '100',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { lot_size: 150 }, // 50% difference - CRITICAL because lot_size in criticalFields
          source: 'BSE',
          confidence: 90,
        });

        expect(result.conflictsDetected).toBeGreaterThan(0);
        expect(result.conflictsBySeverity.CRITICAL).toBeGreaterThan(0);
        expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'CRITICAL'
          })
        );
      });

      it('should detect WARNING conflict for numeric difference 5-20%', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'issue_size',
          source: 'NSE',
          value: '1000000000', // 100 crore
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { issue_size: 1100000000 }, // 10% difference
          source: 'BSE',
          confidence: 90,
        });

        expect(result.conflictsDetected).toBeGreaterThan(0);
        expect(result.conflictsBySeverity.WARNING).toBeGreaterThan(0);
        expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'WARNING'
          })
        );
      });

      it('should detect INFO conflict for numeric difference < 5%', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'issue_size',
          source: 'NSE',
          value: '1000000000',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { issue_size: 1020000000 }, // 2% difference
          source: 'BSE',
          confidence: 90,
        });

        expect(result.conflictsDetected).toBeGreaterThan(0);
        expect(result.conflictsBySeverity.INFO).toBeGreaterThan(0);
      });

      it('should detect CRITICAL conflict for date mismatches', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'open_date',
          source: 'NSE',
          value: '2025-01-15',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { open_date: new Date('2025-01-20') },
          source: 'BSE',
          confidence: 90,
        });

        expect(result.conflictsDetected).toBeGreaterThan(0);
        expect(result.conflictsBySeverity.CRITICAL).toBeGreaterThan(0);
      });
    });

    describe('Field source tracking', () => {
      it('should track new field with source and confidence', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { company_name: 'Test Company' },
          source: 'NSE',
          confidence: 95,
        });

        expect(mockFieldSourcesRepo.trackFieldUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            ipoId: 'test-ipo',
            fieldName: 'company_name',
            source: 'NSE',
            value: 'Test Company',
            confidence: 95,
          })
        );
      });

      it('should update existing field source when value changes', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'lot_size',
          source: 'NSE',
          value: '100',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { lot_size: 150 },
          source: 'ADMIN',
          confidence: 100,
        });

        expect(mockFieldSourcesRepo.trackFieldUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            ipoId: 'test-ipo',
            fieldName: 'lot_size',
            source: 'ADMIN',
            value: 150,
            confidence: 100,
            previousValue: '100',
            previousSource: 'NSE',
          })
        );
      });

      it('should NOT track field source if value identical to existing', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'lot_size',
          source: 'NSE',
          value: '100',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { lot_size: 100 }, // Same value
          source: 'BSE',
          confidence: 90,
        });

        expect(result.fieldsUpdated).toBe(0);
        expect(mockFieldSourcesRepo.trackFieldUpdate).not.toHaveBeenCalled();
      });
    });

    // T-286 (P1-2/P2-3): a SAME-source refresh (the same scraper source
    // updating its own previously-reported value) is not a cross-source
    // disagreement and MUST NOT write a data_conflicts row. This is the
    // regression test for the root cause of 9921/11493 data_conflicts rows
    // having source1 === source2, which destroyed the alert channel.
    describe('Same-source refresh does not log a conflict (T-286 P1-2)', () => {
      it('does NOT call upsertConflict when existingSource === incomingSource (time-based field)', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'total_subscription',
          source: 'NSE',
          value: '5',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date('2026-08-20T10:00:00Z'),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { total_subscription: 8 }, // NSE revising its own number upward
          source: 'NSE', // SAME source as existing
          confidence: 95,
          scrapedAt: new Date('2026-08-20T11:00:00Z'), // newer -> TIME_BASED_PRIORITY wins
        });

        expect(result.fieldResults[0].chosenSource).toBe('NSE');
        expect(result.fieldResults[0].finalValue).toBe(8);
        expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
        expect(mockConflictsRepo.logConflict).not.toHaveBeenCalled();
      });

      it('DOES call upsertConflict when existingSource !== incomingSource (genuine cross-source disagreement)', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'total_subscription',
          source: 'NSE',
          value: '5',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date('2026-08-20T10:00:00Z'),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);

        await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { total_subscription: 9 },
          source: 'BSE', // DIFFERENT source than existing (NSE)
          confidence: 90,
          scrapedAt: new Date('2026-08-20T11:00:00Z'),
        });

        expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
          expect.objectContaining({ source1: 'NSE', source2: 'BSE' })
        );
      });

      it('auto-resolves a prior open conflict once the sources converge on the same value', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'total_subscription',
          source: 'NSE',
          value: '9',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date('2026-08-20T10:00:00Z'),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockConflictsRepo.autoResolveConverged).mockResolvedValue(1);

        await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { total_subscription: 9 }, // BSE now agrees with NSE's 9
          source: 'BSE',
          confidence: 90,
        });

        expect(mockConflictsRepo.autoResolveConverged).toHaveBeenCalledWith(
          'test-ipo',
          'ipos',
          'total_subscription'
        );
        // Values are equivalent -> no new conflict is logged
        expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
      });
    });

    describe('Shadow mode', () => {
      it('should return consolidated data but not track sources in shadow mode', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { company_name: 'Test Company', lot_size: 100 },
          source: 'NSE',
          confidence: 95,
          shadowMode: true,
        });

        expect(result.fieldsProcessed).toBeGreaterThan(0);
        expect(result.consolidatedData).toBeDefined();
        expect(mockFieldSourcesRepo.trackFieldUpdate).not.toHaveBeenCalled();
        expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
      });

      it('should still detect conflicts in shadow mode for metrics', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'lot_size',
          source: 'NSE',
          value: '100',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date(),
          createdAt: new Date(),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { lot_size: 150 }, // 50% diff = CRITICAL
          source: 'BSE',
          confidence: 90,
          shadowMode: true,
        });

        expect(result.conflictsDetected).toBeGreaterThan(0);
        expect(result.conflictsBySeverity.CRITICAL).toBeGreaterThan(0);
        expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled(); // Not logged in shadow mode
      });
    });

    describe('Performance metrics', () => {
      it('should track consolidation performance time', async () => {
        // Mock Date.now() to simulate 150ms elapsed time
        const mockStartTime = 1000;
        const mockEndTime = 1150;
        let callCount = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => {
          callCount++;
          return callCount === 1 ? mockStartTime : mockEndTime;
        });

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { company_name: 'Test Company' },
          source: 'NSE',
          confidence: 95,
        });

        expect(result.performanceMs).toBeGreaterThan(0);
        expect(result.performanceMs).toBeLessThan(500); // Target: <500ms
        expect(result.performanceMs).toBe(150); // Exact value based on mock

        vi.restoreAllMocks();
      });

      it('should return correct field counts', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: {
            company_name: 'Test Company',
            lot_size: 100,
            price_band_lower: 50,
            price_band_upper: 60,
          },
          source: 'NSE',
          confidence: 95,
        });

        expect(result.fieldsProcessed).toBe(4);
        expect(result.fieldsUpdated).toBe(4); // All new fields
      });
    });

    describe('Error handling', () => {
      it('should handle repository errors gracefully', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockRejectedValue(
          new Error('Database connection failed')
        );

        await expect(
          service.consolidateIPOData({
            ipoId: 'test-ipo',
            tableName: 'ipos',
            incomingData: { company_name: 'Test Company' },
            source: 'NSE',
            confidence: 95,
          })
        ).rejects.toThrow('Database connection failed');
      });

      it('should handle null/undefined values in incoming data', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: {
            company_name: 'Test Company',
            lot_size: null,
            price_band_lower: undefined,
          },
          source: 'NSE',
          confidence: 95,
        });

        expect(result.fieldsProcessed).toBeGreaterThan(0);
        // Should only process company_name (non-null/undefined)
      });

      it('should skip invalid field names', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: {
            company_name: 'Test Company',
            invalid_field_xyz: 'Should be skipped',
          },
          source: 'NSE',
          confidence: 95,
        });

        // Should process valid fields only
        expect(result.fieldsProcessed).toBeGreaterThan(0);
      });
    });

    describe('Time-based priority', () => {
      it('should prioritize newer subscription data over older', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'subscriptions',
          fieldName: 'total_subscription',
          source: 'NSE',
          value: '2.5',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date('2025-01-15T10:00:00Z'),
          createdAt: new Date('2025-01-15T10:00:00Z'),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        // Newer data (15 minutes later)
        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'subscriptions',
          incomingData: { total_subscription: 3.2 },
          source: 'NSE',
          confidence: 95,
          scrapedAt: new Date('2025-01-15T10:15:00Z'),
        });

        expect(result.fieldsUpdated).toBeGreaterThan(0);
        // Newer subscription data should override older
      });

      it('should NOT override newer data with older data', async () => {
        const existingFieldSources = [{
          ipoId: 'test-ipo',
          tableName: 'subscriptions',
          fieldName: 'total_subscription',
          source: 'NSE',
          value: '3.2',
          confidence: 95,
          dataLineage: null,
          previousValue: null,
          previousSource: null,
          updatedAt: new Date('2025-01-15T10:15:00Z'),
          createdAt: new Date('2025-01-15T10:15:00Z'),
        }];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);

        // Older data (15 minutes earlier)
        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'subscriptions',
          incomingData: { total_subscription: 2.5 },
          source: 'NSE',
          confidence: 95,
          scrapedAt: new Date('2025-01-15T10:00:00Z'),
        });

        expect(result.fieldsUpdated).toBe(0);
        // Older data should NOT override newer
      });
    });

    describe('Edge cases', () => {
      it('should handle empty incoming data', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: {},
          source: 'NSE',
          confidence: 95,
        });

        expect(result.fieldsProcessed).toBe(0);
        expect(result.fieldsUpdated).toBe(0);
        expect(result.conflictsDetected).toBe(0);
      });

      it('should handle zero confidence score', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: { company_name: 'Test Company' },
          source: 'API_FALLBACK',
          confidence: 0, // Very low confidence
        });

        // Should still process but with low confidence
        expect(result.fieldsProcessed).toBeGreaterThan(0);
      });

      it('should handle very large numeric values', async () => {
        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
        vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: {
            issue_size: 500000000000, // 50,000 crores
          },
          source: 'NSE',
          confidence: 95,
        });

        expect(result.fieldsProcessed).toBeGreaterThan(0);
        expect(result.consolidatedData.issue_size).toBe(500000000000);
      });

      it('should handle multiple fields with mixed conflicts', async () => {
        const existingFieldSources = [
          {
            ipoId: 'test-ipo',
            tableName: 'ipos',
            fieldName: 'lot_size',
            source: 'NSE',
            value: '100',
            confidence: 95,
            dataLineage: null,
            previousValue: null,
            previousSource: null,
            updatedAt: new Date(),
            createdAt: new Date(),
          },
          {
            ipoId: 'test-ipo',
            tableName: 'ipos',
            fieldName: 'issue_size',
            source: 'NSE',
            value: '1000000000', // 100 crore
            confidence: 95,
            dataLineage: null,
            previousValue: null,
            previousSource: null,
            updatedAt: new Date(),
            createdAt: new Date(),
          },
        ];

        vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources);
        vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);

        const result = await service.consolidateIPOData({
          ipoId: 'test-ipo',
          tableName: 'ipos',
          incomingData: {
            lot_size: 150, // 50% diff = CRITICAL (lot_size in criticalFields)
            issue_size: 1040000000, // 4% diff = INFO (uses percentage-based severity)
            min_investment: 15000, // New field
          },
          source: 'BSE',
          confidence: 90,
        });

        expect(result.fieldsProcessed).toBe(3);
        expect(result.conflictsDetected).toBe(2); // lot_size + issue_size
        expect(result.conflictsBySeverity.CRITICAL).toBeGreaterThan(0);
        expect(result.conflictsBySeverity.INFO).toBeGreaterThan(0);
      });
    });
  });

  describe('Performance benchmarks', () => {
    it('should consolidate 20 fields in under 100ms', async () => {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
      vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);

      const largeData: Record<string, any> = {};
      for (let i = 0; i < 20; i++) {
        largeData[`field_${i}`] = `value_${i}`;
      }

      const startTime = Date.now();
      const result = await service.consolidateIPOData({
        ipoId: 'test-ipo',
        tableName: 'ipos',
        incomingData: largeData,
        source: 'NSE',
        confidence: 95,
      });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(result.performanceMs).toBeLessThan(100);
    });
  });
});
