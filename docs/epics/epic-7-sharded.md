# Epic 7: Data Pipeline & Automation

**Epic ID:** epic-7
**Priority:** High
**Story Points:** 27
**Timeline:** Weeks 9-10 (1.5 weeks)
**Status:** IN PROGRESS
**Dependencies:** Epic 2, Story 2.3 (Repository Layer)

---

## Epic Overview

Replace static seed data with live, automated data collection from NSE/BSE websites and IPO Alerts API. Implement web scraping, job scheduling, and cache invalidation for real-time IPO information.

### Business Value

- **Real-time Data:** Fresh IPO data updated every 15-30 minutes without manual intervention
- **Competitive Advantage:** Live subscription data gives users edge in IPO decisions
- **Reliability:** Multi-source strategy (NSE + BSE + API fallback) ensures 95%+ uptime
- **Scalability:** Automated pipeline ready for future data expansion

### User Personas

**Primary:** All users benefit from accurate, real-time IPO data
**Secondary:** Platform administrators monitor scraper health

---

## Stories in This Epic

### Story 7.1: NSE Scraper Implementation
**Priority:** Critical
**Points:** 8
**Status:** ✅ READY (Story created and approved)
**File:** `docs/stories/7.1.nse-scraper.story.md`

**Description:**
Automated scraper for NSE India website to extract IPO data and subscription information using Puppeteer.

**Functional Requirements (FR-11):**

**NSE Data Extraction:**
- Target URL: `https://www.nseindia.com/market-data/public-issues`
- Extracted IPO fields:
  - Company name, symbol, exchange
  - Issue size, price range (min/max)
  - Open date, close date, listing date
  - Lot size, minimum investment
  - Sector/industry classification
- Extracted subscription fields:
  - QIB subscription (times), NII subscription (times)
  - Retail subscription (times), Total subscription (times)
  - Last updated timestamp

**Technical Implementation:**
- Puppeteer 22+ with headless Chrome
- Wait for dynamic content: `page.waitForSelector('.ipo-table')`
- DOM parsing via `page.evaluate()`
- Zod schema validation before database insert
- IPORepository.upsert() for idempotent updates
- SubscriptionRepository.createSnapshot() for historical tracking
- Cache invalidation: `ipos:list:*`, `ipo:{slug}`, `subscription:latest:{slug}`
- Structured logging with Pino (duration, success/failure, record count)

**Error Handling:**
- Retry 3 times with exponential backoff (1s, 2s, 4s)
- Fallback to IPO Alerts API after all retries fail
- Log all failures with error context for monitoring

**Acceptance Criteria:**
1. ✅ Scraper successfully navigates to NSE URL and waits for content
2. ✅ Scraper extracts all required IPO fields accurately
3. ✅ Scraper extracts subscription data for all categories
4. ✅ Scraper validates data with Zod schemas before insert
5. ✅ Scraper upserts IPO data via IPORepository
6. ✅ Scraper creates subscription snapshots via SubscriptionRepository
7. ✅ Scraper invalidates relevant cache keys
8. ✅ Scraper implements retry logic with exponential backoff
9. ✅ Scraper logs all operations (success, failures, duration)
10. ✅ Scraper handles errors gracefully without crashing
11. ✅ Manual test: `npm run scrape:nse` executes successfully

---

### Story 7.2: BSE Scraper Implementation
**Priority:** Critical
**Points:** 8
**Status:** ✅ READY (Story created and approved)
**File:** `docs/stories/7.2.bse-scraper.story.md`

**Description:**
Automated scraper for BSE India website to extract IPO data for mainboard and SME IPOs, using Cheerio or Puppeteer as needed.

**Functional Requirements (FR-12):**

**BSE Data Extraction:**
- Target URL: `https://www.bseindia.com/publicissue.html`
- Extracted IPO fields:
  - Company name, exchange (BSE/BSE-SME)
  - Issue size, price range (min/max)
  - Open date, close date, listing date
  - Lot size, minimum investment
  - Sector/industry classification
- Extracted subscription fields:
  - QIB, NII, Retail, Total subscription (times)
  - Last updated timestamp

**Technical Implementation:**
- Determine rendering approach:
  - If static HTML: Use Cheerio for fast parsing
  - If JavaScript-rendered: Use Puppeteer like NSE
- Zod schema validation before database insert
- IPORepository.upsert() with merge strategy (prefer BSE data for BSE-listed IPOs)
- SubscriptionRepository.createSnapshot() with source attribution
- Cache invalidation: same keys as NSE scraper
- Structured logging with Pino

**Data Merger Logic:**
- If IPO exists from NSE scraper: merge fields (prefer official exchange source)
- If IPO is BSE-exclusive (SME): insert new record
- Subscription data: create separate snapshot with source="BSE"

**Error Handling:**
- Retry 3 times with exponential backoff (1s, 2s, 4s)
- Fallback to IPO Alerts API after all retries fail
- Log all failures with error context

**Acceptance Criteria:**
1. ✅ Scraper successfully navigates to BSE URL and extracts data
2. ✅ Scraper extracts all required IPO fields accurately
3. ✅ Scraper extracts subscription data for all categories
4. ✅ Scraper validates data with Zod schemas before insert
5. ✅ Scraper upserts IPO data via IPORepository with merge logic
6. ✅ Scraper creates subscription snapshots with source attribution
7. ✅ Scraper invalidates relevant cache keys
8. ✅ Scraper implements retry logic with exponential backoff
9. ✅ Scraper logs all operations (success, failures, duration)
10. ✅ Scraper handles errors gracefully without crashing
11. ✅ Manual test: `npm run scrape:bse` executes successfully
12. ✅ Data merger logic tested: NSE + BSE data merges correctly

---

### Story 7.3: IPO Alerts API Fallback
**Priority:** High
**Points:** 3
**Status:** ✅ APPROVED (Story created and approved)
**File:** `docs/stories/7.3.ipo-alerts-api-fallback.story.md`

**Description:**
Integrate IPO Alerts API as fallback data source when NSE/BSE scraping fails, ensuring 95%+ data availability.

**Functional Requirements (FR-13):**

**IPO Alerts API Integration:**
- Base URL: `https://api.ipoalerts.in`
- Endpoints:
  - `GET /ipos?status=open` - Active IPOs
  - `GET /ipos?status=upcoming` - Upcoming IPOs
  - `GET /ipos/{id}` - Single IPO details
- Authentication: API key in header `X-API-Key`
- Rate limit: 100 requests/hour

**Fallback Trigger Logic:**
- Activate when NSE or BSE scraper fails 3+ consecutive times
- Track scraper failure count in Redis: `scraper:{source}:failures`
- Reset failure count on successful scrape

**Technical Implementation:**
- API client with proper authentication and headers
- Zod schema validation and data transformation to IPODhan models
- IPORepository.upsert() with merge strategy (merge with existing NSE/BSE data)
- SubscriptionRepository.createSnapshot() with source="API_FALLBACK"
- Cache invalidation: same keys as scrapers
- Rate limiting: track requests in Redis with TTL
- Structured logging with Pino

**Error Handling:**
- Handle API errors: 404 (not found), 429 (rate limit), 500 (server error)
- Exponential backoff for retries
- Log rate limit events for monitoring
- Graceful degradation: show last known data if API also fails

**Acceptance Criteria:**
1. ✅ API client implemented with proper authentication
2. ✅ API client fetches IPO data from all endpoints
3. ✅ API response validated with Zod and transformed to IPODhan models
4. ✅ Fallback triggers automatically when scrapers fail 3+ times
5. ✅ Fallback upserts IPO data via IPORepository (merges with existing)
6. ✅ Fallback creates subscription snapshots with source attribution
7. ✅ Fallback invalidates relevant cache keys
8. ✅ Rate limiting implemented: 100 requests/hour with tracking
9. ✅ API errors handled gracefully with exponential backoff
10. ✅ Structured logging implemented for all operations
11. ✅ Manual test: `npm run start:fallback` executes successfully

---

### Story 7.4: Scheduler & Cache Invalidation
**Priority:** Critical
**Points:** 5
**Status:** 🔜 NEXT (Pending - ready for creation)
**Dependencies:** Story 7.1 (NSE Scraper), Story 7.2 (BSE Scraper)

**Description:**
Implement job scheduler using Node-cron to run scrapers at defined intervals and implement cache invalidation strategy for real-time data updates.

**Functional Requirements (FR-14):**

**Cron Scheduler:**
- Schedule definitions:
  - **Market hours (9 AM - 5 PM weekdays):** Every 15 minutes
  - **After market hours (5 PM - 9 AM weekdays):** Every 30 minutes
  - **Weekends/holidays:** Every 1 hour
- Scheduled jobs:
  1. NSE Scraper job
  2. BSE Scraper job
  3. Health check job (every 5 minutes)
  4. Daily summary report job (8 AM daily)

**Cron Expressions:**
```javascript
{
  nse_market_hours: '*/15 9-17 * * 1-5',      // Every 15 min, 9 AM-5 PM, Mon-Fri
  nse_after_hours: '*/30 0-8,18-23 * * 1-5',  // Every 30 min, off hours, Mon-Fri
  nse_weekends: '0 */1 * * 0,6',              // Every hour, Sat-Sun
  bse_market_hours: '*/15 9-17 * * 1-5',
  bse_after_hours: '*/30 0-8,18-23 * * 1-5',
  bse_weekends: '0 */1 * * 0,6',
  health_check: '*/5 * * * *',                // Every 5 minutes
  daily_summary: '0 8 * * *'                  // 8 AM daily
}
```

**Cache Invalidation Strategy:**
- Invalidate after successful scrape:
  1. `ipos:list:*` - All listing variations (status, filters)
  2. `ipo:{slug}` - Specific IPO detail cache
  3. `subscription:latest:{slug}` - Latest subscription data
  4. `dashboard:stats` - Dashboard statistics cache
- Use Redis `KEYS` pattern matching or maintain cache key registry
- Set "Last Updated" timestamp in database: `ipos.last_scraped_at`
- Optional: Implement cache warming for frequently accessed IPOs

**Scheduler Service Structure:**
```
scraper/
├── src/
│   ├── scheduler/
│   │   ├── scheduler.ts          // Main scheduler service
│   │   ├── jobs/
│   │   │   ├── nse-job.ts        // NSE scraper job
│   │   │   ├── bse-job.ts        // BSE scraper job
│   │   │   ├── health-check.ts   // Health check job
│   │   │   └── daily-summary.ts  // Daily summary job
│   │   └── cache-invalidator.ts  // Cache invalidation logic
│   ├── scrapers/                 // Existing scrapers
│   └── index.ts                  // Entry point with scheduler
```

**Health Check Logic:**
- Check last successful scrape time from database
- If last scrape > 1 hour ago: Log warning
- If last scrape > 2 hours ago: Send alert (console/email)
- Track consecutive failures in Redis
- Alert if 5+ consecutive failures

**Daily Summary Report:**
- Generate summary at 8 AM:
  - Total IPOs scraped yesterday
  - Success/failure rate for each scraper
  - Total subscription updates
  - Average scrape duration
  - Errors encountered
- Log summary with structured format
- Optional: Send email to admin

**Technical Implementation:**
- Node-cron 3.0+ for job scheduling
- Graceful shutdown: Stop all jobs on process termination
- Job execution tracking: Log start/end times
- Prevent overlapping runs: Use mutex/lock pattern
- Environment-based configuration:
  - `SCRAPER_ENABLED=true/false` - Enable/disable scrapers
  - `SCRAPER_INTERVAL_MODE=dev/prod` - Different intervals for dev
- TypeScript interfaces for job definitions

**Acceptance Criteria:**
1. ✅ Node-cron installed and configured with all schedule expressions
2. ✅ NSE scraper job runs according to schedule (market/after hours/weekends)
3. ✅ BSE scraper job runs according to schedule (market/after hours/weekends)
4. ✅ Health check job runs every 5 minutes and logs warnings/alerts
5. ✅ Daily summary job runs at 8 AM and generates comprehensive report
6. ✅ Cache invalidation service invalidates all relevant cache keys after scrape
7. ✅ Cache invalidation sets `last_scraped_at` timestamp in database
8. ✅ Scheduler supports graceful shutdown on process termination
9. ✅ Mutex/lock pattern prevents overlapping scraper runs
10. ✅ Environment variables control scraper enable/disable and intervals
11. ✅ Structured logging for all scheduled jobs (start, end, duration, status)
12. ✅ Manual test: Start scheduler and verify jobs execute at correct times
13. ✅ Integration test: Verify cache invalidation works end-to-end

**Technical Constraints:**
- Jobs must not overlap (use job locking)
- Failed jobs should not crash the scheduler
- Scheduler must restart jobs after application restart
- Cache invalidation must be atomic (all-or-nothing)

**Testing Requirements:**
- Unit tests for cache invalidation logic
- Integration tests for scheduler job execution
- Test graceful shutdown behavior
- Test health check alerts trigger correctly
- Test daily summary report generation

---

### Story 7.5: Error Handling & Monitoring
**Priority:** High
**Points:** 3
**Status:** 📋 PENDING
**Dependencies:** Story 7.4 (Scheduler & Cache Invalidation)

**Description:**
Implement comprehensive error handling, monitoring, and alerting for the data pipeline to ensure 95%+ scraper uptime.

**Functional Requirements (FR-15):**

**Error Logging:**
- Store scraper logs in `scraper_logs` table:
  ```sql
  CREATE TABLE scraper_logs (
    id UUID PRIMARY KEY,
    source TEXT NOT NULL,           -- 'NSE' | 'BSE' | 'API_FALLBACK'
    status TEXT NOT NULL,            -- 'SUCCESS' | 'FAILURE' | 'PARTIAL'
    records_processed INTEGER,
    records_failed INTEGER,
    duration_ms INTEGER,
    error_message TEXT,
    error_stack TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```
- Index on `created_at` for efficient querying
- Retention policy: Keep logs for 30 days

**Success/Failure Metrics:**
- Track in Redis with rolling window (24 hours):
  - `scraper:nse:success_count` (TTL: 24h)
  - `scraper:nse:failure_count` (TTL: 24h)
  - `scraper:bse:success_count` (TTL: 24h)
  - `scraper:bse:failure_count` (TTL: 24h)
- Calculate success rate: `success / (success + failure) * 100`
- Expose metrics endpoint: `GET /api/admin/scraper/metrics`

**Alerting Logic:**
- Alert if 3+ consecutive failures:
  - Log error with level "ERROR"
  - Send email to admin (optional)
  - Set Redis flag: `scraper:{source}:alert_sent` (TTL: 1h)
- Alert if success rate < 80% in last 24 hours:
  - Log warning with level "WARN"
  - Include recent error summary in alert

**Monitoring Dashboard API:**
- Endpoint: `GET /api/admin/scraper/status`
- Response:
  ```json
  {
    "nse": {
      "lastRun": "2025-10-07T10:15:00Z",
      "lastSuccess": "2025-10-07T10:15:00Z",
      "lastFailure": "2025-10-07T08:00:00Z",
      "successRate24h": 95.5,
      "consecutiveFailures": 0,
      "recordsProcessed24h": 1250
    },
    "bse": { /* same structure */ },
    "apiFallback": { /* same structure */ },
    "health": "HEALTHY" | "DEGRADED" | "CRITICAL"
  }
  ```
- Health status logic:
  - HEALTHY: All scrapers > 90% success rate
  - DEGRADED: Any scraper 70-90% success rate
  - CRITICAL: Any scraper < 70% success rate or down > 2 hours

**Graceful Degradation:**
- When all scrapers fail:
  - Show last known data with "Last updated: X hours ago" message
  - Display banner: "IPO data may be outdated. We're working on it."
  - Log critical error for immediate investigation

**Technical Implementation:**
- Extend existing scrapers to write to `scraper_logs` table
- Create `ScraperLogRepository` for log operations
- Create admin API routes for metrics and status
- Implement email alerting service (optional, using Nodemailer)
- Structured logging with Pino for all monitoring events

**Acceptance Criteria:**
1. ✅ `scraper_logs` table created with proper schema and indexes
2. ✅ All scrapers write logs to database on success/failure
3. ✅ Success/failure metrics tracked in Redis with rolling 24h window
4. ✅ Alert triggers after 3+ consecutive failures with proper notification
5. ✅ Alert triggers if success rate < 80% in last 24 hours
6. ✅ Monitoring dashboard API endpoint returns scraper status
7. ✅ Health status calculated correctly (HEALTHY/DEGRADED/CRITICAL)
8. ✅ Graceful degradation implemented: show last known data when scrapers fail
9. ✅ Frontend displays "Last updated" timestamp and outdated data banner
10. ✅ Email alerting service implemented (optional)
11. ✅ Log retention policy: Logs older than 30 days are cleaned up
12. ✅ Integration test: Verify monitoring and alerting work end-to-end

**Testing Requirements:**
- Unit tests for success rate calculation
- Unit tests for alert triggering logic
- Integration tests for monitoring API
- Test graceful degradation scenario
- Test log retention cleanup job

---

## Technical Architecture Summary

### Technology Stack
- **Puppeteer 22+** - NSE scraping (headless Chrome)
- **Cheerio** - BSE scraping (if static HTML, otherwise Puppeteer)
- **Node-cron 3.0+** - Job scheduling
- **Pino** - Structured logging
- **Zod** - Data validation
- **Redis** - Caching and metrics
- **PostgreSQL** - Data storage

### Data Flow
```
┌─────────────────────────────────────────────────────────────┐
│                     Scheduler (Node-cron)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ NSE Job      │  │ BSE Job      │  │ Health Check     │  │
│  │ (15/30/60m)  │  │ (15/30/60m)  │  │ (5m)             │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
└─────────┼──────────────────┼──────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────┐  ┌─────────────────┐
│  NSE Scraper    │  │  BSE Scraper    │
│  (Puppeteer)    │  │  (Cheerio/Pptr) │
└────────┬────────┘  └────────┬────────┘
         │                    │
         │  (on 3+ failures)  │
         └───────────┬────────┘
                     ▼
           ┌──────────────────────┐
           │ IPO Alerts API       │
           │ (Fallback)           │
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │  Data Validation     │
           │  (Zod Schemas)       │
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │  IPORepository       │
           │  .upsert()           │
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │  Cache Invalidation  │
           │  (Redis)             │
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │  Monitoring Logs     │
           │  (scraper_logs)      │
           └──────────────────────┘
```

### Error Handling Flow
```
Scraper Execution
    │
    ├─ SUCCESS ──> Log success ──> Update metrics ──> Invalidate cache
    │
    └─ FAILURE ──> Retry (3x with backoff)
                      │
                      ├─ SUCCESS ──> Same as above
                      │
                      └─ FAILURE ──> Fallback to API
                                        │
                                        ├─ SUCCESS ──> Same as above
                                        │
                                        └─ FAILURE ──> Alert admin
                                                        Show last data
```

---

## Dependencies

**This Epic Requires:**
- Epic 2, Story 2.3: Repository Layer (IPORepository, SubscriptionRepository)

**This Epic Blocks:**
- None (site works with seed data, scrapers enhance it with real-time updates)

---

## Risks & Mitigation

### Risk 1: Exchange websites change structure
- **Impact:** Scrapers break, no new data
- **Mitigation:** Modular selector patterns, easy to update
- **Contingency:** Switch to manual updates + API fallback within 24 hours

### Risk 2: Anti-bot detection blocks scrapers
- **Impact:** Scraping fails consistently
- **Mitigation:** Puppeteer stealth plugin, rotate user agents, delay requests
- **Contingency:** Pay for IPO Alerts API premium tier for primary data

### Risk 3: Data inconsistencies between NSE/BSE
- **Impact:** Conflicting information shown to users
- **Mitigation:** Data merger logic prioritizes official exchange source
- **Contingency:** Show source attribution on frontend ("Data from NSE/BSE")

### Risk 4: Rate limiting or API quota exhaustion
- **Impact:** Fallback API unavailable when scrapers fail
- **Mitigation:** Implement smart rate limiting, track usage
- **Contingency:** Upgrade to premium API plan or reduce scraping frequency

---

## Definition of Done

- [ ] All 5 stories completed and approved
- [ ] NSE and BSE scrapers running successfully with 95%+ success rate
- [ ] IPO Alerts API fallback tested and working
- [ ] Cron scheduler executing on defined intervals (market/after hours/weekends)
- [ ] Cache invalidation tested and working (data refreshes in UI immediately)
- [ ] Error logging comprehensive (all failures tracked in database)
- [ ] Monitoring dashboard API working and showing correct status
- [ ] Alerting configured and tested (3+ consecutive failures trigger alert)
- [ ] 1 week test period: 95%+ uptime achieved
- [ ] Documentation: How to fix broken scrapers and troubleshooting guide
- [ ] All integration tests passing
- [ ] Code reviewed and deployed to production

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Scraper Uptime | 95%+ | Success rate in last 30 days |
| Data Freshness | < 30 minutes | Time since last successful scrape |
| Scraper Duration | < 2 minutes | Average execution time per scraper |
| Cache Hit Rate | > 80% | Redis cache hits / total requests |
| Error Rate | < 5% | Failures / total scrapes in 30 days |
| Alert Response Time | < 1 hour | Time from alert to issue resolution |

---

## Notes

- This epic transforms IPODhan from static to dynamic real-time platform
- Scrapers run in background as scheduled jobs (non-blocking)
- Data pipeline designed for resilience with multi-source strategy
- Monitoring and alerting ensure quick response to issues
- Cache invalidation ensures users always see fresh data
- Architecture supports future expansion (more data sources, real-time WebSocket updates)
