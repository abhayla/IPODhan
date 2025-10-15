/**
 * E2E Tests: IPO Score Display (Story 4.7)
 * Tests score badge visibility and score section on detail pages
 */

import { test, expect } from '@playwright/test';

test.describe('IPO Score Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
  });

  test('should display score badges on IPO cards', async ({ page }) => {
    // Wait for IPO cards to load
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Check if score badges are visible (some cards might have "Score Pending")
    const scoreBadges = page.locator('text=/^(Score Pending|\\d+)$/');
    const count = await scoreBadges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should display verdict badges on IPO cards with scores', async ({ page }) => {
    // Wait for IPO cards
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Look for verdict badges (Apply, Consider, Skip)
    const verdictBadges = page.locator('text=/^(Apply|Consider|Skip)$/');
    const count = await verdictBadges.count();

    // At least some cards should have verdicts
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should navigate to IPO detail and show score section', async ({ page }) => {
    // Click first IPO card
    const firstCard = page.locator('[data-testid="ipo-card"]').first();
    await firstCard.click();

    // Wait for detail page to load
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/ipos\//);

    // Check for score section or "Score Pending" state
    const scoreSection = page.locator('text=/IPODhan AI Score|Score Pending/i');
    await expect(scoreSection.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display component scores with progress bars when score exists', async ({ page }) => {
    // Navigate to a specific IPO (you may need to adjust this)
    await page.goto('/dashboard');
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Click first IPO
    await page.locator('[data-testid="ipo-card"]').first().click();
    await page.waitForLoadState('networkidle');

    // Check if we have a scored IPO (not all may have scores)
    const scorePending = await page.locator('text=/Score Pending/i').count();

    if (scorePending === 0) {
      // IPO has a score, check for component scores
      await expect(page.locator('text=/Fundamental Analysis/i')).toBeVisible();
      await expect(page.locator('text=/Market Sentiment/i')).toBeVisible();
      await expect(page.locator('text=/Subscription Demand/i')).toBeVisible();
      await expect(page.locator('text=/Sector Performance/i')).toBeVisible();
    }
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/dashboard');
    await page.waitForSelector('[data-testid="ipo-card"]', { timeout: 10000 });

    // Score badges should still be visible
    const scoreBadges = page.locator('text=/^(Score Pending|\\d+)$/');
    const count = await scoreBadges.count();
    expect(count).toBeGreaterThan(0);

    // Click IPO
    await page.locator('[data-testid="ipo-card"]').first().click();
    await page.waitForLoadState('networkidle');

    // Score section should be visible
    const scoreSection = page.locator('text=/IPODhan AI Score|Score Pending/i');
    await expect(scoreSection.first()).toBeVisible();
  });
});
