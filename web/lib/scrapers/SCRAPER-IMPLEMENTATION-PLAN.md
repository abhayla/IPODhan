# Data Scraper Implementation Plan

**Date:** October 13, 2025
**Status:** Implementation in Progress

---

## Overview

This document outlines the implementation strategy for data scrapers to populate the IPODhan platform with real-world data from public sources.

## Scraper Architecture

### Infrastructure ✅ COMPLETE
- **HTTP Client** (`utils/http-client.ts`): Rate-limited, retry-enabled HTTP client
- **Parser Utilities** (`utils/parser.ts`): Cheerio-based HTML parsing with helper functions
- **Base Scraper** (`base-scraper.ts`): Abstract class providing common functionality

### Dependencies
- **cheerio**: HTML/XML parsing (jQuery-like API)
- **Node.js fetch**: HTTP requests (built-in)
- **Drizzle ORM**: Database operations

---

## Data Sources & Implementation Strategy

### 1. Market Holidays Scraper
**Priority:** HIGH (Simple, well-structured data)
**Sources:**
- NSE Official Website: https://www.nseindia.com/regulations/trading-holidays
- BSE Official Website: https://www.bseindia.com/static/about/Market_Holidays.aspx

**Data Structure:**
```typescript
interface MarketHoliday {
  date: Date;
  description: string;
  exchange: 'NSE' | 'BSE' | 'BOTH';
  type: 'TRADING' | 'SETTLEMENT';
  year: number;
}
```

**Implementation Approach:**
1. NSE provides structured calendar data (HTML table or JSON API)
2. BSE provides HTML table on static page
3. Parse both sources, deduplicate, and store
4. Run annually or when holidays change

**Status:** 🔄 IN PROGRESS

---

### 2. IPO Reviews Scraper
**Priority:** HIGH (Critical for user decision-making)
**Potential Sources:**
- Chittorgarh.com IPO Reviews
- Invest or Mintgenie (if accessible)
- MoneyControl IPO Analysis
- Apply IPO (reviews section)

**Data Structure:**
```typescript
interface IPOReview {
  reviewTitle: string;
  author: string;
  recommendation: 'May apply' | 'Subscribe' | 'Avoid' | 'Not Recommended';
  ipoId: string; // Link to IPO
  publishedDate: Date;
  year: number;
  category: 'MAINBOARD' | 'SME';
  reviewUrl: string;
  reviewContent: string; // Full review text
}
```

**Implementation Approach:**
1. Identify IPO by company name matching
2. Extract review metadata (author, date, recommendation)
3. Parse full review content
4. Associate with existing IPO records
5. Run daily for new reviews

**Challenges:**
- Matching IPO names (fuzzy matching needed)
- Extracting structured recommendation from text
- Handling paywall content

**Status:** 📋 PLANNED

---

### 3. Prospectus Documents Scraper
**Priority:** HIGH (Legal requirement for informed investing)
**Primary Sources:**
- SEBI Website: https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=12
- NSE IPO Section: https://www.nseindia.com/market-data/upcoming-ipo
- BSE IPO Section: https://www.bseindia.com/markets/PublicIssues/IPOIssueTracker.aspx
- Company websites (secondary)

**Data Structure:**
```typescript
interface ProspectusDocument {
  ipoId: string;
  documentType: 'DRHP' | 'RHP' | 'PROSPECTUS';
  title: string;
  url: string; // Direct download link
  fileSize: number | null;
  uploadedAt: Date;
  exchange: 'NSE' | 'BSE' | 'BOTH';
}
```

**Implementation Approach:**
1. Scrape NSE/BSE IPO pages for document links
2. Verify document availability
3. Store metadata (not the PDF itself - just the link)
4. Update when new documents are filed
5. Run daily

**Challenges:**
- Dynamic JavaScript content (may need headless browser)
- PDF download links may be temporary
- SEBI website structure changes

**Status:** 📋 PLANNED

---

### 4. Historical IPO Data Scraper
**Priority:** MEDIUM (One-time bulk load + incremental updates)
**Sources:**
- Chittorgarh.com IPO Database (comprehensive historical data)
- MoneyControl IPO Section
- NSE Historical IPO Data
- BSE Historical IPO Data

**Data to Scrape:**
```typescript
interface HistoricalIPO {
  // Core Details
  companyName: string;
  ipoType: 'MAINBOARD' | 'SME' | 'FPO';
  issueSize: number; // in crores
  priceRange: { min: number; max: number };
  lotSize: number;

  // Dates
  openDate: Date;
  closeDate: Date;
  allotmentDate: Date | null;
  listingDate: Date | null;

  // Performance
  subscriptionTimes: {
    retail: number;
    hni: number;
    qib: number;
    overall: number;
  } | null;

  gmp: number | null; // Grey Market Premium
  listingGainPercent: number | null;

  // Current Prices (if listed)
  currentPriceBSE: number | null;
  currentPriceNSE: number | null;

  // Additional
  listingExchanges: string[];
  sector: string | null;
  year: number;
}
```

**Implementation Approach:**
1. Bulk scrape historical data (2020-2025)
2. Parse listing performance data
3. Match with existing IPOs or create new records
4. Update current prices periodically
5. Run: Initial bulk load, then daily for updates

**Challenges:**
- Large data volume (hundreds of IPOs)
- Inconsistent data formats across years
- Matching company names with existing records
- Scraping current prices (may need real-time API)

**Status:** 📋 PLANNED

---

### 5. Rights Issues Scraper
**Priority:** LOW (Less frequent than IPOs)
**Sources:**
- NSE Corporate Actions: https://www.nseindia.com/companies-listing/corporate-filings-actions
- BSE Corporate Actions: https://www.bseindia.com/corporates/Forth_Coming.aspx
- MoneyControl Rights Issues

**Data Structure:**
```typescript
interface RightsIssue {
  companyName: string;
  recordDate: Date;
  openDate: Date;
  closeDate: Date;
  renunciationDate: Date | null;
  ratio: string; // e.g., "1:3" (1 new share for every 3 held)
  issuePrice: number;
  issueSize: number | null; // in crores
  exchange: 'NSE' | 'BSE' | 'BOTH';
  status: 'UPCOMING' | 'LIVE' | 'CLOSED';
  prospectusUrl: string | null;
  year: number;
}
```

**Implementation Approach:**
1. Scrape NSE/BSE corporate actions pages
2. Filter for rights issues
3. Parse dates and ratios
4. Store with proper status
5. Run weekly (rights issues are less frequent)

**Challenges:**
- Parsing ratio format (various notations)
- Tracking status changes (upcoming -> live -> closed)
- Limited structured data on exchange websites

**Status:** 📋 PLANNED

---

## Implementation Order

### Phase 1: Foundation (Current)
1. ✅ HTTP Client with rate limiting
2. ✅ HTML Parser utilities
3. ✅ Base Scraper class
4. 🔄 Market Holidays Scraper (simplest, well-structured)

### Phase 2: Core Data
5. IPO Reviews Scraper
6. Prospectus Documents Scraper

### Phase 3: Historical Data
7. Historical IPO Data Scraper (bulk load)

### Phase 4: Additional Features
8. Rights Issues Scraper

### Phase 5: Automation
9. Scraper Orchestration System
10. Scheduling (cron jobs / BullMQ)
11. Error monitoring and alerting
12. Data quality validation

---

## Technical Considerations

### Rate Limiting
- NSE/BSE: 1-2 requests per second
- Third-party sites: 0.5-1 request per second
- Implement exponential backoff on errors

### Error Handling
- Retry failed requests (3 attempts)
- Log all failures for manual review
- Alert on critical failures

### Data Quality
- Validate all scraped data against schema
- Flag suspicious data for manual review
- Maintain audit trail of scraping operations

### Legal & Ethical
- **Robots.txt Compliance**: Check and respect robots.txt
- **Terms of Service**: Review ToS of all source websites
- **Attribution**: Provide proper data source attribution in UI
- **Caching**: Cache data appropriately to minimize requests
- **User-Agent**: Identify as IPODhan scraper with contact email

### Performance
- Run scrapers during off-peak hours
- Use database transactions for bulk inserts
- Implement idempotency (don't duplicate data)
- Monitor scraper execution time

---

## Database Strategy

### Upsert Logic
```typescript
// For market holidays (date + exchange is unique)
await db.insert(marketHolidays)
  .values(holiday)
  .onConflictDoUpdate({
    target: [marketHolidays.date, marketHolidays.exchange],
    set: { description: holiday.description, updatedAt: new Date() }
  });
```

### Deduplication
- Use unique constraints on natural keys
- Check for existing records before insert
- Update timestamps on changes

### Data Archiving
- Keep historical snapshots for auditing
- Archive old data (>5 years) to separate table

---

## Monitoring & Alerting

### Metrics to Track
- Scraping success rate
- Number of records scraped
- Execution time
- Error rate by source
- Data freshness (last successful scrape)

### Alerts
- Failed scrapes (email/Slack)
- Data quality issues (missing required fields)
- Unusual data patterns (e.g., sudden drop in record count)
- Source website changes (different HTML structure)

---

## Testing Strategy

### Unit Tests
- Test parser functions with sample HTML
- Test data transformation logic
- Test validation functions

### Integration Tests
- Test against live websites (sparingly)
- Use cached HTML responses for tests
- Mock HTTP client for CI/CD

### Data Quality Tests
- Validate scraped data against schema
- Check for common issues (null values, wrong types)
- Compare with known good data

---

## Deployment

### Environment Variables
```bash
ENABLE_SCRAPERS=true
SCRAPER_LOG_LEVEL=info
NSE_BASE_URL=https://www.nseindia.com
BSE_BASE_URL=https://www.bseindia.com
SCRAPER_EMAIL=scrapers@ipodhan.com
```

### Cron Schedule
```
# Market Holidays - Weekly (Sundays at 2 AM)
0 2 * * 0

# IPO Reviews - Daily (3 AM)
0 3 * * *

# Prospectus Documents - Daily (4 AM)
0 4 * * *

# Historical IPO Data - Daily (5 AM)
0 5 * * *

# Rights Issues - Weekly (Sundays at 6 AM)
0 6 * * 0
```

---

## Next Steps

1. **Complete Market Holidays Scraper** (current task)
2. **Test with live NSE/BSE data**
3. **Implement IPO Reviews Scraper**
4. **Set up orchestration system**
5. **Deploy and monitor**

---

**Document Version:** 1.0
**Last Updated:** October 13, 2025
