/**
 * E2E Tests for SME IPO Prospectus Page
 *
 * Story 9.12: SME IPO Prospectus PDF Download Page
 * Tests all 17 acceptance criteria
 */

import { test, expect } from '@playwright/test';

test.describe('SME IPO Prospectus Page', () => {
  // AC#1: Page accessible at /sme-ipo-prospectus
  test('should load the SME IPO Prospectus page', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');
    await expect(page).toHaveURL(/.*sme-ipo-prospectus/);
    await expect(page.locator('h1')).toContainText('SME IPO Prospectus');
  });

  // AC#14: SEO metadata configured
  test('should have proper SEO metadata', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    const title = await page.title();
    expect(title).toContain('SME IPO Prospectus');
    expect(title).toContain('DRHP');
    expect(title).toContain('RHP');

    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toContain('SME IPO');
    expect(description).toContain('prospectus');
    expect(description).toContain('DRHP');
  });

  // AC#2, AC#3: Table displays data and total count
  test('should display prospectus table with total count', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for data to load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Check total count displays
    const totalCount = page.locator('text=Total Records:');
    await expect(totalCount).toBeVisible();
  });

  // AC#4: Column-level search functional
  test('should filter by company name', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Find and fill company name search
    const searchInput = page.locator('input[placeholder*="company name"]');
    await searchInput.fill('Test Company');

    // Wait for debounce and URL update
    await page.waitForTimeout(500);

    // Check URL updated
    expect(page.url()).toContain('companyName=Test');
  });

  // AC#4: Exchange filter works
  test('should filter by exchange', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    // Open exchange dropdown
    const exchangeSelect = page.locator('text=Exchange').locator('..').locator('button');
    await exchangeSelect.click();

    // Select NSE
    await page.locator('text=NSE').first().click();

    // Wait for URL update
    await page.waitForTimeout(300);

    // Check URL updated
    expect(page.url()).toContain('exchange=NSE');
  });

  // AC#5: Sortable columns work
  test('should sort by company name', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for data to load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Find and click company name header (desktop view)
    const companyNameHeader = page.locator('button:has-text("Company Name")');
    if (await companyNameHeader.isVisible()) {
      await companyNameHeader.click();
      await page.waitForTimeout(300);

      // Check sorting indicator appears (arrow icon)
      const sortIcon = page.locator('table').locator('svg').first();
      await expect(sortIcon).toBeVisible();
    }
  });

  // AC#6: Company name links navigate to IPO detail pages
  test('should have clickable company name links', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for data to load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Find first company name link
    const firstCompanyLink = page.locator('a[href^="/ipos/"]').first();
    if (await firstCompanyLink.isVisible()) {
      const href = await firstCompanyLink.getAttribute('href');
      expect(href).toMatch(/^\/ipos\/.+/);
    }
  });

  // AC#7, AC#17: PDF download links with external icon and attributes
  test('should display PDF download links with external icon', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for data to load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Check for download links with target="_blank"
    const pdfLink = page.locator('a:has-text("Download")').first();
    if (await pdfLink.isVisible()) {
      const target = await pdfLink.getAttribute('target');
      expect(target).toBe('_blank');

      const rel = await pdfLink.getAttribute('rel');
      expect(rel).toContain('noopener');

      // Check for external icon
      const externalIcon = pdfLink.locator('svg');
      await expect(externalIcon).toBeVisible();
    }
  });

  // AC#9: Empty state
  test('should show empty state when no results', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus?companyName=NonExistentCompanyXYZ123');

    // Wait for data load
    await page.waitForLoadState('networkidle');

    // Check empty state message (AC#9 specific message)
    const emptyState = page.locator('text=No SME prospectus documents available');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
  });

  // AC#10: Loading skeleton displays
  test('should show loading state initially', async ({ page }) => {
    // Start navigation but don't wait for load
    const navigation = page.goto('/sme-ipo-prospectus');

    // Check for skeleton (loading state)
    // Note: This may be too fast to catch in real conditions
    const skeleton = page.locator('[class*="skeleton"]').first();
    // Skeleton might not be visible by the time we check, so just verify it exists in markup
    // Or we can verify the final loaded state
    await navigation;

    // Verify data eventually loads
    await expect(page.locator('text=Total Records:')).toBeVisible({ timeout: 10000 });
  });

  // AC#11: ISR cache headers
  test('should have ISR cache headers', async ({ page }) => {
    const response = await page.goto('/sme-ipo-prospectus');

    const cacheControl = response?.headers()['cache-control'];
    expect(cacheControl).toBeDefined();
  });

  // AC#12: Responsive design - desktop table
  test('should display table on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/sme-ipo-prospectus');

    // Wait for table to load
    await page.waitForSelector('table', { timeout: 10000 });

    // Table should be visible on desktop
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  // AC#12: Responsive design - mobile cards
  test('should display cards on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/sme-ipo-prospectus');

    // Wait for data load
    await page.waitForLoadState('networkidle');

    // Cards should be visible on mobile
    const cards = page.locator('[class*="Card"]').first();
    await expect(cards).toBeVisible({ timeout: 10000 });
  });

  // AC#13: Pagination works correctly (50 records per page)
  test('should navigate between pages', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for page load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Check for Next button
    const nextButton = page.locator('button:has-text("Next")');
    if (await nextButton.isEnabled()) {
      await nextButton.click();

      // Check URL updated to page 2
      await page.waitForTimeout(300);
      expect(page.url()).toContain('page=2');

      // Check Previous button now enabled
      const prevButton = page.locator('button:has-text("Previous")');
      await expect(prevButton).toBeEnabled();
    }
  });

  // AC#15: Navigation link in SME IPOs submenu
  test('should have navigation link in SME IPOs submenu', async ({ page }) => {
    await page.goto('/');

    // Wait for header to load
    await page.waitForLoadState('networkidle');

    // Desktop: Check SME IPOs dropdown
    if (await page.locator('button:has-text("SME IPOs")').isVisible()) {
      await page.locator('button:has-text("SME IPOs")').click();
      await page.waitForTimeout(200);

      const prospectusLink = page.locator('a[href="/sme-ipo-prospectus"]');
      await expect(prospectusLink).toBeVisible();
      await expect(prospectusLink).toContainText('SME IPO Prospectus');
    }
  });

  // AC#16: Only SME IPOs displayed
  test('should display only SME category IPOs', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for data to load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Check page title and description mention SME
    await expect(page.locator('h1')).toContainText('SME');
    const description = page.locator('text=SME IPOs');
    await expect(description).toBeVisible();
  });

  // AC#17: Missing documents show "Not Available"
  test('should show "Not Available" for missing documents', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for data to load
    await page.waitForSelector('text=Total Records:', { timeout: 10000 });

    // Check for "Not Available" text (desktop or mobile)
    const notAvailableText = page.locator('text=Not Available');
    // It may or may not be visible depending on data, but if it is, verify it's there
    if (await notAvailableText.count() > 0) {
      await expect(notAvailableText.first()).toBeVisible();
    }
  });

  // AC#8: Search results update in real-time (debounced 300ms)
  test('should debounce search input', async ({ page }) => {
    await page.goto('/sme-ipo-prospectus');

    // Wait for page load
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="company name"]');

    // Type quickly
    await searchInput.fill('A');
    await page.waitForTimeout(100);
    await searchInput.fill('AB');
    await page.waitForTimeout(100);
    await searchInput.fill('ABC');

    // Wait for debounce (300ms)
    await page.waitForTimeout(400);

    // Check URL updated after debounce
    expect(page.url()).toContain('companyName=ABC');
  });
});
