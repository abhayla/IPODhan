# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IPODhan is a comprehensive IPO-focused platform for Indian retail investors. The project combines web/mobile applications with a robust data pipeline for real-time IPO tracking and analysis.

**Current Status:** Active Development - Data Pipeline Phase Complete ✅

### Key Features
- Real-time IPO tracking (live, upcoming, closed IPOs)
- Grey Market Premium (GMP) monitoring with multi-source validation
- Broker comparisons and demat account opening facilitation
- Investment tools and calculators
- Knowledge hub for IPO education

## Architecture and Technology Stack

### Data Pipeline (Production-Ready ✅)
- **Language**: Python 3.11+
- **Database**: PostgreSQL 14+ with materialized views
- **Web Scraping**: Playwright (async automation with anti-bot detection)
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
│   ├── repositories/               # Database access layer
│   ├── orchestrator/               # Pipeline coordination
│   ├── monitoring/                 # Health checks and metrics
│   ├── tests/                      # 50 tests (unit + integration)
│   │   ├── unit/                   # 25 unit tests
│   │   └── integration/            # 25 integration tests
│   └── scripts/                    # Utility scripts (backfill, setup)
│
├── infrastructure/
│   └── database/
│       ├── migrations/             # PostgreSQL schema migrations
│       └── BACKFILL_README.md      # Historical data backfill guide
│
├── docs/
│   ├── stories/                    # User stories and requirements
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

### 🚧 In Progress
- Web application (Next.js frontend)
- Backend API (Express with REST endpoints)
- User authentication and authorization

### 📋 Planned
- Mobile application (React Native)
- Real-time WebSocket updates
- AI-powered recommendations
- Broker API integrations
- Payment gateway integration

## Working with the Data Pipeline

### Setup Development Environment

```bash
cd ipodhan-data-pipeline

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Setup database
python scripts/setup_database.py

# Run tests
pytest -v
```

### Running the Pipeline

```bash
# Run IPO data pipeline
python main.py --pipeline ipo

# Run GMP data pipeline
python main.py --pipeline gmp

# Run full pipeline (IPO + GMP)
python main.py --pipeline full

# Run with scheduling (cron-like)
python main.py --schedule
```

### Running Tests

```bash
# Run all tests
pytest -v

# Run with coverage
pytest --cov=. --cov-report=term-missing

# Run specific test suite
pytest tests/unit/test_validators.py -v
pytest tests/integration/test_full_pipeline.py -v

# Run tests in parallel
pytest -n auto
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

**Prerequisites:**
- PostgreSQL 14+ database
- Python 3.11+ environment
- Playwright browser dependencies

**Environment Variables:**
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ipodhan_db
DB_USER=your_user
DB_PASSWORD=your_password
SENTRY_DSN=your_sentry_dsn  # Optional
```

**Deployment Steps:**
1. Install dependencies: `pip install -r requirements.txt`
2. Run database migrations: `psql -f infrastructure/database/migrations/*.sql`
3. Execute backfill (optional): `python scripts/backfill_historical_data.py`
4. Start pipeline: `python main.py --schedule`

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

## Recent Updates

**2025-10-02:** Story 1.2 (IPO Data Pipeline) completed
- 50/50 tests passing (100%)
- Quality score: 98/100
- Production-ready deployment
- Comprehensive QA validation complete

---

**Last Updated:** 2025-10-02
**Project Phase:** Data Pipeline Complete, Web Application In Progress
**Production Status:** Data Pipeline Ready for Deployment ✅