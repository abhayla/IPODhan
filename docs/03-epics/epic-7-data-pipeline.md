# Epic 7: Data Pipeline & Automation

**Duration:** Weeks 9-10
**Goal:** Automated scraping from NSE/BSE for real-time data
**Business Value:** Fresh data without manual updates, competitive advantage
**Status:** Pending

---

## Overview

This epic replaces static seed data with live, automated data collection from NSE/BSE websites and IPO Alerts API. It implements web scraping, job scheduling, and cache invalidation for real-time IPO information.

## Success Criteria

- ✅ Automated scraping every 15-30 minutes
- ✅ NSE and BSE as primary sources
- ✅ IPO Alerts API as fallback
- ✅ Subscription data updated within 15 minutes
- ✅ Error handling and logging robust
- ✅ 95%+ scraper uptime

## Stories

| ID | Story | Priority | Points | Status | Dependencies |
|----|-------|----------|--------|--------|--------------|
| 7.1 | NSE Scraper Implementation | Critical | 8 | Pending | 2.3 |
| 7.2 | BSE Scraper Implementation | Critical | 8 | Pending | 2.3 |
| 7.3 | IPO Alerts API Fallback | High | 3 | Pending | 7.1, 7.2 |
| 7.4 | Scheduler & Cache Invalidation | Critical | 5 | Pending | 7.1, 7.2 |
| 7.5 | Error Handling & Monitoring | High | 3 | Pending | 7.4 |

**Total Points:** 27
**Estimated Duration:** 1.5 weeks

---

## Data Sources

### Primary: Web Scraping
1. **NSE India** (`https://www.nseindia.com/market-data/public-issues`)
   - Current and upcoming mainboard IPOs
   - Real-time subscription data
   - Issue details, timelines
   - Requires Puppeteer (JavaScript-rendered)

2. **BSE India** (`https://www.bseindia.com/publicissue.html`)
   - BSE-listed and SME IPOs
   - Subscription status
   - May use Cheerio (static HTML) for performance

### Secondary: API Fallback
3. **IPO Alerts API** (`https://api.ipoalerts.in`)
   - Used when scraping fails 3+ times
   - Covers mainboard IPOs primarily
   - Rate limit: 100 requests/hour

---

## Scraping Architecture

### Technology Stack
- **Puppeteer 22+** for NSE (headless Chrome)
- **Cheerio** for BSE (if static HTML)
- **Node-cron 3.0+** for scheduling
- **Pino** for structured logging
- **Zod** for data validation

### Scraper Pattern
```javascript
async function scrapeNSE() {
  try {
    // 1. Launch headless browser
    const browser = await puppeteer.launch({ headless: true })

    // 2. Navigate and wait for content
    const page = await browser.newPage()
    await page.goto(NSE_URL)
    await page.waitForSelector('.ipo-table')

    // 3. Extract data
    const ipos = await page.evaluate(() => {
      // DOM parsing logic
    })

    // 4. Validate with Zod
    const validated = IPOSchema.parse(ipos)

    // 5. Upsert to database
    await IPORepository.upsert(validated)

    // 6. Invalidate cache
    await invalidateCache('ipos')

    // 7. Log success
    logger.info({ count: ipos.length }, 'NSE scrape successful')

  } catch (error) {
    logger.error({ error }, 'NSE scrape failed')
    // Fallback to IPO Alerts API
    await fallbackScrape()
  }
}
```

### Schedule
- **Every 15 minutes** during market hours (9 AM - 5 PM)
- **Every 30 minutes** after market hours
- **Every 1 hour** on weekends/holidays
- Configured via Node-cron expressions

---

## Error Handling Strategy

### Scraper Failures
1. **Retry 3 times** with exponential backoff (1s, 2s, 4s)
2. **Fallback to API** if all retries fail
3. **Alert if API also fails** (email to admin)
4. **Graceful degradation**: Show last known data with "Last updated: X mins ago"

### Monitoring
- **Scraper logs** stored in `scraper_logs` table
- **Success/failure metrics** tracked
- **Alert if 3+ consecutive failures**
- **Daily summary email** with scrape statistics

---

## Technical Details

### Scraper Service Structure
```
scraper/
├── src/
│   ├── scrapers/
│   │   ├── nse-scraper.ts
│   │   ├── bse-scraper.ts
│   │   └── ipo-alerts-api.ts
│   ├── services/
│   │   ├── scheduler.ts
│   │   ├── data-merger.ts (merge NSE + BSE data)
│   │   └── cache-invalidator.ts
│   ├── utils/
│   │   ├── logger.ts (Pino)
│   │   └── validators.ts (Zod schemas)
│   └── index.ts (entry point)
├── .env
└── package.json
```

### Cache Invalidation
When new data scraped:
1. Delete cache keys:
   - `ipos:list:*` (all listing variations)
   - `ipo:{slug}` (specific IPO if updated)
   - `subscription:latest:{slug}` (if subscription changed)
2. Set "Last Updated" timestamp in database
3. Trigger real-time update via WebSocket (Phase 2)

---

## Dependencies

**This Epic Requires:**
- Epic 2: Story 2.3 (Repositories to save scraped data)

**This Epic Blocks:**
- None (site works with seed data, scrapers enhance it)

---

## Risks & Mitigation

**Risk 1: Exchange websites change structure**
- Impact: Scrapers break, no new data
- Mitigation: Modular selectors, easy to update
- Contingency: Switch to manual updates + API fallback within 24h

**Risk 2: Anti-bot detection blocks scrapers**
- Impact: Scraping fails consistently
- Mitigation: Puppeteer stealth plugin, rotate user agents
- Contingency: Pay for IPO Alerts API premium tier

**Risk 3: Data inconsistencies between NSE/BSE**
- Impact: Conflicting information shown
- Mitigation: Data merger logic prioritizes official exchange
- Contingency: Show source attribution on frontend

---

## Definition of Done

- [ ] NSE and BSE scrapers running successfully
- [ ] Cron scheduler executing on defined intervals
- [ ] Fallback API working when scrapers fail
- [ ] Cache invalidation tested (data refreshes in UI)
- [ ] Error logging comprehensive (track all failures)
- [ ] Monitoring alerts configured (email on 3+ failures)
- [ ] 1 week test period: 95%+ uptime achieved
- [ ] Documentation: How to fix broken scrapers
