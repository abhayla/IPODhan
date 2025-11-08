# Phases 1.8, 1.9, 2.0 - Implementation Roadmap

**Date**: 2025-11-07
**Status**: 📋 **PLANNING**
**Prerequisite**: ✅ Phase 1.7 Complete (91.1% test coverage)

---

## Overview

This document outlines the implementation plan for the final phases of the data consolidation system:

- **Phase 1.8**: Integration with Scrapers (4-6 hours)
- **Phase 1.9**: Production Deployment (2-3 hours)
- **Phase 2.0**: Monitoring & Optimization (3-4 hours)

**Total Estimated Effort**: 9-13 hours

---

## Phase 1.8: Integration with Scrapers

**Goal**: Integrate data consolidation service with existing scrapers
**Estimated Effort**: 4-6 hours
**Priority**: 🔴 HIGH

### 1.8.1: Update BaseScraperOrchestrator (1-2 hours)

**Current Flow:**
```
Scrape → Validate → Check Protection → Upsert → Invalidate Cache
```

**New Flow:**
```
Scrape → Validate → Check Protection → **Consolidate** → Upsert → Invalidate Cache
```

**Implementation:**

1. **Add consolidation service to BaseScraperOrchestrator**
   ```typescript
   // File: scraper/src/base/BaseScraperOrchestrator.ts

   import { DataConsolidationService } from '../services/data-consolidation-service.js';
   import { FieldSourcesRepository } from '../repositories/field-sources-repository.js';
   import { DataConflictsRepository } from '../repositories/data-conflicts-repository.js';

   export abstract class BaseScraperOrchestrator<T, S> {
     protected consolidationService: DataConsolidationService;

     constructor(protected db: Database, protected redis: Redis) {
       const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
       const conflictsRepo = new DataConflictsRepository(db, redis);
       this.consolidationService = new DataConsolidationService(
         fieldSourcesRepo,
         conflictsRepo
       );
     }
   }
   ```

2. **Add consolidateIPOData method**
   ```typescript
   protected async consolidateIPOData(
     ipoId: string,
     tableName: string,
     incomingData: Record<string, any>,
     source: ScraperSource,
     existingData?: Record<string, any>
   ): Promise<ConsolidationResult> {
     return this.consolidationService.consolidateIPOData({
       ipoId,
       tableName,
       incomingData,
       source,
       existingData,
       confidence: this.getSourceConfidence(source),
       scrapedAt: new Date(),
     });
   }
   ```

3. **Integrate into processIPO method**
   ```typescript
   protected async processIPO(ipo: T): Promise<void> {
     // 1. Validate
     const validation = this.validateIPO(ipo);
     if (!validation.success) {
       this.logError('Validation failed', validation.error);
       return;
     }

     // 2. Check protection
     const protected = await this.checkProtection(ipo.slug);
     if (protected.isLocked) {
       this.logSkipped('IPO locked', ipo.slug);
       return;
     }

     // 3. Get existing data
     const existing = await this.repository.findBySlug(ipo.slug);

     // 4. Consolidate data (NEW!)
     const consolidationResult = await this.consolidateIPOData(
       existing?.id || this.generateTempId(),
       'ipos',
       this.filterProtectedFields(validation.data, protected.fields),
       this.getScraperName(),
       existing
     );

     // 5. Upsert consolidated data
     await this.repository.upsert({
       ...consolidationResult.consolidatedData,
       slug: ipo.slug,
     });

     // 6. Log conflicts
     if (consolidationResult.conflictsDetected > 0) {
       this.logConflicts(consolidationResult);
     }
   }
   ```

**Files to Modify:**
- `scraper/src/base/BaseScraperOrchestrator.ts` (add consolidation)
- `scraper/src/scrapers/nse-scraper-orchestrator-v2.ts` (verify integration)
- `scraper/src/scrapers/bse-scraper-orchestrator-v2.ts` (verify integration)

---

### 1.8.2: Add Source Confidence Mapping (30 mins)

**Create source priority configuration:**

```typescript
// File: scraper/src/config/source-confidence.ts

export const SOURCE_CONFIDENCE: Record<ScraperSource, number> = {
  ADMIN: 100,      // Highest - manual entry
  DRHP: 95,        // Very high - official documents
  NSE: 90,         // High - primary exchange
  BSE: 85,         // High - secondary exchange
  MONEYCONTROL: 75, // Medium - reliable aggregator
  CHITTORGARH: 70,  // Medium - community data
  INVESTORGAIN: 70, // Medium - GMP data
  API_FALLBACK: 50, // Low - fallback only
};

export function getSourceConfidence(source: ScraperSource): number {
  return SOURCE_CONFIDENCE[source] ?? 50;
}
```

---

### 1.8.3: Enable Consolidation by Default (15 mins)

**Update feature flags:**

```typescript
// File: scraper/src/config/feature-flags.ts

export const FEATURE_FLAGS = {
  // ... existing flags

  // Data Consolidation (ENABLE for Phase 1.8)
  ENABLE_DATA_CONSOLIDATION: true,        // Enable consolidation service
  ENABLE_SOURCE_TRACKING: true,           // Track field sources
  ENABLE_CONFLICT_DETECTION: true,        // Detect conflicts
  SHADOW_MODE: false,                     // Disable shadow mode (write to DB)

  // Rollout percentages
  CONSOLIDATION_PERCENTAGE: 100,          // 100% rollout
  SOURCE_TRACKING_PERCENTAGE: 100,
  CONFLICT_DETECTION_PERCENTAGE: 100,
};
```

---

### 1.8.4: Integration Testing (2-3 hours)

**Create integration tests for scraper + consolidation:**

```typescript
// File: scraper/tests/integration/scraper-consolidation.test.ts

describe('Scraper + Consolidation Integration', () => {
  it('NSE scraper should consolidate data correctly', async () => {
    // 1. Run NSE scraper
    const result = await runNSEScraper();

    // 2. Verify consolidation happened
    expect(result.consolidated).toBeGreaterThan(0);

    // 3. Check field sources were tracked
    const fieldSources = await fieldSourcesRepo.findByIPOId(testIPOId);
    expect(fieldSources.length).toBeGreaterThan(0);
    expect(fieldSources[0].source).toBe('NSE');
  });

  it('BSE scraper should detect conflicts with NSE', async () => {
    // 1. Run NSE scraper first
    await runNSEScraper();

    // 2. Run BSE scraper (different data)
    await runBSEScraper();

    // 3. Verify conflicts were detected
    const conflicts = await conflictsRepo.findByIPOId(testIPOId);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('Admin data should override scraper data', async () => {
    // 1. Run scraper
    await runNSEScraper();

    // 2. Update via admin (source: ADMIN)
    await consolidationService.consolidateIPOData({
      ipoId: testIPOId,
      tableName: 'ipos',
      incomingData: { lot_size: 999 },
      source: 'ADMIN',
      confidence: 100,
    });

    // 3. Run scraper again
    await runNSEScraper();

    // 4. Verify admin data was NOT overridden
    const ipo = await ipoRepo.findById(testIPOId);
    expect(ipo.lot_size).toBe(999);
  });
});
```

**Test Coverage Target**: 85%+ on integration paths

---

### 1.8.5: Documentation Updates (30 mins)

**Update scraper documentation:**

1. **Architecture diagram** showing consolidation flow
2. **Source priority matrix** (ADMIN > DRHP > NSE > BSE)
3. **Conflict resolution examples**
4. **Field source tracking guide**

**Files to Update:**
- `scraper/README.md` (add consolidation section)
- `docs/08-scraping/SCRAPING_STRATEGY.md` (update architecture)
- `docs/08-scraping/DATA_FLOW.md` (new diagram)

---

## Phase 1.9: Production Deployment

**Goal**: Deploy consolidation-enabled scrapers to production
**Estimated Effort**: 2-3 hours
**Priority**: 🟡 MEDIUM

### 1.9.1: Pre-Deployment Checklist (30 mins)

**Verify:**
- ✅ All tests passing (91.1%+)
- ✅ Feature flags configured correctly
- ✅ Database migrations applied
- ✅ Redis connection configured
- ✅ Error logging enabled
- ✅ Performance benchmarks acceptable

**Run:**
```bash
cd scraper
npm run test:unit        # Verify 91.1%+ pass rate
npm run test:integration # Verify integration tests
npm run build            # Verify build succeeds
```

---

### 1.9.2: Database Migration (15 mins)

**Ensure these tables exist in production:**

```bash
# Run migrations
cd ../web
npm run db:migrate

# Verify tables
psql -d ipodhan_prod -c "\dt field_sources"
psql -d ipodhan_prod -c "\dt data_conflicts"
```

**Tables Required:**
- `field_sources` (track data sources)
- `data_conflicts` (log conflicts)

---

### 1.9.3: Gradual Rollout Strategy (1-2 hours)

**Phase 1.9.3.1: Shadow Mode (30 mins)**
```typescript
// Test in production without DB writes
FEATURE_FLAGS.SHADOW_MODE = true;
FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE = 100;

// Monitor logs for 1-2 hours
// Verify no errors, conflicts detected correctly
```

**Phase 1.9.3.2: 10% Rollout (30 mins)**
```typescript
// Enable for 10% of IPOs
FEATURE_FLAGS.SHADOW_MODE = false;
FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE = 10;

// Monitor for 2-4 hours
// Check for errors, performance impact
```

**Phase 1.9.3.3: 50% Rollout (30 mins)**
```typescript
FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE = 50;

// Monitor for 12-24 hours
```

**Phase 1.9.3.4: 100% Rollout (30 mins)**
```typescript
FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE = 100;

// Full production rollout
```

---

### 1.9.4: Monitoring Setup (30 mins)

**Add monitoring for:**

1. **Consolidation metrics:**
   - Fields consolidated per scraper run
   - Conflicts detected per run
   - Average consolidation time

2. **Error tracking:**
   - Failed consolidations
   - Repository errors
   - Validation failures

3. **Alerts:**
   - Consolidation time > 500ms (WARNING)
   - Conflicts > 10 per IPO (WARNING)
   - Consolidation errors > 5% (CRITICAL)

---

## Phase 2.0: Monitoring & Optimization

**Goal**: Production monitoring and performance optimization
**Estimated Effort**: 3-4 hours
**Priority**: 🟢 LOW (post-deployment)

### 2.0.1: Performance Monitoring (1 hour)

**Add performance metrics:**

```typescript
// File: scraper/src/services/consolidation-metrics.ts

export class ConsolidationMetrics {
  static async recordConsolidation(result: ConsolidationResult) {
    await redis.hincrby('metrics:consolidation', 'total', 1);
    await redis.hincrby('metrics:consolidation', 'conflicts', result.conflictsDetected);
    await redis.hset('metrics:consolidation', 'avg_time_ms', result.performanceMs);
  }

  static async getMetrics(): Promise<ConsolidationMetrics> {
    const data = await redis.hgetall('metrics:consolidation');
    return {
      totalConsolidations: parseInt(data.total),
      totalConflicts: parseInt(data.conflicts),
      avgTimeMs: parseFloat(data.avg_time_ms),
      conflictRate: parseFloat(data.conflicts) / parseFloat(data.total),
    };
  }
}
```

---

### 2.0.2: Conflict Dashboard (1 hour)

**Create admin dashboard for conflicts:**

```typescript
// Route: /admin/consolidation/conflicts
// Shows:
// - Recent conflicts (last 24h)
// - Conflicts by severity (CRITICAL, WARNING, INFO)
// - Conflicts by field name (top 10)
// - Conflicts by source (NSE vs BSE)
// - Resolution statistics
```

---

### 2.0.3: Performance Optimization (1-2 hours)

**Optimize slow queries:**

1. **Add indexes:**
   ```sql
   CREATE INDEX idx_field_sources_ipo_table
   ON field_sources(ipo_id, table_name);

   CREATE INDEX idx_data_conflicts_ipo_severity
   ON data_conflicts(ipo_id, severity);
   ```

2. **Batch processing:**
   - Consolidate multiple fields in single transaction
   - Use bulk upsert for field sources

3. **Cache optimization:**
   - Cache field sources for 5 minutes
   - Cache conflict rules permanently

**Performance Targets:**
- Consolidation time: p95 < 200ms
- Conflict detection: p95 < 100ms
- Database queries: p95 < 50ms

---

### 2.0.4: Documentation (30 mins)

**Create:**
1. **Runbook** for production issues
2. **Conflict resolution guide** for admins
3. **Performance tuning guide**
4. **Monitoring dashboard guide**

---

## Success Criteria

### Phase 1.8 Success Criteria
- ✅ All scrapers use consolidation service
- ✅ 85%+ integration test coverage
- ✅ Source tracking working for all scrapers
- ✅ Conflicts detected and logged correctly

### Phase 1.9 Success Criteria
- ✅ Production deployment successful
- ✅ No increase in error rate (< 2%)
- ✅ Performance acceptable (< 500ms p95)
- ✅ 100% rollout achieved

### Phase 2.0 Success Criteria
- ✅ Monitoring dashboard live
- ✅ Performance optimizations applied
- ✅ Conflict resolution workflow documented
- ✅ No performance regressions

---

## Risk Mitigation

### High-Risk Areas

**1. Data Loss Risk**
- **Mitigation**: Shadow mode testing, gradual rollout
- **Rollback**: Feature flag disable (instant)

**2. Performance Degradation**
- **Mitigation**: Performance benchmarks, caching
- **Rollback**: Reduce CONSOLIDATION_PERCENTAGE

**3. Conflict Resolution Errors**
- **Mitigation**: Comprehensive testing, admin override
- **Rollback**: Fix priority matrix, redeploy

---

## Timeline

**Week 1:**
- Day 1-2: Phase 1.8 (Integration)
- Day 3: Phase 1.9 (Deployment - shadow mode)
- Day 4: Phase 1.9 (Deployment - gradual rollout)
- Day 5: Phase 1.9 (Deployment - 100% rollout)

**Week 2:**
- Day 1-2: Phase 2.0 (Monitoring & optimization)
- Day 3: Documentation & final testing
- Day 4-5: Buffer for issues

**Total Duration**: 7-10 days (excluding buffer)

---

## Next Steps

**Immediate Actions:**
1. Review this roadmap
2. Approve Phase 1.8 implementation plan
3. Schedule integration testing
4. Prepare production environment

**Questions to Answer:**
1. Which scraper to integrate first? (Recommendation: NSE)
2. Shadow mode duration? (Recommendation: 2-4 hours)
3. Rollout schedule? (Recommendation: 10% → 50% → 100% over 24h)

---

**Created by**: Claude Code
**Date**: 2025-11-07
**Status**: 📋 **AWAITING APPROVAL**
**Next Phase**: Phase 1.8 Implementation
