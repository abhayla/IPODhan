---
name: testing-strategy-expert
description: Test pyramid strategy with Vitest, Playwright E2E, mocking patterns, coverage targets, and test infrastructure setup
---

# Testing Strategy Expert

**Purpose:** Expertise in IPODhan's test pyramid, Vitest configuration, Playwright E2E testing, mocking strategies, and coverage targets.

**When to invoke:** Writing tests, setting up test infrastructure, mocking dependencies, achieving coverage targets, or debugging test failures.

---

## Test Pyramid (70/20/10 Rule)

```
     /\
    /E2E\      10% - Full user flows (Playwright)
   /------\
  /  INT   \   20% - API + Repository tests (Vitest)
 /----------\
/    UNIT    \ 70% - Components + Utils (Vitest)
--------------
```

### Coverage Targets

- **Overall:** 80% minimum
- **Repositories:** 90% minimum (critical data layer)
- **Services:** 85% minimum
- **Utils:** 95% minimum (pure functions)
- **Components:** 70% minimum

---

## Vitest Configuration

### Unit Tests (web/vitest.config.ts)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
```

### Integration Tests (web/vitest.integration.config.ts)

```typescript
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    testTimeout: 10000, // Longer for DB operations
    hookTimeout: 10000,
  },
});
```

---

## Mock Patterns

### Mocking Repositories

```typescript
import { vi } from 'vitest';
import type { IPORepository } from '@/lib/repositories/ipo-repository';

const mockIPORepository: Partial<IPORepository> = {
  findBySlug: vi.fn(),
  findAll: vi.fn(),
  create: vi.fn(),
};

// In test
mockIPORepository.findBySlug.mockResolvedValue(mockIPO);
```

### Mocking Redis

```typescript
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
};
```

### Mocking Database

```typescript
import { vi } from 'vitest';

// Mock db module
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([mockIPO])),
        })),
      })),
    })),
  },
}));
```

---

## Integration Test Setup

### Test Database

```typescript
// tests/integration/setup.ts
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

beforeAll(async () => {
  // Run migrations
  await runMigrations();
});

afterEach(async () => {
  // Clean test data
  await db.execute(sql`TRUNCATE TABLE ipos CASCADE`);
});

afterAll(async () => {
  // Close connection
  await db.end();
});
```

### Test Fixtures

```typescript
// tests/fixtures/ipo-fixtures.ts
export const createTestIPO = (overrides?: Partial<IPO>) => ({
  id: 'test-id',
  companyName: 'Test Company',
  slug: 'test-company-ipo',
  status: 'OPEN' as const,
  segment: 'MAINBOARD' as const,
  ...overrides,
});
```

---

## Playwright E2E Tests

### Configuration (playwright.config.ts)

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test';

test.describe('IPO Detail Page', () => {
  test('should display IPO information', async ({ page }) => {
    await page.goto('/ipos/test-company-ipo');

    await expect(page.locator('h1')).toContainText('Test Company');
    await expect(page.locator('[data-testid="ipo-status"]')).toContainText('OPEN');
  });

  test('should handle not found', async ({ page }) => {
    const response = await page.goto('/ipos/non-existent');

    expect(response?.status()).toBe(404);
    await expect(page.locator('h2')).toContainText('Not Found');
  });
});
```

---

## Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests (requires DB + Redis)
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage
npm run test:coverage

# Watch mode
npm run test:unit:watch
```

---

## Best Practices

1. **Test behavior, not implementation**
2. **Use data-testid for E2E selectors**
3. **Mock external dependencies in unit tests**
4. **Use real DB/Redis in integration tests**
5. **Keep tests fast** (<10s for unit suite)
6. **Clean up test data** after each integration test

---

## References

- **Vitest:** https://vitest.dev/
- **Playwright:** https://playwright.dev/
- **Testing Library:** https://testing-library.com/docs/react-testing-library/intro

