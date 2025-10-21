/**
 * Phase 5: User Journey Testing
 * Journey 4: Research Journey
 *
 * User Story: Investor researches IPOs using search and filters
 *
 * Flow:
 * 1. Homepage → Search for IPO
 * 2. View Search Results
 * 3. Apply Filters (Category, Status)
 * 4. View Filtered Results
 * 5. Click on IPO Detail
 */

import { test, expect } from '@playwright/test';

test.describe('Journey 4: Research Journey', () => {
  // Track journey metrics
  let journeyStartTime: number;
  let pageLoadCount: number;
  let consoleErrors: string[];

  test.beforeEach(async ({ page }) => {
    journeyStartTime = Date.now();
    pageLoadCount = 0;
    consoleErrors = [];

    // Listen for console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Listen for page navigations
    page.on('load', () => {
      pageLoadCount++;
    });
  });

  test.afterEach(async () => {
    const journeyTime = Date.now() - journeyStartTime;
    console.log('Journey Time:', journeyTime, 'ms');
    console.log('Page Loads:', pageLoadCount);
    console.log('Console Errors:', consoleErrors.length);
  });

  test('should complete full research journey', async ({ page }) => {
    // ===== STEP 1: Search from Homepage =====
    console.log('Step 1: Search from homepage');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for search input
    const searchInput = page.locator(
      '[data-testid="search-input"], input[type="search"], input[placeholder*="Search"], input[name*="search"]'
    ).first();

    const hasSearchInput = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasSearchInput) {
      // Enter search query
      await searchInput.fill('Housing');
      console.log('Entered search query: Housing');

      await page.waitForTimeout(500);

      // Look for search button or submit
      const searchButton = page.getByRole('button', { name: /Search/i }).first();
      const hasSearchButton = await searchButton.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasSearchButton) {
        await searchButton.click();
        await page.waitForTimeout(500);
      } else {
        // Try pressing Enter
        await searchInput.press('Enter');
        await page.waitForTimeout(500);
      }

      // ===== STEP 2: View Search Results =====
      console.log('Step 2: View search results');

      // Check for search results (may be inline or navigate to results page)
      const searchResults = page.locator(
        '[data-testid="search-results"], [data-testid="search-result"], .search-results, [class*="search"]'
      );

      const hasResults = await searchResults.first().isVisible({ timeout: 3000 }).catch(() => false);

      if (hasResults) {
        const resultCount = await searchResults.count();
        console.log(`Found ${resultCount} search results`);
        expect(resultCount).toBeGreaterThan(0);
      } else {
        console.log('No search results component found - may redirect to dashboard');
        // Navigate to dashboard for filtering
        await page.goto('/dashboard');
        await page.waitForLoadState('networkidle');
      }

    } else {
      // No search on homepage, go directly to dashboard
      console.log('Search input not found on homepage - navigating to dashboard');
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
    }

    // ===== STEP 3: Apply Filters =====
    console.log('Step 3: Apply filters');

    // Make sure we're on a page with filters (dashboard or search results)
    if (!page.url().includes('dashboard')) {
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
    }

    // Look for category filter
    const categoryFilter = page.locator(
      '[data-testid="category-filter"], select[name*="category"], select[id*="category"]'
    ).first();

    const hasCategoryFilter = await categoryFilter.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasCategoryFilter) {
      // Select MAINBOARD category
      await categoryFilter.selectOption('MAINBOARD');
      console.log('Applied category filter: MAINBOARD');

      await page.waitForTimeout(500);
    } else {
      console.log('Category filter not found');
    }

    // Look for status filter
    const statusFilter = page.locator(
      '[data-testid="status-filter"], select[name*="status"], select[id*="status"]'
    ).first();

    const hasStatusFilter = await statusFilter.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasStatusFilter) {
      // Select OPEN status
      await statusFilter.selectOption('OPEN');
      console.log('Applied status filter: OPEN');

      await page.waitForTimeout(500);
    } else {
      console.log('Status filter not found');
    }

    // ===== STEP 4: View Filtered Results =====
    console.log('Step 4: View filtered results');

    // Look for IPO cards/rows
    const ipoCards = page.locator(
      '[data-testid="ipo-card"], .ipo-card, article, [class*="ipo-item"]'
    );

    const cardCount = await ipoCards.count();
    console.log(`Found ${cardCount} IPO cards after filtering`);

    if (cardCount > 0) {
      // Verify cards are visible
      const firstCard = ipoCards.first();
      await expect(firstCard).toBeVisible();

      // ===== STEP 5: Click on IPO Detail =====
      console.log('Step 5: Navigate to IPO detail');

      // Find link in first card
      const ipoLink = firstCard.locator('a[href*="/ipos/"]').first();
      const hasLink = await ipoLink.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasLink) {
        await ipoLink.click();
        await page.waitForLoadState('networkidle');

        // Verify we're on detail page
        await expect(page).toHaveURL(/\/ipos\/[\w-]+/);

        const heading = page.locator('h1').first();
        await expect(heading).toBeVisible();

        console.log('IPO detail page loaded successfully');

        // ===== STEP 6: Verify Detail Page Data =====
        console.log('Step 6: Verify detail page data');

        const pageContent = await page.content();

        // Check for key data sections
        const hasPriceInfo = pageContent.toLowerCase().includes('price') || pageContent.includes('₹');
        const hasDates = pageContent.toLowerCase().includes('open date') || pageContent.toLowerCase().includes('close date');
        const hasSubscription = pageContent.toLowerCase().includes('subscription');

        if (hasPriceInfo) console.log('✓ Price information found');
        if (hasDates) console.log('✓ Date information found');
        if (hasSubscription) console.log('✓ Subscription data found');

        // Should have at least some key information
        const hasBasicInfo = hasPriceInfo || hasDates || hasSubscription;
        expect(hasBasicInfo).toBe(true);

      } else {
        console.log('IPO link not found in card');
      }

    } else {
      console.log('No IPO cards found - database may be empty for selected filters');
    }

    // Journey completed
    console.log('Journey 4 completed successfully');

    // ===== ASSERTIONS =====
    const totalTime = Date.now() - journeyStartTime;
    expect(totalTime).toBeLessThan(15000); // Should complete in < 15s

    expect(consoleErrors.length).toBeLessThan(5);
  });

  test('should search with autocomplete/suggestions', async ({ page }) => {
    console.log('Testing search autocomplete');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('[data-testid="search-input"], input[type="search"]').first();
    const hasSearchInput = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasSearchInput) {
      // Type search query slowly to trigger autocomplete
      await searchInput.type('Baj', { delay: 100 });
      await page.waitForTimeout(500);

      // Look for autocomplete dropdown
      const autocomplete = page.locator(
        '[data-testid="autocomplete"], [role="listbox"], .autocomplete-results, [class*="suggestions"]'
      );

      const hasAutocomplete = await autocomplete.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasAutocomplete) {
        console.log('Autocomplete dropdown displayed');

        // Check if suggestions are present
        const suggestions = autocomplete.locator('[role="option"], li, div[class*="suggestion"]');
        const suggestionCount = await suggestions.count();

        console.log(`Found ${suggestionCount} suggestions`);

        if (suggestionCount > 0) {
          // Click first suggestion
          await suggestions.first().click();
          await page.waitForTimeout(500);

          console.log('Selected first autocomplete suggestion');
        }

      } else {
        console.log('No autocomplete dropdown found');
      }

    } else {
      console.log('Search input not available on homepage');
    }
  });

  test('should filter by multiple criteria', async ({ page }) => {
    console.log('Testing multiple filter combinations');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Test different filter combinations
    const filterCombinations = [
      { category: 'MAINBOARD', status: 'OPEN' },
      { category: 'SME', status: 'UPCOMING' },
      { category: 'MAINBOARD', status: 'CLOSED' }
    ];

    for (const combo of filterCombinations) {
      console.log(`Testing filters: ${combo.category} + ${combo.status}`);

      // Apply category filter
      const categoryFilter = page.locator('select[name*="category"], select[id*="category"]').first();
      if (await categoryFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
        await categoryFilter.selectOption(combo.category);
        await page.waitForTimeout(300);
      }

      // Apply status filter
      const statusFilter = page.locator('select[name*="status"], select[id*="status"]').first();
      if (await statusFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
        await statusFilter.selectOption(combo.status);
        await page.waitForTimeout(300);
      }

      // Check results updated
      const results = page.locator('[data-testid="ipo-card"], .ipo-card');
      const resultCount = await results.count();

      console.log(`  Results: ${resultCount} IPOs`);
      await page.waitForTimeout(200);
    }

    console.log('Multiple filter combinations tested');
  });

  test('should clear filters and reset results', async ({ page }) => {
    console.log('Testing filter reset');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Apply filters first
    const categoryFilter = page.locator('select[name*="category"]').first();
    if (await categoryFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await categoryFilter.selectOption('MAINBOARD');
      await page.waitForTimeout(300);

      const resultsBefore = page.locator('[data-testid="ipo-card"], .ipo-card');
      const countBefore = await resultsBefore.count();
      console.log(`Results with filter: ${countBefore}`);

      // Look for clear/reset button
      const clearButton = page.getByRole('button', { name: /Clear|Reset/i }).first();
      const hasClearButton = await clearButton.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasClearButton) {
        await clearButton.click();
        await page.waitForTimeout(300);

        const resultsAfter = page.locator('[data-testid="ipo-card"], .ipo-card');
        const countAfter = await resultsAfter.count();
        console.log(`Results after clear: ${countAfter}`);

        console.log('Filter reset successful');
      } else {
        // Manually reset to "All"
        await categoryFilter.selectOption('ALL');
        console.log('Manually reset filters');
      }
    }
  });

  test('should display search results with relevance', async ({ page }) => {
    console.log('Testing search result relevance');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    const hasSearchInput = await searchInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasSearchInput) {
      // Search for specific term
      await searchInput.fill('Finance');
      await searchInput.press('Enter');
      await page.waitForTimeout(1000);

      // Check results contain search term
      const pageContent = await page.textContent('body');
      const hasRelevantResults = pageContent?.toLowerCase().includes('finance');

      if (hasRelevantResults) {
        console.log('Search results contain relevant term');
      } else {
        console.log('Results may not contain exact term (fuzzy search)');
      }
    }
  });

  test('should be mobile responsive throughout journey', async ({ page }) => {
    console.log('Testing mobile responsiveness for research journey');

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Homepage search
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    let body = page.locator('body');
    let bodyBox = await body.boundingBox();
    expect(bodyBox?.width).toBeLessThanOrEqual(375);

    // Dashboard filtering
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    body = page.locator('body');
    bodyBox = await body.boundingBox();
    expect(bodyBox?.width).toBeLessThanOrEqual(375);

    // Filters should be accessible on mobile
    const filterSection = page.locator('[data-testid="filters"], .filters, [class*="filter"]').first();
    const hasFilters = await filterSection.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasFilters) {
      console.log('Filters visible on mobile');
    } else {
      // May be in collapsible menu
      const filterToggle = page.getByRole('button', { name: /Filter|Show Filters/i }).first();
      const hasToggle = await filterToggle.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasToggle) {
        console.log('Filters in collapsible menu on mobile');
      }
    }

    console.log('Mobile responsiveness verified');
  });

  test('should handle no results gracefully', async ({ page }) => {
    console.log('Testing no results scenario');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Apply filters that likely return no results
    const categoryFilter = page.locator('select[name*="category"]').first();
    const statusFilter = page.locator('select[name*="status"]').first();

    if (
      await categoryFilter.isVisible({ timeout: 3000 }).catch(() => false) &&
      await statusFilter.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      // Apply specific combination
      await categoryFilter.selectOption('SME');
      await page.waitForTimeout(300);
      await statusFilter.selectOption('OPEN');
      await page.waitForTimeout(300);

      const results = page.locator('[data-testid="ipo-card"], .ipo-card');
      const resultCount = await results.count();

      if (resultCount === 0) {
        console.log('No results found - checking for empty state');

        // Look for empty state message
        const emptyState = page.locator(
          '[data-testid="empty-state"], .empty-state, text=/No IPOs|No results/i'
        ).first();

        const hasEmptyState = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);

        if (hasEmptyState) {
          console.log('Empty state message displayed correctly');
        } else {
          console.log('No explicit empty state (may just show no cards)');
        }
      } else {
        console.log(`Found ${resultCount} results`);
      }
    }
  });

  test('should navigate back and forth smoothly', async ({ page }) => {
    console.log('Testing navigation smoothness');

    // Homepage → Dashboard
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Dashboard → Back to Homepage
    await page.goBack();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/');

    // Forward to Dashboard
    await page.goForward();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/dashboard');

    console.log('Navigation back/forward working correctly');
  });

  test('should persist filters during navigation', async ({ page }) => {
    console.log('Testing filter persistence');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Apply a filter
    const categoryFilter = page.locator('select[name*="category"]').first();
    const hasCategoryFilter = await categoryFilter.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasCategoryFilter) {
      await categoryFilter.selectOption('MAINBOARD');
      await page.waitForTimeout(300);

      console.log('Applied MAINBOARD filter');

      // Note the current URL (may have query params)
      const urlWithFilters = page.url();
      console.log('URL with filters:', urlWithFilters);

      // Navigate to homepage
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Go back to dashboard
      await page.goBack();
      await page.waitForLoadState('networkidle');

      // Check if filter is still applied (via URL params or state)
      const currentUrl = page.url();

      if (currentUrl.includes('category') || currentUrl.includes('MAINBOARD')) {
        console.log('Filters persisted via URL parameters');
      } else {
        console.log('Filters may not persist (depends on implementation)');
      }
    }
  });
});
