# 📚 MASTER PLAN: IPODhan Data Flow Architecture Fix
## Complete Implementation Strategy with DRHP Integration & Smart Consolidation

**Document Version**: 2.0
**Last Updated**: 2025-11-07
**Status**: Ready for Implementation
**Estimated Effort**: 184 hours (23 working days)

---

## 🎯 EXECUTIVE OVERVIEW

This comprehensive plan addresses the complete data flow pipeline from IPO detection through UI display, based on deep analysis of 15+ files, 8,000+ lines of code, and identification of critical architectural gaps.

### Vision Statement
Transform the current "NSE wins all" basic merging into an intelligent, multi-source data consolidation pipeline with DRHP integration, field-specific priority, confidence scoring, and zero data conflicts.

### Key Problems Solved
1. **Data Conflicts** - Multiple scrapers overwriting each other randomly
2. **No DRHP Integration** - 94% accurate extractor not connected to pipeline
3. **No Source Tracking** - Can't tell which scraper provided which data
4. **Race Conditions** - Simultaneous scrapers creating duplicate IPOs
5. **Wrong Priority Logic** - GMP from NSE instead of specialist Chittorgarh
6. **Late Detection** - IPOs discovered after they open, missing DRHP window

---

## 📊 PART 1: CURRENT STATE ANALYSIS

### How Data "Merging" Works Today

**Location**: `scraper/src/services/data-persister.ts` (Lines 174-318)

```typescript
// Current implementation - NSE always wins
if (existingIPO.issueSize !== ipoData.issueSize && source === 'BSE') {
  logger.warn('NSE vs BSE issue size differs, prioritizing NSE data');
  delete ipoData.issueSize; // BSE data SILENTLY DISCARDED!
}
```

### Critical Issues Identified

| Issue | Current State | Impact | Severity |
|-------|--------------|---------|----------|
| **No Real Merging** | NSE wins, BSE deleted | Data loss, wrong values | 🔴 CRITICAL |
| **Race Conditions** | Last write wins | Duplicate IPOs, corruption | 🔴 CRITICAL |
| **No Source Tracking** | Unknown data origin | No accountability | 🔴 CRITICAL |
| **DRHP Manual** | 94% accuracy unused | 80% manual data entry | 🟡 HIGH |
| **Late Detection** | Found when open | Can't download DRHP early | 🟡 HIGH |
| **No Confidence Score** | All data equal | Can't rank reliability | 🟡 HIGH |
| **Wrong Priorities** | NSE for all fields | GMP wrong, lot size wrong | 🟡 HIGH |
| **No Normalization** | "₹500 Cr" ≠ "500 Crores" | False conflicts | 🟢 MEDIUM |

---

## 🎯 PART 2: IDEAL DATA FLOW ARCHITECTURE

### Complete End-to-End Flow

```
[IPO DETECTION LAYER] - T-60 to T-0 Days
├─ SEBI Monitor (T-60) → DRHP Filing → Early Detection
├─ Exchange APIs (T-30) → IPO Announced → Download DRHP
└─ Real-time RSS (T-0) → Status Changes → Instant Updates
                ↓
[DATA COLLECTION LAYER]
├─ DRHP Extractor → Financial Data (94% accuracy)
├─ NSE Scraper → Real-time IPO Data
├─ BSE Scraper → Supplementary Data
├─ Moneycontrol → Ratings & Analysis
└─ Chittorgarh → GMP Specialist Data
                ↓
[DATA CONSOLIDATION SERVICE] ← NEW CRITICAL COMPONENT
├─ Field Normalization (Currency, Dates, Names)
├─ Source Priority Matrix (Per Field)
├─ Confidence Scoring (0-100%)
├─ Conflict Detection & Resolution
└─ Smart Merging with Validation
                ↓
[PERSISTENCE LAYER]
├─ Distributed Locking (Prevent Races)
├─ Database Transactions (Atomic)
├─ Field Source Tracking (JSONB)
├─ Admin Field Protection
└─ Cache Invalidation
                ↓
[PRESENTATION LAYER]
├─ Source Badges per Field
├─ Confidence Indicators
├─ Admin Conflict Dashboard
└─ Real-time Updates
```

---

## 🛠️ PART 3: CORE COMPONENTS IMPLEMENTATION

### Component 1: IPO Detection System

#### 1.1 Early Detection - SEBI Monitor
```typescript
// NEW SERVICE: IPO Announcement Monitor
class SEBIMonitor {
  @Cron('0 6 * * *')  // Daily at 6 AM
  async detectDRHPFilings() {
    const filings = await this.scrapeSEBI();

    for (const filing of filings) {
      if (filing.type === 'DRHP_FILED') {
        // IPO detected 30-60 days early!
        await this.createEarlyIPO({
          companyName: filing.company,
          drhpUrl: filing.documentUrl,
          status: 'ANNOUNCED',
          estimatedOpenDate: this.estimateDate(filing)
        });
      }
    }
  }
}
```

#### 1.2 Exchange Detection
```typescript
class ExchangeMonitor {
  @Cron('0 * * * *')  // Hourly
  async detectNewIPOs() {
    const nseIPOs = await this.nse.getCurrentIPOs();
    const bseIPOs = await this.bse.getCurrentIPOs();

    for (const ipo of [...nseIPOs, ...bseIPOs]) {
      const existing = await this.findExisting(ipo);

      if (!existing) {
        // NEW IPO - Trigger full pipeline
        await this.orchestrator.processNewIPO(ipo);
      } else if (this.hasStatusChanged(existing, ipo)) {
        // Status change - Update
        await this.orchestrator.updateIPOStatus(ipo);
      }
    }
  }
}
```

#### 1.3 Deduplication Strategy
```typescript
class IPODeduplicationService {
  async findExisting(candidate: IPOCandidate): Promise<IPO | null> {
    // Priority order matching

    // 1. ISIN (100% reliable)
    if (candidate.isin) {
      const match = await this.repo.findByISIN(candidate.isin);
      if (match) return match;
    }

    // 2. Exact slug (90% reliable)
    const slug = generateIPOSlug(candidate.companyName);
    const match = await this.repo.findBySlug(slug);
    if (match) return match;

    // 3. Fuzzy name (85% reliable)
    const normalized = this.normalize(candidate.companyName);
    const match = await this.repo.findByNormalizedName(normalized);
    if (match) return match;

    // 4. Levenshtein distance (80% reliable)
    const similar = await this.repo.findSimilar(candidate.companyName, 0.8);
    if (similar.length === 1) return similar[0];

    return null; // Genuinely new
  }
}
```

### Component 2: DRHP Integration Pipeline

#### 2.1 DRHP Downloader Service
```typescript
class DRHPDownloaderService {
  async processNewIPO(ipo: ScrapedIPO): Promise<DRHPDocument | null> {
    // Check if already downloaded
    const existing = await this.documentRepo.findByType(ipo.id, 'DRHP');
    if (existing) return existing;

    // Search for DRHP URL
    const drhpUrl = await this.findDRHPUrl(ipo.companyName);
    if (!drhpUrl) {
      logger.warn(`No DRHP found for ${ipo.companyName}`);
      return null;
    }

    // Download PDF
    const pdfPath = await this.downloadPDF(drhpUrl, ipo.id);

    // Store reference
    return await this.documentRepo.create({
      ipoId: ipo.id,
      type: 'DRHP',
      url: drhpUrl,
      localPath: pdfPath,
      status: 'READY_FOR_EXTRACTION'
    });
  }

  private async findDRHPUrl(companyName: string): Promise<string | null> {
    // Try multiple sources
    const sources = [
      () => this.searchNSE(companyName),
      () => this.searchBSE(companyName),
      () => this.searchSEBI(companyName),
    ];

    for (const search of sources) {
      const url = await search();
      if (url) return url;
    }

    return null;
  }
}
```

#### 2.2 Python-TypeScript Bridge
```typescript
import { spawn } from 'child_process';

class DRHPExtractorService {
  async extract(options: ExtractOptions): Promise<DRHPExtraction> {
    return new Promise((resolve, reject) => {
      // Timeout protection
      const timeout = setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('DRHP extraction timeout after 30s'));
      }, options.timeout || 30000);

      // Spawn Python process
      const pythonProcess = spawn('python', [
        'pdf-parser-test/extraction_v3.py',
        '--pdf', options.pdfPath,
        '--ipo-id', options.ipoId,
        '--output-format', 'json'
      ]);

      let output = '';
      let errorOutput = '';

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pythonProcess.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          // Queue for manual review on failure
          await this.queueForManualReview(options.pdfPath);
          reject(new Error(`Python extraction failed: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);

          // Validate extraction quality
          if (result.confidence < 75) {
            await this.queueForManualReview(options.pdfPath);
          }

          resolve({
            data: result.fields,
            confidence: result.confidence,
            extractedFields: result.extracted_count,
            totalFields: result.total_fields
          });
        } catch (error) {
          reject(new Error('Invalid JSON from extractor'));
        }
      });
    });
  }
}
```

### Component 3: Data Consolidation Service

#### 3.1 Field Priority Matrix
```typescript
const FIELD_PRIORITY_MATRIX = {
  // FINANCIAL DATA: DRHP is authoritative
  'revenue_fy2024': {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE'],
    confidence_threshold: 80,
    normalization: 'currency'
  },
  'profit_fy2024': {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE'],
    confidence_threshold: 80,
    normalization: 'currency'
  },

  // IPO DETAILS: NSE is primary
  'issueSize': {
    sources: ['ADMIN', 'NSE', 'DRHP', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    validation: { min: 1e6, max: 1e11 }
  },

  // REAL-TIME: Latest wins
  'subscriptionStatus': {
    sources: ['NSE', 'BSE'],
    time_based: true,
    ignore_drhp: true
  },

  // SPECIALIST: Domain expert wins
  'gmpPrice': {
    sources: ['ADMIN', 'CHITTORGARH', 'INVESTORGAIN', 'MONEYCONTROL'],
    time_based: true,
    ignore_drhp: true
  },

  // LOT SIZE: BSE more accurate
  'lotSize': {
    sources: ['ADMIN', 'BSE', 'NSE', 'DRHP'],
    validation: { min: 10, max: 100000 }
  }
};
```

#### 3.2 Smart Consolidation Logic
```typescript
class DataConsolidationService {
  async consolidateIPOData(
    ipoId: string,
    incoming: IPOData,
    source: string
  ): Promise<ConsolidationResult> {
    // Distributed lock prevents race conditions
    const lock = await this.redis.set(
      `lock:ipo:${ipoId}`,
      '1', 'NX', 'EX', 30
    );

    if (!lock) {
      throw new Error('IPO locked by another process');
    }

    try {
      // Atomic transaction
      return await this.db.transaction(async (tx) => {
        // Get current data with source info
        const current = await tx.select()
          .from(ipos)
          .where(eq(ipos.id, ipoId))
          .first();

        // Check field protection
        const protectedFields = await this.getProtectedFields(ipoId);

        // Consolidate each field
        const consolidated = {};
        const sourceTracking = {};
        const conflicts = [];

        for (const field of Object.keys(incoming)) {
          // Skip protected fields
          if (protectedFields.includes(field)) {
            conflicts.push({
              field,
              reason: 'PROTECTED',
              attemptedValue: incoming[field]
            });
            continue;
          }

          // Get field-specific rules
          const rules = FIELD_PRIORITY_MATRIX[field];
          if (!rules) continue;

          // Normalize values
          const normalizedIncoming = this.normalize(field, incoming[field], rules);
          const normalizedCurrent = current?.[field]
            ? this.normalize(field, current[field], rules)
            : null;

          // Check if values are equivalent
          if (this.areEquivalent(normalizedCurrent, normalizedIncoming)) {
            // Same value - just update timestamp
            sourceTracking[field] = {
              source,
              confidence: 100,
              updated_at: new Date()
            };
            continue;
          }

          // Resolve conflict
          const decision = await this.resolveConflict(
            field,
            current,
            normalizedIncoming,
            source,
            rules
          );

          if (decision.update) {
            consolidated[field] = decision.value;
            sourceTracking[field] = {
              source: decision.source,
              confidence: decision.confidence,
              updated_at: new Date(),
              previous: {
                value: current?.[field],
                source: current?.field_sources?.[field]?.source
              }
            };
          } else {
            conflicts.push({
              field,
              currentValue: current?.[field],
              attemptedValue: normalizedIncoming,
              reason: decision.reason
            });
          }
        }

        // Update database
        if (Object.keys(consolidated).length > 0) {
          await tx.update(ipos)
            .set({
              ...consolidated,
              field_sources: sourceTracking,
              updatedAt: new Date()
            })
            .where(eq(ipos.id, ipoId));
        }

        // Log conflicts
        if (conflicts.length > 0) {
          await this.logConflicts(ipoId, conflicts, source);
        }

        return { consolidated, conflicts, sourceTracking };
      });

    } finally {
      await this.redis.del(`lock:ipo:${ipoId}`);
    }
  }

  private async resolveConflict(
    field: string,
    current: IPO,
    incomingValue: any,
    incomingSource: string,
    rules: FieldRules
  ): Promise<Decision> {
    // Time-based priority
    if (rules.time_based) {
      return {
        update: true,
        value: incomingValue,
        source: incomingSource,
        confidence: 95,
        reason: 'NEWER_DATA'
      };
    }

    // Get current source info
    const currentSource = current?.field_sources?.[field]?.source || 'UNKNOWN';
    const currentConfidence = current?.field_sources?.[field]?.confidence || 50;

    // Calculate priorities
    const incomingPriority = rules.sources.indexOf(incomingSource);
    const currentPriority = rules.sources.indexOf(currentSource);

    // Admin always wins
    if (currentSource === 'ADMIN') {
      return {
        update: false,
        reason: 'ADMIN_OVERRIDE'
      };
    }

    // Higher priority source wins
    if (incomingPriority >= 0 &&
        (currentPriority === -1 || incomingPriority < currentPriority)) {

      // Calculate confidence
      const confidence = this.calculateConfidence(
        incomingSource,
        incomingValue,
        rules
      );

      // Check threshold
      if (rules.confidence_threshold && confidence < rules.confidence_threshold) {
        return {
          update: false,
          reason: 'LOW_CONFIDENCE'
        };
      }

      return {
        update: true,
        value: incomingValue,
        source: incomingSource,
        confidence,
        reason: 'HIGHER_PRIORITY'
      };
    }

    return {
      update: false,
      reason: 'LOWER_PRIORITY'
    };
  }
}
```

#### 3.3 Normalization Engine
```typescript
class NormalizationEngine {
  normalize(field: string, value: any, rules: FieldRules): any {
    if (!value) return null;

    switch (rules.normalization) {
      case 'currency':
        return this.normalizeCurrency(value);
      case 'date':
        return this.normalizeDate(value);
      case 'company_name':
        return this.normalizeCompanyName(value);
      default:
        return value;
    }
  }

  normalizeCurrency(value: string | number): number {
    // Handle all Indian currency formats
    const patterns = [
      { regex: /₹?([\d.]+)\s*cr(?:ore)?s?/i, multiplier: 1e7 },
      { regex: /₹?([\d.]+)\s*lakh?s?/i, multiplier: 1e5 },
      { regex: /₹?([\d.]+)\s*million/i, multiplier: 1e6 },
      { regex: /₹?([\d.]+)\s*billion/i, multiplier: 1e9 },
    ];

    const str = value.toString();

    for (const pattern of patterns) {
      const match = str.match(pattern.regex);
      if (match) {
        return parseFloat(match[1]) * pattern.multiplier;
      }
    }

    // Plain number - context aware
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));

    // If small number for issue size, likely in crores
    if (field === 'issueSize' && num < 10000) {
      return num * 1e7; // Convert crores to rupees
    }

    return num;
  }

  normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      // Remove legal suffixes
      .replace(/\s+(limited|ltd\.?|private|pvt\.?|inc|corp|llc|llp|plc)\.?$/gi, '')
      // Remove IPO suffix
      .replace(/\s+ipo$/i, '')
      // Normalize spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  areEquivalent(val1: any, val2: any): boolean {
    if (val1 === val2) return true;

    // Number comparison with tolerance
    if (typeof val1 === 'number' && typeof val2 === 'number') {
      return Math.abs(val1 - val2) < 0.01;
    }

    // String comparison (case insensitive)
    if (typeof val1 === 'string' && typeof val2 === 'string') {
      return val1.toLowerCase().trim() === val2.toLowerCase().trim();
    }

    return false;
  }
}
```

### Component 4: Database Schema Updates

#### 4.1 Field Source Tracking
```sql
-- Efficient JSONB approach (not 10M row table)
ALTER TABLE ipos
ADD COLUMN field_sources JSONB DEFAULT '{}';

-- Example structure:
-- {
--   "revenue_fy2024": {
--     "source": "DRHP",
--     "confidence": 94,
--     "updated_at": "2025-11-07T10:30:00Z",
--     "previous": {
--       "value": 900000000,
--       "source": "NSE"
--     }
--   },
--   "issueSize": {
--     "source": "NSE",
--     "confidence": 99,
--     "updated_at": "2025-11-07T11:00:00Z"
--   },
--   "gmpPrice": {
--     "source": "CHITTORGARH",
--     "confidence": 95,
--     "updated_at": "2025-11-07T12:00:00Z"
--   }
-- }

-- Indexed for fast queries
CREATE INDEX idx_ipos_field_sources ON ipos USING gin(field_sources);

-- Query examples:
-- Find all IPOs with DRHP revenue data
SELECT * FROM ipos
WHERE field_sources @> '{"revenue_fy2024": {"source": "DRHP"}}';

-- Find IPOs with low confidence data
SELECT * FROM ipos
WHERE field_sources @> '[{"confidence": 50}]';
```

#### 4.2 Document Tracking Enhancement
```sql
ALTER TABLE documents
ADD COLUMN extraction_status VARCHAR(50) DEFAULT 'PENDING',
ADD COLUMN extraction_confidence DECIMAL(5,2),
ADD COLUMN extracted_at TIMESTAMP,
ADD COLUMN extraction_error TEXT,
ADD COLUMN retry_count INTEGER DEFAULT 0;

CREATE INDEX idx_documents_extraction_status ON documents(extraction_status);
CREATE INDEX idx_documents_ipo_type ON documents(ipo_id, type);
```

#### 4.3 Conflict Logging Table
```sql
CREATE TABLE data_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipo_id UUID REFERENCES ipos(id),
  field_name VARCHAR(100) NOT NULL,
  current_value TEXT,
  current_source VARCHAR(50),
  attempted_value TEXT,
  attempted_source VARCHAR(50),
  conflict_reason VARCHAR(50),
  resolution VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255)
);

CREATE INDEX idx_conflicts_ipo ON data_conflicts(ipo_id);
CREATE INDEX idx_conflicts_unresolved ON data_conflicts(resolved_at)
  WHERE resolved_at IS NULL;
```

---

## 📅 PART 4: IMPLEMENTATION TIMELINE

### Phase 0: Foundation (Week 1)
**Goal**: Prepare infrastructure without breaking current system

| Day | Task | Details | Effort |
|-----|------|---------|--------|
| 1 | Performance Baseline | Measure current metrics, document | 4h |
| 2 | Load Testing | Test with 1000 concurrent updates | 8h |
| 3 | Feature Flags | Implement gradual rollout system | 8h |
| 4 | Database Migrations | Add JSONB fields, new tables | 8h |
| 5 | Backfill Script | Populate source data for existing IPOs | 8h |

### Phase 1: Core Services (Week 2)
**Goal**: Build critical consolidation infrastructure

| Day | Task | Details | Effort |
|-----|------|---------|--------|
| 6 | Data Consolidation Service | Priority matrix, merging logic | 8h |
| 7 | Confidence Scoring | Implement scoring algorithm | 8h |
| 8 | Normalization Engine | Currency, date, name parsing | 8h |
| 9 | Distributed Locking | Redis-based mutex implementation | 6h |
| 10 | Transaction Support | Atomic updates, rollback logic | 6h |

### Phase 2: DRHP Integration (Week 3)
**Goal**: Connect Python extractor to pipeline

| Day | Task | Details | Effort |
|-----|------|---------|--------|
| 11 | DRHP Downloader | Auto-fetch from exchanges | 8h |
| 12 | Python Bridge | TypeScript-Python with timeout | 8h |
| 13 | Extraction Pipeline | Queue, error handling | 8h |
| 14 | Integration Testing | End-to-end DRHP flow | 8h |
| 15 | Manual Review Queue | Admin interface for failed extractions | 8h |

### Phase 3: Detection & UI (Week 4)
**Goal**: Early detection and admin tools

| Day | Task | Details | Effort |
|-----|------|---------|--------|
| 16 | IPO Detection System | SEBI, Exchange, RSS monitors | 8h |
| 17 | Deduplication Service | Multi-strategy matching | 8h |
| 18 | Admin Conflict Dashboard | UI for resolution | 8h |
| 19 | Source Indicators | UI badges, confidence display | 8h |
| 20 | Monitoring Dashboard | Metrics, alerts setup | 8h |

### Phase 4: Testing & Deployment (Week 5)
**Goal**: Production readiness

| Day | Task | Details | Effort |
|-----|------|---------|--------|
| 21 | Integration Testing | Complete pipeline tests | 8h |
| 22 | Performance Testing | Load test consolidated system | 8h |
| 23 | Staging Deployment | Full system test | 8h |
| 24 | Production Rollout | 10% → 50% → 100% | 8h |
| 25 | Monitoring & Support | Bug fixes, optimization | 8h |

**Total Effort**: 184 hours (23 days)

---

## 🧪 PART 5: COMPREHENSIVE TEST SUITE

### Test Coverage Requirements
- Unit Tests: >85% coverage
- Integration Tests: Critical paths
- E2E Tests: Complete flows
- Load Tests: 1000 concurrent updates
- Chaos Tests: Failure scenarios

### Critical Test Scenarios

#### Test 1: End-to-End New IPO Flow
```typescript
describe('Complete IPO Pipeline', () => {
  test('NEW IPO: Detection → DRHP → Consolidation → UI', async () => {
    // 1. Simulate SEBI filing detection
    const filing = mockSEBIFiling('Test Corp IPO');
    await sebiMonitor.processFiling(filing);

    // 2. Verify IPO created with correct status
    const ipo = await ipoRepo.findBySlug('test-corp');
    expect(ipo.status).toBe('ANNOUNCED');

    // 3. Verify DRHP auto-downloaded
    const doc = await documentRepo.findByType(ipo.id, 'DRHP');
    expect(doc.status).toBe('DOWNLOADED');

    // 4. Wait for extraction
    await waitFor(() => {
      const extraction = extractionQueue.getJob(ipo.id);
      expect(extraction.status).toBe('COMPLETED');
    });

    // 5. Verify financial data extracted
    const final = await ipoRepo.findById(ipo.id);
    expect(final.revenue_fy2024).toBeDefined();
    expect(final.field_sources.revenue_fy2024.source).toBe('DRHP');
    expect(final.field_sources.revenue_fy2024.confidence).toBeGreaterThan(90);
  });
});
```

#### Test 2: Race Condition Prevention
```typescript
test('Simultaneous scrapers should not create duplicates', async () => {
  // Run 10 scrapers simultaneously for same IPO
  const promises = Array(10).fill(0).map((_, i) =>
    scraperOrchestrator.processIPO(testIPO, `SCRAPER_${i}`)
  );

  await Promise.all(promises);

  // Should only create 1 IPO
  const ipos = await ipoRepo.findByCompanyName('Test Corp');
  expect(ipos.length).toBe(1);

  // Check lock was used
  const lockLogs = await redis.lrange('lock:logs', 0, -1);
  expect(lockLogs.length).toBeGreaterThan(5); // Multiple lock attempts
});
```

#### Test 3: Field-Specific Priority
```typescript
test('Field priority should follow matrix rules', async () => {
  const ipoId = 'test-123';

  // DRHP data for financials
  await consolidationService.processUpdate(ipoId, {
    revenue_fy2024: 1000000000,
    profit_fy2024: 100000000
  }, 'DRHP');

  // NSE data for core fields
  await consolidationService.processUpdate(ipoId, {
    issueSize: 5000000000,
    revenue_fy2024: 950000000 // Different from DRHP
  }, 'NSE');

  // Chittorgarh for GMP
  await consolidationService.processUpdate(ipoId, {
    gmpPrice: 45
  }, 'CHITTORGARH');

  // NSE trying to update GMP (should fail)
  await consolidationService.processUpdate(ipoId, {
    gmpPrice: 40
  }, 'NSE');

  const result = await ipoRepo.findById(ipoId);

  // DRHP wins for revenue
  expect(result.revenue_fy2024).toBe(1000000000);
  expect(result.field_sources.revenue_fy2024.source).toBe('DRHP');

  // NSE wins for issue size
  expect(result.issueSize).toBe(5000000000);
  expect(result.field_sources.issueSize.source).toBe('NSE');

  // Chittorgarh wins for GMP
  expect(result.gmpPrice).toBe(45);
  expect(result.field_sources.gmpPrice.source).toBe('CHITTORGARH');
});
```

#### Test 4: Normalization Tests
```typescript
describe('Data Normalization', () => {
  test('Currency normalization should handle all formats', () => {
    const engine = new NormalizationEngine();

    // All should normalize to 5 billion rupees
    expect(engine.normalizeCurrency('₹500 Cr')).toBe(5000000000);
    expect(engine.normalizeCurrency('500 Crores')).toBe(5000000000);
    expect(engine.normalizeCurrency('Rs 500 crore')).toBe(5000000000);
    expect(engine.normalizeCurrency('INR 500 Cr')).toBe(5000000000);

    // Context-aware for issue size
    expect(engine.normalizeCurrency('500', { field: 'issueSize' })).toBe(5000000000);
  });

  test('Company name normalization', () => {
    const engine = new NormalizationEngine();

    // All should normalize to same value
    const names = [
      'XYZ Corporation Limited',
      'XYZ Corporation Ltd.',
      'XYZ Corporation Ltd',
      'XYZ CORPORATION LIMITED IPO',
      'xyz corporation ltd ipo'
    ];

    const normalized = names.map(n => engine.normalizeCompanyName(n));
    const unique = new Set(normalized);

    expect(unique.size).toBe(1);
    expect(normalized[0]).toBe('xyz corporation');
  });
});
```

#### Test 5: Admin Protection
```typescript
test('Admin edits should be protected from scraper overwrites', async () => {
  const ipoId = 'test-ipo';

  // Admin sets issue size
  await adminService.updateIPO(ipoId, {
    issueSize: 5000000000
  }, 'admin-user-123');

  // This automatically protects the field
  const protection = await fieldProtectionRepo.findByField(
    ipoId, 'ipos', 'issueSize'
  );
  expect(protection.isProtected).toBe(true);

  // NSE tries to update (should be blocked)
  const result = await consolidationService.processUpdate(ipoId, {
    issueSize: 5500000000
  }, 'NSE');

  expect(result.conflicts).toContainEqual({
    field: 'issueSize',
    reason: 'PROTECTED',
    attemptedValue: 5500000000
  });

  // Verify value unchanged
  const ipo = await ipoRepo.findById(ipoId);
  expect(ipo.issueSize).toBe(5000000000);
});
```

---

## 📊 PART 6: MONITORING & METRICS

### Key Performance Indicators

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| **IPO Detection Latency** | 1-2 days | <6 hours | Time from announcement to detection |
| **DRHP Coverage** | 0% | >80% | IPOs with extracted DRHP data |
| **Data Conflicts** | Unknown | <2% | Conflicts logged / total updates |
| **Duplicate IPOs** | ~5% | <0.1% | Duplicate count / total IPOs |
| **Field Accuracy** | ~85% | >98% | Validated fields / total fields |
| **Source Tracking** | 0% | 100% | Fields with source / total fields |
| **Processing Speed** | 2s/IPO | <500ms | p95 consolidation latency |
| **Manual Entry** | 80% | <20% | Admin edits / total field updates |
| **Race Conditions** | Unknown | 0 | Lock timeouts / total updates |
| **Cache Hit Rate** | ~60% | >80% | Cache hits / total requests |

### Monitoring Dashboard Endpoints

```typescript
// Real-time pipeline metrics
GET /api/admin/metrics/data-pipeline
{
  "detection": {
    "last24h": 5,
    "avgLatencyHours": 4.2,
    "sources": {
      "SEBI": 2,
      "NSE": 2,
      "RSS": 1
    }
  },
  "consolidation": {
    "processed": 1250,
    "conflicts": 23,
    "conflictRate": "1.84%",
    "avgLatencyMs": 423,
    "lockTimeouts": 2
  },
  "drhp": {
    "extracted": 45,
    "avgConfidence": 93.5,
    "failures": 2,
    "queuedForReview": 3
  },
  "dataQuality": {
    "fieldCompleteness": "87%",
    "sourceTrackingCoverage": "100%",
    "adminOverrides": 156,
    "protectedFields": 89
  }
}

// Conflict resolution dashboard
GET /api/admin/conflicts
[
  {
    "id": "conflict-123",
    "ipoName": "XYZ Corporation",
    "field": "issueSize",
    "currentValue": "500 Cr",
    "currentSource": "NSE",
    "attemptedValue": "505 Cr",
    "attemptedSource": "BSE",
    "reason": "LOWER_PRIORITY",
    "timestamp": "2025-11-07T10:30:00Z"
  }
]
```

### Alert Configuration

```yaml
alerts:
  - name: high-conflict-rate
    condition: conflict_rate > 5%
    severity: WARNING
    notification: slack

  - name: drhp-extraction-failures
    condition: drhp_failure_rate > 10%
    severity: CRITICAL
    notification: [slack, email]

  - name: duplicate-ipos-detected
    condition: duplicate_count > 0
    severity: CRITICAL
    notification: [slack, pagerduty]

  - name: consolidation-slow
    condition: p95_latency > 1000ms
    severity: WARNING
    notification: slack
```

---

## 🚀 PART 7: DEPLOYMENT STRATEGY

### Feature Flags Configuration

```typescript
// Environment variables for gradual rollout
const FEATURE_FLAGS = {
  // Core features
  ENABLE_IPO_DETECTION: process.env.ENABLE_IPO_DETECTION === 'true',
  ENABLE_DRHP_EXTRACTION: process.env.ENABLE_DRHP_EXTRACTION === 'true',
  ENABLE_DATA_CONSOLIDATION: process.env.ENABLE_DATA_CONSOLIDATION === 'true',

  // Rollout percentage
  CONSOLIDATION_PERCENTAGE: parseInt(process.env.CONSOLIDATION_PERCENTAGE || '0'),

  // Specific scrapers
  CONSOLIDATION_SCRAPERS: (process.env.CONSOLIDATION_SCRAPERS || '').split(','),
};

// Usage in code
if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION &&
    Math.random() * 100 < FEATURE_FLAGS.CONSOLIDATION_PERCENTAGE) {
  await consolidationService.process(data);
} else {
  await legacyService.process(data); // Old path
}
```

### Rollout Phases

#### Week 1: Shadow Mode
- Enable logging only (no writes)
- Monitor for issues
- Validate consolidation decisions

#### Week 2: Limited Rollout
- 10% of new IPOs
- Monitor metrics closely
- Quick rollback if issues

#### Week 3: Expanded Rollout
- 50% of IPOs
- Include DRHP extraction
- Admin training

#### Week 4: Full Production
- 100% deployment
- Remove feature flags
- Archive old code paths

### Rollback Plan

```bash
# Instant rollback via environment variables
ENABLE_DATA_CONSOLIDATION=false
ENABLE_DRHP_EXTRACTION=false

# Database is backward compatible
# No schema rollback needed

# Cache clear if needed
redis-cli FLUSHDB

# Restart services
pm2 restart all
```

---

## 📝 PART 8: DOCUMENTATION UPDATES

### Required Documentation

1. **Architecture Diagrams**
   - Updated data flow diagram
   - Component interaction diagram
   - Deployment architecture

2. **API Documentation**
   - New consolidation endpoints
   - Conflict resolution APIs
   - Metrics endpoints

3. **Admin User Guide**
   - Conflict dashboard usage
   - Field protection guide
   - Source indicator meanings

4. **Developer Guide**
   - Adding new scrapers
   - Field priority configuration
   - DRHP extraction setup

5. **Operations Runbook**
   - Monitoring setup
   - Alert response procedures
   - Troubleshooting guide

---

## ✅ PART 9: DEFINITION OF DONE

### System is complete when:

**Core Functionality**
- [ ] IPO detection working for SEBI, NSE, BSE
- [ ] DRHP auto-download functional
- [ ] DRHP extraction integrated with 90%+ success
- [ ] Data consolidation service deployed
- [ ] All fields have source tracking
- [ ] Field-specific priority working
- [ ] Smart normalization operational
- [ ] Distributed locking prevents races

**Quality & Testing**
- [ ] Zero duplicate IPOs for 7 days
- [ ] Data conflict rate <2%
- [ ] Test coverage >85%
- [ ] Load test passes (1000 concurrent)
- [ ] All P0 bugs fixed

**Admin & UI**
- [ ] Conflict dashboard functional
- [ ] Source badges displayed
- [ ] Field protection working
- [ ] Admin can resolve conflicts

**Operations**
- [ ] Monitoring dashboard live
- [ ] Alerts configured
- [ ] Runbook documented
- [ ] Team trained

---

## 🎯 IMMEDIATE NEXT STEPS

1. **Review Plan with Team**
   - Architecture review
   - Effort estimation validation
   - Risk assessment

2. **Setup Infrastructure**
   - Create development environment
   - Setup feature flags
   - Configure monitoring

3. **Create Tickets**
   - Break down into JIRA stories
   - Assign to team members
   - Set sprint goals

4. **Begin Phase 0**
   - Performance baseline
   - Database migrations
   - Feature flag setup

5. **Communication**
   - Stakeholder update
   - Team kick-off meeting
   - Weekly progress reports

---

## 📌 RISK MITIGATION

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **DRHP extraction fails** | HIGH | MEDIUM | Manual queue, admin UI |
| **Performance degradation** | HIGH | LOW | Load testing, gradual rollout |
| **Data corruption** | CRITICAL | LOW | Transactions, backups |
| **Breaking changes** | HIGH | MEDIUM | Feature flags, dual paths |
| **Team knowledge** | MEDIUM | HIGH | Documentation, training |

---

## 🏆 SUCCESS CRITERIA

The project will be considered successful when:

1. **Data Quality**: 98%+ field accuracy with full source tracking
2. **Automation**: 80%+ DRHP coverage, <20% manual entry
3. **Performance**: <500ms p95 latency, zero race conditions
4. **Reliability**: <0.1% duplicate rate, <2% conflict rate
5. **Operations**: Full monitoring, <1h incident response

---

**Document End**
**Total Estimated Effort**: 184 hours (23 working days)
**Recommended Team**: 2-3 developers
**Risk Level**: Medium (mitigated by gradual rollout)
**ROI**: 80% reduction in manual data entry, 98% data accuracy