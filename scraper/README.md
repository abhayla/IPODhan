# IPODhan Scraper

Automated data scraping service for extracting IPO data and subscription information from NSE India website.

## Features

- **NSE Scraper**: Extracts IPO data from NSE India public issues page
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

# NSE Scraper
NSE_URL=https://www.nseindia.com/market-data/public-issues
SCRAPER_TIMEOUT=30000
RETRY_ATTEMPTS=3
RETRY_DELAYS=1000,2000,4000

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

## Usage

### Manual Execution

Run scraper manually for testing:

```bash
# From project root
npm run scraper:nse

# From scraper directory
npm start

# Development mode (watch for changes)
npm run dev
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
│   │   └── nse-scraper-orchestrator.ts # Main orchestration
│   ├── services/
│   │   ├── data-persister.ts           # Database upsert with retry
│   │   └── cache-invalidator.ts        # Redis cache invalidation
│   ├── utils/
│   │   ├── browser.ts                  # Puppeteer utilities
│   │   ├── logger.ts                   # Pino logger
│   │   └── validators.ts               # Zod schemas
│   ├── config.ts                       # Configuration loader
│   └── index.ts                        # CLI entry point
├── tests/
│   ├── unit/                           # Unit tests (>85% coverage)
│   ├── integration/                    # Integration tests
│   └── e2e/                            # E2E tests with performance validation
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

## Future Enhancements (Not in Story 7.1)

- Scheduled execution (Story 7.4 - node-cron)
- BSE scraper integration (Story 7.2)
- IPO Alerts API fallback (Story 7.3)
- Sentry error tracking (Story 7.5)
- Real-time NSE page structure monitoring

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

### NSE Page Structure Changed

**Issue**: Scraper returns 0 IPOs or validation errors

**Solution**: NSE page structure may have changed. Update selectors in `nse-scraper.ts`.

## Support

For issues or questions:
- Check logs in `scraper/logs/` (if configured)
- Review error messages for validation failures
- Verify NSE website is accessible: https://www.nseindia.com/market-data/public-issues

## License

Proprietary - IPODhan Platform
