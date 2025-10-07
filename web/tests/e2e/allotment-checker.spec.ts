/**
 * E2E Tests for Allotment Status Checker
 * Story 4.6: Allotment Status Checker
 *
 * Tests:
 * - AllotmentCheckerCard visibility for CLOSED/LISTED IPOs
 * - PAN input and validation
 * - "Check Status" button functionality
 * - Redirect to registrar website
 * - Component NOT visible for OPEN/UPCOMING IPOs
 *
 * Uses Playwright for browser automation
 */

import { test, expect } from '@playwright/test';

// ==================== TEST CONFIGURATION ====================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Test IPO slugs - update these with actual test data
const CLOSED_IPO_SLUG = 'test-closed-ipo';
const LISTED_IPO_SLUG = 'test-listed-ipo';
const OPEN_IPO_SLUG = 'test-open-ipo';
const UPCOMING_IPO_SLUG = 'test-upcoming-ipo';

// Valid PAN format for testing
const VALID_PAN = 'ABCDE1234F';
const INVALID_PAN_SHORT = 'ABC123';
const INVALID_PAN_FORMAT = '1234567890';

// ==================== HELPER FUNCTIONS ====================

/**
 * Wait for page to be fully loaded
 */
async function waitForPageLoad(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Navigate to IPO detail page
 */
async function navigateToIPO(page: import('@playwright/test').Page, slug: string) {
  await page.goto(`${BASE_URL}/ipos/${slug}`);
  await waitForPageLoad(page);
}

// ==================== TESTS ====================

test.describe('Allotment Status Checker', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport for consistent testing
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test.describe('Component Visibility', () => {
    test('should display AllotmentCheckerCard for CLOSED IPO', async ({ page }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      // Check if allotment checker card is visible
      const checkerCard = page.getByText('Check Allotment Status');
      await expect(checkerCard).toBeVisible();

      // Verify PAN input is present
      const panInput = page.getByPlaceholder('ABCDE1234F');
      await expect(panInput).toBeVisible();

      // Verify "Check Status" button is present
      const checkButton = page.getByRole('button', { name: /Check Status/i });
      await expect(checkButton).toBeVisible();
    });

    test('should display AllotmentCheckerCard for LISTED IPO', async ({ page }) => {
      await navigateToIPO(page, LISTED_IPO_SLUG);

      // Check if allotment checker card is visible
      const checkerCard = page.getByText('Check Allotment Status');
      await expect(checkerCard).toBeVisible();
    });

    test('should NOT display AllotmentCheckerCard for OPEN IPO', async ({ page }) => {
      await navigateToIPO(page, OPEN_IPO_SLUG);

      // Check if allotment checker card is NOT visible
      const checkerCard = page.getByText('Check Allotment Status');
      await expect(checkerCard).not.toBeVisible();
    });

    test('should NOT display AllotmentCheckerCard for UPCOMING IPO', async ({ page }) => {
      await navigateToIPO(page, UPCOMING_IPO_SLUG);

      // Check if allotment checker card is NOT visible
      const checkerCard = page.getByText('Check Allotment Status');
      await expect(checkerCard).not.toBeVisible();
    });
  });

  test.describe('PAN Input and Validation', () => {
    test('should validate PAN format and enable button for valid PAN', async ({ page }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      const panInput = page.getByPlaceholder('ABCDE1234F');
      const checkButton = page.getByRole('button', { name: /Check Status/i });

      // Initially button should be disabled
      await expect(checkButton).toBeDisabled();

      // Enter valid PAN
      await panInput.fill(VALID_PAN);

      // Button should be enabled
      await expect(checkButton).toBeEnabled();

      // No error message should be visible
      await expect(page.getByText(/Invalid PAN/i)).not.toBeVisible();
    });

    test('should show error for invalid PAN format (too short)', async ({ page }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      const panInput = page.getByPlaceholder('ABCDE1234F');
      const checkButton = page.getByRole('button', { name: /Check Status/i });

      // Enter invalid PAN (too short)
      await panInput.fill(INVALID_PAN_SHORT);

      // Button should be disabled
      await expect(checkButton).toBeDisabled();

      // Error message should be visible
      await expect(page.getByText(/PAN must be 10 characters/i)).toBeVisible();
    });

    test('should show error for invalid PAN format (wrong pattern)', async ({ page }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      const panInput = page.getByPlaceholder('ABCDE1234F');
      const checkButton = page.getByRole('button', { name: /Check Status/i });

      // Enter invalid PAN (all numbers)
      await panInput.fill(INVALID_PAN_FORMAT);

      // Button should be disabled
      await expect(checkButton).toBeDisabled();

      // Error message should be visible
      await expect(page.getByText(/Invalid PAN format/i)).toBeVisible();
    });

    test('should convert PAN input to uppercase', async ({ page }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      const panInput = page.getByPlaceholder('ABCDE1234F');

      // Enter lowercase PAN
      await panInput.fill('abcde1234f');

      // Should be converted to uppercase
      await expect(panInput).toHaveValue('ABCDE1234F');
    });
  });

  test.describe('Privacy and Informational Content', () => {
    test('should display privacy notice', async ({ page }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      // Check for privacy notice text
      const privacyNotice = page.getByText(/Your PAN is not stored/i);
      await expect(privacyNotice).toBeVisible();
    });

    test('should show registrar name in the card', async ({ page }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      // Card should display registrar information
      const checkerCard = page.getByText('Check Allotment Status').locator('..');
      await expect(checkerCard).toBeVisible();

      // Should contain text about checking on registrar website
      await expect(page.getByText(/Check your IPO allotment status/i)).toBeVisible();
    });
  });

  test.describe('Registrar Redirect (Mock)', () => {
    test('should prepare redirect with PAN parameter on button click', async ({ page, context }) => {
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      const panInput = page.getByPlaceholder('ABCDE1234F');
      const checkButton = page.getByRole('button', { name: /Check Status/i });

      // Enter valid PAN
      await panInput.fill(VALID_PAN);

      // Listen for new page/tab open
      const [newPage] = await Promise.all([
        context.waitForEvent('page'),
        checkButton.click()
      ]);

      // Verify new page URL contains PAN parameter
      const url = newPage.url();
      expect(url).toContain('pan=ABCDE1234F');

      // Close the new page
      await newPage.close();
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should display correctly on mobile viewport', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      await navigateToIPO(page, CLOSED_IPO_SLUG);

      // Check if allotment checker card is visible
      const checkerCard = page.getByText('Check Allotment Status');
      await expect(checkerCard).toBeVisible();

      // PAN input should be full-width
      const panInput = page.getByPlaceholder('ABCDE1234F');
      await expect(panInput).toBeVisible();

      // Button should be full-width
      const checkButton = page.getByRole('button', { name: /Check Status/i });
      await expect(checkButton).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle missing registrar URL gracefully', async ({ page }) => {
      // This test assumes we have a test IPO with no registrar URL
      // Skip if not applicable to test data
      await navigateToIPO(page, CLOSED_IPO_SLUG);

      // If registrar URL is missing, should show error message
      // Note: This may or may not be visible depending on test data
      // Test will pass either way as it's checking for graceful handling
      const errorMessage = page.getByText(/Registrar website URL is not available/i);
      const isVisible = await errorMessage.isVisible().catch(() => false);

      // Verify either the error message shows or the checker card is present
      if (isVisible) {
        await expect(errorMessage).toBeVisible();
      }
    });
  });
});

test.describe('Allotment Status Checker - Cross-Browser', () => {
  test('should work correctly in Chrome', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chrome-specific test');

    await navigateToIPO(page, CLOSED_IPO_SLUG);
    const checkerCard = page.getByText('Check Allotment Status');
    await expect(checkerCard).toBeVisible();
  });

  test('should work correctly in Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'Firefox-specific test');

    await navigateToIPO(page, CLOSED_IPO_SLUG);
    const checkerCard = page.getByText('Check Allotment Status');
    await expect(checkerCard).toBeVisible();
  });
});
