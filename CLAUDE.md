# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IPODhan is a comprehensive IPO-focused platform for Indian retail investors. The project combines web/mobile applications with a robust data pipeline for real-time IPO tracking and analysis.

**Current Status:** Active Development - Data Pipeline Complete ✅, Scoring Engine In Progress 🚧

### Key Features
- Real-time IPO tracking (live, upcoming, closed IPOs)
- Grey Market Premium (GMP) monitoring with multi-source validation
- IPO scoring algorithm (0-100 scores with 4 weighted components) - IN PROGRESS
- Broker comparisons and demat account opening facilitation
- Investment tools and calculators
- Knowledge hub for IPO education

## Architecture and Technology Stack

### Data Pipeline (Production-Ready ✅)
- **Language**: Python 3.11+ (tested on Python 3.13.7)
- **Database**: PostgreSQL 14+ with materialized views
- **Web Scraping**: Playwright (async automation with anti-bot detection, requires `playwright install`)
- **Data Validation**: Pydantic V2 for type-safe schemas
- **Architecture Pattern**: Repository pattern with clean separation of concerns
- **Testing**: pytest with 50 tests (100% pass rate, 95-99% critical coverage)
- **Code Quality**: Black formatter, Flake8 linting
- **CI/CD**: GitHub Actions workflow configured

**Data Sources:**
- NSE India (official IPO listings)
- BSE India (official IPO listings)
- IPOWatch (GMP tracking)
- InvestorGain (GMP tracking)
- Chittorgarh (GMP tracking)

### IPO Scoring Engine (In Progress 🚧)
- **Language**: Python 3.11+ (FastAPI for API)
- **Database**: PostgreSQL (shared with data pipeline)
- **Cache**: Redis 7.x for score caching (TTL: 1 hour)
- **Architecture**: Microservice pattern with FastAPI
- **Testing**: pytest with 50+ tests target (70% coverage minimum)
- **Scheduling**: 3x daily score calculations (9 AM, 1 PM, 5 PM IST)

**Scoring Components:**
- Fundamentals (40%): P/E, revenue growth, profitability, debt, ROE, cash flow
- Market Sentiment (30%): GMP trend, watchlist, crowd prediction
- Subscription (20%): QIB, HNI, retail, momentum
- Sector Timing (10%): Sector performance, peer comparison, market condition

### Web Application (Planned)
- **Frontend**: React (Next.js) with Tailwind CSS for web, React Native for mobile
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (shared with data pipeline)
- **Real-time**: WebSockets for live updates
- **Analytics**: Google Analytics with custom tracking

### Infrastructure
- **Cloud**: AWS/GCP/Vercel
- **Containerization**: Docker ready
- **Monitoring**: Sentry integration points
- **Security**: Environment-based secrets, 100% parameterized queries

## Project Structure

```
IPODhan/
├── ipodhan-data-pipeline/          # ✅ PRODUCTION-READY
│   ├── scrapers/                   # Web scrapers (NSE, BSE, GMP sources)
│   ├── validators/                 # Pydantic-based data validation
│   ├── schemas/                    # Type-safe data schemas
│   ├── repositories/               # Database access layer (repository pattern)
│   ├── orchestrator/               # Pipeline coordination (pipeline.py, scheduler.py)
│   ├── monitoring/                 # Health checks and metrics
│   ├── tests/                      # 50 tests (unit + integration)
│   │   ├── unit/                   # 25 unit tests
│   │   └── integration/            # 25 integration tests
│   ├── scripts/                    # Utility scripts (backfill, setup, populate)
│   └── main.py                     # CLI entry point (run-ipo, run-gmp, run-full, schedule)
│
├── ipodhan-score-engine/           # 🚧 IN PROGRESS (Story 1.3)
│   ├── algorithms/                 # Scoring engine, SME adjuster
│   ├── api/                        # FastAPI REST endpoints
│   ├── repositories/               # Score data access layer
│   ├── schedulers/                 # 3x daily score calculations
│   ├── testing/                    # A/B testing framework
│   ├── monitoring/                 # Performance tracking
│   └── tests/                      # 50+ tests (unit + integration)
│
├── infrastructure/
│   └── database/
│       ├── migrations/             # PostgreSQL schema migrations (001-004)
│       └── BACKFILL_README.md      # Historical data backfill guide
│
├── docs/
│   ├── stories/                    # User stories and requirements (1.2 ✅, 1.3 🚧)
│   ├── api/                        # API specifications
│   └── qa/                         # Quality assurance documentation
│       ├── assessments/            # Risk profiles and test reports
│       └── gates/                  # Quality gate decisions
│
├── ipodhan-web/                    # Frontend (Next.js) - PLANNED
├── ipodhan-backend/                # Backend API (Express) - PLANNED
└── figma-plugin/                   # Design system plugin
```

## Development Guidelines

### Data Pipeline Development

**Testing Requirements:**
- All new features must include unit tests
- Integration tests for scrapers and database operations
- Minimum 90% coverage on critical modules (validators, repositories)
- All tests must pass before commit

**Code Quality Standards:**
- Run `black .` before committing (enforced in CI/CD)
- Flake8 linting (max-line-length=120)
- Type hints using Pydantic schemas
- Comprehensive docstrings for all public methods

**Database Guidelines:**
- Use repository pattern for all database access
- Always use parameterized queries (SQL injection prevention)
- Materialized views for complex aggregations (refresh every 2 hours)
- ON CONFLICT handling for upserts

**Scraping Best Practices:**
- Implement retry mechanism (3 attempts, exponential backoff)
- Use realistic browser fingerprinting (anti-bot detection)
- Rate limiting: 1 request per 30 seconds per source
- Save debug outputs (screenshots, HTML) for troubleshooting
- Proper User-Agent headers

### Performance Requirements
- Test suite execution: <3 seconds (currently 2.59s ✅)
- Scraper timeout: 30 seconds with retry
- Database connection pooling (10 connections max)
- Pipeline execution: Support for 5 sources concurrently
- 99.9% uptime target

### Security and Compliance
- All credentials in environment variables (.env not committed)
- 100% parameterized SQL queries (zero injection vectors)
- HTTPS encryption for all communications
- SEBI regulatory compliance for IPO content
- Respectful web scraping (rate limits, proper User-Agent)

### Data Quality
- Multi-source validation for GMP data (3 sources with confidence scoring)
- Duplicate detection (by ISIN and company name + dates)
- Comprehensive data validation using Pydantic schemas
- Health monitoring with consecutive failure tracking
- Data freshness indicators (green/yellow/red)

## Current Implementation Status

### ✅ Completed (Story 1.2 - IPO Data Pipeline)

**All Acceptance Criteria Met:**
1. ✅ Data source integration (NSE, BSE, 3 GMP sources)
2. ✅ Validation & normalization pipeline (Pydantic-based)
3. ✅ Database schema (migrations 001-003 complete)
4. ✅ GMP history tracking with materialized views
5. ✅ Scraper implementation (Playwright with anti-bot detection)
6. ✅ Pipeline monitoring & error handling

**Quality Metrics:**
- **Tests:** 50/50 passing (100%)
- **Quality Score:** 98/100 (EXCELLENT)
- **Risk Score:** 72/100 (LOW-MEDIUM, acceptable)
- **Coverage:** 95-99% on critical modules
- **Code Quality:** Black formatted, zero blocking issues

**Key Features:**
- Multi-source data ingestion with retry mechanisms
- Type-safe validation and normalization
- Duplicate detection and conflict resolution
- Health monitoring with automated alerts
- Comprehensive error logging with Sentry integration points
- Historical data backfill capability

### 🚧 In Progress (Story 1.3 - IPO Scoring Engine)

**Status:** Core implementation complete, testing in progress

**Completed Components:**
- ✅ IPO scoring microservice (FastAPI)
- ✅ 4-component scoring algorithm (Fundamentals 40%, Sentiment 30%, Subscription 20%, Sector 10%)
- ✅ Redis caching layer for score optimization
- ✅ A/B testing framework for algorithm variants
- ✅ Performance tracking for prediction accuracy
- ✅ Database migration 004 (score_history, score_performance, ab_experiments tables)
- ✅ SME-specific adjustments (penalties/bonuses)

**In Progress:**
- Testing and validation (50+ tests target)
- Production deployment configuration

### 📋 Planned
- Web application (Next.js frontend) - Story 1.4+
- Backend API (Express with REST endpoints)
- User authentication and authorization
- Mobile application (React Native)
- Real-time WebSocket updates
- AI-powered recommendations (build on scoring engine)
- Broker API integrations
- Payment gateway integration

## Working with the Codebase

### Important Architecture Patterns

**Repository Pattern (Established in Story 1.2):**
- All database access goes through repository classes (`repositories/` directory)
- 100% parameterized SQL queries (zero SQL injection vectors)
- Connection pooling (10 connections max) managed by `db_config.py`
- All repositories follow same pattern: `check_duplicate()`, `upsert_*()`, `get_*()` methods

**Pipeline Orchestration Pattern:**
- `orchestrator/pipeline.py`: Main DataPipeline class coordinates scrape → validate → normalize → store
- `orchestrator/scheduler.py`: Handles scheduling with market hours awareness
- Each source processed independently with error isolation
- Pipeline status tracked in `pipeline_status` table

**Scraper Pattern (Data Pipeline):**
- All scrapers inherit from `BaseScraper` (in `scrapers/base_scraper.py`)
- Playwright-based async automation with anti-bot detection
- Retry mechanism: 3 attempts with exponential backoff
- Debug outputs saved (screenshots, HTML) in `debug/` directory
- Rate limiting: 1 request per 30 seconds per source
- **IMPORTANT:** Always run `playwright install chromium` after pip install

**Scoring Pattern (Score Engine):**
- Main calculation in `IPOScoringEngine.calculate_score(ipo_data: dict) -> ScoreResult`
- Four component scores calculated separately, then weighted and summed
- Missing data handled with confidence assessment (HIGH/MEDIUM/LOW)
- Redis caching with 1-hour TTL (graceful degradation if Redis unavailable)
- SME adjustments applied after base score calculation
- Score bounded to 0-100 range with `min(max(score, 0), 100)`

**Validation & Normalization:**
- Pydantic V2 schemas in `schemas/` directory for type safety
- Two-stage validation: `validators/ipo_validator.py` → `validators/normalizer.py`
- Validation returns `ValidationResult` object with `is_valid`, `data`, `errors`
- Normalization handles date formats, currency conversions, field mappings

### Working with the Data Pipeline

#### Setup Development Environment

**Windows:**
```bash
cd ipodhan-data-pipeline

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers (REQUIRED)
playwright install chromium

# Setup database
python scripts/setup_database.py

# Run tests
pytest -v
```

**Linux/macOS:**
```bash
cd ipodhan-data-pipeline

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers (REQUIRED)
playwright install chromium

# Setup database
python scripts/setup_database.py

# Run tests
pytest -v
```

#### Running the Pipeline

The data pipeline uses a CLI interface through `main.py`:

```bash
# Run scheduled pipeline (default, runs continuously with market hours awareness)
python main.py
# or explicitly
python main.py schedule

# Run IPO pipeline once (scrapes NSE + BSE)
python main.py run-ipo

# Run GMP pipeline once (scrapes IPOWatch + InvestorGain + Chittorgarh)
python main.py run-gmp

# Run full pipeline (IPO + GMP) once
python main.py run-full

# Check pipeline health (shows source status, consecutive failures)
python main.py health-check

# Generate metrics report (weekly data quality report)
python main.py metrics

# Get help
python main.py help
```

**Pipeline Flow:**
1. `main.py` → `orchestrator/pipeline.py` → `DataPipeline` class
2. `DataPipeline.run_ipo_pipeline()` or `DataPipeline.run_gmp_pipeline()`
3. For each source: scrape → validate → normalize → store
4. Update `pipeline_status` table with execution stats
5. Refresh materialized views (for GMP aggregates)

### Working with the Scoring Engine (Story 1.3)

**Setup:**
```bash
cd ipodhan-score-engine

# Create virtual environment (if not exists)
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/macOS

# Install dependencies
pip install -r requirements.txt

# Setup Redis (required for caching)
# Windows: Download from https://github.com/microsoftarchive/redis/releases
# Linux: sudo apt-get install redis-server
# macOS: brew install redis
# Start Redis: redis-server (default port 6379)

# Configure environment (copy and edit .env.example)
cp .env.example .env

# Run database migration 004 (if not already applied)
psql -h <DB_HOST> -U <DB_USER> -d ipodhan_db -f ../infrastructure/database/migrations/004_score_tracking_tables.sql

# Run tests
pytest -v
```

**Running the Scoring Engine:**

```bash
# Start FastAPI server (default port 8001)
python main.py api
# or explicitly
python main.py

# Start automated scheduler (3x daily at 9 AM, 1 PM, 5 PM IST)
python main.py scheduler

# Calculate scores once (manual trigger)
python main.py calculate

# Run tests
python main.py test
# or
pytest -v

# Get help
python main.py help
```

**Key Components:**
- `algorithms/scoring_engine.py`: Main IPOScoringEngine class with calculate_score method
- `algorithms/sme_adjuster.py`: SME-specific adjustments (penalties/bonuses)
- `algorithms/schemas.py`: Pydantic data models for type safety
- `api/main.py`: FastAPI app with REST endpoints
- `repositories/score_repository.py`: Score database access (follows Story 1.2 pattern)
- `repositories/ipo_data_fetcher.py`: Fetches IPO data for scoring
- `schedulers/score_scheduler.py`: 3x daily calculations (9 AM, 1 PM, 5 PM IST)
- `testing/ab_testing.py`: A/B testing framework for algorithm variants
- `monitoring/performance_tracker.py`: Prediction accuracy tracking

**API Endpoints:**
- `GET /api/scores/{ipo_id}` - Current score with breakdown
- `GET /api/scores/{ipo_id}/history?days=30` - Historical scores (default 30 days)
- `GET /api/scores/{ipo_id}/breakdown` - Detailed component breakdown
- `POST /api/scores/{ipo_id}/recalculate` - Trigger recalculation (requires API key)
- `GET /api/scores/accuracy` - Accuracy metrics dashboard

**Scoring Algorithm:**
- **Total:** 100 points across 4 components
- **Fundamentals (40%):** P/E (8), Revenue Growth (8), Profitability (8), Debt (5), ROE (5), Cash Flow (6)
- **Market Sentiment (30%):** GMP Trend (10), Watchlist (5), Social Buzz (5), Crowd Prediction (5), Search Trends (5)
  - MVP skips Social Buzz + Search Trends, recalculates weights proportionally
- **Subscription (20%):** QIB (8), HNI (4), Retail (5), Momentum (3)
- **Sector Timing (10%):** Sector Performance (3), Peer Comparison (3), Market Condition (2), IPO Capacity (2)
- **SME Adjustments:** Risk penalty (-5), Liquidity penalty (-3), Growth bonus (+8 if revenue >40%), Promoter holding bonus (+3 if >60%)

**Reference Documentation:**
- Full story: `docs/stories/1.3.ipo-scoring-algorithm.md` (742 lines)
- Developer handoff: `docs/stories/1.3-dev-handoff.md` (quick reference)
- Sprint planning: `docs/stories/1.3-sprint-planning-summary.md`

### Running Tests

```bash
# Data Pipeline Tests (from ipodhan-data-pipeline/)
cd ipodhan-data-pipeline
pytest -v                                           # Run all 50 tests
pytest --cov=. --cov-report=term-missing           # With coverage
pytest tests/unit/test_validators.py -v            # Specific test file
pytest tests/integration/test_full_pipeline.py -v  # Integration tests
pytest -n auto                                      # Parallel execution

# Scoring Engine Tests (from ipodhan-score-engine/)
cd ipodhan-score-engine
pytest -v                                           # Run all tests
pytest --cov=algorithms --cov=api --cov=repositories --cov-report=term-missing
pytest tests/unit/test_scoring_engine.py -v        # Score algorithm tests
pytest tests/unit/test_sme_adjuster.py -v          # SME adjuster tests
pytest tests/integration/test_score_api.py -v      # API integration tests
pytest tests/integration/test_score_repository.py -v  # DB integration tests
```

### Code Formatting & Linting

```bash
# Format code with Black
black .

# Check formatting
black --check .

# Lint with Flake8
flake8 --max-line-length=120 --extend-ignore=E203,W503
```

## Key Files and Locations

### Documentation
- **Story Files:** `docs/stories/*.md` (user stories and ACs)
- **QA Reports:** `docs/qa/assessments/*.md` (risk profiles, test reports)
- **Quality Gates:** `docs/qa/gates/*.yml` (gate decisions)
- **API Specs:** `docs/api/*.md` (endpoint specifications)

### Database
- **Migrations:** `infrastructure/database/migrations/*.sql`
- **Backfill Guide:** `infrastructure/database/BACKFILL_README.md`

### Testing
- **Unit Tests:** `ipodhan-data-pipeline/tests/unit/`
- **Integration Tests:** `ipodhan-data-pipeline/tests/integration/`
- **Coverage Report:** `ipodhan-data-pipeline/.coverage`

### Configuration
- **CI/CD:** `.github/workflows/ci-data.yml`
- **Environment:** `ipodhan-data-pipeline/.env.example`

## Quality Assurance

### Testing Strategy
- **Unit Tests (25):** Validators, normalizers, repositories
- **Integration Tests (25):** Full pipeline, scrapers, database
- **Coverage Target:** >90% on critical modules
- **Test Execution:** <3 seconds for full suite

### Quality Gates
All code must pass through quality gates before merging:
- ✅ All tests passing (100%)
- ✅ Black formatting compliance
- ✅ No blocking linting issues
- ✅ Code review by QA agent (Quinn)
- ✅ Risk assessment (acceptable risk score)

### Risk Management
- **Risk Profiles:** Documented in `docs/qa/assessments/`
- **Acceptable Risk:** ≤72/100 (LOW-MEDIUM)
- **High-Risk Mitigations:** Multi-source redundancy, retry mechanisms
- **Monitoring:** Health checks, consecutive failure tracking

## Deployment

### Data Pipeline Deployment

**Production VPS Details:**
- **Server**: Windows Server 2022
- **IP**: 103.118.16.189
- **Database**: PostgreSQL 15.x

**Prerequisites:**
- PostgreSQL 15+ database
- Python 3.11+ environment
- Playwright browser dependencies

**Environment Variables:**
```env
# Database Configuration (Production VPS: Windows Server 2022 @ 103.118.16.189)
DB_HOST=103.118.16.189
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=***REMOVED-CREDENTIAL***

# Pipeline Configuration (Optional)
IPO_SCRAPE_INTERVAL=15              # Minutes between IPO scrapes
GMP_SCRAPE_INTERVAL_MARKET=30      # Minutes between GMP scrapes (market hours)
GMP_SCRAPE_INTERVAL_OFFMARKET=120  # Minutes between GMP scrapes (off-market)
MARKET_HOURS_START=09:00           # Market start time
MARKET_HOURS_END=17:00             # Market end time

# Monitoring (Optional)
SENTRY_DSN=your_sentry_dsn         # Error tracking
LOG_LEVEL=INFO                      # DEBUG, INFO, WARNING, ERROR

# Environment (Optional)
ENVIRONMENT=development             # development, staging, production
```

**Deployment Steps:**
1. Install dependencies: `pip install -r requirements.txt`
2. Install Playwright browsers: `playwright install chromium`
3. Run database migrations: `psql -f infrastructure/database/migrations/*.sql`
4. Execute backfill (optional): `python scripts/backfill_historical_data.py`
5. Start pipeline: `python main.py schedule` (or just `python main.py`)

**Monitoring:**
- Health check endpoint (planned)
- Pipeline status tracking in database
- Sentry error tracking
- Log aggregation (structured logging)

## CI/CD Pipeline

**GitHub Actions Workflow:** `.github/workflows/ci-data.yml`

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main`
- Changes in `ipodhan-data-pipeline/**`

**Steps:**
1. Setup Python 3.11
2. Install dependencies
3. Run Black formatter check
4. Run pytest (all 50 tests)
5. Generate coverage report

## Troubleshooting

### Common Issues

**1. Playwright Browser Not Found**
```bash
# Error: Executable doesn't exist at <path>
# Solution: Install Playwright browsers
playwright install chromium
```

**2. Database Connection Failed**
```bash
# Error: could not connect to server
# Solution: Check PostgreSQL is running and .env is configured
# Windows: Check services.msc for PostgreSQL service
# Linux: sudo systemctl status postgresql
```

**3. Import Errors After Installing Dependencies**
```bash
# Error: ModuleNotFoundError
# Solution: Ensure virtual environment is activated
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
```

**4. Tests Failing on Fresh Setup**
```bash
# Solution: Ensure database migrations are applied
cd infrastructure/database/migrations
psql -U your_user -d ipodhan_db -f 001_create_ipos_table.sql
psql -U your_user -d ipodhan_db -f 002_create_gmp_table.sql
psql -U your_user -d ipodhan_db -f 003_add_pipeline_status.sql
```

**5. Scraper Timeouts**
```bash
# Error: TimeoutError during scraping
# Solution: Check internet connection and anti-bot settings
# Debug outputs saved in: ipodhan-data-pipeline/debug/
```

**6. Redis Connection Failed (Scoring Engine)**
```bash
# Error: redis.exceptions.ConnectionError
# Solution: Ensure Redis server is running
# Windows: Run redis-server.exe
# Linux: sudo systemctl start redis
# Check connection: redis-cli ping (should return PONG)
# Note: API will work without Redis (slower, no caching)
```

**7. Score Calculation Errors**
```bash
# Error: Missing required fields
# Solution: Check IPO data completeness
# The scoring engine handles missing data gracefully with confidence scores
# Check logs for specific missing fields
# Verify IPO exists: psql -c "SELECT * FROM ipo_details WHERE id = <ipo_id>;"
```

## Contributing

### Development Workflow
1. Create feature branch from `develop`
2. Implement feature with tests
3. Run `black .` and `pytest`
4. Commit with descriptive message
5. Create pull request to `main`
6. Wait for CI/CD checks
7. Request QA review (if needed)

### Commit Message Format
```
<type>: <short description>

<detailed description>

<footer with references>

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>
```

**Types:** feat, fix, docs, test, refactor, chore

## Support and Resources

### Documentation
- **Product Requirements:** `docs/design-requirements/`
- **Technical Specs:** `docs/api/`, `docs/stories/`
- **Deployment Guides:** `*_DEPLOYMENT.md` files

### Getting Help
- Create issue in GitHub repository
- Email: support@ipodhan.com
- QA Agent: Quinn (Test Architect)

## Key Workflows and Common Tasks

### Adding a New Data Source (Scraper)
1. Create scraper class in `scrapers/` inheriting from `BaseScraper`
2. Implement `async def scrape(self) -> List[Dict]` method
3. Add Playwright automation with anti-bot detection
4. Implement retry mechanism (use base class pattern)
5. Add unit tests in `tests/unit/` (mock scraping)
6. Add integration tests in `tests/integration/` (real scraping)
7. Register scraper in `orchestrator/pipeline.py`

### Adding a New Database Table
1. Create migration file: `infrastructure/database/migrations/00X_description.sql`
2. Write CREATE TABLE with proper indexes
3. Add repository methods in appropriate repository class
4. Write unit tests for repository methods
5. Run migration: `psql -f migrations/00X_description.sql`
6. Update relevant schemas in `schemas/` directory

### Debugging Scraper Issues
1. Check `debug/` directory for screenshots and HTML dumps
2. Review logs for retry attempts and error messages
3. Test scraper independently: `pytest tests/integration/test_*_scraper.py -v -s`
4. Verify anti-bot detection settings (User-Agent, viewport, realistic timing)
5. Check rate limiting (1 request per 30 seconds)

### Performance Optimization
1. **Database:** Use `EXPLAIN ANALYZE` on slow queries, add indexes as needed
2. **Caching:** Implement Redis for frequently accessed data (see Story 1.3)
3. **Scraping:** Batch operations, use connection pooling
4. **Validation:** Cache validation results for duplicate checks
5. **Pipeline:** Run sources concurrently where possible (use `asyncio.gather`)

## Recent Updates

**2025-10-02:** Story 1.3 (IPO Scoring Engine) implementation complete
- Core implementation finished (scoring engine, API, scheduler, A/B testing)
- Database migration 004 applied (score_history, score_performance, ab_experiments)
- FastAPI server operational on port 8001
- 3x daily scheduler implemented (9 AM, 1 PM, 5 PM IST)
- Redis caching layer integrated
- Testing and validation in progress

**2025-10-02:** Story 1.2 (IPO Data Pipeline) completed
- 50/50 tests passing (100%)
- Quality score: 98/100
- Production-ready deployment
- Comprehensive QA validation complete

---

**Last Updated:** 2025-10-02
**Project Phase:** Data Pipeline Complete ✅, Scoring Engine Implementation Complete ✅ (Testing In Progress 🚧)
**Production Status:** Data Pipeline Ready ✅, Scoring Engine Ready for Testing ✅

## Quick Reference

### Most Common Commands

**Data Pipeline:**
```bash
# Setup (first time only)
cd ipodhan-data-pipeline
python -m venv .venv
.venv\Scripts\activate                    # Windows
pip install -r requirements.txt
playwright install chromium
python scripts/setup_database.py

# Daily development
.venv\Scripts\activate                    # Windows (activate venv)
pytest -v                                 # Run all tests
python main.py run-full                   # Test pipeline once
black .                                   # Format code
flake8 --max-line-length=120              # Lint code

# Production
python main.py                            # Start scheduled pipeline
python main.py health-check               # Check status
python main.py metrics                    # View metrics
```

**Scoring Engine (Story 1.3):**
```bash
# Setup (first time only)
cd ipodhan-score-engine
python -m venv .venv
.venv\Scripts\activate                    # Windows
pip install -r requirements.txt
cp .env.example .env                      # Configure environment
# Start Redis server: redis-server

# Daily development
.venv\Scripts\activate                    # Windows (activate venv)
pytest -v                                 # Run all tests
python main.py api                        # Start API server
python main.py calculate                  # Calculate scores once
black .                                   # Format code
flake8 --max-line-length=120              # Lint code

# Production
python main.py api                        # Start API server (port 8001)
python main.py scheduler                  # Start scheduler (3x daily)

# API Testing
# Get score for IPO
curl http://localhost:8001/api/scores/1

# Get historical scores
curl http://localhost:8001/api/scores/1/history?days=30

# Trigger recalculation (requires API key in header)
curl -X POST http://localhost:8001/api/scores/1/recalculate \
     -H "X-API-Key: your_api_key"
```

**Database Management:**
```bash
# Connect to database
psql -h <DB_HOST> -U <DB_USER> -d ipodhan_db

# Run migration
psql -h <DB_HOST> -U <DB_USER> -d ipodhan_db -f infrastructure/database/migrations/00X_*.sql

# Check table structure
\d+ ipo_details
\d+ gmp_tracking

# Refresh materialized view
REFRESH MATERIALIZED VIEW gmp_aggregates;
```