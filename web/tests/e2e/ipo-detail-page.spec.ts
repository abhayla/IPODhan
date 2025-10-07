/**
 * E2E Tests for IPO Detail Page
 *
 * Tests:
 * - Navigate to detail page from dashboard
 * - Page loads in <2 seconds
 * - Tier 1 data renders immediately
 * - Tab switching and content loading
 * - URL updates on tab switch
 * - Breadcrumbs navigation
 * - Invalid slug redirects to 404
 *
 * Uses Playwright for browser automation
 */

import { test, expect } from '@playwright/test';

// ==================== TEST CONFIGURATION ====================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const VALID_IPO_SLUG = 'test-ipo'; // Update with actual test data slug
const INVALID_IPO_SLUG = 'non-existent-ipo-slug-12345';

// ==================== HELPER FUNCTIONS ====================

/**
 * Wait for page to be fully loaded
 */
async function waitForPageLoad(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');
}

// ==================== TESTS ====================

test.describe('IPO Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport for consistent testing
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('should navigate to detail page from dashboard', async ({ page }) => {
    // Navigate to dashboard
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForPageLoad(page);

    // Click on first IPO card (if exists)
    const ipoCard = page.locator('[data-testid="ipo-card"]').first();
    if (await ipoCard.count() > 0) {
      await ipoCard.click();

      // Verify URL changed to detail page
      await expect(page).toHaveURL(/\/ipos\/[a-z0-9-]+/);

      // Verify we're on detail page
      await expect(page.locator('[data-testid="ipo-header"]')).toBeVisible();
    }
  });

  test('should load detail page in less than 2 seconds', async ({ page }) => {
    const startTime = Date.now();

    // Navigate to detail page
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);

    // Wait for Tier 1 content to be visible
    await page.locator('[data-testid="ipo-header"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="key-metrics-cards"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="info-section"]').waitFor({ state: 'visible' });

    const loadTime = Date.now() - startTime;

    // Verify page loaded within 2 seconds
    expect(loadTime).toBeLessThan(2000);
  });

  test('should render Tier 1 data immediately', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Verify IPO Header is visible
    await expect(page.locator('[data-testid="ipo-header"]')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible(); // Company name

    // Verify Key Metrics Cards are visible
    await expect(page.locator('[data-testid="key-metrics-cards"]')).toBeVisible();

    // Verify Info Section is visible
    await expect(page.locator('[data-testid="info-section"]')).toBeVisible();
  });

  test('should display breadcrumbs with correct navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Verify breadcrumbs are visible
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    await expect(breadcrumbs).toBeVisible();

    // Verify breadcrumb items
    await expect(breadcrumbs).toContainText('Home');
    await expect(breadcrumbs).toContainText('IPOs');

    // Click on "Home" breadcrumb
    await page.locator('[data-testid="breadcrumbs"] >> text=Home').click();
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });

  test('should display tabs and switch between them', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Verify all tabs are visible
    await expect(page.locator('button:has-text("Overview")')).toBeVisible();
    await expect(page.locator('button:has-text("Financials")')).toBeVisible();
    await expect(page.locator('button:has-text("Subscription")')).toBeVisible();
    await expect(page.locator('button:has-text("GMP")')).toBeVisible();
    await expect(page.locator('button:has-text("Documents")')).toBeVisible();

    // Default tab should be Overview
    await expect(page.locator('button:has-text("Overview")')).toHaveAttribute(
      'data-state',
      'active'
    );
  });

  test('should update URL when switching tabs', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Click on Financials tab
    await page.locator('button:has-text("Financials")').click();
    await page.waitForTimeout(500); // Wait for tab transition

    // Verify URL updated
    await expect(page).toHaveURL(`${BASE_URL}/ipos/${VALID_IPO_SLUG}?tab=financials`);

    // Click on Subscription tab
    await page.locator('button:has-text("Subscription")').click();
    await page.waitForTimeout(500);

    // Verify URL updated
    await expect(page).toHaveURL(`${BASE_URL}/ipos/${VALID_IPO_SLUG}?tab=subscription`);

    // Click on GMP tab
    await page.locator('button:has-text("GMP")').click();
    await page.waitForTimeout(500);

    // Verify URL updated
    await expect(page).toHaveURL(`${BASE_URL}/ipos/${VALID_IPO_SLUG}?tab=gmp`);

    // Click on Documents tab
    await page.locator('button:has-text("Documents")').click();
    await page.waitForTimeout(500);

    // Verify URL updated
    await expect(page).toHaveURL(`${BASE_URL}/ipos/${VALID_IPO_SLUG}?tab=documents`);

    // Click on Overview tab
    await page.locator('button:has-text("Overview")').click();
    await page.waitForTimeout(500);

    // Verify URL updated (no query param for default tab)
    await expect(page).toHaveURL(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
  });

  test('should load tab content progressively', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Click on Financials tab
    await page.locator('button:has-text("Financials")').click();

    // Wait for tab content to load (either data or placeholder)
    await page.waitForTimeout(1000);

    // Verify some content is visible
    const tabContent = page.locator('[role="tabpanel"][data-state="active"]');
    await expect(tabContent).toBeVisible();
  });

  test('should handle tab transitions smoothly (<500ms)', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    const startTime = Date.now();

    // Click on Financials tab
    await page.locator('button:has-text("Financials")').click();

    // Wait for tab to become active
    await page
      .locator('button:has-text("Financials")[data-state="active"]')
      .waitFor({ state: 'visible' });

    const transitionTime = Date.now() - startTime;

    // Verify transition completed in <500ms
    expect(transitionTime).toBeLessThan(500);
  });

  test('should redirect to 404 for invalid IPO slug', async ({ page }) => {
    // Navigate to invalid slug
    await page.goto(`${BASE_URL}/ipos/${INVALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Verify 404 page is displayed
    await expect(page.locator('h1:has-text("IPO Not Found")')).toBeVisible();
    await expect(
      page.locator('text=The IPO you\'re looking for doesn\'t exist')
    ).toBeVisible();

    // Verify "Browse All IPOs" button is present
    await expect(
      page.locator('a:has-text("Browse All IPOs")')
    ).toBeVisible();
  });

  test('should navigate from 404 page to dashboard', async ({ page }) => {
    // Navigate to invalid slug
    await page.goto(`${BASE_URL}/ipos/${INVALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Click "Browse All IPOs" button
    await page.locator('a:has-text("Browse All IPOs")').click();
    await waitForPageLoad(page);

    // Verify redirected to dashboard
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
  });

  test('should display SEO metadata in page head', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Verify page title
    const title = await page.title();
    expect(title).toContain('IPO Details');
    expect(title).toContain('IPODhan');

    // Verify meta description
    const metaDescription = await page
      .locator('meta[name="description"]')
      .getAttribute('content');
    expect(metaDescription).toBeTruthy();
    expect(metaDescription).toContain('IPO');

    // Verify Open Graph tags
    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute('content');
    expect(ogTitle).toBeTruthy();
  });

  test('should display JSON-LD structured data', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Verify JSON-LD script tags exist
    const jsonLdScripts = await page.locator('script[type="application/ld+json"]').count();
    expect(jsonLdScripts).toBeGreaterThan(0);

    // Verify JSON-LD content
    const jsonLdContent = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    expect(jsonLdContent).toBeTruthy();

    const jsonLd = JSON.parse(jsonLdContent!);
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(['FinancialProduct', 'BreadcrumbList']).toContain(jsonLd['@type']);
  });
});

// ==================== MOBILE TESTS ====================

test.describe('IPO Detail Page - Mobile', () => {
  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
  });

  test('should render mobile-responsive layout', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Verify mobile layout elements
    await expect(page.locator('[data-testid="ipo-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="key-metrics-cards"]')).toBeVisible();

    // Verify tabs are horizontally scrollable on mobile
    const tabsList = page.locator('[role="tablist"]');
    await expect(tabsList).toBeVisible();
  });

  test('should allow tab switching on mobile', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${VALID_IPO_SLUG}`);
    await waitForPageLoad(page);

    // Click on Financials tab
    await page.locator('button:has-text("Financials")').click();
    await page.waitForTimeout(500);

    // Verify URL updated
    await expect(page).toHaveURL(`${BASE_URL}/ipos/${VALID_IPO_SLUG}?tab=financials`);

    // Verify tab is active
    await expect(page.locator('button:has-text("Financials")')).toHaveAttribute(
      'data-state',
      'active'
    );
  });
});
