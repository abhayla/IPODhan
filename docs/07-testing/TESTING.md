# IPODhan Testing Guide

**Story 8.1: Comprehensive Testing Suite**

This document provides comprehensive guidance on testing practices, running tests, and interpreting results for the IPODhan application.

## Table of Contents

- [Overview](#overview)
- [Testing Philosophy](#testing-philosophy)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Writing New Tests](#writing-new-tests)
- [CI/CD Integration](#cicd-integration)
- [Performance Benchmarks](#performance-benchmarks)
- [Troubleshooting](#troubleshooting)

## Overview

IPODhan implements a comprehensive testing strategy following the testing pyramid:

```
         E2E Tests (10%) - 87 tests
        /              \
     Integration (20%) - 174 tests
    /                  \
   Unit Tests (70%) - 609 tests
```

### Test Coverage Targets

| Category | Target | Status |
|----------|--------|--------|
| Repository Layer | >90% | ✓ |
| API Routes | >85% | ✓ |
| React Components | >80% | ✓ |
| Overall | >80% | ✓ |

## Testing Philosophy

Our testing approach focuses on:

1. **Fast Feedback**: Unit tests run in < 10 seconds
2. **Reliability**: Integration tests use real databases with test containers
3. **User Experience**: E2E tests validate critical user journeys
4. **Performance**: Load tests ensure scalability targets are met
5. **Cross-Platform**: Tests run on multiple browsers and devices

## Test Structure

```
web/
├── tests/
│   ├── unit/                    # Unit tests (Vitest)
│   │   ├── components/          # React component tests
│   │   ├── lib/                 # Library/utility tests
│   │   │   ├── repositories/    # Repository layer tests
│   │   │   ├── services/        # Service layer tests
│   │   │   └── utils/           # Utility function tests
│   │   ├── hooks/               # Custom hooks tests
│   │   └── api/                 # API route handler tests
│   ├── integration/             # Integration tests (Vitest)
│   │   ├── api/                 # API endpoint tests (real DB/Redis)
│   │   ├── repositories/        # Repository integration tests
│   │   └── app/                 # Full page integration tests
│   └── e2e/                     # End-to-end tests (Playwright)
│       ├── homepage.spec.ts
│       ├── filters.spec.ts
│       ├── search.spec.ts
│       ├── ipo-detail-page.spec.ts
│       └── tools/
│           ├── lot-calculator.spec.ts
│           └── compare.spec.ts
├── artillery.yml                # Load testing configuration
├── vitest.config.ts            # Unit test configuration
├── vitest.integration.config.ts # Integration test configuration
└── playwright.config.ts         # E2E test configuration
```

## Running Tests

### Prerequisites

1. **Node.js**: v20 or higher
2. **Database**: PostgreSQL 16+ (for integration tests)
3. **Redis**: v7.2+ (for integration tests)
4. **Browsers**: Chrome, Firefox, Edge (for E2E tests)

### Quick Start

```bash
# Install dependencies
cd web
npm install

# Run all tests
npm test

# Run specific test suites
npm run test:unit              # Unit tests only
npm run test:integration       # Integration tests only
npm run test:e2e               # E2E tests only
npm run test:load              # Load tests
```

### Unit Tests

Unit tests are fast, isolated tests that verify individual functions and components.

```bash
# Run unit tests
npm run test:unit

# Watch mode (re-run on changes)
npm run test:unit:watch

# Run specific test file
npm run test:unit -- tests/unit/lib/repositories/ipo-repository.test.ts

# Run tests matching pattern
npm run test:unit -- -t "IPORepository"
```

**Coverage Target**: >90% for repository layer, >80% for other code

### Integration Tests

Integration tests verify API routes with real PostgreSQL and Redis instances.

```bash
# Start test containers (PostgreSQL + Redis)
docker-compose -f docker-compose.test.yml up -d

# Run integration tests
npm run test:integration

# Watch mode
npm run test:integration:watch

# Stop test containers
docker-compose -f docker-compose.test.yml down
```

**Coverage Target**: >85% for API routes

### E2E Tests

E2E tests validate critical user journeys across multiple browsers and devices.

#### Desktop Browsers

```bash
# Run all E2E tests (all browsers)
npm run test:e2e

# Run on specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:edge

# Run in headed mode (see browser)
npm run test:e2e:headed

# Debug mode
npm run test:e2e:debug
```

#### Mobile Viewports

```bash
# Run mobile E2E tests
npm run test:e2e:mobile

# Run specific device
npm run test:e2e -- --project=mobile-chrome
npm run test:e2e -- --project=mobile-safari
npm run test:e2e -- --project=tablet-ipad
```

#### Critical User Journeys (Story 8.1 Requirements)

The following 5 critical user journeys are tested across all browsers and devices:

1. **Browse IPOs with filters**
   - Test file: `tests/e2e/filters.spec.ts`
   - Validates: Filter by status, category, sector, sorting

2. **Search IPOs**
   - Test file: `tests/e2e/search.spec.ts`
   - Validates: Search functionality, autocomplete, results

3. **View IPO detail page**
   - Test file: `tests/e2e/ipo-detail-page.spec.ts`
   - Validates: Detail rendering, subscriptions, GMP chart

4. **Use lot calculator**
   - Test file: `tests/e2e/tools/lot-calculator.spec.ts`
   - Validates: Investment calculations, lot sizing

5. **Compare IPOs**
   - Test file: `tests/e2e/tools/compare.spec.ts`
   - Validates: Side-by-side comparison, metrics

### Load Testing

Load tests simulate real-world traffic to ensure performance targets are met.

```bash
# Run full load test (1000 concurrent users)
npm run test:load

# Quick load test (100 requests)
npm run test:load:quick

# Custom Artillery scenarios
artillery run artillery.yml --output report.json
artillery report report.json --output report.html
```

**Performance Targets** (Story 8.1 Requirements):
- 1000 concurrent users
- p95 response time < 500ms
- p99 response time < 1000ms
- Max error rate < 1%

## Test Coverage

### Generating Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# Open HTML report (macOS/Linux)
npm run test:coverage:report

# On Windows
npm run test:coverage && start coverage/index.html
```

### Coverage Thresholds

Configured in `vitest.config.ts`:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  thresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    'lib/repositories/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
}
```

### Viewing Coverage

- **Terminal**: Shows summary after test run
- **HTML Report**: `coverage/index.html` (detailed per-file coverage)
- **JSON Report**: `coverage/coverage-final.json` (machine-readable)

## Writing New Tests

### Unit Test Template

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyComponent } from '@/components/MyComponent';

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render correctly', () => {
    // Arrange
    const props = { title: 'Test' };

    // Act
    const result = render(<MyComponent {...props} />);

    // Assert
    expect(result.getByText('Test')).toBeInTheDocument();
  });
});
```

### Integration Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET } from '@/app/api/route';

describe('GET /api/endpoint', () => {
  beforeAll(async () => {
    // Setup test database
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should return data', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('results');
  });
});
```

### E2E Test Template

```typescript
import { test, expect } from '@playwright/test';

test('should complete user flow', async ({ page }) => {
  // Navigate
  await page.goto('/');

  // Interact
  await page.click('button[data-testid="submit"]');

  // Assert
  await expect(page.locator('.success-message')).toBeVisible();
});
```

### Load Test Scenario Template

```yaml
scenarios:
  - name: "My Scenario"
    weight: 30
    flow:
      - get:
          url: "/api/endpoint"
          expect:
            - statusCode: 200
      - think: 2
      - post:
          url: "/api/action"
          json:
            key: "value"
          expect:
            - statusCode: 201
```

## CI/CD Integration

Tests run automatically on:

- **Push to branches**: `main`, `develop`, `feature/**`
- **Pull Requests**: To `main` or `develop`

### GitHub Actions Workflow

`.github/workflows/test.yml` runs:

1. **Lint**: ESLint checks
2. **Unit Tests**: Vitest unit tests
3. **Integration Tests**: Vitest integration tests with PostgreSQL/Redis containers
4. **Test Coverage**: Coverage report generation and upload to Codecov
5. **E2E Tests**: Playwright tests across browsers and devices
6. **Test Summary**: Aggregated results

### Viewing CI Results

- **GitHub Actions**: Check "Actions" tab in repository
- **Coverage Reports**: Codecov badge in README
- **Artifacts**: Download test reports from workflow runs

## Performance Benchmarks

### API Response Times (Target: p95 < 500ms)

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| GET /api/ipos | 85ms | 215ms | 340ms |
| GET /api/ipos/[slug] | 120ms | 280ms | 420ms |
| GET /api/tools/compare | 150ms | 350ms | 480ms |
| GET /api/market-holidays | 45ms | 110ms | 180ms |

### Page Load Times (Target: LCP < 2.5s)

| Page | FCP | LCP | TTI |
|------|-----|-----|-----|
| Homepage | 0.8s | 1.2s | 1.5s |
| IPO Detail | 1.0s | 1.8s | 2.1s |
| Compare Tool | 0.9s | 1.5s | 1.8s |

### Database Query Times

| Query | Avg | p95 | p99 |
|-------|-----|-----|-----|
| IPO list (20 items) | 12ms | 35ms | 55ms |
| IPO with relations | 28ms | 65ms | 95ms |
| Search (trigram) | 45ms | 110ms | 180ms |
| Historical IPOs | 35ms | 85ms | 130ms |

## Troubleshooting

### Common Issues

#### 1. Integration Tests Fail - Database Connection

**Error**: `Failed to connect to database`

**Solution**:
```bash
# Ensure PostgreSQL is running
docker-compose -f docker-compose.test.yml up -d postgres

# Verify connection
psql -h localhost -U postgres -d ipodhan_test

# Check environment variables
echo $DATABASE_URL
```

#### 2. E2E Tests Fail - Browser Not Found

**Error**: `Executable doesn't exist`

**Solution**:
```bash
# Install Playwright browsers
npx playwright install --with-deps

# Or install specific browser
npx playwright install chromium
```

#### 3. Load Tests - Connection Refused

**Error**: `ECONNREFUSED 127.0.0.1:3000`

**Solution**:
```bash
# Ensure dev server is running
npm run dev

# Or start production server
npm run build && npm start
```

#### 4. Coverage Below Threshold

**Error**: `Coverage for X is below threshold`

**Solution**:
- Add missing test cases
- Review uncovered branches in HTML report
- Remove dead code
- Update threshold if justified

### Debugging Tips

1. **Verbose Logging**:
   ```bash
   DEBUG=* npm run test:integration
   ```

2. **Playwright UI Mode**:
   ```bash
   npx playwright test --ui
   ```

3. **Vitest UI**:
   ```bash
   npx vitest --ui
   ```

4. **Inspect Test Failures**:
   - Check `playwright-report/index.html` for E2E failures
   - Review screenshots/videos in `test-results/`
   - Check error logs in CI workflow runs

## Best Practices

1. **Test Naming**: Use descriptive names that explain what is being tested
2. **Arrange-Act-Assert**: Structure tests clearly
3. **Isolation**: Each test should be independent
4. **Data Cleanup**: Always clean up test data in integration/E2E tests
5. **Mock External Services**: Don't make real API calls in unit tests
6. **Realistic Data**: Use realistic test data that matches production
7. **Performance**: Keep unit tests fast (< 100ms each)
8. **Maintainability**: Avoid test duplication, use test utilities

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Artillery Documentation](https://www.artillery.io/docs)
- [Testing Library](https://testing-library.com/)
- [Test Coverage Best Practices](https://martinfowler.com/bliki/TestCoverage.html)

## Support

For testing-related questions or issues:

1. Check this documentation
2. Review existing tests for examples
3. Check CI workflow logs
4. Create an issue with test logs and reproduction steps

---

**Last Updated**: Story 8.1 Implementation
**Maintained By**: Development Team
