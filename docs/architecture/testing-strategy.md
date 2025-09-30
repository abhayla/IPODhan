# Testing Strategy

## Testing Pyramid

```
        E2E Tests (10%)
        /              \
    Integration Tests (30%)
    /                      \
Frontend Unit (30%)  Backend Unit (30%)
```

## Test Organization

### Frontend Tests
```
ipodhan-web/tests/
├── unit/
│   ├── components/
│   ├── hooks/
│   └── utils/
├── integration/
│   ├── pages/
│   └── api/
└── e2e/
    ├── user-flows/
    └── smoke/
```

### Backend Tests
```
ipodhan-backend/tests/
├── unit/
│   ├── services/
│   ├── repositories/
│   └── utils/
├── integration/
│   ├── routes/
│   └── database/
└── fixtures/
    └── test-data/
```

### E2E Tests
```
tests-e2e/
├── flows/
│   ├── ipo-research.spec.ts
│   ├── whatsapp-flow.spec.ts
│   └── api-integration.spec.ts
└── smoke/
    └── critical-paths.spec.ts
```

## Test Examples

### Frontend Component Test
```typescript
// tests/unit/components/IPOCard.test.tsx
import { render, screen } from '@testing-library/react';
import { IPOCard } from '@/components/ipo/IPOCard';
import { mockIPO, mockScore } from '../fixtures';

describe('IPOCard', () => {
  it('displays IPO score and verdict', () => {
    render(<IPOCard ipo={mockIPO} score={mockScore} />);

    expect(screen.getByText(mockIPO.companyName)).toBeInTheDocument();
    expect(screen.getByText(mockScore.totalScore.toString())).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  it('shows loading state when score is not available', () => {
    render(<IPOCard ipo={mockIPO} />);
    expect(screen.getByTestId('score-skeleton')).toBeInTheDocument();
  });
});
```

### Backend API Test
```typescript
// tests/integration/routes/ipos.test.ts
import request from 'supertest';
import app from '../../src/app';
import { seedDatabase, cleanDatabase } from '../helpers';

describe('GET /api/ipos', () => {
  beforeEach(() => seedDatabase());
  afterEach(() => cleanDatabase());

  it('returns filtered IPOs by status', async () => {
    const response = await request(app)
      .get('/api/ipos?status=LIVE')
      .expect(200);

    expect(response.body.data).toHaveLength(3);
    expect(response.body.data[0].status).toBe('LIVE');
  });

  it('returns 401 for protected endpoints without auth', async () => {
    await request(app)
      .post('/api/users/watchlist')
      .send({ ipoId: 'test-id' })
      .expect(401);
  });
});
```

### E2E Test
```typescript
// tests-e2e/flows/ipo-research.spec.ts
import { test, expect } from '@playwright/test';

test('User can research and add IPO to watchlist', async ({ page }) => {
  await page.goto('/');

  // View upcoming IPOs
  await page.click('text=Upcoming');
  await expect(page.locator('.ipo-card')).toHaveCount(5);

  // Click on first IPO
  await page.click('.ipo-card:first-child');
  await expect(page).toHaveURL(/\/ipo\/.+/);

  // Check score is visible
  const score = page.locator('[data-testid="ipo-score"]');
  await expect(score).toBeVisible();

  // Add to watchlist
  await page.click('text=Add to Watchlist');
  await expect(page.locator('text=Added to watchlist')).toBeVisible();
});
```
