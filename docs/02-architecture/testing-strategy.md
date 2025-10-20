# Testing Strategy

**Single Source of Truth for Testing Patterns**
**Implementation**: `web/tests/`, `web/vitest.config.ts`

---

## Test Pyramid

```
        /\
       /E2E\      10% - Critical user journeys (Playwright)
      /------\
     /  INT  \    20% - API routes, repositories (Vitest + real DB)
    /----------\
   /   UNIT     \ 70% - Components, utilities, services (Vitest + mocks)
  /--------------\
```

**Distribution Target**:
- **Unit Tests**: 70% - Fast, isolated, extensive coverage
- **Integration Tests**: 20% - Real database/Redis, API routes
- **E2E Tests**: 10% - Full browser, critical user flows

---

## Test Organization

### Directory Structure

```
web/tests/
├── unit/                          # Fast, isolated tests
│   ├── components/               # React component tests
│   ├── lib/
│   │   ├── repositories/        # Repository logic (mocked DB)
│   │   ├── services/            # Business logic (mocked repos)
│   │   └── utils/               # Pure functions
│   └── api/                     # API route logic (mocked)
├── integration/                  # Real DB + Redis
│   ├── api/                     # API routes end-to-end
│   ├── repositories/            # Repository with real DB
│   └── lib/scrapers/            # Scraper integration
└── e2e/                         # Playwright browser tests
    ├── ipo-listing.spec.ts
    ├── ipo-detail.spec.ts
    └── search.spec.ts
```

### Test File Naming Convention

| Pattern | Example | Purpose |
|---------|---------|---------|
| `*.test.ts` | `ipo-repository.test.ts` | Unit tests |
| `*.integration.test.ts` | `ipo-repository.integration.test.ts` | Integration tests |
| `*.spec.ts` | `ipo-listing.spec.ts` | E2E tests (Playwright) |

---

## Unit Testing Patterns

### Repository Unit Tests

**Location**: `tests/unit/lib/repositories/`

**Pattern**: Mock database and Redis

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { mockIPO } from '@/lib/db/types';

describe('IPORepository', () => {
  let mockDb: any;
  let mockRedis: any;
  let repository: IPORepository;

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([mockIPO()])
    };

    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK')
    };

    repository = new IPORepository(mockDb, mockRedis);
  });

  it('should fetch from DB on cache miss', async () => {
    const result = await repository.findBySlug('test-ipo');

    expect(mockRedis.get).toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
```

### Service Unit Tests

**Location**: `tests/unit/lib/services/`

**Pattern**: Mock repositories

```typescript
import { describe, it, expect, vi } from 'vitest';
import { getMainboardLandingData } from '@/lib/services/mainboard-landing-service';

vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({
    findUpcoming: vi.fn().mockResolvedValue([]),
    findOpen: vi.fn().mockResolvedValue([])
  }))
}));

describe('MainboardLandingService', () => {
  it('should aggregate dashboard data', async () => {
    const result = await getMainboardLandingData();

    expect(result).toHaveProperty('upcoming');
    expect(result).toHaveProperty('open');
    expect(result).toHaveProperty('metrics');
  });
});
```

### Component Unit Tests

**Location**: `tests/unit/components/`

**Pattern**: React Testing Library

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { IPOCard } from '@/components/ipo-card';
import { mockIPO } from '@/lib/db/types';

describe('IPOCard', () => {
  it('should render IPO details', () => {
    const ipo = mockIPO({ companyName: 'Test Company' });
    render(<IPOCard ipo={ipo} />);

    expect(screen.getByText('Test Company')).toBeInTheDocument();
  });
});
```

---

## Integration Testing Patterns

### Setup Requirements

**Integration tests require**:
- Running PostgreSQL database
- Running Redis instance
- Test database with migrations applied

**Configuration**: `web/vitest.config.ts`

```typescript
test: {
  include: ['tests/integration/**/*.test.{ts,tsx}'],
  setupFiles: ['./tests/integration/setup.ts']
}
```

### Integration Test Setup Pattern

**Common Setup** (inline in test files):

```typescript
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';

beforeAll(async () => {
  // Verify connections
  await db.execute(sql`SELECT 1`);
  await getRedisClient().ping();
});

beforeEach(async () => {
  // Clear Redis cache before each test
  await getRedisClient().flushdb();
});

afterAll(async () => {
  // Cleanup connections
  await closeRedisClient();
});
```

### Repository Integration Tests

**Location**: `tests/integration/repositories/`

**Pattern**: Real database queries

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos } from '@/lib/db';

describe('IPORepository Integration', () => {
  let repository: IPORepository;

  beforeEach(async () => {
    // Clean database
    await db.delete(ipos);

    // Clear cache
    await getRedisClient().flushdb();

    repository = new IPORepository(db, getRedisClient());
  });

  it('should cache IPO after first fetch', async () => {
    // Insert test data
    await db.insert(ipos).values({
      id: 'test-id',
      companyName: 'Test Company',
      slug: 'test-ipo'
    });

    // First call - cache miss
    const result1 = await repository.findBySlug('test-ipo');
    expect(result1).toBeDefined();

    // Second call - cache hit (verify via Redis directly)
    const cached = await getRedisClient().get('ipo:slug:test-ipo');
    expect(cached).toBeTruthy();

    const result2 = await repository.findBySlug('test-ipo');
    expect(result2).toEqual(result1);
  });
});
```

### API Route Integration Tests

**Location**: `tests/integration/api/`

**Pattern**: Test full request/response cycle

```typescript
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/ipos/route';
import { NextRequest } from 'next/server';

describe('GET /api/ipos', () => {
  it('should return paginated IPO list', async () => {
    const request = new NextRequest('http://localhost:3000/api/ipos?page=1&limit=10');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('meta');
    expect(data.meta).toHaveProperty('page', 1);
    expect(data.meta).toHaveProperty('limit', 10);
  });
});
```

---

## E2E Testing Patterns

### Playwright Configuration

**Location**: `web/playwright.config.ts`

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'edge', use: { ...devices['Desktop Edge'] } }
  ]
});
```

### Critical User Journeys

**E2E Test Scenarios**:
1. Homepage → Browse IPOs → IPO Detail
2. Search functionality
3. IPO comparison tool
4. Mobile responsive layout

**Example E2E Test**:

```typescript
import { test, expect } from '@playwright/test';

test.describe('IPO Listing Page', () => {
  test('should display and filter IPO list', async ({ page }) => {
    await page.goto('/ipos');

    // Wait for IPO cards to load
    await expect(page.locator('[data-testid="ipo-card"]').first()).toBeVisible();

    // Test filter
    await page.selectOption('[data-testid="status-filter"]', 'OPEN');
    await page.waitForLoadState('networkidle');

    // Verify filtered results
    const cards = page.locator('[data-testid="ipo-card"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should navigate to IPO detail page', async ({ page }) => {
    await page.goto('/ipos');

    // Click first IPO card
    await page.locator('[data-testid="ipo-card"]').first().click();

    // Verify navigation to detail page
    await expect(page).toHaveURL(/\/ipos\/[\w-]+-ipo$/);
    await expect(page.locator('h1')).toBeVisible();
  });
});
```

---

## Test Fixture Patterns

### Mock Data Helpers

**Location**: `web/lib/db/types.ts`

```typescript
export const DEFAULT_HISTORICAL_FIELDS = {
  symbol: null,
  isin: null,
  subscriptionRetail: null,
  // ... all historical fields as null
};

export function mockIPO(data: Partial<IPO>): IPO {
  return {
    id: 'test-id',
    companyName: 'Test Company',
    slug: 'test-company-ipo',
    category: 'MAINBOARD',
    status: 'OPEN',
    ...DEFAULT_HISTORICAL_FIELDS,
    ...data
  } as IPO;
}
```

**Usage in Tests**:
```typescript
const testIPO = mockIPO({
  companyName: 'Custom Company',
  status: 'CLOSED'
});
// All other fields have sensible defaults
```

### Database Seeding for Tests

**Script**: `web/scripts/seed-database.ts`

```bash
# Seed test data (idempotent)
npm run seed:database

# Force re-seed (truncates first)
npm run seed:force

# Verify seed integrity
npm run verify:seed
```

---

## Coverage Targets

### Overall Coverage Thresholds

**From**: `web/vitest.config.ts`

| Metric | Target | Repository Target |
|--------|--------|-------------------|
| Lines | 80% | 90% |
| Functions | 80% | 90% |
| Branches | 80% | 90% |
| Statements | 80% | 90% |

**Repositories have higher threshold** because they're critical data layer.

### Coverage Commands

```bash
# Run all tests with coverage
npm run test:coverage

# Generate HTML report
npm run test:coverage -- --reporter=html
# Open coverage/index.html

# Check specific directory
npm run test:coverage -- lib/repositories
```

### Coverage Exclusions

**From**: `vitest.config.ts:coverage.exclude`

- `node_modules/`
- `vitest.setup.ts`
- `**/*.config.{ts,js}`
- `**/types/**`
- `**/*.d.ts`
- `tests/**`
- `.next/**`
- `drizzle/**` (migrations)
- `scripts/**`

---

## Running Tests

### Test Commands

```bash
# All tests (unit + integration)
npm run test

# Unit tests only
npm run test:unit

# Unit tests in watch mode
npm run test:unit:watch

# Integration tests (requires DB + Redis)
npm run test:integration

# E2E tests (all browsers)
npm run test:e2e

# E2E specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:edge

# Specific test file
npm run test:unit -- path/to/file.test.ts

# Specific test name pattern
npm run test:unit -- -t "IPORepository"

# Coverage report
npm run test:coverage
```

### CI/CD Integration

**GitHub Actions Pattern**:

```yaml
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_PASSWORD: test
    redis:
      image: redis:7
  steps:
    - run: npm run test:unit
    - run: npm run test:integration
    - run: npm run test:e2e:chromium
```

---

## Test Performance Optimization

### Speed Optimization Strategies

1. **Parallel Execution**:
   - Unit tests: Run in parallel (Vitest default)
   - E2E tests: 1 worker in CI, unlimited locally

2. **Test Isolation**:
   - Each integration test clears DB/cache in `beforeEach`
   - No shared state between tests

3. **Smart Test Selection**:
   ```bash
   # Run only changed files
   npm run test:unit -- --changed

   # Run related tests
   npm run test:unit -- --related src/lib/repositories/ipo-repository.ts
   ```

4. **Mock External Services**:
   - Never make real API calls in tests
   - Use `vi.mock()` for external dependencies

### Performance Targets

| Test Type | Target Time | Alert Threshold |
|-----------|-------------|-----------------|
| Unit test file | < 1s | > 3s |
| Integration test file | < 5s | > 15s |
| E2E test | < 30s | > 60s |
| Full test suite | < 5min | > 10min |

---

## Testing Best Practices

### ✅ Do's

1. **Test behavior, not implementation**
2. **Use descriptive test names** - `should return cached IPO on second fetch`
3. **Follow AAA pattern** - Arrange, Act, Assert
4. **Use test fixtures** - `mockIPO()` helpers
5. **Clean up after tests** - `beforeEach` for fresh state
6. **Mock external dependencies** - Never test third-party code

### ❌ Don'ts

1. **Don't test framework code** - Trust Next.js/React work
2. **Don't share state** - Each test independent
3. **Don't skip cleanup** - Causes flaky tests
4. **Don't hardcode test data** - Use factories
5. **Don't test implementation details** - Test public API only

---

## Debugging Tests

### Debug Commands

```bash
# Run with verbose output
npm run test:unit -- --reporter=verbose

# Run single test in watch mode
npm run test:unit:watch -- -t "should cache IPO"

# Debug with Node inspector
node --inspect-brk node_modules/vitest/vitest.mjs run

# E2E with headed browser
npm run test:e2e -- --headed

# E2E debug mode (pauses on failure)
npm run test:e2e -- --debug
```

### Common Test Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Flaky tests | Shared state | Add `beforeEach` cleanup |
| Timeout errors | Missing await | Check all async calls |
| Cache pollution | Not clearing Redis | `flushdb()` in setup |
| DB constraint errors | Test data conflicts | Use unique IDs per test |

---

## Related Documentation

- **Repository Patterns**: `docs/02-architecture/backend-architecture.md`
- **Cache Strategy**: `docs/05-caching/CACHING_STRATEGY.md`
- **Database Seeding**: `docs/stories/7.11.database-seeding-for-testing.story.md`

---

**Last Updated**: 2025-10-20
**Maintained By**: QA + Engineering team
**Review Frequency**: After major testing framework upgrades
