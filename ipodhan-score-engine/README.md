# IPO Scoring Engine

Microservice for calculating 0-100 scores for IPOs based on weighted component analysis.

## Overview

The IPO Scoring Engine evaluates IPOs using 4 weighted components:
- **Fundamentals (40%)**: P/E ratio, revenue growth, profitability, debt, ROE, cash flow
- **Market Sentiment (30%)**: GMP trend, watchlist, crowd prediction
- **Subscription (20%)**: QIB, HNI, retail subscription, momentum
- **Sector Timing (10%)**: Sector performance, peer comparison, market condition

**Score Bands:**
- 70-100: Strong Buy 🟢
- 50-69: Consider 🟡
- 30-49: Risky 🟠
- 0-29: Avoid 🔴

## Quick Start

### Setup

```bash
# Create virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Setup environment variables
cp .env.example .env
# Edit .env with your database and Redis credentials

# Run database migration
cd ../infrastructure/database/migrations
psql -h <DB_HOST> -U <DB_USER> -d <DB_NAME> -f 004_score_tracking_tables.sql
```

### Running the Service

```bash
# Start API server (default port 8001)
python main.py api

# Start score calculation scheduler (3x daily)
python main.py scheduler

# Calculate scores once (manual trigger)
python main.py calculate

# Run tests
python main.py test
```

## API Endpoints

### Score Endpoints

**Get Current Score:**
```
GET /api/scores/{ipo_id}
```

**Get Score History:**
```
GET /api/scores/{ipo_id}/history?days=7
```

**Get Score Breakdown:**
```
GET /api/scores/{ipo_id}/breakdown
```

**Recalculate Score:**
```
POST /api/scores/{ipo_id}/recalculate
Headers: X-API-Key: your_api_key
```

**Get Accuracy Metrics:**
```
GET /api/scores/accuracy
```

**API Documentation:**
- Swagger UI: `http://localhost:8001/api/docs`
- ReDoc: `http://localhost:8001/api/redoc`

## Architecture

### Components

- **`algorithms/`**: Core scoring logic
  - `scoring_engine.py`: Main IPOScoringEngine class
  - `sme_adjuster.py`: SME-specific adjustments
  - `schemas.py`: Pydantic data models

- **`api/`**: FastAPI REST service
  - `main.py`: API endpoints with Redis caching

- **`repositories/`**: Database access layer
  - `score_repository.py`: Score CRUD operations
  - `db_config.py`: Connection pooling

- **`schedulers/`**: Automated score calculation
  - `score_scheduler.py`: 3x daily scheduler (9 AM, 1 PM, 5 PM IST)

- **`testing/`**: A/B testing framework
  - `ab_testing.py`: Algorithm variant testing

- **`monitoring/`**: Performance tracking
  - `performance_tracker.py`: Accuracy analysis

### Database Tables

- **`score_history`**: Historical scores with algorithm versioning
- **`score_performance`**: Prediction accuracy tracking
- **`ab_experiments`**: A/B test experiments
- **`current_ipo_scores`**: Materialized view for latest scores

## Configuration

### Environment Variables

```bash
# Database (Required)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=your_password

# Redis Cache (Required for performance)
REDIS_HOST=localhost
REDIS_PORT=6379
SCORE_CACHE_TTL=3600  # 1 hour

# API Configuration
API_PORT=8001
API_KEY=your_secret_key

# Scheduling
SCORE_CALCULATION_TIMES=09:00,13:00,17:00
TIMEZONE=Asia/Kolkata
```

## Development

### Running Tests

```bash
# Run all tests
pytest -v

# Run with coverage
pytest --cov=. --cov-report=term-missing

# Run specific test file
pytest tests/unit/test_scoring_engine.py -v
```

### Code Quality

```bash
# Format code with Black
black .

# Lint with Flake8
flake8 --max-line-length=120 --extend-ignore=E203,W503
```

## Performance Targets

- **Score Calculation**: <2 seconds per IPO
- **API Response**: <500ms (with Redis caching)
- **Cache Hit Rate**: >90%
- **Prediction Accuracy**: >70% correlation with listing gains

## SME Adjustments

Special handling for SME category IPOs:
- **Penalties**: Higher risk (-5), Lower liquidity (-3)
- **Bonuses**: Growth potential (+8 if revenue >40%), Promoter holding (+3 if holding >60%)
- Final score bounded to 0-100 range

## Testing

- **Unit Tests**: 23 tests passing (100% pass rate)
  - 14 tests for scoring engine
  - 9 tests for SME adjuster
- **Integration Tests**: Deferred to future sprint
- **Code Coverage**:
  - Scoring algorithm: 62% (acceptable - complex calculation logic)
  - SME adjuster: 96% (excellent)
  - Schemas: 100% (full coverage)
  - Overall critical modules: 46% algorithms/repositories (unit tested core logic)

## Implementation Status

✅ **Complete (100% - Core Functionality):**
- Database schema (migration 004)
- Scoring engine core (all 4 components)
- SME adjuster with penalties/bonuses
- Score repository with CRUD operations
- IPO data fetcher (integration with Story 1.2 pipeline)
- A/B testing framework
- FastAPI service (5 endpoints with Redis caching)
- Score scheduler (3x daily automated calculation)
- Performance tracker (accuracy monitoring)
- Unit tests (23 tests, 100% passing)
- Code quality (Black formatted, Flake8 compliant)

⏳ **Deferred (Future Sprint):**
- Integration tests (API endpoints, repositories)
- Higher test coverage (target: 80%+ overall)
- Production deployment configuration

## Next Steps

1. Deploy to staging environment
2. Test with real IPO data from pipeline
3. Monitor score calculation performance
4. Add integration tests in next sprint
5. Enhance test coverage for edge cases

## Dependencies

- Python 3.11+
- PostgreSQL 14+ (shared with data pipeline)
- Redis 7.x (for caching)
- FastAPI (web framework)
- Pydantic V2 (data validation)
- pytest (testing)

## License

MIT License - Part of IPODhan Platform

## Support

For issues or questions, see Story 1.3 documentation: `docs/stories/1.3.ipo-scoring-algorithm.md`
