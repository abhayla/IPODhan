/**
 * E2E Tests for Review Moderation Flow
 *
 * Story 11.16: IPO Recommendations Summary Section
 *
 * Tests complete user journeys:
 * 1. Admin reviews pending reviews at /admin/reviews
 * 2. Admin approves/rejects reviews
 * 3. Approved reviews appear in IPO detail page
 * 4. Recommendation Summary section displays correctly
 * 5. "View All Reviews" navigation works
 * 6. Performance: Review summary loads in <500ms
 *
 * Uses Playwright for browser automation
 * Coverage Target: >85% of critical user flows
 */

import { test, expect } from '@playwright/test';

// ==================== CONFIGURATION ====================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'test-admin-token';

// Test data IDs (should exist in test database)
const TEST_IPO_SLUG = 'review-summary-test-corp';
const TEST_REVIEW_ID_PENDING = 'test-review-pending-001';

// ==================== HELPER FUNCTIONS ====================

/**
 * Setup admin authentication
 */
async function setupAdminAuth(page: any) {
  await page.setExtraHTTPHeaders({
    Authorization: `Bearer ${ADMIN_TOKEN}`,
  });
}

/**
 * Wait for element with timeout
 */
async function waitForElement(page: any, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { timeout });
}

// ==================== TESTS ====================

test.describe('Review Moderation Flow - E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Setup admin authentication
    await setupAdminAuth(page);
  });

  // ==================== Admin Review List ====================

  test('should navigate to /admin/reviews and see pending reviews', async ({
    page,
  }) => {
    // Navigate to admin reviews page
    await page.goto(`${BASE_URL}/admin/reviews`);

    // Wait for page to load
    await waitForElement(page, 'h1');

    // Check for page title
    const title = await page.textContent('h1');
    expect(title).toContain('Pending Reviews');

    // Check for reviews table/list
    const reviewsList = await page.locator('[data-testid="reviews-list"]');
    await expect(reviewsList).toBeVisible();

    // Should have at least one pending review
    const reviewItems = await page.locator('[data-testid="review-item"]');
    const count = await reviewItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should display review details in admin list', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reviews`);

    // Wait for first review item
    await waitForElement(page, '[data-testid="review-item"]');

    // Check for review fields
    const firstReview = page.locator('[data-testid="review-item"]').first();

    await expect(firstReview).toContainText(/Author:/);
    await expect(firstReview).toContainText(/IPO:/);
    await expect(firstReview).toContainText(/Recommendation:/);
    await expect(firstReview).toContainText(/Published:/);
  });

  // ==================== Approve Review ====================

  test('should approve review and see it disappear from list', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/reviews`);

    // Wait for reviews to load
    await waitForElement(page, '[data-testid="review-item"]');

    // Count initial reviews
    const initialCount = await page.locator('[data-testid="review-item"]').count();

    // Find and click Approve button on first review
    const approveButton = page
      .locator('[data-testid="review-item"]')
      .first()
      .locator('button[data-action="approve"]');

    await approveButton.click();

    // Wait for confirmation/toast
    await page.waitForTimeout(1000);

    // Count reviews after approval
    const finalCount = await page.locator('[data-testid="review-item"]').count();

    // Should have one less review
    expect(finalCount).toBe(initialCount - 1);
  });

  // ==================== Reject Review ====================

  test('should reject review and see it disappear from list', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/reviews`);

    await waitForElement(page, '[data-testid="review-item"]');

    const initialCount = await page.locator('[data-testid="review-item"]').count();

    // Click Reject button
    const rejectButton = page
      .locator('[data-testid="review-item"]')
      .first()
      .locator('button[data-action="reject"]');

    await rejectButton.click();

    await page.waitForTimeout(1000);

    const finalCount = await page.locator('[data-testid="review-item"]').count();

    expect(finalCount).toBe(initialCount - 1);
  });

  // ==================== IPO Detail with Reviews ====================

  test('should display Recommendation Summary section on IPO detail page', async ({
    page,
  }) => {
    // Navigate to IPO detail page with reviews
    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    // Wait for page to load
    await waitForElement(page, 'h1');

    // Scroll to Recommendation Summary section
    const summarySection = page.locator('[data-testid="recommendation-summary"]');
    await summarySection.scrollIntoViewIfNeeded();

    // Check for section title
    await expect(summarySection).toContainText('Broker Recommendations');

    // Check for key elements
    await expect(summarySection).toContainText(/Based on .* review/);
    await expect(summarySection).toContainText('Recommendation Breakdown');
    await expect(summarySection).toContainText('Sentiment Analysis');
  });

  test('should display Recommendation Summary after Company Contact Section', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    // Get all section headings
    const sections = page.locator('h2, h3');
    const headings = await sections.allTextContents();

    // Find indices
    const contactIndex = headings.findIndex((h) =>
      h.includes('Company Contact')
    );
    const recommendationIndex = headings.findIndex((h) =>
      h.includes('Broker Recommendations')
    );

    // Recommendation should come after Contact
    expect(recommendationIndex).toBeGreaterThan(contactIndex);
  });

  test('should display star rating and average score', async ({ page }) => {
    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    const summarySection = page.locator('[data-testid="recommendation-summary"]');
    await summarySection.scrollIntoViewIfNeeded();

    // Check for star icons
    const stars = summarySection.locator('svg[class*="lucide-star"]');
    const starCount = await stars.count();
    expect(starCount).toBe(5); // Always 5 stars

    // Check for rating number
    await expect(summarySection).toContainText(/\d\.\d/); // Format: X.X
    await expect(summarySection).toContainText('/5');
  });

  test('should display recommendation breakdown with percentages', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    const summarySection = page.locator('[data-testid="recommendation-summary"]');
    await summarySection.scrollIntoViewIfNeeded();

    // Check for recommendation types
    await expect(summarySection).toContainText('May Apply');
    await expect(summarySection).toContainText('Subscribe');
    await expect(summarySection).toContainText('Avoid');
    await expect(summarySection).toContainText('Not Recommended');

    // Check for percentages
    const percentages = await summarySection.locator('text=/\\d+%/').count();
    expect(percentages).toBeGreaterThan(0);
  });

  // ==================== View All Reviews Navigation ====================

  test('should navigate to reviews page when clicking "View All Reviews"', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    const summarySection = page.locator('[data-testid="recommendation-summary"]');
    await summarySection.scrollIntoViewIfNeeded();

    // Click "View All Reviews" button
    const viewAllButton = summarySection.locator('a', {
      hasText: 'View All',
    });
    await viewAllButton.click();

    // Wait for navigation
    await page.waitForLoadState('networkidle');

    // Should navigate to reviews page
    const url = page.url();
    expect(url).toMatch(/\/(mainboard|sme)-ipo-reviews/);
  });

  // ==================== Performance Test ====================

  test('should load review summary in <500ms', async ({ page }) => {
    // Start performance measurement
    const startTime = Date.now();

    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    // Wait for Recommendation Summary to be visible
    const summarySection = page.locator('[data-testid="recommendation-summary"]');
    await summarySection.scrollIntoViewIfNeeded();
    await summarySection.waitFor({ state: 'visible' });

    const loadTime = Date.now() - startTime;

    console.log(`Review summary load time: ${loadTime}ms`);

    // Performance target: <500ms
    expect(loadTime).toBeLessThan(500);
  });

  // ==================== Empty State ====================

  test('should show empty state when no reviews available', async ({ page }) => {
    // Navigate to IPO without reviews
    await page.goto(`${BASE_URL}/ipos/no-reviews-test-corp`);

    // Wait for page load
    await waitForElement(page, 'h1');

    // Scroll to where reviews would be
    const summarySection = page.locator('[data-testid="recommendation-summary"]');

    if (await summarySection.count() > 0) {
      await summarySection.scrollIntoViewIfNeeded();

      // Check for empty state message
      await expect(summarySection).toContainText(
        'No broker reviews available yet'
      );
      await expect(summarySection).toContainText(
        'Expert opinions will appear here once brokers publish their analysis'
      );
    }
  });

  // ==================== Integration: Approve and Verify ====================

  test('should see approved review appear in IPO detail immediately', async ({
    page,
    context,
  }) => {
    // Step 1: Navigate to admin reviews
    await page.goto(`${BASE_URL}/admin/reviews`);
    await waitForElement(page, '[data-testid="review-item"]');

    // Get first pending review's IPO slug
    const firstReview = page.locator('[data-testid="review-item"]').first();
    const ipoSlug = await firstReview.getAttribute('data-ipo-slug');

    // Step 2: Approve the review
    const approveButton = firstReview.locator('button[data-action="approve"]');
    await approveButton.click();
    await page.waitForTimeout(1000);

    // Step 3: Navigate to IPO detail page in new tab
    const detailPage = await context.newPage();
    await detailPage.goto(`${BASE_URL}/ipos/${ipoSlug}`);

    // Step 4: Verify review appears in summary
    const summarySection = detailPage.locator(
      '[data-testid="recommendation-summary"]'
    );
    await summarySection.scrollIntoViewIfNeeded();

    // Should show reviews (not empty state)
    await expect(summarySection).toContainText('Based on');
    await expect(summarySection).toContainText('Recommendation Breakdown');

    await detailPage.close();
  });

  // ==================== Responsive Design ====================

  test('should display correctly on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    const summarySection = page.locator('[data-testid="recommendation-summary"]');
    await summarySection.scrollIntoViewIfNeeded();

    // Should be visible and readable
    await expect(summarySection).toBeVisible();

    // Check that key elements render
    await expect(summarySection).toContainText('Broker Recommendations');
    await expect(summarySection).toContainText('Sentiment Analysis');
  });

  // ==================== Error Handling ====================

  test('should handle network errors gracefully', async ({ page }) => {
    // Simulate offline mode
    await page.route('**/api/admin/reviews', (route) => {
      route.abort('failed');
    });

    await page.goto(`${BASE_URL}/admin/reviews`);

    // Should show error message or fallback UI
    const errorMessage = page.locator('[data-testid="error-message"]');

    // Either error message or empty state should be visible
    const hasError = (await errorMessage.count()) > 0;
    const hasEmptyState =
      (await page.locator('text=/No reviews|Error loading/').count()) > 0;

    expect(hasError || hasEmptyState).toBe(true);
  });
});

// ==================== ACCESSIBILITY TESTS ====================

test.describe('Review Moderation Accessibility', () => {
  test('should have accessible Recommendation Summary section', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/ipos/${TEST_IPO_SLUG}`);

    const summarySection = page.locator('[data-testid="recommendation-summary"]');
    await summarySection.scrollIntoViewIfNeeded();

    // Check for semantic HTML
    const heading = summarySection.locator('h2, h3');
    await expect(heading).toBeVisible();

    // Check for ARIA labels on interactive elements
    const viewAllButton = summarySection.locator('a', { hasText: 'View All' });
    const ariaLabel = await viewAllButton.getAttribute('aria-label');

    // Should have accessible label or text
    expect(ariaLabel || (await viewAllButton.textContent())).toBeTruthy();
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reviews`);
    await waitForElement(page, '[data-testid="review-item"]');

    // Tab to approve button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Check that button is focused
    const focusedElement = await page.locator(':focus');
    const tagName = await focusedElement.evaluate((el) => el.tagName);

    expect(['BUTTON', 'A', 'INPUT']).toContain(tagName);
  });
});
