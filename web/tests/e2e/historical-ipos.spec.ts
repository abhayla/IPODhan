import { test, expect } from '@playwright/test';

test.describe('Historical IPOs Page E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/history');
  });

  test('page loads successfully with title and description', async ({ page }) => {
    await expect(page).toHaveTitle(/Historical IPOs/);
    await expect(page.locator('h1')).toContainText('Historical IPOs');
    await expect(page.getByText(/Browse past IPO performance/)).toBeVisible();
  });

  test('displays filter sidebar on desktop', async ({ page }) => {
    await expect(page.getByText('Filters').first()).toBeVisible();
    await expect(page.getByText('Year').first()).toBeVisible();
    await expect(page.getByText('Sector').first()).toBeVisible();
    await expect(page.getByText('Listing Performance').first()).toBeVisible();
  });

  test('displays search bar', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search by company name...');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEditable();
  });

  test('search functionality works with debounce', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search by company name...');

    // Type in search
    await searchInput.fill('Reliance');

    // Wait for debounce (500ms)
    await page.waitForTimeout(600);

    // URL should be updated with search param
    await expect(page).toHaveURL(/search=Reliance/);
  });

  test('filter by year updates URL', async ({ page }) => {
    // Click on year dropdown
    await page.getByRole('combobox').first().click();

    // Select a year (assuming 2024 is available)
    await page.getByRole('option', { name: '2024' }).click();

    // URL should be updated
    await expect(page).toHaveURL(/year=2024/);
  });

  test('filter by sector updates URL', async ({ page }) => {
    // Click on sector dropdown (second combobox)
    const sectorDropdown = page.getByRole('combobox').nth(1);
    await sectorDropdown.click();

    // Select first sector option (not "All Sectors")
    const sectorOptions = page.getByRole('option');
    const firstSector = sectorOptions.nth(1); // Skip "All Sectors"
    await firstSector.click();

    // URL should contain sector param
    await page.waitForURL(/sector=/);
  });

  test('filter by performance updates results', async ({ page }) => {
    // Select "Positive Gains" radio button
    await page.getByLabel('Positive Gains').click();

    // Wait for URL update
    await expect(page).toHaveURL(/performance=Positive/);
  });

  test('clear filters button works', async ({ page }) => {
    // Apply some filters first
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: '2024' }).click();

    // Wait for filters to apply
    await page.waitForURL(/year=2024/);

    // Click clear button
    await page.getByRole('button', { name: /Clear/i }).first().click();

    // URL should be reset
    await expect(page).toHaveURL('/history');
  });

  test('table sorting works', async ({ page }) => {
    // Click on "Listing Date" header to sort
    await page.getByRole('button', { name: /Listing Date/i }).click();

    // URL should contain sort params
    await expect(page).toHaveURL(/sort=listing_date/);
  });

  test('pagination navigation works', async ({ page }) => {
    // Check if pagination exists (depends on data)
    const nextButton = page.getByRole('button', { name: /Next/i });

    if (await nextButton.isVisible()) {
      // Click next page
      await nextButton.click();

      // URL should update with page param
      await expect(page).toHaveURL(/page=2/);

      // Previous button should now be enabled
      const prevButton = page.getByRole('button', { name: /Previous/i });
      await expect(prevButton).toBeEnabled();
    }
  });

  test('IPO card/row is clickable and navigates to detail page', async ({ page }) => {
    // Wait for IPO data to load
    await page.waitForSelector('a[href^="/ipos/"]', { timeout: 5000 });

    // Click on first IPO link
    const firstIPOLink = page.locator('a[href^="/ipos/"]').first();
    const href = await firstIPOLink.getAttribute('href');

    await firstIPOLink.click();

    // Should navigate to IPO detail page
    await expect(page).toHaveURL(new RegExp(href || ''));
  });

  test('empty state displays when no results', async ({ page }) => {
    // Apply filters that will return no results
    await page.getByPlaceholder('Search by company name...').fill('NonExistentCompany12345');

    // Wait for debounce
    await page.waitForTimeout(600);

    // Should show empty state
    await expect(page.getByText('No IPOs Found')).toBeVisible();
    await expect(page.getByRole('button', { name: /Clear All Filters/i })).toBeVisible();
  });

  test('results count updates with filters', async ({ page }) => {
    // Get initial results count
    const resultsCount = page.getByText(/Showing/);
    await expect(resultsCount).toBeVisible();

    // Apply a filter
    await page.getByLabel('Positive Gains').click();

    // Results count should update
    await page.waitForTimeout(500);
    await expect(resultsCount).toBeVisible();
  });

  test('mobile: filter drawer opens and closes', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Filter button should be visible on mobile
    const filterButton = page.getByRole('button', { name: /Filters/i });
    await expect(filterButton).toBeVisible();

    // Click to open drawer
    await filterButton.click();

    // Drawer content should be visible
    await expect(page.getByText('Filter Historical IPOs')).toBeVisible();

    // Close drawer (click outside or close button)
    await page.keyboard.press('Escape');

    // Drawer should close
    await expect(page.getByText('Filter Historical IPOs')).not.toBeVisible();
  });

  test('mobile: card view displays correctly', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Wait for cards to load
    await page.waitForSelector('[class*="space-y-4"]');

    // Cards should be visible
    const cards = page.locator('[class*="hover:shadow-lg"]');
    await expect(cards.first()).toBeVisible();
  });

  test('SEO: meta tags are present', async ({ page }) => {
    // Check title
    await expect(page).toHaveTitle(/Historical IPOs/);

    // Check meta description
    const metaDescription = page.locator('meta[name="description"]');
    await expect(metaDescription).toHaveAttribute('content', /historical IPO data/);
  });

  test('SEO: structured data is present', async ({ page }) => {
    // Check for JSON-LD structured data
    const structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toBeAttached();

    const content = await structuredData.textContent();
    expect(content).toContain('CollectionPage');
    expect(content).toContain('Historical IPOs Database');
  });

  test('URL persistence: filters persist on page reload', async ({ page }) => {
    // Apply filters
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: '2024' }).click();

    await page.waitForURL(/year=2024/);

    // Reload page
    await page.reload();

    // Filters should still be applied (check URL)
    await expect(page).toHaveURL(/year=2024/);
  });

  test('accessibility: keyboard navigation works', async ({ page }) => {
    // Tab to search input
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Should be able to type in search
    await page.keyboard.type('Test');

    // Tab to filter controls
    await page.keyboard.press('Tab');

    // Should be able to navigate filters
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });

  test('performance: page loads within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/history');
    await page.waitForSelector('h1:has-text("Historical IPOs")');

    const loadTime = Date.now() - startTime;

    // Page should load within 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });
});
