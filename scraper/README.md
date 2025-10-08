# IPODhan Scraper

Automated data scraping service for extracting IPO data and subscription information from NSE and BSE India websites.

## Features

- **NSE Scraper**: Extracts IPO data from NSE India public issues page
- **BSE Scraper**: Extracts IPO data from BSE India public issues page (including SME IPOs)
- **IPO Alerts API Fallback**: Automatic fallback to API when NSE/BSE scrapers fail
- **Dual-Listed IPO Support**: Automatically merges data for IPOs listed on both NSE and BSE
- **SME IPO Coverage**: Comprehensive coverage of SME IPOs from BSE
- **Failure Tracking**: Monitors consecutive scraper failures and triggers fallback automatically
- **Rate Limiting**: Enforces 100 requests/hour limit for API fallback
- **Data Validation**: Zod schema validation for all scraped data
- **Retry Logic**: Exponential backoff (1s, 2s, 4s) for resilient scraping
- **Database Persistence**: Upserts IPO data and creates subscription snapshots
- **Cache Invalidation**: Automatic Redis cache invalidation after updates
- **Structured Logging**: Pino logger with JSON output for monitoring
- **Manual Execution**: CLI tool for manual testing before scheduling

## Installation

```bash
# Install dependencies (from project root)
npm install --workspace=scraper

# Or from scraper directory
cd scraper
npm install
```

## Configuration

Create `scraper/.env` file (use `.env.example` as template):

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ipodhan

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=

# Scrapers
NSE_URL=https://www.nseindia.com/market-data/public-issues
BSE_URL=https://www.bseindia.com/publicissue.html
SCRAPER_TIMEOUT=30000
RETRY_ATTEMPTS=3
RETRY_DELAYS=1000,2000,4000

# IPO Alerts API Fallback (Story 7.3)
IPO_ALERTS_API_URL=https://api.ipoalerts.in
IPO_ALERTS_API_KEY=your_api_key_here

# Rate Limiting (Story 7.3)
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW=3600000

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

## Usage

### Manual Execution

Run scrapers manually for testing:

```bash
# Run NSE scraper (default)
npm start

# Run BSE scraper only
npm run start:bse

# Run both scrapers (NSE first, then BSE)
npm run start:all

# Run IPO Alerts API fallback scraper (Story 7.3)
npm run start:fallback
# or
npm run start:api

# Development mode (watch for changes)
npm run dev
```

### CLI Options

The scraper CLI supports a `--source` flag to control which scraper(s) to run:

- `--source=nse` (default): Run NSE scraper only
- `--source=bse`: Run BSE scraper only
- `--source=fallback` or `--source=api`: Run IPO Alerts API fallback only (Story 7.3)
- `--source=all`: Run all scrapers sequentially (NSE, BSE, and fallback)

Examples:
```bash
tsx src/index.ts --source=bse
tsx src/index.ts --source=fallback
```

### Expected Output

```
{"level":"info","time":"2025-10-08T10:30:00.000Z","msg":"NSE scraper orchestrator started"}
{"level":"info","time":"2025-10-08T10:30:15.000Z","msg":"Scraped data received from NSE","totalIPOs":15}
{"level":"info","time":"2025-10-08T10:30:45.000Z","msg":"NSE scraper orchestrator completed","iposProcessed":15,"iposInserted":3,"iposUpdated":12,"iposFailed":0,"subscriptionsCreated":5,"duration":45000}
{"level":"info","time":"2025-10-08T10:30:45.000Z","msg":"Scraper completed successfully"}
```

### Exit Codes

- `0`: Success (all IPOs processed successfully or majority succeeded)
- `1`: Failure (errors during scraping or majority failed)

## Architecture

### Directory Structure

```
scraper/
├── src/
│   ├── scrapers/
│   │   ├── nse-scraper.ts              # NSE scraping logic
│   │   ├── nse-scraper-orchestrator.ts # NSE orchestration
│   │   ├── bse-scraper.ts              # BSE scraping logic (Story 7.2)
│   │   ├── bse-scraper-orchestrator.ts # BSE orchestration (Story 7.2)
│   │   ├── ipo-alerts-fallback.ts      # API fallback scraper (Story 7.3)
│   │   └── ipo-alerts-fallback-orchestrator.ts # API fallback orchestration (Story 7.3)
│   ├── services/
│   │   ├── data-persister.ts           # Database upsert with retry & merge logic
│   │   ├── cache-invalidator.ts        # Redis cache invalidation
│   │   ├── ipo-alerts-client.ts        # IPO Alerts API client with rate limiting (Story 7.3)
│   │   └── scraper-failure-tracker.ts  # Failure tracking for automatic fallback (Story 7.3)
│   ├── utils/
│   │   ├── browser.ts                  # Puppeteer utilities
│   │   ├── logger.ts                   # Pino logger
│   │   └── validators.ts               # Zod schemas
│   ├── config.ts                       # Configuration loader
│   └── index.ts                        # CLI entry point (multi-source support)
├── tests/
│   ├── unit/                           # Unit tests (>90% coverage)
│   ├── integration/                    # Integration tests
│   ├── e2e/                            # E2E tests with performance validation
│   └── fixtures/                       # Test fixtures (API responses, mock data)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Workflow

1. **Scrape**: Launch Puppeteer browser and navigate to NSE public issues page
2. **Extract**: Parse DOM to extract IPO data and subscription figures
3. **Validate**: Validate extracted data with Zod schemas
4. **Persist**: Upsert IPO to database, create subscription snapshots
5. **Invalidate**: Delete relevant Redis cache keys
6. **Log**: Record success/failure metrics for monitoring

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run E2E tests (includes performance test)
npm run test:e2e

# Test coverage
npm run test:coverage
```

### Performance Test

E2E test validates scraper execution time < 60 seconds (requirement from Story 7.1).

## Security

- **Environment Variables**: All sensitive config in `.env` (never committed)
- **Database SSL**: Enabled in production via `NODE_ENV=production`
- **Redis AUTH**: Password authentication configured for production
- **Input Sanitization**: Multi-layer (Zod + HTML escaping + parameterized queries)
- **Scraping Compliance**: Respects robots.txt and Terms of Service

## Monitoring

Scraper logs are structured JSON for easy parsing by PM2 and monitoring tools:

- **Success Logs**: IPO count, duration, insert/update breakdown
- **Error Logs**: Validation failures, database errors, retry attempts
- **Performance Logs**: Execution time, bottleneck identification

## BSE Scraper Implementation (Story 7.2)

### Parsing Technology Decision

**Chosen Approach**: Puppeteer (JavaScript-rendered content)

**Evaluation Evidence** (2025-10-08):
1. **View Source Test**: BSE page contains IPO table data in initial HTML render
2. **Network Tab Analysis**: Page uses ASP.NET postbacks (`__doPostBack`) for dynamic content
3. **JavaScript Dependency**: Subscription data loaded via JavaScript interactions and popups

**Rationale**:
- BSE uses ASP.NET with JavaScript postbacks for subscription data
- While basic IPO list is in static HTML, subscription data requires JavaScript execution
- Consistency with NSE scraper (Puppeteer already configured)
- More reliable for complex page interactions and future-proofing
- Meets <60s performance target despite browser overhead

**Trade-offs**:
- Slower than Cheerio (3-5s browser launch vs <1s HTML fetch)
- Higher memory usage (~100MB vs ~10MB)
- More robust for page structure changes

### SME IPO Handling

The BSE scraper automatically identifies and categorizes SME IPOs:
- Detects SME platform designation from BSE table ("SME" vs "MainBoard")
- Tags IPOs with correct category (MAINBOARD, SME, RIGHTS, NCD)
- Tracks SME count separately in scraper logs
- Critical for comprehensive SME IPO coverage (BSE is primary SME exchange)

### Dual-Listed IPO Merge Logic

When an IPO is listed on both NSE and BSE:
1. NSE scraper runs first, creates IPO with `listingExchanges: ['NSE']`
2. BSE scraper finds same IPO (matched by slug)
3. Adds 'BSE' to `listingExchanges` array: `['NSE', 'BSE']`
4. Logs merge operation for monitoring
5. Creates separate subscription snapshots for each exchange
6. Prioritizes NSE data if discrepancies detected (NSE more authoritative for mainboard)

Example log output:
```json
{"level":"info","msg":"IPO tata-capital-limited updated with BSE listing (dual-listed)","slug":"tata-capital-limited","exchanges":["NSE","BSE"]}
```

## IPO Alerts API Fallback (Story 7.3)

### Overview

The scraper includes an automatic fallback mechanism that uses the IPO Alerts API when primary scrapers (NSE/BSE) fail. This ensures 95%+ data availability even during scraper failures.

### Fallback Trigger

The fallback is triggered automatically when:
- NSE scraper fails 3 consecutive times
- BSE scraper fails 3 consecutive times
- Manual execution via `npm run start:fallback`

### How It Works

1. **Failure Tracking**: Each scraper failure is tracked in memory
2. **Threshold Check**: After 3 consecutive failures, fallback is triggered
3. **API Fetch**: IPO Alerts API is called to fetch open and upcoming IPOs
4. **Data Transformation**: API data (underscore_case) is transformed to IPODhan format (camelCase)
5. **Validation**: All API data is validated with Zod schemas
6. **Merge Logic**:
   - If IPO does NOT exist: Create new IPO from API data
   - If IPO exists (from NSE/BSE): DO NOT overwrite NSE/BSE data (more authoritative)
   - Log data discrepancies for monitoring
7. **Persistence**: Upsert validated data to database
8. **Cache Invalidation**: Delete relevant Redis cache keys

### Rate Limiting

- **Limit**: 100 requests per hour (API provider constraint)
- **Tracking**: In-memory request timestamp tracking
- **Warning**: Log warning at 80% threshold (80 requests)
- **Enforcement**: Reject requests when limit reached
- **Reset**: Rate limit window resets after 1 hour

### Data Merge Behavior

**NSE/BSE data is ALWAYS authoritative**. API fallback is supplementary only.

**When IPO exists with NSE/BSE data:**
- DO NOT overwrite: company name, issue size, price range, dates, description, registrar, lead managers
- DO merge: listing exchanges (additive only)
- Log discrepancies for monitoring (e.g., "API reports issue size: 500 crores, NSE reports: 450 crores")

**When IPO does not exist:**
- Create new IPO with all fields from API data
- Track source: `source='IPO_ALERTS_API'`

### Environment Variables

Required environment variables for API fallback:

```bash
# IPO Alerts API Configuration
IPO_ALERTS_API_URL=https://api.ipoalerts.in  # API base URL
IPO_ALERTS_API_KEY=your_api_key_here         # Get from IPO Alerts provider

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100                   # Max requests per hour
RATE_LIMIT_WINDOW=3600000                     # Rate limit window (1 hour in ms)
```

### Manual Execution

Run API fallback manually for testing:

```bash
# Using npm script
npm run start:fallback

# Or using tsx directly
tsx src/index.ts --source=fallback
```

### Troubleshooting

#### API Authentication Failed (401)

**Issue**: API rejects requests with 401 Unauthorized

**Solution**:
1. Verify `IPO_ALERTS_API_KEY` is set correctly in `.env`
2. Contact API provider to verify API key validity
3. Check if API key has been rotated or expired
4. Test API key with curl:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" https://api.ipoalerts.in/ipos?status=open
   ```

#### Rate Limit Exceeded (429)

**Issue**: API returns 429 Too Many Requests

**Solution**:
1. Check rate limit status in logs (remaining requests)
2. Wait until rate limit resets (logged reset time)
3. Reduce scraper execution frequency
4. Consider upgrading API plan for higher limits (if available)

#### API Endpoint Not Found (404)

**Issue**: API returns 404 Not Found

**Solution**:
1. Verify `IPO_ALERTS_API_URL` in `.env` is correct
2. Check API documentation for endpoint changes
3. Test API endpoint availability:
   ```bash
   curl https://api.ipoalerts.in/ipos?status=open
   ```

#### No Data Returned from API

**Issue**: API returns empty data array

**Solution**:
- This is expected when no IPOs are currently open/upcoming
- Logs will show "0 IPOs fetched from API"
- Not an error, fallback completed successfully

#### API Response Format Changed

**Issue**: Zod validation fails for API responses

**Solution**:
1. Check logs for validation error details
2. Update Zod schemas in `src/utils/validators.ts` to match new API format
3. Update `transformIPOAlertsData()` function if field names changed
4. Re-run tests to verify: `npm run test:unit`

### Monitoring

API fallback logs include:

```json
{
  "level": "info",
  "msg": "API fallback scrape successful",
  "scraper": "ipo_alerts_api",
  "triggerReason": "nse_failure",
  "iposFetched": 15,
  "iposInserted": 2,
  "iposSkipped": 13,
  "iposFailed": 0,
  "rateLimitUsed": 5,
  "rateLimitRemaining": 95,
  "duration": 12000
}
```

### Performance

- **Target**: < 30 seconds for typical API response (10-20 IPOs)
- **API Request Time**: < 5 seconds per request
- **No Browser Overhead**: Uses native `fetch` API (faster than web scraping)
- **Transformation**: < 10ms per IPO

## Future Enhancements (Not in Story 7.1/7.2/7.3)

- Scheduled execution (Story 7.4 - node-cron)
- Persistent rate limit tracking (Story 7.5 - Redis or database)
- Sentry error tracking (Story 7.5)
- Real-time page structure monitoring for NSE, BSE, and API

## Troubleshooting

### Scraper Fails to Launch Browser

**Issue**: Puppeteer cannot launch Chrome

**Solution**: Install Chrome dependencies (Linux servers)

```bash
# Ubuntu/Debian
sudo apt-get install -y chromium-browser

# Or use Puppeteer's bundled Chromium
```

### Database Connection Errors

**Issue**: Cannot connect to PostgreSQL

**Solution**: Verify `DATABASE_URL` in `.env` and check database is running

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"
```

### Redis Connection Errors

**Issue**: Cannot connect to Redis

**Solution**: Verify Redis is running and `REDIS_URL` is correct

```bash
# Test Redis connection
redis-cli ping
```

### NSE/BSE Page Structure Changed

**Issue**: Scraper returns 0 IPOs or validation errors

**Solution**: NSE or BSE page structure may have changed. Update selectors:
- NSE: Update selectors in `nse-scraper.ts`
- BSE: Update selectors in `bse-scraper.ts`

**BSE-Specific**: If BSE page structure changes significantly, may need to re-evaluate Cheerio vs Puppeteer decision.

## Support

For issues or questions:
- Check logs in `scraper/logs/` (if configured)
- Review error messages for validation failures
- Verify NSE website is accessible: https://www.nseindia.com/market-data/public-issues

## License

Proprietary - IPODhan Platform
