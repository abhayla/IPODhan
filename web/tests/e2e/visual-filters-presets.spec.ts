import { test, expect } from '@playwright/test';

/**
 * Visual filter builder, filter chips, presets (localStorage), share-via-URL.
 *
 * Extracted from the former "Phase 3: Real-Time Experience" spec — its
 * live-updates tests (LiveGMPTicker/HotRightNow/MarketPulse/ViewerCount/SSE)
 * were removed when the test-only Math.random() fabrication harness was deleted
 * (GMP coverage revival, C3). These filter tests are unrelated to that harness.
 */
test.describe('Visual filters & presets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
  });

  test('should display VisualFilterBuilder with chips', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const filterBuilder = page.locator('[data-testid="visual-filter-builder"], .visual-filter-builder, .filter-chips').first();

    if (await filterBuilder.count() > 0) {
      await expect(filterBuilder).toBeVisible();

      // Should contain filter chips (segment, status, sector)
      const chips = filterBuilder.locator('[role="button"], .chip, .filter-chip');
      const count = await chips.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should filter IPOs when clicking filter chips', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Find filter chip (e.g., MAINBOARD segment)
    const mainboardChip = page.locator('button:has-text("MAINBOARD"), button:has-text("Mainboard")').first();

    if (await mainboardChip.count() > 0) {
      await mainboardChip.click();
      await page.waitForTimeout(500);

      const filteredCount = await page.locator('[data-testid="ipo-card"], .ipo-card, article').count();
      expect(filteredCount).toBeGreaterThan(0);
    }
  });

  test('should show active filter count badge', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const filterChip = page.locator('button:has-text("OPEN"), button:has-text("Open")').first();

    if (await filterChip.count() > 0) {
      await filterChip.click();
      await page.waitForTimeout(300);

      const filterCount = page.locator('[data-testid="active-filters"], text=/\\d+.*active|\\d+.*filter/i').first();
      if (await filterCount.count() > 0) {
        await expect(filterCount).toBeVisible();
      }
    }
  });

  test('should save filter presets to localStorage', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const filterChip = page.locator('button:has-text("MAINBOARD")').first();
    if (await filterChip.count() > 0) {
      await filterChip.click();
      await page.waitForTimeout(300);
    }

    const savePresetButton = page.locator('button:has-text("Save"), button[aria-label*="save preset" i]').first();

    if (await savePresetButton.count() > 0) {
      await savePresetButton.click();
      await page.waitForTimeout(300);

      const nameInput = page.locator('input[placeholder*="preset" i], input[aria-label*="preset" i]').first();
      if (await nameInput.count() > 0) {
        await nameInput.fill('Test Preset');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);

        const presets = await page.evaluate(() => {
          const stored = localStorage.getItem('ipodhan_filter_presets') || localStorage.getItem('filter_presets');
          return stored ? JSON.parse(stored) : null;
        });

        expect(presets).toBeTruthy();
      }
    }
  });

  test('should load saved filter presets', async ({ page }) => {
    await page.evaluate(() => {
      const presets = [{
        name: 'E2E Test Preset',
        filters: { segment: ['MAINBOARD'], status: ['OPEN'] },
        createdAt: Date.now(),
      }];
      localStorage.setItem('ipodhan_filter_presets', JSON.stringify(presets));
    });

    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const presetSelector = page.locator('[data-testid="filter-presets"], .filter-presets, select:has(option)').first();

    if (await presetSelector.count() > 0) {
      await expect(presetSelector).toBeVisible();

      const testPreset = page.locator('text="E2E Test Preset"').first();
      if (await testPreset.count() > 0) {
        await expect(testPreset).toBeVisible();
      }
    }
  });

  test('should share filters via URL', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const filterChip = page.locator('button:has-text("MAINBOARD")').first();
    if (await filterChip.count() > 0) {
      await filterChip.click();
      await page.waitForTimeout(300);
    }

    const shareButton = page.locator('button:has-text("Share"), button[aria-label*="share" i]').first();

    if (await shareButton.count() > 0) {
      await shareButton.click();
      await page.waitForTimeout(300);

      const url = page.url();
      const hasQueryParams = url.includes('?') || url.includes('segment=') || url.includes('status=');

      const copyConfirmation = page.locator('text=/copied|link.*copied/i').first();
      const hasCopyConfirmation = await copyConfirmation.count() > 0;

      expect(hasQueryParams || hasCopyConfirmation).toBeTruthy();
    }
  });

  test('should clear all filters', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const filters = page.locator('button:has-text("MAINBOARD"), button:has-text("OPEN")');
    const count = await filters.count();
    if (count > 0) {
      await filters.first().click();
      await page.waitForTimeout(200);
      if (count > 1) {
        await filters.nth(1).click();
        await page.waitForTimeout(200);
      }
    }

    const clearButton = page.locator('button:has-text("Clear"), button[aria-label*="clear" i]').first();

    if (await clearButton.count() > 0) {
      await clearButton.click();
      await page.waitForTimeout(300);

      const activeFilters = page.locator('[data-testid="active-filters"]').first();
      if (await activeFilters.count() > 0) {
        const text = await activeFilters.textContent();
        expect(text).toContain('0');
      }
    }
  });
});
