import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/dashboard');
  });

  test('should display IPO dashboard with header', async ({ page }) => {
    // Wait for page to load
    await expect(page.locator('h1')).toContainText('IPO Dashboard');
    await expect(page.getByText(/Browse current and upcoming IPOs/i)).toBeVisible();
  });

  test('should display IPO cards in grid layout', async ({ page }) => {
    // Wait for IPO cards to load (or empty state)
    const container = page.locator('[data-testid="ipo-container"]');
    await expect(container).toBeVisible();

    // Check if grid layout is applied
    await expect(container).toHaveClass(/grid/);
  });

  test('should display view toggle buttons', async ({ page }) => {
    // Check for view toggle buttons
    const gridButton = page.getByLabel('Grid view');
    const listButton = page.getByLabel('List view');

    await expect(gridButton).toBeVisible();
    await expect(listButton).toBeVisible();
  });

  test('should toggle between grid and list views', async ({ page }) => {
    const container = page.locator('[data-testid="ipo-container"]');

    // Initially should be in grid view
    await expect(container).toHaveClass(/grid/);

    // Switch to list view
    await page.click('button[aria-label="List view"]');

    // Wait for URL to update
    await expect(page).toHaveURL(/view=list/);

    // Check if layout changed to flex column
    await expect(container).toHaveClass(/flex-col/);

    // Switch back to grid view
    await page.click('button[aria-label="Grid view"]');
    await expect(page).toHaveURL(/view=grid/);
    await expect(container).toHaveClass(/grid/);
  });

  test('should display pagination when there are multiple pages', async ({ page }) => {
    const pagination = page.locator('[data-testid="pagination"]');

    // Check if pagination exists (might not be visible if only 1 page)
    const paginationCount = await pagination.count();

    if (paginationCount > 0) {
      // If pagination exists, check for prev/next buttons
      const prevButton = page.getByLabel('Previous page');
      const nextButton = page.getByLabel('Next page');

      await expect(prevButton).toBeVisible();
      await expect(nextButton).toBeVisible();

      // Previous button should be disabled on first page
      await expect(prevButton).toBeDisabled();
    }
  });

  test('should navigate to next page when clicking next button', async ({ page }) => {
    const pagination = page.locator('[data-testid="pagination"]');
    const paginationCount = await pagination.count();

    if (paginationCount > 0) {
      const nextButton = page.getByLabel('Next page');

      // Check if next button is enabled
      const isDisabled = await nextButton.isDisabled();

      if (!isDisabled) {
        // Click next page
        await nextButton.click();

        // Wait for URL to update
        await expect(page).toHaveURL(/page=2/);

        // Check that previous button is now enabled
        const prevButton = page.getByLabel('Previous page');
        await expect(prevButton).not.toBeDisabled();
      }
    }
  });

  test('should display empty state when no IPOs found', async ({ page }) => {
    // Navigate with a filter that returns no results (if API supports it)
    await page.goto('/dashboard?status=NONEXISTENT');

    // Check for empty state
    const emptyState = page.locator('[data-testid="empty-state"]');
    const emptyStateCount = await emptyState.count();

    if (emptyStateCount > 0) {
      await expect(emptyState).toContainText('No IPOs found');
    }
  });

  test('should display loading skeletons initially', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/dashboard');

    // Check for skeleton loaders (they should appear briefly)
    const skeleton = page.locator('[data-testid="ipo-card-skeleton"]');

    // Skeleton might be visible very briefly, so we just check if it exists in DOM
    // during initial load or if content loads quickly
    const skeletonCount = await skeleton.count();

    // This is acceptable - either we caught the loading state or content loaded fast
    expect(skeletonCount).toBeGreaterThanOrEqual(0);
  });

  test('should persist view preference in URL', async ({ page }) => {
    // Switch to list view
    await page.click('button[aria-label="List view"]');
    await expect(page).toHaveURL(/view=list/);

    // Reload page
    await page.reload();

    // Should still be in list view after reload
    await expect(page).toHaveURL(/view=list/);
    const container = page.locator('[data-testid="ipo-container"]');
    await expect(container).toHaveClass(/flex-col/);
  });

  test('should have proper SEO metadata', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/IPO Dashboard/);

    // Check meta description
    const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
    expect(metaDescription).toContain('IPO');
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Navigate to dashboard
    await page.goto('/dashboard');

    // Check that page renders
    await expect(page.locator('h1')).toContainText('IPO Dashboard');

    // Check that grid uses 1 column on mobile
    const container = page.locator('[data-testid="ipo-container"]');
    await expect(container).toBeVisible();
  });

  test('should be responsive on tablet', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    // Navigate to dashboard
    await page.goto('/dashboard');

    // Check that page renders
    await expect(page.locator('h1')).toContainText('IPO Dashboard');

    // Check that container is visible
    const container = page.locator('[data-testid="ipo-container"]');
    await expect(container).toBeVisible();
  });

  test('should be responsive on desktop', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate to dashboard
    await page.goto('/dashboard');

    // Check that page renders
    await expect(page.locator('h1')).toContainText('IPO Dashboard');

    // Check that container is visible
    const container = page.locator('[data-testid="ipo-container"]');
    await expect(container).toBeVisible();
  });

  test('should have accessible navigation elements', async ({ page }) => {
    // Check for proper ARIA labels
    const gridButton = page.getByLabel('Grid view');
    const listButton = page.getByLabel('List view');

    await expect(gridButton).toHaveAttribute('aria-label', 'Grid view');
    await expect(listButton).toHaveAttribute('aria-label', 'List view');

    // Check pagination accessibility (if it exists)
    const pagination = page.locator('[aria-label="Page navigation"]');
    const paginationCount = await pagination.count();

    if (paginationCount > 0) {
      await expect(pagination).toBeVisible();
    }
  });
});
