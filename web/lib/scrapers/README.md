# IPODhan Data Scrapers

Comprehensive data scraping system for populating the IPODhan platform with real-world IPO data from public sources.

---

## 📋 Overview

This directory contains all web scraping infrastructure and implementations for gathering IPO-related data from various public sources including NSE, BSE, Chittorgarh, and other financial websites.

### Status: 🟢 Core Infrastructure Complete (60%)

- ✅ **Infrastructure**: HTTP client, parsers, base classes
- ✅ **Market Holidays Scraper**: NSE + BSE (100% complete)
- ✅ **IPO Reviews Scraper**: Chittorgarh (100% complete)
- ✅ **Prospectus Scraper**: NSE + BSE (100% complete) - Story 7.9
- 🔨 **Historical IPO Scraper**: Skeleton created (20%)
- 🔨 **Rights Issues Scraper**: Skeleton created (20%)

---

## 📁 Directory Structure

```
web/lib/scrapers/
├── README.md                           # This file
├── SCRAPER-IMPLEMENTATION-PLAN.md      # Detailed planning document
├── SCRAPER-IMPLEMENTATION-SUMMARY.md   # Implementation summary & guide
├── base-scraper.ts                     # Abstract base class
├── orchestrator.ts                     # Scraper orchestration (TODO)
├── index.ts                            # Public exports
├── utils/
│   ├── http-client.ts                  # Rate-limited HTTP client
│   └── parser.ts                       # HTML parsing utilities
└── sources/
    ├── market-holidays-scraper.ts      # ✅ Market holidays (NSE/BSE)
    ├── ipo-reviews-scraper.ts          # ✅ IPO reviews (Chittorgarh)
    ├── prospectus-scraper.ts           # 🔨 Prospectus documents
    ├── historical-ipo-scraper.ts       # 🔨 Historical IPO data
    └── rights-issues-scraper.ts        # 🔨 Rights issues

web/scripts/
└── run-scrapers.ts                     # Manual execution script
```

---

## 🚀 Quick Start

### Prerequisites
```bash
npm install cheerio @types/cheerio
```

### Run Scrapers Manually
```bash
cd web
npx tsx scripts/run-scrapers.ts
```

### Use Individual Scrapers
```typescript
import { marketHolidaysScraper } from '@/lib/scrapers/sources/market-holidays-scraper';
import { ipoReviewsScraper } from '@/lib/scrapers/sources/ipo-reviews-scraper';

// Scrape market holidays for 2025
const holidays = await marketHolidaysScraper.scrape(2025);

// Scrape all IPO reviews
const reviews = await ipoReviewsScraper.scrape('ALL');

// Scrape only Mainboard reviews
const mainboard = await ipoReviewsScraper.scrape('MAINBOARD');
```

---

## ✅ Completed Scrapers

### 1. Market Holidays Scraper

**Location:** `sources/market-holidays-scraper.ts`

**Features:**
- Scrapes NSE and BSE holiday calendars
- Handles trading and settlement holidays
- Automatic merging and deduplication
- Multi-year support

**Data Sources:**
- NSE: https://www.nseindia.com/regulations/trading-holidays
- BSE: https://www.bseindia.com/static/about/Market_Holidays.aspx

**Database Table:** `market_holidays`

**Usage:**
```typescript
// Single year
const result = await marketHolidaysScraper.scrape(2025);

// Multiple years
const years = await marketHolidaysScraper.scrapeMultipleYears([2024, 2025, 2026]);
```

---

### 2. IPO Reviews Scraper

**Location:** `sources/ipo-reviews-scraper.ts`

**Features:**
- Scrapes comprehensive IPO reviews
- Extracts recommendations (Subscribe/Avoid/May apply/Not Recommended)
- Scrapes full review content
- Fuzzy matching with existing IPOs
- Supports Mainboard and SME categories

**Data Source:**
- Chittorgarh: https://www.chittorgarh.com/ipo/ipo-reviews-recommendations/

**Database Table:** `ipo_reviews`

**Usage:**
```typescript
// All categories
const all = await ipoReviewsScraper.scrape('ALL');

// Mainboard only
const mainboard = await ipoReviewsScraper.scrape('MAINBOARD');

// SME only
const sme = await ipoReviewsScraper.scrape('SME');
```

---

### 3. Prospectus Documents Scraper

**Location:** `sources/prospectus-scraper.ts`
**Status:** ✅ Complete (Story 7.9)

**Features:**
- Scrapes document metadata from NSE and BSE
- Extracts DRHP, RHP, Prospectus, and Addendum links
- Validates document URLs with HTTP HEAD requests
- Fuzzy matching with 85% similarity threshold
- Automatic deduplication across exchanges
- Retry logic for failed URL validations
- Upsert with conflict resolution on URL

**Data Sources:**
- NSE: https://www.nseindia.com/market-data/upcoming-ipo
- BSE: https://www.bseindia.com/markets/PublicIssues/IPOIssueTracker.aspx

**Database Table:** `documents`

**Usage:**
```typescript
import { prospectusScraper } from '@/lib/scrapers/sources/prospectus-scraper';

// Scrape all prospectus documents
const result = await prospectusScraper.scrape();

console.log(`Scraped ${result.data.length} documents`);
console.log(`Matched ${result.data.filter(d => d.ipoId).length} to IPOs`);
```

**Performance:**
- Target execution time: <300 seconds (5 minutes)
- Batch validation: 5 concurrent HEAD requests
- Retry logic: 2 attempts with 5s delay
- Rate limiting: 1 req/sec per exchange

**Testing:**
- Unit tests: 15+ test cases covering fuzzy matching, validation, merging
- Integration tests: Full workflow with database operations
- Coverage: >80%

---

## 🔨 In-Progress Scrapers

### 4. Historical IPO Data Scraper

**Location:** `sources/historical-ipo-scraper.ts`
**Status:** Skeleton created, needs implementation

**TODO:**
- [ ] Implement Chittorgarh historical data scraping
- [ ] Parse subscription data (Retail, HNI, QIB)
- [ ] Parse GMP (Grey Market Premium)
- [ ] Parse listing performance
- [ ] Implement bulk insert/update logic

**Data Source:**
- Chittorgarh: https://www.chittorgarh.com/ipo/ipo-performance-tracker/

---

### 5. Rights Issues Scraper

**Location:** `sources/rights-issues-scraper.ts`
**Status:** Skeleton created, needs implementation

**TODO:**
- [ ] Implement NSE corporate actions scraping
- [ ] Implement BSE corporate actions scraping
- [ ] Parse rights issue details (ratio, dates, price)
- [ ] Determine status (UPCOMING/LIVE/CLOSED)
- [ ] Store in database

**Data Sources:**
- NSE: https://www.nseindia.com/companies-listing/corporate-filings-actions
- BSE: https://www.bseindia.com/corporates/Forth_Coming.aspx

---

## 🛠️ Infrastructure Components

### HTTP Client (`utils/http-client.ts`)

Rate-limited, retry-enabled HTTP client with:
- User agent rotation
- Exponential backoff
- Timeout management
- Request queuing

**Usage:**
```typescript
import { httpClient } from '../utils/http-client';

// Fetch HTML
const response = await httpClient.fetch('https://example.com', {
  timeout: 30000,
  retries: 3,
  rateLimit: 1, // 1 req/sec
});

// Fetch JSON
const data = await httpClient.fetchJSON('https://api.example.com/data');
```

### Parser Utilities (`utils/parser.ts`)

HTML parsing helpers built on Cheerio:
- `parseHTML()` - Load HTML
- `cleanText()` - Clean whitespace
- `extractNumber()` - Extract numbers from text
- `parseDate()` - Parse various date formats
- `extractTable()` - Extract table data
- `extractLinks()` - Extract links
- `stripHTML()` - Remove HTML tags

**Usage:**
```typescript
import { parseHTML, extractTable, parseDate } from '../utils/parser';

const $ = parseHTML(html);
const tables = extractTable($, 'table.data');
const date = parseDate('15-Jan-2025');
```

### Base Scraper (`base-scraper.ts`)

Abstract base class providing:
- Common scraping methods
- Error handling
- Logging
- Data validation
- Result patterns

**Usage:**
```typescript
import { BaseScraper, type ScraperResult } from '../base-scraper';

class MyScraper extends BaseScraper<MyData[]> {
  constructor() {
    super({
      name: 'MyScraper',
      baseUrl: 'https://example.com',
      rateLimit: 1,
      timeout: 30000,
      retries: 3,
    });
  }

  async scrape(): Promise<ScraperResult<MyData[]>> {
    try {
      const $ = await this.fetchHTML('/data');
      const data = this.parseData($);
      return this.createSuccessResult(data);
    } catch (error) {
      return this.createErrorResult(error);
    }
  }
}
```

---

## 📅 Scheduling

### Recommended Schedule

| Scraper | Frequency | Cron | Time |
|---------|-----------|------|------|
| Market Holidays | Weekly | `0 2 * * 0` | Sun 2:00 AM |
| IPO Reviews | Daily | `0 3 * * *` | Every 3:00 AM |
| Prospectus | Daily | `0 4 * * *` | Every 4:00 AM |
| Historical IPO | Daily | `0 5 * * *` | Every 5:00 AM |
| Rights Issues | Weekly | `0 6 * * 0` | Sun 6:00 AM |

### Implementation Options

**Option 1: node-cron**
```typescript
import cron from 'node-cron';

cron.schedule('0 2 * * 0', async () => {
  await marketHolidaysScraper.scrape();
});
```

**Option 2: BullMQ (Recommended for production)**
```typescript
import { Queue, Worker } from 'bullmq';

const queue = new Queue('scrapers');
await queue.add('holidays', {}, { repeat: { cron: '0 2 * * 0' } });
```

**Option 3: External cron**
```bash
# /etc/crontab
0 2 * * 0 cd /path/to/web && npx tsx scripts/run-market-holidays.ts
```

---

## 🔍 Monitoring & Logging

### Log Levels
- `INFO`: Scraper start/complete
- `WARN`: Retries, partial failures
- `ERROR`: Scraping failures

### Metrics to Track
- ✅ Scraping success rate
- ✅ Number of records scraped
- ✅ Execution time
- ✅ Error rate by source
- ✅ Data freshness

### Database Logging (TODO)

Create `scraper_logs` table:
```sql
CREATE TABLE scraper_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL,
  records_scraped INTEGER,
  error_message TEXT,
  execution_time_ms INTEGER,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);
```

---

## 🧪 Testing

### Manual Testing
```bash
# Test single scraper
npx tsx scripts/run-scrapers.ts

# Test with environment variables
SCRAPER_LOG_LEVEL=debug npx tsx scripts/run-scrapers.ts
```

### Unit Testing (TODO)
```typescript
import { marketHolidaysScraper } from './sources/market-holidays-scraper';

describe('Market Holidays Scraper', () => {
  it('should scrape holidays', async () => {
    const result = await marketHolidaysScraper.scrape(2025);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});
```

---

## ⚠️ Legal & Ethical Considerations

### Robots.txt Compliance
✅ Check robots.txt for each source
✅ Respect crawl-delay directives
✅ Respect disallowed paths

### Rate Limiting
✅ Default: 1 request per second
✅ Exponential backoff on errors
✅ Request queuing

### User Agent
✅ Identify as IPODhan scraper
✅ Include contact email

### Terms of Service
⚠️ Review ToS for each source
⚠️ Ensure scraping is permitted
⚠️ Provide proper attribution

### Data Attribution
✅ Store data source in database
✅ Display attribution in UI
✅ Link to original sources

---

## 📊 Performance

### Optimization Strategies
- Batch database inserts
- Use transactions
- Implement caching
- Parallel scraping (where appropriate)
- Incremental updates

### Resource Usage
- Memory: ~50-100MB per scraper
- CPU: Minimal (I/O bound)
- Network: Rate limited to 1 req/sec

---

## 🐛 Troubleshooting

### Common Issues

**Issue: Module not found**
```bash
npm install cheerio @types/cheerio
```

**Issue: Database connection error**
```bash
# Check database URL in .env
DATABASE_URL=postgresql://...
```

**Issue: Scraper timeout**
```typescript
// Increase timeout
const result = await scraper.scrape({
  timeout: 60000, // 60 seconds
});
```

**Issue: Rate limiting errors**
```typescript
// Decrease rate limit
rateLimit: 0.5, // 1 request per 2 seconds
```

---

## 📚 Resources

### Documentation
- [Implementation Plan](./SCRAPER-IMPLEMENTATION-PLAN.md)
- [Implementation Summary](./SCRAPER-IMPLEMENTATION-SUMMARY.md)

### Data Sources
- NSE: https://www.nseindia.com
- BSE: https://www.bseindia.com
- Chittorgarh: https://www.chittorgarh.com

### Technologies
- [Cheerio](https://cheerio.js.org/): HTML/XML parsing
- [Drizzle ORM](https://orm.drizzle.team/): Database operations
- TypeScript: Type safety

---

## 🎯 Next Steps

### Immediate (This Week)
1. ✅ Complete core infrastructure
2. ✅ Complete Market Holidays scraper
3. ✅ Complete IPO Reviews scraper
4. 🔄 Test scrapers with live data
5. 📝 Create execution scripts

### Short Term (Next 2 Weeks)
6. Complete Prospectus scraper
7. Complete Historical IPO scraper
8. Complete Rights Issues scraper
9. Implement orchestrator
10. Set up scheduling

### Long Term (Next Month)
11. Add monitoring dashboard
12. Implement alerting
13. Add data quality checks
14. Implement incremental updates
15. Add manual trigger API

---

## 👥 Contributing

### Adding a New Scraper

1. **Create scraper file** in `sources/`
2. **Extend BaseScraper** class
3. **Implement `scrape()` method**
4. **Add to orchestrator**
5. **Update documentation**
6. **Test thoroughly**

### Example Template
```typescript
import { BaseScraper, type ScraperResult } from '../base-scraper';

export class MyNewScraper extends BaseScraper<MyData[]> {
  constructor() {
    super({
      name: 'MyNewScraper',
      baseUrl: 'https://example.com',
      rateLimit: 1,
    });
  }

  async scrape(): Promise<ScraperResult<MyData[]>> {
    try {
      this.logStart('Starting scrape');
      const data = await this.fetchAndParse();
      await this.storeData(data);
      this.logComplete(data.length);
      return this.createSuccessResult(data);
    } catch (error) {
      return this.createErrorResult(error);
    }
  }
}
```

---

## 📝 License

Part of the IPODhan platform. All rights reserved.

---

**Last Updated:** October 13, 2025
**Version:** 1.0
**Status:** 🟢 Operational (40% complete)
