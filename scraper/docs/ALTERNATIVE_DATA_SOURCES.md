# Alternative Data Sources - Moneycontrol & Chittorgarh

## Overview

This document describes the implementation of alternative IPO data sources for IPODhan platform, achieving 99% data availability through redundant sources.

## Data Sources

### 1. Moneycontrol (https://www.moneycontrol.com/ipo/)

**Purpose**: Aggregates IPO data from both NSE and BSE exchanges

**Key Features**:
- IPO ratings (0-5 stars)
- Expected listing gains
- Aggregated data from multiple exchanges
- 90%+ reliability

**Scraping Method**:
- **Primary**: Cheerio (static HTML parsing) - 10x faster
- **Fallback**: Puppeteer (if JavaScript rendering detected)
- **Retry Logic**: 3 attempts with exponential backoff (1s, 2s, 4s)

**Data Extracted**:
- Company name
- Issue size
- Price range (min/max)
- Open and close dates
- IPO rating (Moneycontrol exclusive)
- Listing gains expectation
- Subscription data

**Execution**:
```bash
# Manual execution
npm run start:moneycontrol

# Scheduled execution
# Every 30 minutes during market hours (9:00 AM - 5:00 PM)
# Every 2 hours after market hours
```

---

### 2. Chittorgarh (https://www.chittorgarh.com/ipo/ipo_list.asp)

**Purpose**: Primary source for GMP (Grey Market Premium) data

**Key Features**:
- GMP (Grey Market Premium) - unique data point
- GMP percentage relative to issue price
- Subscription status
- 85%+ reliability

**Scraping Method**:
- **Cheerio only** (simple HTML table structure)
- **Retry Logic**: 3 attempts with exponential backoff (1s, 2s, 4s)

**Data Extracted**:
- Company name
- Issue size
- Price range (min/max)
- Open and close dates
- **GMP (in INR)** - exclusive to Chittorgarh
- **GMP percentage** - calculated
- **GMP updated timestamp**
- Lot size and minimum investment
- Subscription data

**GMP Validation**:
- Valid range: -50% to +200% of issue price
- Invalid values are rejected and logged
- GMP history tracked for trending

**Execution**:
```bash
# Manual execution
npm run start:chittorgarh

# Scheduled execution
# Every 45 minutes during market hours
# Every 4 hours after market hours (GMP updates less frequently)
```

---

### 3. Moneycontrol RSS Feed

**Purpose**: Early detection of new IPO announcements

**Feed URL**: https://www.moneycontrol.com/rss/iponews.xml

**Features**:
- Real-time IPO news
- New IPO announcements
- Company name extraction
- IPO date parsing

**Usage**:
```typescript
import { parseMoneycontrolRSS, filterNewIPOAnnouncements } from './scrapers/moneycontrol-rss.js';

// Parse RSS feed
const { news, errors } = await parseMoneycontrolRSS();

// Filter for new IPO announcements
const newIPOs = filterNewIPOAnnouncements(news);
```

---

## Data Source Priority

When multiple sources provide data for the same IPO, the following priority is used for conflict resolution:

1. **NSE** (Priority 1) - Most authoritative for NSE-listed IPOs
2. **BSE** (Priority 2) - Most authoritative for BSE-listed IPOs
3. **Moneycontrol** (Priority 3) - Aggregator with ratings
4. **Chittorgarh** (Priority 4) - GMP data provider
5. **API Fallback** (Priority 5) - Last resort

**Merge Strategy**:
- Higher priority source data is preserved for core fields
- Lower priority sources supplement missing fields
- Source-specific data (GMP, ratings) is always merged
- All sources are tracked in `dataSources` array

---

## Deduplication Logic

**Company Name Normalization**:
```typescript
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')                     // Standardize whitespace
    .replace(/limited|ltd|inc|pvt/gi, '')     // Remove suffixes
    .replace(/[^\w\s]/g, '')                  // Remove special chars
    .trim();
}
```

**Fuzzy Matching**:
- Uses Levenshtein distance algorithm
- Threshold: 85% similarity required
- Handles variations in company names across sources

---

## Performance Targets

| Source | Method | Target Time | Actual |
|--------|--------|-------------|--------|
| Moneycontrol | Cheerio | < 30s | TBD |
| Moneycontrol | Puppeteer | < 45s | TBD |
| Chittorgarh | Cheerio | < 20s | TBD |
| RSS Parser | Fetch | < 5s | TBD |
| All Sources | Parallel | < 2 min | TBD |

**Resource Usage**:
- Memory: < 512MB for all scrapers
- CPU: < 50% average
- Max concurrent Puppeteer instances: 2

---

## Scheduler Configuration

**Staggered Schedule** (prevents resource spikes):
```typescript
const schedules = {
  'NSE':          '0,30 * * * *',    // :00 and :30 every hour
  'BSE':          '5,35 * * * *',    // :05 and :35 every hour
  'Moneycontrol': '10,40 * * * *',   // :10 and :40 every hour
  'Chittorgarh':  '15 * * * *',      // :15 every hour
};
```

**Rationale**:
- 15-minute offset between scrapers
- Avoids simultaneous database writes
- Distributes network requests
- Prevents browser resource conflicts

---

## Monitoring & Alerting

**Metrics Tracked**:
- Success/failure rates per source
- Execution duration (ms)
- Records processed/failed
- Consecutive failures
- GMP data freshness (Chittorgarh)

**Alert Thresholds**:
- 3+ consecutive failures → ERROR alert
- Success rate < 80% (24 hours) → WARNING alert
- GMP data stale > 24 hours → WARNING alert

**Dashboard Integration**:
```bash
GET /api/admin/scraper/status
{
  "sources": {
    "MONEYCONTROL": {
      "successRate": 0.92,
      "lastRun": "2025-10-09T10:15:00Z",
      "consecutiveFailures": 0,
      "avgDuration": 28000
    },
    "CHITTORGARH": {
      "successRate": 0.88,
      "lastRun": "2025-10-09T10:30:00Z",
      "consecutiveFailures": 0,
      "avgDuration": 18000,
      "gmpFreshness": "2 hours ago"
    }
  }
}
```

---

## Error Handling

**Retry Logic**:
```typescript
// Exponential backoff: 1s, 2s, 4s
await retryWithExponentialBackoff(
  () => scrapeMoneycontrolIPOs(),
  3,
  1000
);
```

**Fallback Behavior**:
- Cheerio fails → Try Puppeteer
- Puppeteer fails → Log error, continue
- All retries fail → Trigger alert
- 3+ consecutive failures → Activate API fallback

**Graceful Degradation**:
- Missing optional fields → Use defaults
- Invalid data → Skip record, log warning
- Partial success → Process valid records
- Total failure → No database writes

---

## robots.txt Compliance

**Moneycontrol**:
- Crawl-delay: None specified
- Disallowed paths: `/admin/*`, `/api/*`
- IPO section: ALLOWED

**Chittorgarh**:
- Crawl-delay: None specified
- Disallowed paths: None relevant
- IPO section: ALLOWED

**Best Practices**:
- 2-3 second delay between requests
- User-Agent identification
- Respect HTTP 429 (rate limiting)
- Exponential backoff on errors

---

## Database Schema Extensions

**GMP Fields** (added to `ipos` table):
```sql
ALTER TABLE ipos ADD COLUMN gmp DECIMAL(10, 2);
ALTER TABLE ipos ADD COLUMN gmp_percentage DECIMAL(5, 2);
ALTER TABLE ipos ADD COLUMN gmp_updated_at TIMESTAMP;
ALTER TABLE ipos ADD COLUMN rating DECIMAL(2, 1);  -- Moneycontrol rating
ALTER TABLE ipos ADD COLUMN listing_gains DECIMAL(5, 2);  -- Expected gains
```

**Data Sources Tracking**:
```sql
ALTER TABLE ipos ADD COLUMN data_sources TEXT[];  -- Array of sources
```

---

## Testing

**Unit Tests**:
```bash
npm run test:unit -- scraper-utils.test.ts
npm run test:unit -- moneycontrol-scraper.test.ts
npm run test:unit -- chittorgarh-scraper.test.ts
npm run test:unit -- data-merger.test.ts
```

**Integration Tests**:
```bash
npm run test:integration -- moneycontrol.integration.test.ts
npm run test:integration -- chittorgarh.integration.test.ts
```

**Coverage Targets**:
- Scrapers: > 80%
- Data merger: > 90%
- Validators: > 85%

---

## Troubleshooting

### Issue: Moneycontrol scraper returns 0 IPOs

**Possible Causes**:
1. Website structure changed
2. JavaScript rendering required
3. IP temporarily blocked

**Resolution**:
1. Check selector: `.pcorporate .bl_12`
2. Verify auto-detection switches to Puppeteer
3. Check for 403/429 HTTP status
4. Review recent commits for selector changes

### Issue: Chittorgarh GMP values seem unrealistic

**Possible Causes**:
1. Data parsing error
2. Website displaying test/dummy data
3. Validation thresholds too permissive

**Resolution**:
1. Check validation: -50% to +200% range
2. Verify HTML structure hasn't changed
3. Cross-reference with manual check
4. Review `validateGMP()` function

### Issue: High memory usage during parallel execution

**Possible Causes**:
1. Too many Puppeteer instances
2. Memory leaks in scraper
3. Large HTML documents

**Resolution**:
1. Limit Puppeteer instances to 2
2. Ensure `closeBrowser()` is called
3. Stagger scheduler more aggressively
4. Monitor with `process.memoryUsage()`

---

## Future Enhancements

**Phase 2**:
1. GMP history tracking and trending
2. Sentiment analysis from news
3. Real-time WebSocket updates for GMP
4. Additional sources (Groww, Zerodha, Economic Times)
5. ML-based IPO performance predictions

**Phase 3**:
1. Automated discrepancy detection
2. Confidence scoring (source agreement)
3. Manual review queue for conflicts
4. Historical accuracy tracking per source

---

## References

- **Story**: docs/stories/7.6.alternative-data-sources.story.md
- **Scraper Utils**: scraper/src/utils/scraper-utils.ts
- **Data Merger**: scraper/src/services/data-merger.ts
- **Validators**: scraper/src/utils/validators.ts
- **Moneycontrol Scraper**: scraper/src/scrapers/moneycontrol-scraper.ts
- **Chittorgarh Scraper**: scraper/src/scrapers/chittorgarh-scraper.ts
- **RSS Parser**: scraper/src/scrapers/moneycontrol-rss.ts
