import { test, expect } from '@playwright/test';

test.describe('Loading States', () => {
  test('displays loading skeleton on dashboard page load', async ({ page }) => {
    // Intercept API call to delay response
    await page.route('**/api/ipos*', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      route.continue();
    });

    await page.goto('/dashboard');

    // Check for loading skeleton
    const skeleton = page.getByTestId('ipo-grid-skeleton');
    await expect(skeleton).toBeVisible();

    // Wait for loading to complete
    await page.waitForSelector('[data-testid="ipo-grid-skeleton"]', { state: 'hidden' });

    // Check that IPO content is now visible
    const ipoContainer = page.getByTestId('ipo-container');
    await expect(ipoContainer).toBeVisible();
  });

  test('shows loading spinner during search', async ({ page }) => {
    await page.goto('/dashboard');

    // Type in search
    const searchInput = page.getByRole('textbox', { name: /search ipos/i });
    await searchInput.fill('tech');

    // Check for loading spinner (during debounce)
    const spinner = page.getByRole('status');
    await expect(spinner).toBeVisible();

    // Wait for search to complete
    await page.waitForTimeout(500);
  });

  test('displays error page on failed API request', async ({ page }) => {
    // Intercept API call and return error
    await page.route('**/api/ipos*', async route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: { message: 'Server error' } }),
      });
    });

    await page.goto('/dashboard');

    // Check for error message
    await expect(page.getByText(/something went wrong/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});
