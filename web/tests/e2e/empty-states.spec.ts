import { test, expect } from '@playwright/test';

test.describe('Empty States', () => {
  test('displays empty state when no IPOs match search', async ({ page }) => {
    // Intercept API and return empty results
    await page.route('**/api/ipos*', async route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: [],
          pagination: { page: 1, limit: 12, total: 0, hasMore: false }
        }),
      });
    });

    await page.goto('/dashboard?search=nonexistent');

    // Check for empty state
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByText(/no ipos found/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /clear/i })).toBeVisible();
  });

  test('displays empty state when filters return no results', async ({ page }) => {
    // Intercept API and return empty results
    await page.route('**/api/ipos*', async route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: [],
          pagination: { page: 1, limit: 12, total: 0, hasMore: false }
        }),
      });
    });

    await page.goto('/dashboard?status=CLOSED&category=SME');

    // Check for empty state
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByText(/no ipos found/i)).toBeVisible();
  });

  test('clear button in empty state works', async ({ page }) => {
    // First load with empty results
    await page.route('**/api/ipos*search=nonexistent*', async route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: [],
          pagination: { page: 1, limit: 12, total: 0, hasMore: false }
        }),
      });
    });

    await page.goto('/dashboard?search=nonexistent');

    // Click clear button
    await page.getByRole('button', { name: /clear/i }).click();

    // Should navigate to dashboard without search param
    await expect(page).toHaveURL('/dashboard');
  });
});
