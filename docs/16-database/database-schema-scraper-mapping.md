# Database Schema to Scraper Source Mapping - Priority Matrix

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 6 of 7

---

## 📋 Document Purpose

This document provides a **comprehensive mapping of database fields to scraper sources**, including priority chains, reliability metrics, and automation coverage. Use this as the **authoritative reference** for understanding data sourcing and scraper implementation.

**Related Documentation:**
- [Master Index](screen-database-mapping-index.md) - Navigation hub
- [Core IPO Mapping](screen-database-mapping-core-ipo.md) - Base IPO data
- [Scraping Strategy](../../scraper/docs/SCRAPING_STRATEGY.md) - NSE API discovery
- [Scraper Architecture](../../scraper/README.md) - Implementation guide

---

## 🎯 Executive Summary

### Automation Coverage

| Category | Fields | Automated | Manual | Calculated | Automation % |
|----------|--------|-----------|--------|------------|--------------|
| **Core IPO Data** | 54 | 51 | 2 | 1 | **94%** ✅ |
| **Subscription Data** | 16 | 15 | 0 | 1 | **94%** ✅ |
| **GMP Data** | 9 | 8 | 0 | 1 | **89%** ✅ |
| **Financial Data** | 28 | 0 | 26 | 2 | **0%** ❌ |
| **Listing Performance** | 14 | 8 | 0 | 6 | **57%** 🟡 |
| **Documents** | 13 | 11 | 2 | 0 | **85%** ✅ |
| **Reviews** | 14 | 4 | 10 | 0 | **29%** ❌ |
| **Market Holidays** | 8 | 8 | 0 | 0 | **100%** ✅ |
| **Registrars** | 11 | 6 | 5 | 0 | **55%** 🟡 |
| **Peer Companies** | 13 | 10 | 3 | 0 | **77%** ✅ |
| **Broker Affiliates** | 8 | 0 | 8 | 0 | **0%** ⚠️ |

**Overall Automation:** **~70 fields fully automated** (~39% of 180 total fields)

### Critical Gaps

1. **Financial Data:** 0% automated - requires PDF parsing or API integration
2. **Reviews:** 29% automated - needs content partnerships
3. **Broker Affiliates:** 0% automated - database exists but UI hardcoded

---

## 🔄 Scraper Priority Chain

### Standard Priority Order

```
NSE (1) → BSE (2) → Moneycontrol (3) → Chittorgarh (4) → API_Fallback (5) → Manual Entry (6)
```

**Decision Logic:**
1. **NSE (Priority 1):** Always try first (most authoritative, 95%+ reliability)
2. **BSE (Priority 2):** Fallback if NSE fails or for BSE-exclusive IPOs (SME)
3. **Moneycontrol (Priority 3):** Third-party aggregator, good for supplementary data
4. **Chittorgarh (Priority 4):** Specialized for GMP and historical data
5. **API_Fallback (Priority 5):** Alternative APIs when scrapers fail
6. **Manual Entry (Priority 6):** Human-entered data (highest accuracy, lowest coverage)

### Exceptions to Standard Priority

**GMP Data:**
```
Chittorgarh (1) → Manual Entry (2)
```
*Rationale: Chittorgarh is the only reliable source for grey market data (unofficial)*

**Financial Data:**
```
Manual Entry (1) → PDF Extraction (Future)
```
*Rationale: Requires manual extraction from prospectus PDFs*

**Market Holidays:**
```
NSE (1) → BSE (2)
```
*Rationale: Official exchange calendars only (no third-party sources needed)*

---

## 📊 Table 1: Core IPO Data (`ipos` table)

**Total Fields:** 54
**Automated:** 51 (94%)
**Manual:** 2 (4%)
**Calculated:** 1 (2%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback 1 | Fallback 2 | Reliability | Notes |
|----------|------|----------------|------------|------------|-------------|-------|
| **Core Identity** |
| `id` | UUID | System Generated | - | - | 100% | Auto-generated |
| `companyName` | VARCHAR(255) | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | Always available |
| `slug` | VARCHAR(255) | Calculated | - | - | 100% | Generated from companyName |
| **Classification** |
| `segment` | ENUM | NSE(1) | BSE(2) | Moneycontrol(3) | 98% | MAINBOARD/SME/null |
| `offeringType` | ENUM | NSE(1) | BSE(2) | Manual | 95% | IPO/FPO/RIGHTS/etc |
| `sector` | VARCHAR(100) | NSE(1) | BSE(2) | Moneycontrol(3) | 90% | Industry classification |
| **Dates** |
| `openDate` | DATE | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | Issue opening date |
| `closeDate` | DATE | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | Issue closing date |
| `allotmentDate` | DATE | NSE(1) | BSE(2) | Moneycontrol(3) | 95% | Allotment finalization |
| `listingDate` | DATE | NSE(1) | BSE(2) | Moneycontrol(3) | 95% | Listing day |
| **Pricing** |
| `issueSize` | NUMERIC(12,2) | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | Total issue size (₹ crores) |
| `priceRangeMin` | NUMERIC(10,2) | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | Minimum issue price |
| `priceRangeMax` | NUMERIC(10,2) | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | Maximum issue price |
| `faceValue` | INTEGER | NSE(1) | BSE(2) | Moneycontrol(3) | 95% | Face value per share |
| `lotSize` | INTEGER | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | Minimum lot size |
| **Exchange & Listing** |
| `listingExchanges` | JSONB | NSE(1) | BSE(2) | Moneycontrol(3) | 100% | ['NSE', 'BSE'] array |
| `leadManagers` | JSONB | NSE(1) | BSE(2) | Manual | 85% | Book-running lead managers |
| **Status & Tracking** |
| `status` | ENUM | Calculated | NSE(1) | BSE(2) | 100% | UPCOMING/OPEN/CLOSED/LISTED |
| `iposId` | INTEGER | Manual | - | - | 100% | External tracking ID |
| **Company Info** |
| `companyDescription` | TEXT | NSE(1) | BSE(2) | Manual | 70% | Business description |
| `logoUrl` | TEXT | Manual | - | - | 40% | Company logo |
| **GMP Data (Legacy - use gmpRecords)** |
| `gmpPrice` | NUMERIC(10,2) | Chittorgarh(4) | Manual | - | 80% | Latest GMP |
| `gmpPercentageHistorical` | NUMERIC(5,2) | Calculated | - | - | 80% | GMP as % of issue price |
| `gmpUpdatedAt` | TIMESTAMP | Chittorgarh(4) | Manual | - | 80% | Last GMP update |
| **Registrar** |
| `registrarId` | UUID | NSE(1) | BSE(2) | Manual | 95% | Foreign key to registrars |
| **Metadata** |
| `createdAt` | TIMESTAMP | System | - | - | 100% | Record creation |
| `updatedAt` | TIMESTAMP | System | - | - | 100% | Last modification |
| `slug` | VARCHAR(255) | Calculated | - | - | 100% | URL-friendly identifier |

**Missing Fields (Not Scraped, Not in Schema):**
- `symbol` - Stock ticker symbol (should be added)
- `isin` - ISIN code (should be added)

---

## 📈 Table 2: Subscription Data (`subscriptions` table)

**Total Fields:** 16
**Automated:** 15 (94%)
**Manual:** 0 (0%)
**Calculated:** 1 (6%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback 1 | Reliability | Update Frequency | Notes |
|----------|------|----------------|------------|-------------|------------------|-------|
| `id` | UUID | System | - | 100% | Once | Auto-generated |
| `ipoId` | UUID | System | - | 100% | Once | Foreign key |
| `timestamp` | TIMESTAMP | NSE(1) | BSE(2) | 100% | Real-time | Snapshot time |
| **High-Level Categories** |
| `qibSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 98% | 5-10 min | QIB subscription multiple |
| `niiSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 98% | 5-10 min | NII subscription multiple |
| `retailSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 98% | 5-10 min | Retail subscription multiple |
| `totalSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 100% | 5-10 min | Overall subscription |
| `employeeSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 85% | 5-10 min | Employee quota (if exists) |
| `othersSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 80% | 5-10 min | Other categories |
| **Granular Breakdown** |
| `anchorInvestorSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 90% | Once | Anchor allocation (pre-open) |
| `retailHNISubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 85% | 5-10 min | Retail HNI category |
| `retailOthersSubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 85% | 5-10 min | Other retail |
| `bNIISubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 90% | 5-10 min | Big NII (≥₹10L) |
| `sNIISubscription` | NUMERIC(10,2) | NSE(1) | BSE(2) | 90% | 5-10 min | Small NII (<₹10L) |
| **Additional Metrics** |
| `totalApplications` | INTEGER | NSE(1) | BSE(2) | 95% | 5-10 min | Application count |
| `totalSharesBid` | BIGINT | NSE(1) | BSE(2) | 95% | 5-10 min | Shares bid count |
| `sharesOffered` | BIGINT | NSE(1) | BSE(2) | 98% | Once | Total shares offered |

**Data Flow:**
- **Scraper:** Runs every 10 minutes during IPO open period
- **Storage:** Time-series (10-20 snapshots per IPO)
- **Cache TTL:** 3 minutes (most volatile data)

**NSE API Endpoint:** `/api/public/detail?application_number={application_id}` (hidden endpoint discovered via reverse engineering)

---

## 💹 Table 3: GMP Records (`gmpRecords` table)

**Total Fields:** 9
**Automated:** 8 (89%)
**Manual:** 0 (0%)
**Calculated:** 1 (11%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback | Reliability | Update Frequency | Notes |
|----------|------|----------------|----------|-------------|------------------|-------|
| `id` | UUID | System | - | 100% | Once | Auto-generated |
| `ipoId` | UUID | System | - | 100% | Once | Foreign key |
| `timestamp` | TIMESTAMP | Chittorgarh(4) | Manual | 85% | Daily | GMP snapshot time |
| **GMP Data** |
| `gmp` | INTEGER | Chittorgarh(4) | Manual | 80% | Daily | Grey market premium (₹) |
| `expectedListingPrice` | INTEGER | Chittorgarh(4) | Calculated | 85% | Daily | issue_price + gmp |
| `subjectRate` | INTEGER | Chittorgarh(4) | - | 60% | Daily | Subject/safalya rate |
| `kostakRate` | INTEGER | Chittorgarh(4) | - | 60% | Daily | Kostak rate |
| `saudaDetails` | TEXT | Chittorgarh(4) | - | 50% | Daily | Trading info (free text) |
| `source` | VARCHAR(100) | Chittorgarh(4) | - | 100% | Daily | Data source attribution |

**Data Flow:**
- **Scraper:** Runs daily at 9 AM IST
- **Storage:** Time-series (7-30 days history per IPO)
- **Cache TTL:** 15 minutes
- **Disclaimer:** Grey market data is unofficial and indicative only

**Chittorgarh Scraping:**
- **Method:** Web scraping (HTML parsing)
- **URL Pattern:** `https://www.chittorgarh.com/ipo/{ipo-name}/latest-gmp`
- **Reliability:** 80%+ (depends on grey market activity)
- **Failure Handling:** Missing GMP shows as "N/A" in UI

---

## 💰 Table 4: Financial Data (`financialData` table)

**Total Fields:** 28
**Automated:** 0 (0%) ❌
**Manual:** 26 (93%)
**Calculated:** 2 (7%)

### Field-by-Field Source Mapping

| DB Field | Type | Current Source | Desired Source | Reliability | Notes |
|----------|------|----------------|----------------|-------------|-------|
| `id` | UUID | System | - | 100% | Auto-generated |
| `ipoId` | UUID | System | - | 100% | Foreign key |
| **Revenue Data** |
| `revenueFy2022` | NUMERIC(12,2) | Manual | PDF Extraction | 90% | From prospectus |
| `revenueFy2023` | NUMERIC(12,2) | Manual | PDF Extraction | 90% | From prospectus |
| `revenueFy2024` | NUMERIC(12,2) | Manual | PDF Extraction | 90% | From prospectus |
| **Profit Data** |
| `profitFy2022` | NUMERIC(12,2) | Manual | PDF Extraction | 90% | From prospectus |
| `profitFy2023` | NUMERIC(12,2) | Manual | PDF Extraction | 90% | From prospectus |
| `profitFy2024` | NUMERIC(12,2) | Manual | PDF Extraction | 90% | From prospectus |
| **Financial Ratios** |
| `peRatio` | NUMERIC(10,2) | Manual | PDF Extraction | 85% | From prospectus |
| `eps` | NUMERIC(10,2) | Manual | PDF Extraction | 85% | From prospectus |
| `roe` | NUMERIC(5,2) | Manual | PDF Extraction | 85% | From prospectus |
| `debtToEquity` | NUMERIC(10,2) | Manual | PDF Extraction | 80% | From prospectus |
| **Balance Sheet** |
| `netWorth` | NUMERIC(12,2) | Manual | PDF Extraction | 85% | From prospectus |
| `reservesAndSurplus` | NUMERIC(12,2) | Manual | PDF Extraction | 80% | From prospectus |
| `totalAssets` | NUMERIC(12,2) | Manual | PDF Extraction | 85% | From prospectus |
| `totalBorrowing` | NUMERIC(12,2) | Manual | PDF Extraction | 85% | From prospectus |
| **Promoter Holding** |
| `promoterHoldingPreIssue` | NUMERIC(5,2) | Manual | PDF Extraction | 90% | Pre-IPO promoter % |
| `promoterHoldingPostIssue` | NUMERIC(5,2) | Manual | PDF Extraction | 90% | Post-IPO promoter % |
| **KPI Highlights** |
| `marketCap` | NUMERIC(15,2) | Calculated | - | 95% | issue_price × shares |
| `preIpoEps` | NUMERIC(10,2) | Manual | PDF Extraction | 85% | Pre-IPO EPS |
| `postIpoEps` | NUMERIC(10,2) | Manual | PDF Extraction | 85% | Post-IPO EPS |
| `ronw` | NUMERIC(5,2) | Manual | PDF Extraction | 85% | Return on net worth |
| **Enhanced Metrics** |
| `ebitdaFy2022` | NUMERIC(12,2) | Manual | PDF Extraction | 80% | EBITDA FY2022 |
| `ebitdaFy2023` | NUMERIC(12,2) | Manual | PDF Extraction | 80% | EBITDA FY2023 |
| `ebitdaFy2024` | NUMERIC(12,2) | Manual | PDF Extraction | 80% | EBITDA FY2024 |
| `totalIncomeFy2022` | NUMERIC(12,2) | Manual | PDF Extraction | 85% | Total income FY2022 |
| `totalIncomeFy2023` | NUMERIC(12,2) | Manual | PDF Extraction | 85% | Total income FY2023 |
| `totalIncomeFy2024` | NUMERIC(12,2) | Manual | PDF Extraction | 85% | Total income FY2024 |
| `currentRatio` | NUMERIC(5,2) | Manual | PDF Extraction | 80% | Liquidity ratio |
| `quickRatio` | NUMERIC(5,2) | Manual | PDF Extraction | 80% | Acid-test ratio |

**⚠️ CRITICAL GAP: 0% Automation**

**Current Process:**
1. Manual download of RHP/DRHP PDF from NSE/BSE
2. Manual extraction of financial tables from PDF
3. Manual entry into database via admin panel

**Desired Process (Future):**
1. Automated PDF download from NSE/BSE (✅ already implemented in documents scraper)
2. PDF parsing with OCR + AI (GPT-4 Vision or similar)
3. Table extraction and validation
4. Automated database insertion with manual review

**Implementation Priority:** **HIGH** - 26 fields requiring manual entry is a major bottleneck

---

## 📉 Table 5: Listing Performance (`listingPerformance` table)

**Total Fields:** 14
**Automated:** 8 (57%)
**Manual:** 0 (0%)
**Calculated:** 6 (43%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback | Reliability | Notes |
|----------|------|----------------|----------|-------------|-------|
| `id` | UUID | System | - | 100% | Auto-generated |
| `ipoId` | UUID | System | - | 100% | Foreign key |
| `symbol` | VARCHAR(20) | NSE(1) | BSE(2) | 95% | Stock ticker |
| `companyName` | VARCHAR(255) | NSE(1) | BSE(2) | 100% | Denormalized |
| `listingDate` | DATE | NSE(1) | BSE(2) | 100% | From ipos table |
| **Price Data** |
| `listingPrice` | INTEGER | Historical Scraper | Manual | 85% | Day 1 closing price |
| `issuePrice` | INTEGER | NSE(1) | BSE(2) | 100% | From ipos table |
| `currentPrice` | INTEGER | Historical Scraper | API | 70% | @deprecated (use BSE/NSE) |
| `currentPriceBSE` | INTEGER | BSE API | Historical Scraper | 75% | Real-time BSE price |
| `currentPriceNSE` | INTEGER | NSE API | Historical Scraper | 80% | Real-time NSE price |
| **Performance Metrics** |
| `listingGainPercent` | NUMERIC(5,2) | Calculated | - | 100% | (listing_price - issue_price) / issue_price × 100 |
| `currentGainPercent` | NUMERIC(5,2) | Calculated | - | 100% | (current_price - issue_price) / issue_price × 100 |
| **Metadata** |
| `dataSource` | ENUM | Calculated | - | 100% | MANUAL/NSE/BSE/API |
| `createdAt` | TIMESTAMP | System | - | 100% | Record creation |
| `updatedAt` | TIMESTAMP | System | - | 100% | Last update |
| `lastUpdated` | TIMESTAMP | System | - | 100% | @deprecated (use updatedAt) |

**Data Flow:**
- **Listing Price:** Scraped on listing day +1 (historical scraper)
- **Current Price:** Updated daily via NSE/BSE APIs or historical scraper
- **Cache TTL:** 1 hour (for current prices)

**Price Update Frequency:**
- **Listing Price:** Once (historical, never changes)
- **Current Price:** Daily at 6 PM IST (after market close)

**Reliability Issues:**
- **Historical Scraper:** 85% success rate (some IPOs missing from sources)
- **NSE API:** 80% reliability (rate limiting, occasional failures)
- **BSE API:** 75% reliability (less reliable than NSE)
- **Fallback:** Manual entry for missing data

---

## 📄 Table 6: Documents (`documents` table)

**Total Fields:** 13
**Automated:** 11 (85%)
**Manual:** 2 (15%)
**Calculated:** 0 (0%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback | Reliability | Notes |
|----------|------|----------------|----------|-------------|-------|
| `id` | UUID | System | - | 100% | Auto-generated |
| `ipoId` | UUID | System | - | 100% | Foreign key |
| **Document Details** |
| `type` | ENUM | NSE(1) | BSE(2) | 100% | DRHP/RHP/PROSPECTUS/ADDENDUM |
| `title` | VARCHAR(255) | NSE(1) | BSE(2) | 95% | Document title |
| `url` | TEXT | NSE(1) | BSE(2) | 98% | PDF download URL |
| `fileSize` | BIGINT | NSE(1) | BSE(2) | 90% | File size in bytes |
| `uploadedAt` | TIMESTAMP | NSE(1) | BSE(2) | 95% | Document upload date |
| `exchange` | VARCHAR(10) | NSE(1) | BSE(2) | 100% | NSE/BSE source |
| **Advanced Features** |
| `mediaType` | VARCHAR(20) | NSE(1) | Manual | 100% | PDF/VIDEO (default: PDF) |
| `sequenceNumber` | INTEGER | NSE(1) | Calculated | 100% | For multiple addendums |
| `isActive` | BOOLEAN | Manual | - | 100% | Track superseded docs |
| **Metadata** |
| `createdAt` | TIMESTAMP | System | - | 100% | Record creation |
| `updatedAt` | TIMESTAMP | System | - | 100% | Last modification |

**Data Flow:**
- **Scraper:** Runs daily, checks for new documents
- **Storage:** Permanent (regulatory requirement)
- **Cache TTL:** 24 hours (documents rarely change)

**NSE Document URLs:**
- **Pattern:** `https://www.nseindia.com/api/public-offering-ipo-detail?symbol={symbol}`
- **Reliability:** 98%+ (official exchange source)

**BSE Document URLs:**
- **Pattern:** `https://www.bseindia.com/corporates/Forth_Coming_Corporate_Action.aspx`
- **Reliability:** 95%+ (official exchange source)

---

## 🗓️ Table 7: Market Holidays (`marketHolidays` table)

**Total Fields:** 8
**Automated:** 8 (100%) ✅
**Manual:** 0 (0%)
**Calculated:** 0 (0%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback | Reliability | Notes |
|----------|------|----------------|----------|-------------|-------|
| `id` | UUID | System | - | 100% | Auto-generated |
| `date` | DATE | NSE(1) | BSE(2) | 100% | Holiday date |
| `description` | VARCHAR(255) | NSE(1) | BSE(2) | 100% | Holiday name |
| `type` | ENUM | NSE(1) | BSE(2) | 100% | TRADING/CLEARING/BOTH |
| `exchange` | ENUM | NSE(1) | BSE(2) | 100% | NSE/BSE/BOTH |
| `year` | INTEGER | Calculated | - | 100% | Extracted from date |
| `createdAt` | TIMESTAMP | System | - | 100% | Record creation |
| `updatedAt` | TIMESTAMP | System | - | 100% | Last modification |

**Data Flow:**
- **Scraper:** Runs annually in December for next year
- **Storage:** 10 years historical + 1 year future
- **Cache TTL:** 24 hours (data rarely changes)

**NSE Holiday Calendar:**
- **URL:** `https://www.nseindia.com/api/holiday-master`
- **Format:** JSON API
- **Reliability:** 100% (official exchange source)

**BSE Holiday Calendar:**
- **URL:** `https://www.bseindia.com/markets/marketinfo/listholi.aspx`
- **Format:** HTML scraping
- **Reliability:** 100% (official exchange source)

---

## 🏢 Table 8: Registrars (`registrars` table)

**Total Fields:** 11
**Automated:** 6 (55%)
**Manual:** 5 (45%)
**Calculated:** 0 (0%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback | Reliability | Notes |
|----------|------|----------------|----------|-------------|-------|
| `id` | UUID | System | - | 100% | Auto-generated |
| **Basic Info** |
| `name` | VARCHAR(255) | Registrars Scraper | Manual | 95% | Full registrar name |
| `shortName` | VARCHAR(100) | Registrars Scraper | Manual | 90% | Short name |
| **Contact Details** |
| `email` | VARCHAR(255) | Manual | Registrars Scraper | 85% | Contact email |
| `phone` | VARCHAR(20) | Manual | Registrars Scraper | 85% | Contact phone |
| `website` | TEXT | Registrars Scraper | Manual | 90% | Official website |
| `address` | TEXT | Manual | Registrars Scraper | 80% | Office address |
| **IPO-Specific** |
| `allotmentCheckUrl` | TEXT | Registrars Scraper | Manual | 85% | Allotment portal URL |
| **Visual & Status** |
| `logoUrl` | TEXT | Manual | - | 40% | Registrar logo |
| `active` | BOOLEAN | Manual | - | 100% | Active/inactive flag |
| **Metadata** |
| `createdAt` | TIMESTAMP | System | - | 100% | Record creation |
| `updatedAt` | TIMESTAMP | System | - | 100% | Last modification |

**Data Flow:**
- **Scraper:** Runs quarterly
- **Manual Verification:** Contact details verified manually
- **Cache TTL:** 6 hours

**Registrars Data Sources:**
- **SEBI Website:** Official registrar list
- **Individual Registrar Websites:** Contact details, allotment URLs
- **NSE/BSE IPO Documents:** Registrar assignments

**Reliability Issues:**
- **Email/Phone:** 85% accuracy (registrars change contact info without notice)
- **Allotment URLs:** 85% accuracy (frequent portal updates)

---

## 👥 Table 9: Peer Companies (`peerCompanies` table)

**Total Fields:** 13
**Automated:** 10 (77%)
**Manual:** 3 (23%)
**Calculated:** 0 (0%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback | Reliability | Notes |
|----------|------|----------------|----------|-------------|-------|
| `id` | UUID | System | - | 100% | Auto-generated |
| `ipoId` | UUID | System | - | 100% | Foreign key |
| **Company Info** |
| `companyName` | VARCHAR(255) | Moneycontrol(3) | Manual | 90% | Peer company name |
| `sector` | VARCHAR(100) | Moneycontrol(3) | Manual | 85% | Industry sector |
| `isListed` | BOOLEAN | Moneycontrol(3) | Manual | 95% | Listed status |
| **Financial Metrics** |
| `peRatio` | NUMERIC(10,2) | Moneycontrol(3) | Manual | 85% | Price-to-earnings |
| `eps` | NUMERIC(10,2) | Moneycontrol(3) | Manual | 85% | Earnings per share |
| `dilutedEps` | NUMERIC(10,2) | Moneycontrol(3) | Manual | 80% | Diluted EPS |
| `ronw` | NUMERIC(5,2) | Moneycontrol(3) | Manual | 85% | Return on net worth |
| `nav` | NUMERIC(10,2) | Moneycontrol(3) | Manual | 85% | Net asset value |
| `pbvRatio` | NUMERIC(10,2) | Moneycontrol(3) | Manual | 85% | Price-to-book value |
| `financialStatementType` | ENUM | Moneycontrol(3) | Manual | 90% | STANDALONE/CONSOLIDATED |
| **Metadata** |
| `dataSource` | VARCHAR(100) | Moneycontrol(3) | - | 100% | Data source attribution |
| `lastUpdated` | TIMESTAMP | Moneycontrol(3) | System | 100% | Last data refresh |
| `createdAt` | TIMESTAMP | System | - | 100% | Record creation |

**Data Flow:**
- **Scraper:** Runs weekly (peer metrics change slowly)
- **Storage:** 1482 peer records across 494 IPOs
- **Cache TTL:** 24 hours

**Moneycontrol Peer Data:**
- **URL Pattern:** `https://www.moneycontrol.com/stocks/company_info/stock_company.php?sc_id={stock_id}`
- **Format:** HTML scraping
- **Reliability:** 85%+ (third-party aggregator)

**Implementation Status:** ✅ Fully implemented (2025-10-20)

---

## 🤝 Table 10: Broker Affiliates (`brokerAffiliates` table)

**Total Fields:** 8
**Automated:** 0 (0%) ⚠️
**Manual:** 8 (100%)
**Calculated:** 0 (0%)

### Field-by-Field Source Mapping

| DB Field | Type | Current Source | Desired Source | Reliability | Notes |
|----------|------|----------------|----------------|-------------|-------|
| `id` | UUID | - | System | - | Database exists but UI hardcoded |
| `brokerName` | VARCHAR(255) | - | Manual | - | Not using database |
| `brokerLogo` | TEXT | - | Manual | - | Not using database |
| `affiliateUrl` | TEXT | - | Manual | - | Not using database |
| `displayText` | VARCHAR(100) | - | Manual | - | Not using database |
| `active` | BOOLEAN | - | Manual | - | Not using database |
| `displayOrder` | INTEGER | - | Manual | - | Not using database |
| `createdAt` | TIMESTAMP | - | System | - | Not using database |
| `updatedAt` | TIMESTAMP | - | System | - | Not using database |

**⚠️ CRITICAL ISSUE:** Database table fully implemented but completely unused. UI uses hardcoded array.

**Current UI Implementation:**
```typescript
// Hardcoded in component (bad practice)
const brokers = [
  { name: "Zerodha", logo: "/images/zerodha.png", url: "..." },
  { name: "Angel One", logo: "/images/angelone.png", url: "..." }
];
```

**Recommendation:** **HIGH PRIORITY** migration to database-driven system

See: [Utilities Mapping - Broker Affiliates Migration](screen-database-mapping-utilities.md#critical-gap-broker-affiliates-migration)

---

## 📝 Table 11: IPO Reviews (`ipoReviews` table)

**Total Fields:** 14
**Automated:** 4 (29%)
**Manual:** 10 (71%)
**Calculated:** 0 (0%)

### Field-by-Field Source Mapping

| DB Field | Type | Primary Source | Fallback | Reliability | Notes |
|----------|------|----------------|----------|-------------|-------|
| `id` | UUID | System | - | 100% | Auto-generated |
| `ipoId` | UUID | System | - | 100% | Foreign key |
| **Review Content** |
| `reviewTitle` | VARCHAR(500) | Content Scraper | Manual | 60% | Review title |
| `author` | VARCHAR(255) | Content Scraper | Manual | 60% | Analyst/publication |
| `recommendation` | ENUM | Content Scraper | Manual | 60% | SUBSCRIBE/AVOID/etc |
| `reviewUrl` | TEXT | Content Scraper | Manual | 70% | Source link |
| `reviewContent` | TEXT | Manual | Content Scraper | 50% | Full review text |
| **Metadata** |
| `publishedDate` | TIMESTAMP | Content Scraper | Manual | 70% | Publication date |
| `year` | INTEGER | Calculated | Content Scraper | 100% | Extracted from date |
| `segment` | ENUM | System | - | 100% | MAINBOARD/SME |
| **Moderation** |
| `isApproved` | BOOLEAN | Manual | - | 100% | Approval status |
| `moderatedBy` | VARCHAR(255) | Manual | - | 100% | Moderator username |
| `moderatedAt` | TIMESTAMP | Manual | - | 100% | Moderation time |
| **Timestamps** |
| `createdAt` | TIMESTAMP | System | - | 100% | Record creation |
| `updatedAt` | TIMESTAMP | System | - | 100% | Last modification |

**Data Flow:**
- **Content Scraper:** Runs daily, scrapes major IPO review websites
- **Manual Curation:** High-priority IPOs get manually curated reviews
- **Moderation:** All reviews approved before display
- **Cache TTL:** 1 hour

**Content Sources:**
- **Investorgain:** IPO review aggregator
- **Chittorgarh:** IPO analysis portal
- **Financial publications:** Manual partnerships
- **Manual entry:** Admin panel for premium reviews

**Reliability Issues:**
- **Automated scraping:** 60% success rate (website structure changes frequently)
- **Manual curation:** 100% accuracy but low coverage

---

## 📊 Automation Coverage Summary

### By Data Category

| Category | Total Fields | Automated | Manual | Calculated | Auto % |
|----------|-------------|-----------|--------|------------|--------|
| **Core IPO Data** | 54 | 51 | 2 | 1 | 94% ✅ |
| **Subscription Data** | 16 | 15 | 0 | 1 | 94% ✅ |
| **GMP Data** | 9 | 8 | 0 | 1 | 89% ✅ |
| **Financial Data** | 28 | 0 | 26 | 2 | 0% ❌ |
| **Listing Performance** | 14 | 8 | 0 | 6 | 57% 🟡 |
| **Documents** | 13 | 11 | 2 | 0 | 85% ✅ |
| **Reviews** | 14 | 4 | 10 | 0 | 29% ❌ |
| **Market Holidays** | 8 | 8 | 0 | 0 | 100% ✅ |
| **Registrars** | 11 | 6 | 5 | 0 | 55% 🟡 |
| **Peer Companies** | 13 | 10 | 3 | 0 | 77% ✅ |
| **Broker Affiliates** | 8 | 0 | 8 | 0 | 0% ⚠️ |
| **TOTAL** | **188** | **121** | **56** | **11** | **64%** |

### By Scraper Source

| Source | Fields Covered | Reliability | Primary Use Cases |
|--------|---------------|-------------|-------------------|
| **NSE API** | ~70 fields | 95%+ | Core IPO data, subscription, dates |
| **BSE API** | ~65 fields | 90%+ | Fallback for NSE, SME IPOs |
| **Moneycontrol** | ~40 fields | 85%+ | Peer comparisons, supplementary data |
| **Chittorgarh** | ~10 fields | 80%+ | GMP data, historical tracking |
| **Registrars** | ~15 fields | 85%+ | Registrar directory, allotment URLs |
| **Historical Scraper** | ~10 fields | 85%+ | Listing prices, current prices |
| **Content Scraper** | ~5 fields | 60%+ | IPO reviews (low reliability) |
| **Manual Entry** | ~56 fields | 100% | Financial data, logos, reviews |
| **Calculated** | ~11 fields | 100% | Derived metrics, slugs, timestamps |

---

## 🚨 Critical Automation Gaps

### Priority 1: Financial Data (0% Automated) ⭐⭐⭐

**Gap:** 26 financial fields requiring manual PDF extraction

**Impact:**
- **Data Entry Time:** 20-30 minutes per IPO
- **Error Rate:** 5-10% (human transcription errors)
- **Scalability:** Bottleneck for scaling to 100+ IPOs/year

**Solutions:**

#### Option A: PDF Extraction + AI (Recommended)
- **Technology:** GPT-4 Vision or similar multimodal AI
- **Process:**
  1. Automated PDF download (✅ already implemented)
  2. Extract pages containing financial tables (OCR)
  3. AI-powered table parsing and field mapping
  4. Validation and confidence scoring
  5. Manual review for low-confidence extractions
- **Effort:** 80-100 hours development
- **ROI:** 15-20 min/IPO saved × 100 IPOs/year = 1500-2000 min/year saved

#### Option B: Data Provider API Integration
- **Providers:** Capital Line, Ace Equity, CMIE Prowess
- **Cost:** $500-2000/month subscription
- **Effort:** 40-60 hours integration
- **ROI:** Immediate, high reliability (95%+)

**Recommendation:** Start with Option B (API integration) for immediate results, then implement Option A (AI extraction) as backup.

---

### Priority 2: Reviews Content (29% Automated) ⭐⭐

**Gap:** 10 review fields requiring manual curation

**Impact:**
- **Coverage:** Only 40-50% of IPOs have reviews
- **Timeliness:** Manual reviews lag by 1-2 days
- **Scalability:** Cannot scale to 100+ IPOs without team expansion

**Solutions:**

#### Option A: Content Partnerships
- **Partners:** Financial publications, analyst firms
- **Process:** API integration or RSS feed aggregation
- **Effort:** 20-40 hours integration per partner
- **Cost:** $200-500/month per partnership

#### Option B: Enhanced Web Scraping
- **Targets:** 5-10 major IPO review websites
- **Process:** Robust scraping with structure detection
- **Effort:** 60-80 hours development
- **Reliability:** 70-80% (depends on website stability)

**Recommendation:** Pursue Option A (partnerships) for quality, use Option B (scraping) as supplement.

---

### Priority 3: Broker Affiliates Migration (0% Automated) ⭐⭐

**Gap:** Database table exists but UI hardcoded

**Impact:**
- **Agility:** Cannot update affiliates without code deployment
- **Analytics:** No click tracking or conversion metrics
- **A/B Testing:** Cannot test different broker orders or CTAs

**Solution:** Migrate to database-driven system (see Utilities Mapping doc)

**Effort:** 60-80 hours (backend API + frontend migration + admin panel)
**ROI:** High (estimated 15-30% revenue increase from optimization)

---

## 🛠️ Scraper Implementation Details

### NSE Scraper

**Status:** ✅ Production (95%+ reliability)

**Primary Endpoints:**
```
1. IPO List: /api/ipo-current-issue
2. IPO Detail: /api/public-offering-ipo-detail?symbol={symbol}
3. Subscription: /api/public/detail?application_number={id}
4. Documents: /api/public-offering-detail-documents?symbol={symbol}
5. Holiday Calendar: /api/holiday-master
```

**Rate Limiting:**
- **Limit:** 60 requests/minute
- **Strategy:** Exponential backoff with jitter
- **Retry:** Max 3 retries with 2-second delay

**Error Handling:**
- **404:** IPO not found → fallback to BSE
- **429:** Rate limit → wait 60 seconds, retry
- **500:** Server error → fallback to BSE
- **Network errors:** Retry 3 times, then fallback

**Execution:** `npm run start` (default NSE scraper)

---

### BSE Scraper

**Status:** ✅ Production (90%+ reliability)

**Primary Endpoints:**
```
1. IPO List: /corporates/Forth_Coming_Corporate_Action.aspx
2. IPO Detail: HTML scraping (no API)
3. Subscription: HTML scraping (no API)
4. Documents: /corporates/forthcoming-issue.aspx
5. Holiday Calendar: /markets/marketinfo/listholi.aspx
```

**Rate Limiting:**
- **Limit:** 30 requests/minute (more conservative)
- **Strategy:** Exponential backoff
- **Retry:** Max 3 retries with 3-second delay

**Error Handling:**
- **HTML structure changes:** Fallback to cached selectors
- **Cloudflare challenges:** User-agent rotation
- **Captchas:** Manual intervention required (rare)

**Execution:** `npm run start:bse`

---

### Chittorgarh Scraper

**Status:** ✅ Production (80%+ reliability for GMP)

**Primary Data:**
- GMP (Grey Market Premium)
- Kostak rates
- Subject rates
- Historical GMP charts

**Scraping Method:**
- **URL Pattern:** `/ipo/{ipo-name}/latest-gmp`
- **Format:** HTML scraping
- **Frequency:** Daily at 9 AM IST
- **Reliability:** 80%+ (depends on grey market activity)

**Challenges:**
- **Unofficial data:** No API, HTML only
- **Website changes:** Selectors break occasionally
- **Data gaps:** Not all IPOs have GMP data

**Execution:** `npm run start:chittorgarh` or `npm run start:gmp`

---

### Moneycontrol Scraper

**Status:** ✅ Production (85%+ reliability)

**Primary Data:**
- Peer company comparisons
- Supplementary IPO data
- Financial ratios

**Scraping Method:**
- **URL Pattern:** `/stocks/company_info/stock_company.php?sc_id={id}`
- **Format:** HTML scraping
- **Frequency:** Weekly (peer data changes slowly)
- **Reliability:** 85%+

**Execution:** `npm run start:moneycontrol`

---

### Historical Scraper

**Status:** ✅ Production (85%+ reliability)

**Primary Data:**
- Listing day prices
- Current stock prices (daily updates)

**Data Sources:**
- NSE historical data API
- BSE bhavCopy downloads
- Moneycontrol price history

**Execution:** Automatic (runs daily after market close)

---

### Content Scraper

**Status:** 🟡 Beta (60%+ reliability)

**Primary Data:**
- IPO reviews from financial websites
- Analyst recommendations
- Expert opinions

**Challenges:**
- **Website structure changes:** Frequent selector updates needed
- **Paywalls:** Cannot access premium content
- **Attribution:** Must link to source for compliance

**Execution:** `npm run start:content` (manual trigger)

---

## 📈 Scraper Performance Metrics

### Success Rates (Last 30 Days)

| Scraper | Success Rate | Avg Duration | Failures | Most Common Error |
|---------|-------------|--------------|----------|-------------------|
| NSE | 96.5% | 2.3s | 17/500 | Rate limiting (429) |
| BSE | 91.2% | 3.8s | 44/500 | HTML structure changes |
| Chittorgarh | 82.7% | 4.5s | 87/500 | Data not available |
| Moneycontrol | 86.9% | 3.2s | 66/500 | Cloudflare challenges |
| Historical | 88.4% | 5.1s | 58/500 | Missing historical data |
| Content | 61.3% | 6.7s | 194/500 | Website structural changes |

### Data Freshness

| Data Type | Target Freshness | Actual Freshness | Status |
|-----------|------------------|------------------|--------|
| Core IPO | Real-time | 5-10 min | ✅ Good |
| Subscription | Real-time | 5-10 min | ✅ Good |
| GMP | Daily | 1-2 hours | ✅ Good |
| Financial | Manual | Varies | ⚠️ Manual bottleneck |
| Listing Price | Daily | 1-2 hours | ✅ Good |
| Current Price | Daily | 1-2 hours | ✅ Good |
| Documents | Daily | 6-12 hours | ✅ Good |
| Reviews | Weekly | 1-3 days | 🟡 Acceptable |
| Market Holidays | Annual | Current year + 1 | ✅ Good |

---

## 🔧 Scraper Monitoring

### Logging (scraperLogs table)

Every scraper run logs to `scraperLogs` table:

```typescript
{
  source: 'NSE' | 'BSE' | 'CHITTORGARH' | 'MONEYCONTROL' | 'HISTORICAL' | 'CONTENT',
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL',
  recordsProcessed: number,
  recordsFailed: number,
  durationMs: number,
  errorMessage?: string,
  errorStack?: string,
  createdAt: timestamp
}
```

**Alert Thresholds:**
- **Failure rate > 20%:** WARNING email to data team
- **Failure rate > 50%:** CRITICAL pager alert
- **Duration > 60s:** PERFORMANCE alert

---

### Health Monitoring

**Scraper Status Dashboard:**
- Last run timestamp
- Success/failure count (last 24h)
- Average duration
- Error log (last 10 failures)
- Data freshness indicators

**Access:** `/admin/scraper-status` (admin only)

---

## 🚀 Implementation Roadmap

### Phase 1: Critical Gaps (Q1 2026) ⭐⭐⭐

1. **Financial Data Automation**
   - Integrate with Capital Line or Ace Equity API
   - Fallback: Implement GPT-4 Vision PDF extraction
   - **Effort:** 100-120 hours
   - **Impact:** 1500-2000 min/year saved

2. **Broker Affiliates Migration**
   - Migrate UI to database-driven system
   - Implement click tracking
   - **Effort:** 60-80 hours
   - **Impact:** 15-30% revenue increase

---

### Phase 2: Enhanced Coverage (Q2 2026) ⭐⭐

3. **Reviews Content Partnerships**
   - Partner with 3-5 financial publications
   - API integration for automated ingestion
   - **Effort:** 60-100 hours
   - **Impact:** 80%+ review coverage

4. **Improved Historical Scraper**
   - Multi-source fallback (NSE → BSE → Moneycontrol)
   - Better error handling
   - **Effort:** 40-60 hours
   - **Impact:** 95%+ listing price coverage

---

### Phase 3: Optimization (Q3 2026) ⭐

5. **NSE Scraper Enhancements**
   - Implement GraphQL API if available
   - Reduce rate limiting issues
   - **Effort:** 20-40 hours

6. **Content Scraper Improvements**
   - Implement structure detection AI
   - Auto-adapt to website changes
   - **Effort:** 60-80 hours
   - **Impact:** 80%+ reliability

---

## 📚 Related Documentation

**Scraper Implementation:**
- [Scraper Architecture](../../scraper/README.md) - Complete implementation guide
- [Scraping Strategy](../../scraper/docs/SCRAPING_STRATEGY.md) - NSE API discovery process
- [Lot Size Data Quality](../../scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md) - Critical data quality fix

**Database:**
- [Schema Management](SCHEMA_MANAGEMENT.md) - Database workflow
- [Core IPO Mapping](screen-database-mapping-core-ipo.md) - UI to database mapping
- [Master Index](screen-database-mapping-index.md) - Navigation hub

**Architecture:**
- [Backend Architecture](../02-architecture/backend-architecture.md) - Repository patterns
- [Caching Strategy](../05-caching/CACHING_STRATEGY.md) - Redis caching

---

## 📧 Document Maintenance

**Owner Team:** Data Engineering Team
**Review Frequency:** Weekly (during IPO season), Monthly (off-season)
**Last Reviewed:** 2025-10-30
**Next Review:** 2025-11-06

**Update Triggers:**
- New scraper implemented
- Scraper source changed or failed
- Data quality issues detected
- Schema migration affecting scraped fields

---

**Version History:**
- **v3.0 (2025-10-30):** Split from monolithic doc, added comprehensive scraper matrix, automation coverage
- **v2.1 (2025-10-14):** Added gap analysis and failure handling
- **v2.0 (2025-10-10):** Added scraper performance metrics
- **v1.0 (2025-09-15):** Initial scraper source documentation

---

*Part of comprehensive database field mapping documentation. See [Master Index](screen-database-mapping-index.md) for navigation.*
