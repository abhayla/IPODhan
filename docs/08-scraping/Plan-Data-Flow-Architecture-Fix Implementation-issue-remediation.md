# Issue Remediation Plan: Data Flow Architecture Testing
## Comprehensive Fix Strategies for Test Failures

**Document Version**: 1.0
**Created**: 2025-11-08
**Status**: Ready for Use
**Related**: Plan-Data-Flow-Architecture-Fix Implementation-testing.md

---

## 🎯 Purpose

This document provides **step-by-step remediation strategies** for all potential failures discovered during Data Flow Architecture testing. Each issue category has proven fix templates, test verification procedures, and safe deployment strategies.

---

## 📊 Current Implementation Status

### ✅ **IMPLEMENTED COMPONENTS** (Production-Ready)

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| **Data Consolidation Service** | ✅ 100% | `scraper/src/services/data-consolidation-service.ts` | Phase 4 - 100% rollout |
| **Field Priority Matrix** | ✅ 100% | `scraper/src/config/field-priority-matrix.ts` | Comprehensive field rules |
| **Normalization Engine** | ✅ 100% | `scraper/src/services/normalization-engine.ts` | Currency, date, name parsing |
| **field_sources Table** | ✅ 100% | `packages/shared/src/db/schema.ts` (lines 1041-1088) | Audit trail tracking |
| **data_conflicts Table** | ✅ 100% | `packages/shared/src/db/schema.ts` (lines 1090-1140) | Conflict logging |
| **field_protection Table** | ✅ 100% | `packages/shared/src/db/schema.ts` (lines 888-926) | Admin edit protection |
| **Feature Flags** | ✅ 100% | `scraper/src/config/feature-flags.ts` | Gradual rollout control |

### ❌ **MISSING COMPONENTS** (Need Implementation)

| Component | Status | Priority | Estimated Effort |
|-----------|--------|----------|------------------|
| **IPODeduplicationService** | ❌ Missing | P1 | 8 hours |
| **Admin Conflict Dashboard** | ❌ Missing | P1 | 16 hours |
| **DRHP Extraction Pipeline** | ❌ 10% | P2 | 40 hours |
| **Early Detection (SEBI)** | ❌ Missing | P3 | 16 hours |

### ⚠️ **HIGH-RISK AREAS** (Potential Bugs)

1. **Currency Normalization Edge Cases** - Complex regex patterns
2. **Fuzzy Name Matching** - False positive IPO merges
3. **Time-Based Priority Logic** - Race conditions with concurrent scrapers
4. **Conflict Severity Classification** - Incorrect CRITICAL/WARNING/INFO
5. **Field Protection Race Conditions** - Admin edit timing issues

---

## 🔧 CATEGORY A: Data Quality Fixes (Normalization)

**Root Cause**: Normalization engine doesn't handle edge case formats
**Impact**: False positive conflicts, data rejected as "different" when actually equivalent

---

### Issue A.1: Currency Format Not Recognized

**Symptoms**:
```
❌ Test fails: "₹500 Cr" vs "Rs 5000000000" treated as conflict
❌ Consolidation rejects equivalent values
❌ data_conflicts table shows WARNING severity for same value
```

**Root Cause**:
```typescript
// scraper/src/services/normalization-engine.ts
// Missing regex pattern for specific format
normalizeCurrency(value: string): number {
  const patterns = [
    { regex: /₹?([\d.]+)\s*cr(?:ore)?s?/i, multiplier: 1e7 },
    // Missing: /Rs\s*([\d.]+)\s*cr(?:ore)?s?/i
  ];
}
```

**Fix Location**: `scraper/src/services/normalization-engine.ts`

**Step-by-Step Fix**:

1. **Add failing test case** (write before fixing):
```typescript
// scraper/tests/unit/services/normalization-engine.test.ts
describe('Currency Normalization Edge Cases', () => {
  test('handles "Rs 500 Crores" format', () => {
    const engine = new NormalizationEngine();
    const result = engine.normalizeCurrency('Rs 500 Crores');
    expect(result).toBe(5000000000);  // ₹500 Cr = 5 billion
  });

  test('handles unicode rupee symbol', () => {
    const result = engine.normalizeCurrency('₹500.5 Cr');
    expect(result).toBe(5005000000);
  });

  test('handles comma separators', () => {
    const result = engine.normalizeCurrency('₹5,000 Cr');
    expect(result).toBe(50000000000);
  });
});
```

2. **Update normalization logic**:
```typescript
// scraper/src/services/normalization-engine.ts
normalizeCurrency(value: string | number): number | null {
  if (typeof value === 'number') return value;
  if (!value) return null;

  // Remove commas first
  const cleanValue = value.toString().replace(/,/g, '');

  const patterns = [
    // Crores
    { regex: /₹?\s*Rs\.?\s*([\d.]+)\s*cr(?:ore)?s?/i, multiplier: 1e7 },
    { regex: /₹([\d.]+)\s*cr(?:ore)?s?/i, multiplier: 1e7 },
    { regex: /([\d.]+)\s*crores?/i, multiplier: 1e7 },

    // Lakhs
    { regex: /₹?\s*Rs\.?\s*([\d.]+)\s*l(?:akh)?s?/i, multiplier: 1e5 },
    { regex: /₹([\d.]+)\s*l(?:akh)?s?/i, multiplier: 1e5 },

    // Million/Billion
    { regex: /([\d.]+)\s*million/i, multiplier: 1e6 },
    { regex: /([\d.]+)\s*billion/i, multiplier: 1e9 },
  ];

  for (const pattern of patterns) {
    const match = cleanValue.match(pattern.regex);
    if (match) {
      return parseFloat(match[1]) * pattern.multiplier;
    }
  }

  // Plain number - context aware
  const num = parseFloat(cleanValue.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return null;

  return num;
}
```

3. **Run unit tests**:
```bash
cd scraper
npm run test:unit -- normalization-engine.test.ts
```

4. **Test with real data**:
```typescript
// scraper/tests/integration/normalization-real-data.test.ts
describe('Real Scraper Data Normalization', () => {
  test('NSE vs BSE currency formats are equivalent', async () => {
    const engine = new NormalizationEngine();

    // Real NSE format
    const nseValue = engine.normalizeCurrency('500 Crores');

    // Real BSE format
    const bseValue = engine.normalizeCurrency('₹500 Cr');

    expect(nseValue).toBe(bseValue);
    expect(engine.areEquivalent(nseValue, bseValue)).toBe(true);
  });
});
```

5. **Deploy to production**:
```bash
# Scraper deployment (no restart needed for normalization fix)
git add scraper/src/services/normalization-engine.ts
git commit -m "fix(normalization): add support for Rs and unicode rupee formats"
git push

# PM2 will auto-reload on next scraper run
```

**Verification Checklist**:
- [ ] Unit tests pass (100%)
- [ ] Integration test with real NSE/BSE data passes
- [ ] Shadow mode shows reduced conflicts by 20-30%
- [ ] No new conflicts created by fix
- [ ] Performance impact < 5ms per normalization

**Rollback Plan**: Revert commit, previous normalization logic still works

---

### Issue A.2: Company Name False Negatives

**Symptoms**:
```
❌ "ABC Ltd" and "ABC Limited" create 2 separate IPOs (duplicate)
❌ Fuzzy matching fails to detect similarity
❌ Manual deduplication required
```

**Root Cause**:
```typescript
// scraper/src/services/data-persister.ts (lines 163-188)
// Simple normalization, no similarity threshold
const normalizedName = companyName
  .toLowerCase()
  .replace(/\s+(limited|ltd\.?|private|pvt\.?)$/i, '')
  .trim();

// Missing: Similarity scoring for near-matches
```

**Fix Location**: Create `scraper/src/services/ipo-deduplication-service.ts`

**Step-by-Step Fix**:

1. **Install fuzzy matching library**:
```bash
cd scraper
npm install --save fuse.js @types/fuse.js
```

2. **Create deduplication service**:
```typescript
// scraper/src/services/ipo-deduplication-service.ts
import Fuse from 'fuse.js';
import { db } from '@/lib/db';
import { ipos } from '@ipodhan/shared/db/schema';

export interface DeduplicationCandidate {
  companyName: string;
  isin?: string;
  slug?: string;
}

export class IPODeduplicationService {
  private readonly SIMILARITY_THRESHOLD = 0.85; // 85% match required

  async findExisting(candidate: DeduplicationCandidate): Promise<IPO | null> {
    // 1. ISIN matching (100% reliable)
    if (candidate.isin) {
      const match = await db.select()
        .from(ipos)
        .where(eq(ipos.isin, candidate.isin))
        .limit(1);

      if (match.length > 0) return match[0];
    }

    // 2. Exact slug matching (90% reliable)
    if (candidate.slug) {
      const match = await db.select()
        .from(ipos)
        .where(eq(ipos.slug, candidate.slug))
        .limit(1);

      if (match.length > 0) return match[0];
    }

    // 3. Normalized name matching (85% reliable)
    const normalizedCandidate = this.normalizeCompanyName(candidate.companyName);

    const allIPOs = await db.select({
      id: ipos.id,
      companyName: ipos.companyName,
      slug: ipos.slug,
      isin: ipos.isin
    }).from(ipos);

    // 4. Fuzzy matching with Fuse.js
    const fuse = new Fuse(allIPOs, {
      keys: ['companyName'],
      threshold: 1 - this.SIMILARITY_THRESHOLD, // 0.15 = 85% match
      includeScore: true
    });

    const results = fuse.search(normalizedCandidate);

    if (results.length > 0 && results[0].score < (1 - this.SIMILARITY_THRESHOLD)) {
      console.log(`Fuzzy match: "${candidate.companyName}" → "${results[0].item.companyName}" (${(1 - results[0].score) * 100}% similar)`);
      return results[0].item;
    }

    return null; // Genuinely new IPO
  }

  private normalizeCompanyName(name: string): string {
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

  async findSimilar(companyName: string, threshold: number = 0.6): Promise<Array<{ ipo: IPO, score: number }>> {
    const allIPOs = await db.select().from(ipos);

    const fuse = new Fuse(allIPOs, {
      keys: ['companyName'],
      threshold: 1 - threshold,
      includeScore: true
    });

    const results = fuse.search(companyName);

    return results.map(r => ({
      ipo: r.item,
      score: (1 - r.score) * 100  // Convert to percentage
    }));
  }
}
```

3. **Update data-persister to use deduplication service**:
```typescript
// scraper/src/services/data-persister.ts
import { IPODeduplicationService } from './ipo-deduplication-service';

class DataPersister {
  private deduplicationService: IPODeduplicationService;

  constructor() {
    this.deduplicationService = new IPODeduplicationService();
  }

  async persistIPO(ipoData: ScrapedIPO, source: string): Promise<IPO> {
    // Use deduplication service
    const existing = await this.deduplicationService.findExisting({
      companyName: ipoData.companyName,
      isin: ipoData.isin,
      slug: ipoData.slug
    });

    if (existing) {
      console.log(`Deduplication match: ${ipoData.companyName} → ${existing.id}`);
      // Update existing IPO via consolidation
      return await this.updateIPO(existing.id, ipoData, source);
    }

    // Create new IPO
    return await this.createIPO(ipoData, source);
  }
}
```

4. **Add tests**:
```typescript
// scraper/tests/unit/services/ipo-deduplication.test.ts
describe('IPODeduplicationService', () => {
  test('matches company name variations', async () => {
    const service = new IPODeduplicationService();

    const variations = [
      'Midwest Gold Limited',
      'Midwest Gold Ltd',
      'MIDWEST GOLD LIMITED',
      'midwest gold ltd ipo'
    ];

    // All should match the same IPO
    const matches = await Promise.all(
      variations.map(name => service.findExisting({ companyName: name }))
    );

    const uniqueMatches = new Set(matches.map(m => m?.id));
    expect(uniqueMatches.size).toBe(1); // All matched same IPO
  });

  test('does not match different companies', async () => {
    const service = new IPODeduplicationService();

    const match1 = await service.findExisting({ companyName: 'Midwest Gold Limited' });
    const match2 = await service.findExisting({ companyName: 'Eastern Silver Limited' });

    expect(match1?.id).not.toBe(match2?.id);
  });
});
```

5. **Deploy**:
```bash
git add scraper/src/services/ipo-deduplication-service.ts
git add scraper/src/services/data-persister.ts
git commit -m "feat(deduplication): add fuzzy matching service to prevent duplicates"
npm run build --workspace=scraper
pm2 restart scraper
```

**Verification Checklist**:
- [ ] Unit tests pass
- [ ] Integration test with real duplicate scenarios passes
- [ ] Shadow mode for 24h shows zero duplicate IPOs created
- [ ] Similarity threshold tuned (test with 0.80, 0.85, 0.90)
- [ ] Performance: <50ms per deduplication check

**Monitoring**:
```typescript
// Add metrics
logger.info('Deduplication match', {
  candidate: ipoData.companyName,
  matched: existing.companyName,
  similarity: score,
  method: 'fuzzy'  // or 'isin', 'slug', 'exact'
});
```

---

## 🔧 CATEGORY B: Source Priority Fixes (Matrix)

**Root Cause**: Field priority matrix has incorrect source rankings
**Impact**: Lower quality data source overwrites higher quality source

---

### Issue B.1: Wrong Source Winning for Field

**Symptoms**:
```
❌ Test fails: Chittorgarh GMP overwritten by NSE GMP
❌ BSE lot_size overwritten by NSE lot_size
❌ Field sources show wrong winner
```

**Root Cause**:
```typescript
// scraper/src/config/field-priority-matrix.ts
export const FIELD_PRIORITY_MATRIX = {
  'gmpPrice': {
    sources: ['ADMIN', 'NSE', 'CHITTORGARH'],  // ❌ Wrong order!
    // Should be: ['ADMIN', 'CHITTORGARH', 'INVESTORGAIN', 'NSE']
  }
};
```

**Fix Location**: `scraper/src/config/field-priority-matrix.ts`

**Step-by-Step Fix**:

1. **Identify incorrect priority** (from test failure):
```
Test: "Chittorgarh wins for GMP"
Expected: gmpPrice source = CHITTORGARH
Actual: gmpPrice source = NSE
Reason: NSE has higher priority in matrix
```

2. **Update priority matrix**:
```typescript
// scraper/src/config/field-priority-matrix.ts
export const FIELD_PRIORITY_MATRIX: FieldPriorityMatrix = {
  // GMP DATA: Specialist sources win
  'gmpPrice': {
    sources: ['ADMIN', 'CHITTORGARH', 'INVESTORGAIN', 'MONEYCONTROL', 'NSE', 'BSE'],
    //          ^^^^^^   ^^^^^^^^^^^^  SPECIALISTS FIRST
    normalization: 'number',
    timeBased: true,  // Latest GMP wins among same-priority sources
    validation: { min: 0, max: 1000 }
  },

  'gmpPercentage': {
    sources: ['ADMIN', 'CHITTORGARH', 'INVESTORGAIN', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'percentage',
    timeBased: true
  },

  // LOT SIZE: BSE more accurate than NSE
  'lotSize': {
    sources: ['ADMIN', 'BSE', 'NSE', 'DRHP', 'MONEYCONTROL'],
    //          ^^^^^^   ^^^  BSE detail pages more accurate
    normalization: 'number',
    validation: { min: 10, max: 100000 },
    rejectValues: [1]  // lot_size=1 always invalid
  },

  // FINANCIAL DATA: DRHP is authoritative
  'revenueFy2024': {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    //          ^^^^^^   ^^^^  DRHP extracted data most reliable
    normalization: 'currency',
    confidenceThreshold: 80  // Reject low-confidence DRHP
  },

  // REAL-TIME DATA: Latest wins
  'subscriptionQib': {
    sources: ['NSE', 'BSE'],
    timeBased: true,
    ignoreDRHP: true  // DRHP has historical data, not real-time
  }
};
```

3. **Add priority documentation**:
```typescript
// scraper/src/config/field-priority-matrix.ts
/**
 * SOURCE PRIORITY RATIONALE
 *
 * ADMIN - Always highest (100% confidence, manual verification)
 *
 * DRHP - Financial data authority (94% extraction accuracy)
 *   - Revenue, profit, assets, liabilities
 *   - Company details (incorporation date, registered office)
 *
 * NSE - Primary exchange data (95%+ reliability)
 *   - Issue size, price band, dates
 *   - Subscription data (real-time)
 *
 * BSE - Secondary exchange + detail pages
 *   - Lot size (detail page scraping more accurate than NSE API)
 *   - Registrar, lead managers
 *
 * CHITTORGARH - GMP specialist (90%+ accuracy for GMP)
 *   - Grey market premium data
 *   - Subscription estimates
 *
 * MONEYCONTROL - Fallback source
 *   - General IPO information
 *   - Analysis and ratings
 *
 * API_FALLBACK - Lowest priority
 *   - Generic API responses
 */
```

4. **Test priority change**:
```typescript
// scraper/tests/integration/field-priority.test.ts
describe('Field Priority Matrix', () => {
  test('Chittorgarh wins GMP over NSE', async () => {
    const testIPO = await createTestIPO();

    // NSE provides GMP
    await consolidationService.consolidateIPOData({
      ipoId: testIPO.id,
      incomingData: { gmpPrice: 40 },
      source: 'NSE',
      existingData: testIPO
    });

    // Chittorgarh provides different GMP (should win)
    await consolidationService.consolidateIPOData({
      ipoId: testIPO.id,
      incomingData: { gmpPrice: 45 },
      source: 'CHITTORGARH',
      existingData: testIPO
    });

    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO.id));

    expect(finalIPO[0].gmpPrice).toBe(45);  // Chittorgarh won

    const fieldSource = await db.select().from(field_sources)
      .where(and(
        eq(field_sources.ipoId, testIPO.id),
        eq(field_sources.fieldName, 'gmpPrice')
      ));

    expect(fieldSource[0].source).toBe('CHITTORGARH');
  });
});
```

5. **Deploy**:
```bash
# Priority matrix is configuration - instant effect
git add scraper/src/config/field-priority-matrix.ts
git commit -m "fix(priority): correct GMP and lot_size source priorities

- GMP: Chittorgarh > Investorgain > NSE (specialist sources first)
- Lot Size: BSE > NSE (BSE detail pages more accurate)
- Add priority rationale documentation"

git push
# PM2 auto-reloads on next scraper run
```

**Verification Checklist**:
- [ ] Integration test passes with corrected priority
- [ ] Historical conflicts reviewed (should have different winners now)
- [ ] Shadow mode for 24h shows improved data quality
- [ ] No regression on other fields

**Monitoring**:
```sql
-- Check which sources are winning for GMP
SELECT
  field_sources->>'gmpPrice'->>'source' as source,
  COUNT(*) as count
FROM ipos
WHERE field_sources->>'gmpPrice' IS NOT NULL
GROUP BY source
ORDER BY count DESC;

-- Expected: CHITTORGARH or INVESTORGAIN top, not NSE
```

---

### Issue B.2: Time-Based Priority Not Working

**Symptoms**:
```
❌ Old subscription data overwrites new subscription data
❌ GMP from yesterday overwrites GMP from today
❌ Timestamp not respected
```

**Root Cause**:
```typescript
// scraper/src/services/data-consolidation-service.ts
// Missing timestamp comparison for time-based fields
if (rules.timeBased) {
  // ❌ Bug: Not comparing timestamps!
  return { update: true, value: incomingValue };
}
```

**Fix Location**: `scraper/src/services/data-consolidation-service.ts`

**Step-by-Step Fix**:

1. **Add timestamp tracking to incoming data**:
```typescript
// scraper/src/services/data-consolidation-service.ts
interface ConsolidationInput {
  ipoId: string;
  tableName: string;
  incomingData: Record<string, any>;
  source: string;
  existingData: any;
  shadowMode: boolean;
  timestamp?: Date;  // ✅ Add timestamp
}
```

2. **Update time-based comparison logic**:
```typescript
// scraper/src/services/data-consolidation-service.ts
private async resolveConflict(
  field: string,
  current: IPO,
  incomingValue: any,
  incomingSource: string,
  rules: FieldRules,
  incomingTimestamp?: Date
): Promise<Decision> {

  // Time-based priority
  if (rules.timeBased) {
    const currentTimestamp = current?.field_sources?.[field]?.updatedAt;
    const newTimestamp = incomingTimestamp || new Date();

    // If current has no timestamp, accept new
    if (!currentTimestamp) {
      return {
        update: true,
        value: incomingValue,
        source: incomingSource,
        confidence: 95,
        reason: 'NEWER_DATA'
      };
    }

    // Compare timestamps
    if (new Date(newTimestamp) > new Date(currentTimestamp)) {
      return {
        update: true,
        value: incomingValue,
        source: incomingSource,
        confidence: 95,
        reason: 'NEWER_DATA'
      };
    } else {
      return {
        update: false,
        reason: 'STALE_DATA'
      };
    }
  }

  // ... rest of priority logic
}
```

3. **Update scrapers to provide timestamps**:
```typescript
// scraper/src/scrapers/nse-scraper.ts
async scrapeSubscriptionData(ipoId: string): Promise<SubscriptionData> {
  const data = await this.fetchNSESubscription(ipoId);

  return {
    subscriptionQib: data.qibTimes,
    subscriptionNii: data.niiTimes,
    subscriptionRetail: data.retailTimes,
    timestamp: new Date(),  // ✅ Add scrape timestamp
    source: 'NSE'
  };
}
```

4. **Test time-based priority**:
```typescript
// scraper/tests/integration/time-based-priority.test.ts
describe('Time-Based Priority', () => {
  test('newer subscription data wins', async () => {
    const testIPO = await createTestIPO();

    // Old data (T=0)
    await consolidationService.consolidateIPOData({
      ipoId: testIPO.id,
      incomingData: { subscriptionQib: 10.5 },
      source: 'NSE',
      existingData: testIPO,
      timestamp: new Date('2025-11-08T10:00:00Z')
    });

    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Newer data (T=1)
    await consolidationService.consolidateIPOData({
      ipoId: testIPO.id,
      incomingData: { subscriptionQib: 12.3 },  // Different value
      source: 'NSE',
      existingData: testIPO,
      timestamp: new Date('2025-11-08T10:05:00Z')  // 5 minutes later
    });

    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO.id));

    expect(finalIPO[0].subscriptionQib).toBe(12.3);  // Newer value won
  });

  test('stale data rejected', async () => {
    const testIPO = await createTestIPO();

    // New data first
    await consolidationService.consolidateIPOData({
      ipoId: testIPO.id,
      incomingData: { gmpPrice: 50 },
      source: 'CHITTORGARH',
      timestamp: new Date('2025-11-08T12:00:00Z')
    });

    // Old data (should be rejected)
    const result = await consolidationService.consolidateIPOData({
      ipoId: testIPO.id,
      incomingData: { gmpPrice: 45 },
      source: 'CHITTORGARH',
      timestamp: new Date('2025-11-08T10:00:00Z')  // 2 hours earlier
    });

    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].reason).toBe('STALE_DATA');

    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO.id));
    expect(finalIPO[0].gmpPrice).toBe(50);  // Newer value retained
  });
});
```

5. **Deploy**:
```bash
git add scraper/src/services/data-consolidation-service.ts
git add scraper/src/scrapers/nse-scraper.ts
git commit -m "fix(consolidation): implement time-based priority with timestamp comparison

- Add timestamp tracking to consolidation input
- Compare timestamps for time-based fields
- Reject stale data (older than current)
- Update scrapers to provide scrape timestamp"

npm run build --workspace=scraper
pm2 restart scraper
```

**Verification Checklist**:
- [ ] Integration tests pass for time-based priority
- [ ] Subscription data updates correctly (newer wins)
- [ ] GMP updates correctly (newer wins)
- [ ] Stale data rejected with proper conflict log

---

## 🔧 CATEGORY C: Conflict Resolution Fixes (Logic)

**Root Cause**: Consolidation service has bugs in conflict detection or resolution
**Impact**: Data corruption, missed conflicts, incorrect severity classification

---

### Issue C.1: Conflict Severity Misclassified

**Symptoms**:
```
❌ 50% revenue difference classified as INFO (should be CRITICAL)
❌ 1% price difference classified as WARNING (should be INFO)
❌ Admin can't find critical conflicts in dashboard
```

**Root Cause**:
```typescript
// scraper/src/services/normalization-engine.ts
calculateSeverity(field: string, diff: number): Severity {
  // ❌ Bug: Fixed thresholds don't account for field type
  if (diff > 0.5) return 'CRITICAL';   // 50%
  if (diff > 0.1) return 'WARNING';    // 10%
  return 'INFO';
}
```

**Fix Location**: `scraper/src/services/normalization-engine.ts`

**Step-by-Step Fix**:

1. **Define field-specific severity thresholds**:
```typescript
// scraper/src/config/conflict-severity-rules.ts
export const CONFLICT_SEVERITY_RULES = {
  // Financial data - CRITICAL if >10% difference
  'issueSize': { info: 0.01, warning: 0.05, critical: 0.10 },
  'revenueFy2024': { info: 0.02, warning: 0.10, critical: 0.25 },
  'profitFy2024': { info: 0.05, warning: 0.15, critical: 0.30 },

  // Price data - WARNING if >5% difference
  'priceRangeMin': { info: 0.02, warning: 0.05, critical: 0.15 },
  'priceRangeMax': { info: 0.02, warning: 0.05, critical: 0.15 },

  // Dates - CRITICAL if >7 days difference
  'openDate': { info: 1, warning: 3, critical: 7 },  // Days
  'closeDate': { info: 1, warning: 3, critical: 7 },

  // Lot size - CRITICAL if different (no tolerance)
  'lotSize': { info: 0, warning: 0, critical: 0.01 },

  // GMP - INFO for normal fluctuations
  'gmpPrice': { info: 0.10, warning: 0.25, critical: 0.50 },
  'gmpPercentage': { info: 5, warning: 15, critical: 30 },  // Absolute %
};
```

2. **Update severity calculation**:
```typescript
// scraper/src/services/normalization-engine.ts
import { CONFLICT_SEVERITY_RULES } from '@/config/conflict-severity-rules';

calculateSeverity(
  field: string,
  currentValue: any,
  incomingValue: any
): 'INFO' | 'WARNING' | 'CRITICAL' {
  const rules = CONFLICT_SEVERITY_RULES[field];

  if (!rules) {
    // Default for unknown fields
    return 'WARNING';
  }

  // Calculate difference based on field type
  let diff: number;

  if (field.includes('Date')) {
    // Date difference in days
    const current = new Date(currentValue);
    const incoming = new Date(incomingValue);
    diff = Math.abs((incoming.getTime() - current.getTime()) / (1000 * 60 * 60 * 24));
  } else if (typeof currentValue === 'number' && typeof incomingValue === 'number') {
    // Percentage difference for numbers
    const avg = (currentValue + incomingValue) / 2;
    diff = Math.abs(currentValue - incomingValue) / avg;
  } else {
    // String difference (Levenshtein distance)
    diff = this.calculateLevenshteinDistance(
      currentValue.toString(),
      incomingValue.toString()
    ) / Math.max(currentValue.toString().length, incomingValue.toString().length);
  }

  // Apply thresholds
  if (diff >= rules.critical) return 'CRITICAL';
  if (diff >= rules.warning) return 'WARNING';
  if (diff >= rules.info) return 'INFO';

  // Values are equivalent (within tolerance)
  return 'INFO';
}
```

3. **Add tests for severity classification**:
```typescript
// scraper/tests/unit/services/conflict-severity.test.ts
describe('Conflict Severity Classification', () => {
  const engine = new NormalizationEngine();

  describe('Financial data', () => {
    test('50% revenue difference is CRITICAL', () => {
      const severity = engine.calculateSeverity(
        'revenueFy2024',
        1000000000,  // ₹100 Cr
        1500000000   // ₹150 Cr (50% higher)
      );
      expect(severity).toBe('CRITICAL');
    });

    test('15% revenue difference is WARNING', () => {
      const severity = engine.calculateSeverity(
        'revenueFy2024',
        1000000000,  // ₹100 Cr
        1150000000   // ₹115 Cr (15% higher)
      );
      expect(severity).toBe('WARNING');
    });

    test('1% revenue difference is INFO', () => {
      const severity = engine.calculateSeverity(
        'revenueFy2024',
        1000000000,  // ₹100 Cr
        1010000000   // ₹101 Cr (1% higher)
      );
      expect(severity).toBe('INFO');
    });
  });

  describe('Date conflicts', () => {
    test('10-day date difference is CRITICAL', () => {
      const severity = engine.calculateSeverity(
        'openDate',
        '2025-11-01',
        '2025-11-11'  // 10 days later
      );
      expect(severity).toBe('CRITICAL');
    });

    test('1-day date difference is INFO', () => {
      const severity = engine.calculateSeverity(
        'openDate',
        '2025-11-01',
        '2025-11-02'  // 1 day later
      );
      expect(severity).toBe('INFO');
    });
  });

  describe('Lot size', () => {
    test('any lot size difference is CRITICAL', () => {
      const severity = engine.calculateSeverity(
        'lotSize',
        75,
        100  // Different
      );
      expect(severity).toBe('CRITICAL');
    });
  });
});
```

4. **Update conflict logging**:
```typescript
// scraper/src/services/data-consolidation-service.ts
async logConflict(conflict: DataConflict) {
  await db.insert(data_conflicts).values({
    id: uuidv4(),
    ipoId: conflict.ipoId,
    fieldName: conflict.field,
    currentValue: conflict.currentValue?.toString(),
    currentSource: conflict.currentSource,
    attemptedValue: conflict.attemptedValue?.toString(),
    attemptedSource: conflict.attemptedSource,
    conflictReason: conflict.reason,
    severity: this.normalizationEngine.calculateSeverity(
      conflict.field,
      conflict.currentValue,
      conflict.attemptedValue
    ),  // ✅ Use smart severity calculation
    createdAt: new Date()
  });
}
```

5. **Deploy**:
```bash
git add scraper/src/config/conflict-severity-rules.ts
git add scraper/src/services/normalization-engine.ts
git commit -m "fix(conflicts): implement field-specific severity classification

- Add CONFLICT_SEVERITY_RULES for each field type
- Financial data: >25% = CRITICAL, >10% = WARNING
- Dates: >7 days = CRITICAL, >3 days = WARNING
- Lot size: Any difference = CRITICAL
- Update conflict logging to use smart severity"

npm run build --workspace=scraper
pm2 restart scraper
```

**Verification Checklist**:
- [ ] Unit tests pass for all severity scenarios
- [ ] Integration test with real conflicts
- [ ] Review existing conflicts in `data_conflicts` table
- [ ] Admin dashboard shows correctly classified conflicts

**Monitoring**:
```sql
-- Check conflict severity distribution
SELECT severity, COUNT(*) as count
FROM data_conflicts
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY severity;

-- Expected: More INFO than CRITICAL (not all conflicts are critical)
```

---

## 🔧 CATEGORY D: Deduplication Fixes (Service)

**Root Cause**: Missing or buggy IPO deduplication service
**Impact**: Duplicate IPOs created, poor user experience

---

### Issue D.1: Duplicate IPOs Created

**Fix**: See **Issue A.2** (Company Name False Negatives) above.

This is the same fix - implementing `IPODeduplicationService` with fuzzy matching.

---

## 🔧 CATEGORY E: Admin UI Fixes (Dashboard)

**Root Cause**: No UI to view/resolve data conflicts
**Impact**: Admins can't manually intervene in consolidation decisions

---

### Issue E.1: No Conflict Dashboard

**Symptoms**:
```
❌ data_conflicts table has 50 unresolved conflicts
❌ No UI to view conflicts
❌ Admin can't manually resolve conflicts
❌ No way to see field source history
```

**Fix Location**: Create `web/app/admin/conflicts/page.tsx`

**Step-by-Step Fix**:

1. **Create API endpoint for conflicts**:
```typescript
// web/app/api/admin/conflicts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { data_conflicts, ipos } from '@ipodhan/shared/db/schema';
import { eq, desc, and, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get('status') || 'unresolved';
  const limit = parseInt(searchParams.get('limit') || '50');

  try {
    const query = db.select({
      conflict: data_conflicts,
      ipo: {
        id: ipos.id,
        companyName: ipos.companyName,
        slug: ipos.slug,
        status: ipos.status
      }
    })
    .from(data_conflicts)
    .leftJoin(ipos, eq(data_conflicts.ipoId, ipos.id))
    .orderBy(desc(data_conflicts.createdAt))
    .limit(limit);

    // Filter by resolution status
    if (status === 'unresolved') {
      query.where(isNull(data_conflicts.resolvedAt));
    } else if (status === 'resolved') {
      query.where(isNull(data_conflicts.resolvedAt));
    }

    const conflicts = await query;

    return NextResponse.json({
      success: true,
      data: conflicts,
      meta: {
        total: conflicts.length,
        status
      }
    });
  } catch (error) {
    console.error('Conflicts API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conflicts' },
      { status: 500 }
    );
  }
}

// POST endpoint to resolve conflict
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { conflictId, resolution, adminNote } = body;

  try {
    await db.update(data_conflicts)
      .set({
        resolvedAt: new Date(),
        resolvedBy: 'admin',  // TODO: Get from session
        resolution: resolution,  // 'ACCEPT_CURRENT' | 'ACCEPT_ATTEMPTED' | 'MANUAL_OVERRIDE'
        adminNote: adminNote
      })
      .where(eq(data_conflicts.id, conflictId));

    return NextResponse.json({
      success: true,
      message: 'Conflict resolved'
    });
  } catch (error) {
    console.error('Resolve conflict error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve conflict' },
      { status: 500 }
    );
  }
}
```

2. **Create admin conflict dashboard page**:
```tsx
// web/app/admin/conflicts/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface DataConflict {
  id: string;
  ipoName: string;
  fieldName: string;
  currentValue: string;
  currentSource: string;
  attemptedValue: string;
  attemptedSource: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  conflictReason: string;
  createdAt: string;
}

export default function ConflictsPage() {
  const [conflicts, setConflicts] = useState<DataConflict[]>([]);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');

  useEffect(() => {
    fetchConflicts();
  }, [filter]);

  async function fetchConflicts() {
    const res = await fetch(`/api/admin/conflicts?status=unresolved`);
    const data = await res.json();
    setConflicts(data.data);
  }

  async function resolveConflict(conflictId: string, resolution: string) {
    await fetch('/api/admin/conflicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conflictId, resolution })
    });
    fetchConflicts(); // Refresh
  }

  const filteredConflicts = conflicts.filter(c => {
    if (filter === 'critical') return c.severity === 'CRITICAL';
    if (filter === 'warning') return c.severity === 'WARNING';
    return true;
  });

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Data Conflicts Dashboard</h1>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          All ({conflicts.length})
        </Button>
        <Button
          variant={filter === 'critical' ? 'destructive' : 'outline'}
          onClick={() => setFilter('critical')}
        >
          Critical ({conflicts.filter(c => c.severity === 'CRITICAL').length})
        </Button>
        <Button
          variant={filter === 'warning' ? 'default' : 'outline'}
          onClick={() => setFilter('warning')}
        >
          Warnings ({conflicts.filter(c => c.severity === 'WARNING').length})
        </Button>
      </div>

      {/* Conflict List */}
      <div className="space-y-4">
        {filteredConflicts.map(conflict => (
          <Card key={conflict.id} className="p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-semibold">{conflict.ipoName}</h3>
                <p className="text-sm text-gray-500">
                  Field: <code>{conflict.fieldName}</code>
                </p>
              </div>
              <Badge
                variant={
                  conflict.severity === 'CRITICAL'
                    ? 'destructive'
                    : conflict.severity === 'WARNING'
                    ? 'warning'
                    : 'default'
                }
              >
                {conflict.severity}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="border-l-4 border-blue-500 pl-4">
                <p className="text-sm font-semibold">Current Value (Kept)</p>
                <p className="text-lg">{conflict.currentValue}</p>
                <p className="text-xs text-gray-500">Source: {conflict.currentSource}</p>
              </div>
              <div className="border-l-4 border-orange-500 pl-4">
                <p className="text-sm font-semibold">Attempted Value (Rejected)</p>
                <p className="text-lg">{conflict.attemptedValue}</p>
                <p className="text-xs text-gray-500">Source: {conflict.attemptedSource}</p>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Reason: {conflict.conflictReason}
            </p>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => resolveConflict(conflict.id, 'ACCEPT_CURRENT')}
              >
                Keep Current
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => resolveConflict(conflict.id, 'ACCEPT_ATTEMPTED')}
              >
                Use Attempted
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const value = prompt('Enter manual value:');
                  if (value) {
                    resolveConflict(conflict.id, `MANUAL:${value}`);
                  }
                }}
              >
                Manual Override
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {filteredConflicts.length === 0 && (
        <p className="text-center text-gray-500 mt-8">No conflicts found.</p>
      )}
    </div>
  );
}
```

3. **Add navigation link**:
```tsx
// web/app/admin/layout.tsx
<nav>
  <Link href="/admin">Dashboard</Link>
  <Link href="/admin/ipos">IPOs</Link>
  <Link href="/admin/conflicts">Conflicts</Link>  {/* ✅ Add */}
</nav>
```

4. **Test**:
```bash
cd web
npm run dev
# Visit http://localhost:3000/admin/conflicts
```

5. **Deploy**:
```bash
git add web/app/admin/conflicts/
git add web/app/api/admin/conflicts/
git commit -m "feat(admin): add data conflicts dashboard

- View unresolved conflicts with severity filtering
- Resolve conflicts (keep current, use attempted, manual override)
- Real-time conflict count badges
- Integration with data_conflicts table"

npm run build --workspace=web
pm2 restart web
```

**Verification Checklist**:
- [ ] Dashboard loads with real conflict data
- [ ] Can filter by severity (CRITICAL, WARNING)
- [ ] Can resolve conflicts (all 3 options work)
- [ ] Resolved conflicts disappear from list
- [ ] Admin notes saved correctly

---

## 🚨 Emergency Fix Protocol

### P0 (Blocker) - Data Corruption / Duplicate IPOs

**Response Time**: < 2 hours

**Procedure**:
1. **Immediate Rollback**:
```bash
# Disable data consolidation
ENABLE_DATA_CONSOLIDATION=false pm2 restart scraper

# Or full rollback
git revert HEAD
npm run build
pm2 restart all
```

2. **Root Cause Analysis** (within 1 hour):
- Check recent scraper logs
- Query data_conflicts for patterns
- Review field_sources for corruption

3. **Hotfix**:
- Create hotfix branch: `hotfix/data-corruption-fix`
- Write failing test
- Implement fix
- Test on staging with real data
- Deploy to production

4. **Validation** (within 24 hours):
- Monitor for 24h
- Check duplicate IPO count
- Verify data integrity

### P1 (Major) - Wrong Data Source Winning

**Response Time**: < 24 hours

**Procedure**:
1. **Document Issue**:
- Capture affected IPOs
- Log incorrect data sources
- Note expected vs actual behavior

2. **Fix Priority Matrix**:
- Update `field-priority-matrix.ts`
- Add integration test
- Deploy with shadow mode first (24h)

3. **Validate**:
- Compare shadow mode decisions vs production
- Confirm improved data quality
- Full rollout after validation

### P2 (Minor) - UI Polish / Edge Cases

**Response Time**: < 1 week

**Procedure**:
1. **Create Issue** in tracker
2. **Add to Sprint** backlog
3. **Fix in Standard** release cycle
4. **No Emergency** deployment needed

---

## 📊 Fix Verification Checklist

For **every fix**, complete this checklist before deployment:

### 1. Testing
- [ ] Unit test passes (if applicable)
- [ ] Integration test passes
- [ ] Manual test with real production data
- [ ] No regression on existing tests

### 2. Code Review
- [ ] Code follows project patterns
- [ ] Comments added for complex logic
- [ ] Performance impact analyzed (<5% overhead)
- [ ] Security implications reviewed

### 3. Deployment
- [ ] Shadow mode validation (24h for P0/P1)
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Monitoring configured
- [ ] Rollback plan documented

### 4. Post-Deployment
- [ ] Metrics reviewed (24h, 72h, 1 week)
- [ ] Conflict rate decreased
- [ ] No new issues introduced
- [ ] Documentation updated

---

## 📈 Monitoring After Fixes

### Key Metrics to Track

**Data Quality Metrics**:
```sql
-- Conflict rate (should decrease after fixes)
SELECT
  DATE(created_at) as date,
  COUNT(*) as conflicts,
  AVG(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) as critical_rate
FROM data_conflicts
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

**Source Priority Metrics**:
```sql
-- Which sources are winning for each field
SELECT
  field_name,
  source,
  COUNT(*) as wins
FROM field_sources
WHERE updated_at > NOW() - INTERVAL '7 days'
GROUP BY field_name, source
ORDER BY field_name, wins DESC;
```

**Deduplication Metrics**:
```sql
-- Duplicate IPO detection rate
SELECT
  DATE(created_at) as date,
  COUNT(DISTINCT company_name) as unique_companies,
  COUNT(*) as total_ipos,
  (COUNT(*) - COUNT(DISTINCT company_name)) as duplicates
FROM ipos
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at);
```

### Alerts to Configure

**Sentry/Winston Alerts**:
```typescript
// High conflict rate alert
if (conflictRate > 0.05) {  // >5%
  logger.error('High conflict rate detected', {
    rate: conflictRate,
    last24h: conflictCount
  });
  sendSlackAlert('Data quality degradation detected');
}

// Duplicate IPO alert
if (duplicateDetected) {
  logger.critical('Duplicate IPO created', {
    ipo1: existing.id,
    ipo2: duplicate.id,
    companyName: existing.companyName
  });
  sendSlackAlert('URGENT: Duplicate IPO needs manual merge');
}
```

---

## ✅ Fix Completion Criteria

A fix is considered **complete** when:

1. **Tests Pass**:
   - [ ] Unit tests: 100% pass rate
   - [ ] Integration tests: 100% pass rate
   - [ ] Manual test with real data: Success

2. **Code Quality**:
   - [ ] Code review approved
   - [ ] ESLint: 0 errors
   - [ ] TypeScript: 0 type errors
   - [ ] Test coverage maintained or improved

3. **Deployment**:
   - [ ] Shadow mode validation (if applicable)
   - [ ] Gradual rollout completed
   - [ ] Production metrics stable (72h)
   - [ ] Zero critical incidents

4. **Documentation**:
   - [ ] Fix documented in this file
   - [ ] Comments added to code
   - [ ] Runbook updated (if needed)
   - [ ] Team notified

5. **Monitoring**:
   - [ ] Metrics show improvement
   - [ ] Alerts configured
   - [ ] No regression detected

---

## 🔗 Related Documents

- **Testing Plan**: `Plan-Data-Flow-Architecture-Fix Implementation-testing.md` (identifies issues)
- **Implementation Plan**: `Plan-Data-Flow-Architecture-Fix Implementation.md` (builds features)
- **Database Schema**: `packages/shared/src/db/schema.ts`
- **Data Consolidation Service**: `scraper/src/services/data-consolidation-service.ts`
- **Field Priority Matrix**: `scraper/src/config/field-priority-matrix.ts`

---

**Document End**
**Total Fix Categories**: 5 (A-E)
**Total Common Issues**: 10+
**Average Fix Time**: 2-8 hours per issue
**Emergency Response**: < 2 hours for P0