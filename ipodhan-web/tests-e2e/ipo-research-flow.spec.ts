import { test, expect } from '@playwright/test';

test.describe('IPO Research Flow', () => {
  test('user can view upcoming IPOs, click on one, and check score', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');

    // Wait for page to load
    await expect(page.locator('h1')).toContainText("India's Smartest IPO Platform");

    // Click on Upcoming tab
    await page.click('button:has-text("Upcoming IPOs")');

    // Wait for IPO cards to load
    await page.waitForSelector('[role="listitem"]', { timeout: 10000 });

    // Verify IPO cards are displayed
    const ipoCards = page.locator('[role="listitem"]');
    const cardCount = await ipoCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Click on first IPO card
    const firstCard = ipoCards.first();
    await firstCard.locator('button:has-text("View Details")').click();

    // Verify we're on the detail page
    await expect(page).toHaveURL(/\/ipo\/.+/);

    // Verify score is displayed (if available)
    const scoreElement = page.locator('[aria-label*="Score:"]');
    if (await scoreElement.count() > 0) {
      await expect(scoreElement).toBeVisible();
    }

    // Verify tabs are present
    await expect(page.locator('button[role="tab"]:has-text("Overview")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Subscription")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("GMP")')).toBeVisible();

    // Click on Analysis tab
    await page.click('button[role="tab"]:has-text("Analysis")');

    // Verify analysis content is shown
    await expect(page.locator('h2:has-text("Score Breakdown")')).toBeVisible();
  });

  test('user can search for IPOs', async ({ page }) => {
    await page.goto('/');

    // Fill in search query
    await page.fill('input[placeholder*="Search IPOs"]', 'tech');

    // Submit search
    await page.click('button:has-text("Search")');

    // Verify we're on search page
    await expect(page).toHaveURL(/\/search\?q=tech/);

    // Verify search results heading
    await expect(page.locator('h1:has-text("Search Results")')).toBeVisible();
  });

  test('user can apply filters', async ({ page }) => {
    await page.goto('/');

    // Wait for filter bar
    await page.waitForSelector('select[aria-label="Filter by score range"]');

    // Apply score filter
    await page.selectOption('select[aria-label="Filter by score range"]', '70+');

    // Verify filtered results (cards should update)
    await page.waitForTimeout(1000); // Wait for filter to apply

    // Apply category filter
    await page.selectOption('select[aria-label="Filter by category"]', 'MAINBOARD');

    await page.waitForTimeout(1000);
  });
});
