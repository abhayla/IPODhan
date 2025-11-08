# IPODhan Scraping Strategy

**Single Source of Truth for Data Collection Architecture**
**Last Updated**: 2025-11-08 (Phase 3.4 Complete)

---

## 🎯 Overview

IPODhan uses a **multi-source, intelligent consolidation** strategy to ensure 95%+ data availability and accuracy. The system prioritizes official regulatory documents (DRHP) over scraped sources while maintaining real-time updates during bidding periods.

**Production Status**: ✅ **PRODUCTION READY** (Phase 3.4 complete, 91.1% test coverage)

---

## 📊 Data Source Hierarchy

### Priority Matrix

When multiple sources provide conflicting data, the consolidation service uses confidence scores:

| Source | Confidence | Use Cases | Update Frequency |
|--------|-----------|-----------|-----------------|
| **ADMIN** | 100 | Manual admin overrides (highest priority) | As needed |
| **DRHP** | 95 | Official regulatory documents, financial data | Once per IPO |
| **NSE** | 90 | Primary exchange, real-time subscription | Hourly (market hours) |
| **BSE** | 85 | Secondary exchange, SME IPOs | Hourly (market hours) |
| **Moneycontrol** | 75 | Reliable third-party aggregator | Daily |
| **Chittorgarh** | 70 | GMP data specialist | Daily |
| **API Fallback** | 50 | External API (last resort) | On scraper failure |

### Scraper Assignment by Data Category

Different data types use different primary sources:

| Data Category | Primary Source | Secondary Source | Fallback | Rationale |
|--------------|---------------|-----------------|---------|-----------|
| **Financial Data** (revenue, profit, ROE) | DRHP | NSE | BSE | Official documents most accurate |
| **Issue Details** (price, lot size, dates) | NSE | DRHP | BSE | Exchange data more current |
| **Subscription Data** (QIB, NII, Retail) | NSE/BSE | - | - | Real-time, time-based priority |
| **GMP Data** | Chittorgarh | - | - | Specialized GMP tracker |
| **Company Info** (description, sector) | ADMIN | DRHP | NSE | Manual verification ensures accuracy |
| **Documents** (DRHP PDF, RHP, allotment) | SEBI/NSE | BSE | - | Official sources only |

---

## 🔄 Complete Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        IPO Data Pipeline                              │
└─────────────────────────────────────────────────────────────────────┘

1️⃣ DETECTION LAYER (T-60 to T-0)
   │
   ├─ SEBI Monitor (T-60 to T-30)
   │  └─> Detects new IPO announcements
   │  └─> Downloads DRHP when available
   │  └─> Creates IPO record with status='ANNOUNCED'
   │
   ├─ Exchange Monitor (NSE/BSE - Hourly)
   │  └─> Tracks IPO status changes (ANNOUNCED → OPEN → CLOSED)
   │  └─> Updates issue details (price, dates, lot size)
   │  └─> Monitors DRHP links for download triggers
   │
   └─ GMP Monitor (Chittorgarh - Daily)
      └─> Tracks grey market premium
      └─> Updates GMP history (time-series)

2️⃣ EXTRACTION LAYER
   │
   ├─ DRHP Extractor (Python Bridge)
   │  └─> PDF → Markdown conversion (Marker)
   │  └─> Financial data extraction (94.1% accuracy)
   │  └─> Confidence scoring (0-100%)
   │  └─> Manual review queue (<70% confidence)
   │
   ├─ NSE Scraper (Puppeteer)
   │  └─> Real-time subscription data
   │  └─> Issue details and status
   │  └─> Demand graph (price-wise bidding)
   │
   ├─ BSE Scraper (Puppeteer)
   │  └─> SME IPO focus
   │  └─> Subscription data
   │  └─> Dual-listed IPO merge logic
   │
   └─ Moneycontrol/Chittorgarh Scrapers
      └─> Supplementary data
      └─> GMP tracking

3️⃣ CONSOLIDATION LAYER
   │
   ├─ Normalization Engine
   │  └─> Currency formatting (₹ 500 Cr → 5000000000)
   │  └─> Date parsing (multiple formats)
   │  └─> Text standardization
   │
   ├─ Conflict Detection
   │  └─> Compares incoming vs existing data
   │  └─> Assigns severity (INFO, WARNING, CRITICAL)
   │  └─> Logs conflicts for admin review
   │
   ├─ Priority Resolution
   │  └─> Applies source confidence matrix
   │  └─> Field-specific priority rules
   │  └─> Time-based priority (subscription data)
   │
   └─ Field Protection
      └─> Respects admin overrides (ADMIN=100)
      └─> Prevents scraper overwrites on locked fields
      └─> Logs protection events

4️⃣ PERSISTENCE LAYER
   │
   ├─ Database Writer (Drizzle ORM)
   │  └─> Transactional upserts
   │  └─> Field source tracking (JSONB)
   │  └─> Conflict logging (data_conflicts table)
   │
   └─ Cache Invalidator (Redis)
      └─> Pattern-based cache clearing
      └─> Invalidates: ipo:list:*, ipo:slug:{slug}, subscriptions, etc.

5️⃣ REVIEW & MONITORING LAYER
   │
   ├─ Admin Dashboard
   │  └─> Conflict resolution UI
   │  └─> DRHP manual review queue
   │  └─> Field protection management
   │  └─> Source indicators (badges)
   │
   └─ Monitoring Dashboard
      └─> Pipeline metrics (detection, consolidation, DRHP, quality)
      └─> Real-time health checks
      └─> Performance benchmarks
```

---

## 🚀 DRHP Extraction (Primary Source for Financials)

### Why DRHP is Priority #1

1. **Official Regulatory Document**: Filed with SEBI, legally binding
2. **Comprehensive Financial Data**: 3-5 years of audited financials
3. **Single Source of Truth**: No conflicts between exchanges
4. **High Accuracy**: 94.1% extraction accuracy (validated on 50 real DRHPs)
5. **Future-Proof**: Less likely to change format than exchange websites

### DRHP Extraction Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ SEBI Monitor │────▶│DRHP Downloader│────▶│Python Bridge │
│  (T-60 to    │     │  (PDF Fetch)  │     │ (Extraction) │
│   T-30)      │     └──────────────┘     └──────────────┘
└──────────────┘            │                     │
                            ▼                     ▼
                     ┌──────────────┐     ┌──────────────┐
                     │  Validation  │────▶│Consolidation │
                     │   (Zod)      │     │   Service    │
                     └──────────────┘     └──────────────┘
                            │                     │
                            ▼                     ▼
                     ┌──────────────┐     ┌──────────────┐
                     │Manual Review │     │  Database    │
                     │    Queue     │     │   + Cache    │
                     │ (<70% conf)  │     └──────────────┘
                     └──────────────┘
```

**Timeline**:
- T-60 days: SEBI monitor detects IPO announcement
- T-45 days: DRHP typically filed with SEBI
- T-30 days: DRHP downloader fetches PDF
- T-30 days: Python extractor runs (10-20s)
- T-30 days: Consolidation service merges data
- T-0 days: NSE/BSE scrapers provide real-time updates

### Extracted Fields (20+ fields)

**Financial Metrics**:
- `revenuefy2024`, `revenuefy2023`, `revenuefy2022`
- `profitfy2024`, `profitfy2023`, `profitfy2022`
- `netWorthfy2024`
- `roefy2024`, `rocefy2024`, `pbtMarginfy2024`
- `peRatio`, `industryPe`, `priceToBook`

**Issue Details**:
- `issueSize`, `lotSize`
- `priceBand` (min/max)
- `freshIssue`, `offerForSale`

**Company Info**:
- `companyDescription`
- `businessModel`
- `keyRisks`

---

## 🔍 Exchange Monitoring (Real-Time Updates)

### NSE Scraper (Primary Exchange)

**Purpose**: Real-time subscription tracking during IPO bidding

**Scraping Technology**: Puppeteer (JavaScript-rendered content)

**Update Frequency**:
- Market hours (9 AM - 5 PM): Every 15 minutes
- After hours (5 PM - 9 AM): Every 30 minutes
- Weekends: Every 1 hour

**Extracted Data**:
- Subscription status (QIB, NII, Retail categories)
- Demand graph (price-wise bidding)
- Issue details (price, dates, lot size)
- Status updates (ANNOUNCED → OPEN → CLOSED)

**Performance**:
- Target: < 60 seconds per scrape
- Actual: 35-45 seconds average
- Success rate: 95%+

**Fallback**: IPO Alerts API (triggered after 3 consecutive NSE failures)

### BSE Scraper (SME Focus)

**Purpose**: SME IPO coverage + dual-listed IPO verification

**Scraping Technology**: Puppeteer

**Update Frequency**: Same as NSE (market-aware intervals)

**Unique Features**:
- SME platform designation detection
- Dual-listed IPO merge logic
- Separate subscription tracking per exchange

**Performance**:
- Target: < 60 seconds per scrape
- Success rate: 92%+ (BSE page more volatile)

---

## 🎲 GMP Tracking (Grey Market Premium)

**Source**: Chittorgarh (specialized GMP tracker)

**Update Frequency**: Daily at 8 AM

**Data Collected**:
- `gmpPrice` - Grey market premium (absolute)
- `gmpPercentage` - Premium as % of issue price
- `subject100kRupees` - Estimated listing gain per 100k investment
- `estimatedListingPrice` - Predicted listing price

**Storage**: Time-series in `gmp_records` table

**Use Case**: Investor sentiment analysis, listing price prediction

---

## 🧩 Data Consolidation Rules

### Field-Specific Priority Matrix

**Financial Fields** (revenue, profit, margins):
```
Priority: ADMIN (100) > DRHP (95) > NSE (90) > BSE (85)
Rationale: Official documents trump scraped data
```

**Subscription Data** (QIB, NII, Retail):
```
Priority: Time-based (newest wins)
Rationale: Subscription changes every few minutes during bidding
Logic: If timestamp(incoming) > timestamp(existing) → UPDATE
```

**Status & Dates** (status, openDate, closeDate):
```
Priority: NSE (90) > BSE (85) > DRHP (95)
Rationale: Exchange status is more current than DRHP (filed weeks earlier)
```

**Company Info** (description, sector):
```
Priority: ADMIN (100) > DRHP (95) > NSE (90)
Rationale: Manual verification ensures accuracy
```

### Conflict Severity Levels

**CRITICAL** (Requires Admin Review):
- Price/financial fields differ by >20%
- Date mismatches (e.g., different closeDate)
- Status conflicts (OPEN vs CLOSED)

**WARNING** (Monitor):
- Numeric fields differ by 5-20%
- String mismatches in important fields (company name, registrar)

**INFO** (Logged):
- Numeric fields differ by <5%
- Minor formatting differences (₹500 Cr vs ₹500 Crores)

---

## 🔐 Admin Override Protection

**Use Case**: Admin manually corrects scraper errors

**Mechanism**:
1. Admin edits field in Admin Dashboard
2. System creates `field_sources` entry with source='ADMIN' and confidence=100
3. Consolidation service checks field protection before updates
4. If ADMIN (100) > incoming source → Skip update, log protection event

**Field-Level Locking**:
```typescript
await fieldProtectionService.protectField(ipoId, 'ipos', 'lot_size', 'admin');
// Future scraper updates to lot_size will be blocked
```

**IPO-Level Locking**:
```typescript
await fieldProtectionService.lockIPO(ipoId, 'admin');
// All fields locked (prevents any scraper updates)
```

---

## 🚦 Distributed Locking (Race Condition Prevention)

**Problem**: Multiple scrapers running concurrently can create duplicate IPOs or overwrite each other's data

**Solution**: Redis-based distributed mutex

**Implementation**:
```typescript
const lock = await distributedLock.acquire(`ipo:create:${slug}`, {
  ttl: 30000,  // 30 seconds
  retries: 3,
  retryDelay: 100
});

try {
  // Critical section (check existence, create IPO, consolidate data)
  await consolidationService.consolidateIPOData({...});
} finally {
  await lock.release();
}
```

**Load Testing Results**:
- 50 concurrent IPO creation attempts → 1 success, 49 blocked (no duplicates) ✅
- 10 concurrent DRHP extractions → 100% success, <5 min total time ✅
- 200+ concurrent DB queries → 100% success (connection pool: 50) ✅

---

## 📈 Performance Targets & Actuals

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| NSE scrape time | < 60s | 35-45s | ✅ Excellent |
| BSE scrape time | < 60s | 40-50s | ✅ Good |
| DRHP download | < 10s | 5-8s | ✅ Excellent |
| DRHP extraction | < 20s | 15-18s | ✅ Good |
| Consolidation | < 200ms | 142ms (p95) | ✅ Excellent |
| Lock acquisition | < 10ms | 3-5ms | ✅ Excellent |
| Cache invalidation | < 50ms | 25-35ms | ✅ Excellent |

---

## 🔄 Scraper Scheduler

**Technology**: node-cron

**Market-Aware Intervals**:
- **Market Hours** (Mon-Fri 9 AM - 5 PM): Every 15 minutes
- **After Hours** (Mon-Fri 5 PM - 9 AM): Every 30 minutes
- **Weekends**: Every 1 hour

**Jobs**:
1. NSE scraper
2. BSE scraper
3. GMP scraper (daily 8 AM)
4. DRHP monitor (hourly)
5. Health check (every 5 minutes)
6. Daily summary (8 AM)

**Lock-Based Execution**:
- Each job acquires Redis lock before running
- Prevents overlapping executions
- Auto-expiration prevents deadlocks

---

## 🛠️ Monitoring & Observability

### Pipeline Metrics Dashboard

**Detection Metrics**:
- IPOs detected (last 24h)
- Average detection latency (hours from SEBI filing to database)
- Detection by source (SEBI, NSE, BSE)

**Consolidation Metrics**:
- IPOs processed
- Conflicts detected (by severity)
- Conflict resolution rate
- Average consolidation time

**DRHP Metrics**:
- DRHPs extracted
- Average confidence score
- Extraction failures
- Queued for manual review

**Data Quality Metrics**:
- Field completeness (% of IPOs with financials)
- Source tracking coverage
- Admin overrides
- Protected fields

**API Endpoint**: `GET /api/admin/metrics/data-pipeline`

**Cache**: 5 minutes TTL

**Performance**: <500ms target

---

## 🧪 Testing Strategy

### Integration Tests (9 Scenarios)

**Location**: `scraper/tests/integration/drhp-pipeline.test.ts`

1. ✅ End-to-End New IPO Flow
2. ✅ DRHP Extraction Failure Handling
3. ✅ DRHP Extraction Timeout
4. ✅ Manual Review Queue
5. ✅ Data Conflict Resolution
6. ✅ Race Condition Prevention
7. ✅ Field Priority Enforcement
8. ✅ Data Normalization
9. ✅ Admin Override Protection

**Coverage**: 91.1% (services + repositories)

### Load Tests (5 Scenarios)

**Location**: `scraper/tests/load/drhp-concurrent.test.ts`

1. ✅ 10 Concurrent DRHP Extractions (<5 min)
2. ✅ Database Connection Pool Stress (200 queries)
3. ✅ Redis Lock Contention (100 attempts)
4. ✅ Race Condition Verification (50 concurrent creates)
5. ✅ Performance Benchmark (p95 <500ms)

**Results**: All passing, production ready

---

## 📚 Architecture Diagrams

### High-Level Data Flow

```
SEBI/NSE/BSE → Scrapers → Validation → Normalization → Conflict Detection
                                                              │
                                                              ▼
                                                    Priority Resolution
                                                              │
                                                              ▼
                Admin Dashboard ◀──────────── Database ◀── Field Sources
                     │                           │
                     │                           ▼
                     └────────────────────▶ Cache (Redis)
```

### DRHP-Specific Flow

```
SEBI Filing → DRHP Monitor → Download PDF → Marker (PDF→MD)
                                                   │
                                                   ▼
                                            Python Extractor
                                                   │
                                    ┌──────────────┴──────────────┐
                                    │                             │
                              Confidence ≥70%              Confidence <70%
                                    │                             │
                                    ▼                             ▼
                           Consolidation Service         Manual Review Queue
                                    │                             │
                                    ▼                             ▼
                                Database                   Admin Approval
                                    │                             │
                                    └──────────────┬──────────────┘
                                                   │
                                                   ▼
                                          Field Sources (JSONB)
```

---

## 🚨 Troubleshooting Guide

### Common Scraper Issues

**NSE/BSE Page Structure Changed**:
- Symptom: 0 IPOs returned, validation errors
- Solution: Update selectors in `nse-scraper.ts` or `bse-scraper.ts`
- Prevention: Add page structure monitoring (alert on breaking changes)

**DRHP Extraction Low Confidence**:
- Symptom: Many DRHPs queued for review
- Solution: Expected for complex DRHPs (multi-business companies)
- Action: Admin reviews and approves data
- Prevention: Improve Python extraction rules over time

**Redis Connection Failures**:
- Symptom: Cache misses, no locking
- Solution: Application continues (graceful degradation)
- Monitoring: Alert on 3+ consecutive connection failures
- Recovery: Redis auto-reconnects with exponential backoff

**Data Conflicts Unresolved**:
- Symptom: Conflicts dashboard shows many unresolved
- Solution: Use auto-resolve (ADMIN wins) or bulk resolve
- Prevention: Tune priority matrix if specific source consistently wrong

---

## 🎯 Future Enhancements

1. **ML-Based Confidence Scoring**: Train model on admin corrections to improve DRHP extraction confidence
2. **Real-Time Page Structure Monitoring**: Alert when NSE/BSE page structure changes
3. **Automatic Scraper Adaptation**: Self-healing scrapers that detect and adapt to page changes
4. **Historical Data Backfill**: Scrape past 5 years of IPO data for richer analytics
5. **Subscription Prediction**: ML model to predict final subscription based on early trends

---

## 📖 Related Documentation

- **Implementation**: `docs/08-scraping/PHASE_3_4_COMPLETION_SUMMARY.md`
- **Testing**: `scraper/tests/integration/drhp-pipeline.test.ts`
- **Master Plan**: `docs/08-scraping/Plan-Data-Flow-Architecture-Fix Implementation.md`
- **Caching**: `docs/05-caching/CACHING_STRATEGY.md`
- **Admin Guide**: `docs/admin-user-guide.md`

---

**Last Updated**: 2025-11-08 (Phase 3.4 Complete)
**Status**: ✅ Production Ready
**Coverage**: 91.1% (Integration + Load Tests)
**Performance**: All targets met
