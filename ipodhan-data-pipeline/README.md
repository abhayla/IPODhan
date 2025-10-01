# IPODhan Data Pipeline

Comprehensive IPO data scraping, validation, and storage pipeline for IPODhan platform.

## Overview

This data pipeline scrapes IPO data from NSE/BSE and GMP data from multiple sources, validates and normalizes the data, and stores it in PostgreSQL database with comprehensive monitoring.

## Features

- **Multi-Source IPO Data Scraping**: NSE and BSE official sources
- **GMP Tracking**: IPOWatch, InvestorGain, Chittorgarh integration
- **Data Validation**: Pydantic-based schema validation
- **Data Normalization**: Standardized data format across sources
- **Automated Scheduling**: Market hours-aware scheduling
- **Monitoring & Alerts**: Health checks, data freshness tracking, Sentry integration
- **Historical Backfill**: Script for backfilling 2+ years of data
- **Repository Pattern**: Clean database access layer

## Architecture

```
ipodhan-data-pipeline/
├── scrapers/           # Web scrapers (NSE, BSE, GMP sources)
├── validators/         # Data validation and normalization
├── repositories/       # Database access layer
├── orchestrator/       # Pipeline orchestration and scheduling
├── monitoring/         # Health checks and metrics
├── schemas/           # Pydantic data schemas
├── scripts/           # Utility scripts (backfill, etc.)
├── tests/             # Unit and integration tests
├── main.py            # CLI entry point
└── requirements.txt   # Python dependencies
```

## Installation

### Prerequisites

- Python 3.11+
- PostgreSQL 16
- Docker (optional, for local development)

### Setup

1. **Clone the repository**
   ```bash
   cd ipodhan-data-pipeline
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Install Playwright browsers**
   ```bash
   playwright install chromium
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

5. **Run database migrations**
   ```bash
   # Ensure PostgreSQL is running
   # Run migration scripts in infrastructure/database/migrations/ in order
   psql -h localhost -U postgres -d ipodhan -f ../infrastructure/database/migrations/001_initial_schema.sql
   psql -h localhost -U postgres -d ipodhan -f ../infrastructure/database/migrations/002_enhanced_ipo_schema.sql
   ```

## Usage

### Command Line Interface

```bash
# Start scheduled pipeline (runs continuously)
python main.py schedule

# Run IPO pipeline once
python main.py run-ipo

# Run GMP pipeline once
python main.py run-gmp

# Run full pipeline once
python main.py run-full

# Check pipeline health
python main.py health-check

# View weekly metrics report
python main.py metrics

# View help
python main.py help
```

### Historical Data Backfill

```bash
# Backfill last 2 years of data
python scripts/backfill_historical_data.py

# Reset and re-run backfill
python scripts/backfill_historical_data.py --reset
```

### Monitoring

```bash
# Run health check
python -m monitoring.health_check

# Generate weekly report
python -m monitoring.metrics
```

## Configuration

### Environment Variables

Configure in `.env` file:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=postgres
DB_POOL_MIN=1
DB_POOL_MAX=10

# Sentry (optional)
SENTRY_DSN=

# Scraping
SCRAPE_TIMEOUT=30
SCRAPE_RETRY_COUNT=3

# Scheduling
IPO_SCRAPE_INTERVAL=15                 # minutes
GMP_SCRAPE_INTERVAL_MARKET=30          # minutes
GMP_SCRAPE_INTERVAL_OFFHOURS=60        # minutes
MARKET_HOURS_START=09:00
MARKET_HOURS_END=17:00

# Logging
LOG_LEVEL=INFO
```

### Scheduling Logic

- **IPO Data (NSE/BSE)**: Every 15 minutes during market hours (9 AM - 5 PM IST)
- **GMP Data**: Every 30 minutes during market hours, hourly off-hours
- **Materialized View Refresh**: Every 2 hours for `gmp_current`

## Database Schema

### Main Tables

- `ipos`: Core IPO information
- `ipo_details`: Extended IPO details (ISIN, financials dates)
- `ipo_financials`: Revenue, profit, key ratios
- `gmp_tracking`: GMP history with multiple sources
- `pipeline_status`: Pipeline health monitoring

### Materialized Views

- `gmp_current`: Aggregated current GMP across sources

## Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=. --cov-report=term

# Run specific test file
pytest tests/unit/test_validators.py

# Run integration tests (requires database)
pytest tests/integration/
```

## Data Flow

```
1. Scrape     → NSE/BSE scrapers fetch IPO data
               GMP scrapers fetch grey market data

2. Validate   → IPODataValidator validates data
               Schema validation with Pydantic

3. Normalize  → DataNormalizer standardizes format
               Date formatting, amount conversions

4. Store      → IPODataRepository handles database
               Duplicate checking, upsert logic

5. Monitor    → Pipeline status tracking
               Health checks and alerts
```

## Monitoring & Alerts

### Health Check Dashboard

Monitors:
- Last successful scrape time per source
- Consecutive failure count
- Data freshness status (GREEN/YELLOW/RED)
- Execution metrics

### Alert Conditions

- **Consecutive Failures**: Alert after 3 consecutive failures
- **Stale Data**: Alert if no successful scrape in 6 hours
- **Sentry Integration**: Automatic error tracking

### Data Freshness

- **GREEN**: Data updated < 1 hour ago
- **YELLOW**: Data updated 1-3 hours ago
- **RED**: Data updated > 3 hours ago

## Error Handling

- **Retry Mechanism**: 3 attempts with exponential backoff (1s, 2s, 4s)
- **Timeout**: 30-second timeout per request
- **Error Logging**: Comprehensive logging with Sentry integration
- **Graceful Degradation**: Continue pipeline despite individual source failures

## Development

### Code Standards

- **Formatting**: Black (line length 100)
- **Type Hints**: Pydantic schemas for validation
- **Naming**: snake_case for files/functions, PascalCase for classes
- **Testing**: Minimum 70% code coverage

### Running Locally

```bash
# Format code
black .

# Run linting (if configured)
# flake8 .

# Run tests
pytest --cov=.

# Start pipeline
python main.py run-full
```

### CI/CD

Tests run automatically via GitHub Actions (`.github/workflows/ci-data.yml`):
- Black formatter check
- Pytest execution
- Code coverage reporting

## Deployment

### Windows Service (NSSM)

```bash
# Install as Windows Service
nssm install IPODhanDataPipeline "C:\Python311\python.exe" "C:\path\to\main.py schedule"
nssm set IPODhanDataPipeline AppDirectory "C:\path\to\ipodhan-data-pipeline"
nssm start IPODhanDataPipeline
```

### Windows Task Scheduler

Alternative scheduling via Windows Task Scheduler:
- Create task for IPO pipeline (every 15 min during 9 AM - 5 PM)
- Create task for GMP pipeline (every 30 min during 9 AM - 5 PM, hourly off-hours)

## Troubleshooting

### Common Issues

**1. Playwright browser not installed**
```bash
playwright install chromium
```

**2. Database connection failed**
- Check PostgreSQL is running
- Verify credentials in `.env`
- Test connection: `psql -h localhost -U postgres -d ipodhan`

**3. Scraping timeout errors**
- Increase `SCRAPE_TIMEOUT` in `.env`
- Check internet connection
- Verify source websites are accessible

**4. Import errors**
```bash
# Ensure you're in the correct directory
cd ipodhan-data-pipeline

# Reinstall dependencies
pip install -r requirements.txt
```

## Performance

- **IPO Pipeline**: ~5-10 seconds per source
- **GMP Pipeline**: ~10-15 seconds for all sources
- **Database Queries**: Indexed for fast retrieval
- **Connection Pooling**: Up to 10 concurrent connections

## Security

- **No Hardcoded Credentials**: All config in `.env`
- **Respectful Scraping**: Rate limits (1 req/30s per source)
- **Parameterized Queries**: SQL injection prevention
- **User-Agent Header**: Legitimate scraper identification

## Contributing

1. Follow coding standards (Black formatting)
2. Write tests for new features
3. Update documentation
4. Ensure CI/CD passes

## License

Proprietary - IPODhan Platform

## Support

For issues or questions, contact the development team or open an issue in the repository.
