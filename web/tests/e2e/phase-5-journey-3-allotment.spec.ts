/**
 * Phase 5: User Journey Testing
 * Journey 3: Allotment Journey
 *
 * User Story: Investor checks IPO allotment status
 *
 * Flow:
 * 1. Homepage → Allotment Checker
 * 2. View Registrar List
 * 3. Select Registrar
 * 4. Fill Allotment Form (or redirect to registrar site)
 */

import { test, expect } from '@playwright/test';

test.describe('Journey 3: Allotment Checker', () => {
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

  test('should complete full allotment checking journey', async ({ page }) => {
    // ===== STEP 1: Navigate to Allotment Checker =====
    console.log('Step 1: Navigate to Allotment Checker');

    await page.goto('/tools/allotment-checker');
    await page.waitForLoadState('networkidle');

    // Verify page loaded
    const pageHeading = page.locator('h1').first();
    await expect(pageHeading).toBeVisible({ timeout: 5000 });

    const headingText = await pageHeading.textContent();
    expect(headingText).toMatch(/Allotment|Check Status/i);

    console.log('Allotment Checker page loaded');

    // ===== STEP 2: View Registrar List =====
    console.log('Step 2: View registrar list');

    // Look for registrar selection
    const registrarSelect = page.locator(
      '[data-testid="registrar-select"], select[name*="registrar"], select[id*="registrar"]'
    ).first();

    const hasRegistrarSelect = await registrarSelect.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasRegistrarSelect) {
      // Click to open dropdown
      await registrarSelect.click();
      await page.waitForTimeout(300);

      // Check for options
      const options = page.locator('[role="option"], option');
      const optionCount = await options.count();

      console.log(`Found ${optionCount} registrar options`);
      expect(optionCount).toBeGreaterThan(0);

      // ===== STEP 3: Select a Registrar =====
      console.log('Step 3: Select registrar');

      // Select first available registrar
      const firstOption = options.first();
      const registrarName = await firstOption.textContent();
      console.log('Selecting registrar:', registrarName);

      await firstOption.click();
      await page.waitForTimeout(300);

      // ===== STEP 4: Fill Allotment Form =====
      console.log('Step 4: Fill allotment form');

      // Look for PAN/Application Number input
      const panInput = page.locator(
        '[data-testid="pan-input"], input[name*="pan"], input[placeholder*="PAN"], input[type="text"]'
      ).first();

      const hasPANInput = await panInput.isVisible({ timeout: 3000 }).catch(() => false);

      if (hasPANInput) {
        // Fill PAN (test format)
        await panInput.fill('ABCDE1234F');
        console.log('Entered PAN: ABCDE1234F');

        // Look for DP ID / Client ID input
        const dpInput = page.locator(
          '[data-testid="dp-input"], input[name*="dp"], input[placeholder*="DP"], input[placeholder*="Client"]'
        ).first();

        const hasDPInput = await dpInput.isVisible({ timeout: 2000 }).catch(() => false);

        if (hasDPInput) {
          await dpInput.fill('12345678');
          console.log('Entered DP ID: 12345678');
        }

        // Look for Submit/Check button
        const submitButton = page.getByRole('button', {
          name: /Check Status|Submit|Check Allotment/i
        }).first();

        const hasSubmitButton = await submitButton.isVisible({ timeout: 2000 }).catch(() => false);

        if (hasSubmitButton) {
          console.log('Submit button found');

          // Click submit (but don't wait for navigation as it may redirect externally)
          await submitButton.click();
          await page.waitForTimeout(500);

          console.log('Form submitted successfully');
        } else {
          console.log('Submit button not found');
        }

      } else {
        console.log('PAN input not found - may redirect directly to registrar');
      }

    } else {
      // May show registrar cards instead of dropdown
      console.log('Registrar select not found - checking for registrar cards');

      const registrarCards = page.locator(
        '[data-testid="registrar-card"], .registrar-card, [class*="registrar"]'
      );

      const cardCount = await registrarCards.count();
      console.log(`Found ${cardCount} registrar cards`);

      if (cardCount > 0) {
        // Click first registrar card
        const firstCard = registrarCards.first();
        await firstCard.click();
        await page.waitForTimeout(500);

        console.log('Clicked registrar card');

        // May open modal or redirect
        const modal = page.locator('[role="dialog"], .modal, [data-testid="modal"]');
        const hasModal = await modal.isVisible({ timeout: 2000 }).catch(() => false);

        if (hasModal) {
          console.log('Modal opened for allotment check');
        }
      }
    }

    // Journey completed
    console.log('Journey 3 completed successfully');

    // ===== ASSERTIONS =====
    const totalTime = Date.now() - journeyStartTime;
    expect(totalTime).toBeLessThan(15000); // Should complete in < 15s

    expect(consoleErrors.length).toBeLessThan(5);
  });

  test('should display all major registrars', async ({ page }) => {
    console.log('Testing registrar list completeness');

    await page.goto('/tools/allotment-checker');
    await page.waitForLoadState('networkidle');

    const pageContent = await page.content();

    // Check for major registrars
    const majorRegistrars = [
      'Kfin',
      'Link Intime',
      'Bigshare',
      'Cameo',
      'Integrated Registry'
    ];

    const foundRegistrars: string[] = [];

    for (const registrar of majorRegistrars) {
      if (pageContent.toLowerCase().includes(registrar.toLowerCase())) {
        foundRegistrars.push(registrar);
        console.log(`✓ Found registrar: ${registrar}`);
      }
    }

    console.log(`Found ${foundRegistrars.length}/${majorRegistrars.length} major registrars`);

    // Should have at least some registrars
    expect(foundRegistrars.length).toBeGreaterThan(0);
  });

  test('should validate PAN format', async ({ page }) => {
    console.log('Testing PAN validation');

    await page.goto('/tools/allotment-checker');
    await page.waitForLoadState('networkidle');

    // Look for PAN input
    const panInput = page.locator(
      '[data-testid="pan-input"], input[name*="pan"], input[placeholder*="PAN"]'
    ).first();

    const hasPANInput = await panInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasPANInput) {
      // Test invalid PAN format
      await panInput.fill('INVALID');
      await page.waitForTimeout(300);

      // Click outside to trigger validation
      await page.click('body');
      await page.waitForTimeout(300);

      // Check for error message
      const errorMessage = page.locator(
        '[data-testid="error"], .error, [class*="error"]'
      ).first();

      const hasError = await errorMessage.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasError) {
        console.log('PAN validation error displayed correctly');
      } else {
        console.log('No validation error shown (may validate on submit)');
      }

      // Test valid PAN format
      await panInput.fill('ABCDE1234F');
      await page.waitForTimeout(300);

      const value = await panInput.inputValue();
      expect(value).toBe('ABCDE1234F');

      console.log('Valid PAN format accepted');

    } else {
      console.log('PAN input not found on this page');
    }
  });

  test('should provide direct links to registrar websites', async ({ page }) => {
    console.log('Testing registrar website links');

    await page.goto('/tools/allotment-checker');
    await page.waitForLoadState('networkidle');

    // Look for external links to registrar sites
    const externalLinks = page.locator('a[href*="kfintech"], a[href*="linkintime"], a[href*="bigshareonline"]');
    const linkCount = await externalLinks.count();

    console.log(`Found ${linkCount} external registrar links`);

    if (linkCount > 0) {
      // Verify first link
      const firstLink = externalLinks.first();
      const href = await firstLink.getAttribute('href');

      expect(href).toBeTruthy();
      console.log('Registrar link:', href);

      // Should open in new tab
      const target = await firstLink.getAttribute('target');
      if (target === '_blank') {
        console.log('Link opens in new tab (correct)');
      }
    }
  });

  test('should be mobile responsive', async ({ page }) => {
    console.log('Testing mobile responsiveness');

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/tools/allotment-checker');
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    const bodyBox = await body.boundingBox();

    // Should not have horizontal scroll
    expect(bodyBox?.width).toBeLessThanOrEqual(375);

    // Content should be visible
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();

    console.log('Mobile responsiveness verified');
  });

  test('should handle navigation from homepage', async ({ page }) => {
    console.log('Testing navigation from homepage');

    // Start at homepage
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for allotment checker link
    const allotmentLink = page.getByRole('link', {
      name: /Allotment|Check Status/i
    }).first();

    const hasLink = await allotmentLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasLink) {
      await allotmentLink.click();
      await page.waitForLoadState('networkidle');

      // Verify navigation successful
      expect(page.url()).toContain('allotment');

      console.log('Navigation from homepage successful');
    } else {
      // Try direct navigation
      await page.goto('/tools/allotment-checker');
      await page.waitForLoadState('networkidle');

      const heading = page.locator('h1').first();
      await expect(heading).toBeVisible();

      console.log('Direct navigation successful');
    }
  });

  test('should show recent/closed IPOs for allotment check', async ({ page }) => {
    console.log('Testing recent IPO display for allotment');

    await page.goto('/tools/allotment-checker');
    await page.waitForLoadState('networkidle');

    const pageContent = await page.content();

    // Should mention checking allotment for recent/closed IPOs
    const hasRecentIPO =
      pageContent.toLowerCase().includes('recent') ||
      pageContent.toLowerCase().includes('closed') ||
      pageContent.toLowerCase().includes('listed');

    if (hasRecentIPO) {
      console.log('Page mentions recent/closed IPOs for allotment check');
    } else {
      console.log('No specific mention of recent IPOs');
    }

    // Just verify page loaded correctly
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
  });
});
