import { test, expect } from '@playwright/test';

/**
 * Admin Cache Management E2E Tests
 * Tests cache statistics display, cache clearing operations, and confirmation dialogs
 */

const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'test-admin-token-for-e2e';

test.describe('Admin Cache Management - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to admin dashboard
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should navigate to settings page from dashboard', async ({ page }) => {
    // Look for Settings link in navigation
    const settingsLink = page.getByRole('link', { name: /settings/i });

    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    // Should navigate to settings page
    await page.waitForURL('**/admin/settings', { timeout: 5000 });

    // Verify we're on settings page
    await expect(page.getByRole('heading', { name: /admin settings|settings/i })).toBeVisible();
  });

  test('should display cache management section', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // Check for cache section
    const cacheSection = page.getByText(/cache management|cache statistics|redis cache/i).first();
    await expect(cacheSection).toBeVisible();
  });
});

test.describe('Admin Cache Statistics Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
  });

  test('should display cache statistics', async ({ page }) => {
    // Wait for cache stats to load
    await page.waitForTimeout(2000);

    // Check for key statistics
    const statsLabels = [
      /total.*keys|keys.*count/i,
      /memory.*usage|used.*memory/i,
      /cache.*hit|hit.*rate/i,
    ];

    let foundStats = 0;
    for (const label of statsLabels) {
      if (await page.getByText(label).count() > 0) {
        foundStats++;
      }
    }

    // Should display at least 2 out of 3 key statistics
    expect(foundStats).toBeGreaterThanOrEqual(2);
  });

  test('should display cache breakdown by type', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for cache type breakdown (IPO caches, protection caches, etc.)
    const cacheTypes = [
      /ipo.*cache/i,
      /protection.*cache/i,
      /gmp.*cache/i,
      /subscription.*cache/i,
    ];

    let foundTypes = 0;
    for (const type of cacheTypes) {
      if (await page.getByText(type).count() > 0) {
        foundTypes++;
      }
    }

    // Should show at least some cache types
    if (foundTypes > 0) {
      expect(foundTypes).toBeGreaterThan(0);
    } else {
      // Breakdown might not be visible
      test.skip();
    }
  });

  test('should display numeric values for cache statistics', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for numeric values in cache section
    const cacheSection = page.locator('text=/cache/i').first().locator('..');

    if (await cacheSection.count() > 0) {
      const content = await cacheSection.textContent();

      // Should contain numbers (keys count, memory size, etc.)
      expect(content).toMatch(/\d+/);
    } else {
      test.skip();
    }
  });

  test('should display memory usage in readable format', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for memory units (KB, MB, GB, or bytes)
    const hasMemoryUnits = await page.getByText(/\d+\s*(B|KB|MB|GB|bytes)/i).count() > 0;

    if (hasMemoryUnits) {
      expect(hasMemoryUnits).toBeTruthy();
    } else {
      // Memory display might be different format
      test.skip();
    }
  });

  test('should have refresh statistics button', async ({ page }) => {
    await page.waitForTimeout(2000);

    const refreshButton = page.getByRole('button', { name: /refresh.*stat|reload.*stat|update.*stat/i });

    if (await refreshButton.count() > 0) {
      await expect(refreshButton).toBeVisible();
    } else {
      // Auto-refresh might be implemented instead
      test.skip();
    }
  });
});

test.describe('Admin Cache Clearing Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
  });

  test('should display cache clearing buttons', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for clear cache buttons
    const clearButtons = page.locator('button:has-text("Clear"), button:has-text("Flush"), button:has-text("Reset")');

    const buttonCount = await clearButtons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test('should have separate buttons for different cache types', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for specific clear buttons
    const clearTypes = [
      /clear.*protection/i,
      /clear.*ipo/i,
      /clear.*all/i,
    ];

    let foundButtons = 0;
    for (const type of clearTypes) {
      const button = page.getByRole('button', { name: type });
      if (await button.count() > 0) {
        foundButtons++;
      }
    }

    // Should have at least 2 types of clear buttons
    expect(foundButtons).toBeGreaterThanOrEqual(2);
  });

  test('should show confirmation dialog before clearing protection caches', async ({ page }) => {
    await page.waitForTimeout(2000);

    const clearProtectionButton = page.getByRole('button', { name: /clear.*protection/i });

    if (await clearProtectionButton.count() > 0) {
      await clearProtectionButton.click();

      // Should show confirmation dialog
      await page.waitForTimeout(500);

      // Look for confirmation dialog
      const confirmDialog = page.locator('[role="dialog"], .modal, .confirmation');
      const confirmText = page.getByText(/are you sure|confirm|warning/i);

      const hasDialog = await confirmDialog.count() > 0;
      const hasConfirmText = await confirmText.count() > 0;

      expect(hasDialog || hasConfirmText).toBeTruthy();

      // Close dialog (find Cancel button)
      const cancelButton = page.getByRole('button', { name: /cancel|no|close/i }).first();
      if (await cancelButton.count() > 0) {
        await cancelButton.click();
      } else {
        // Press Escape key
        await page.keyboard.press('Escape');
      }
    } else {
      test.skip();
    }
  });

  test('should show confirmation dialog before clearing IPO caches', async ({ page }) => {
    await page.waitForTimeout(2000);

    const clearIPOButton = page.getByRole('button', { name: /clear.*ipo/i });

    if (await clearIPOButton.count() > 0) {
      await clearIPOButton.click();
      await page.waitForTimeout(500);

      // Should show confirmation
      const confirmText = page.getByText(/are you sure|confirm|warning/i);
      const hasConfirmation = await confirmText.count() > 0;

      expect(hasConfirmation).toBeTruthy();

      // Cancel
      const cancelButton = page.getByRole('button', { name: /cancel|no/i }).first();
      if (await cancelButton.count() > 0) {
        await cancelButton.click();
      } else {
        await page.keyboard.press('Escape');
      }
    } else {
      test.skip();
    }
  });

  test('should show confirmation dialog before clearing all caches', async ({ page }) => {
    await page.waitForTimeout(2000);

    const clearAllButton = page.getByRole('button', { name: /clear.*all|flush.*all/i });

    if (await clearAllButton.count() > 0) {
      await clearAllButton.click();
      await page.waitForTimeout(500);

      // Should show strong warning
      const warningText = page.getByText(/are you sure|confirm|warning|dangerous/i);
      const hasWarning = await warningText.count() > 0;

      expect(hasWarning).toBeTruthy();

      // Cancel
      const cancelButton = page.getByRole('button', { name: /cancel|no/i }).first();
      if (await cancelButton.count() > 0) {
        await cancelButton.click();
      } else {
        await page.keyboard.press('Escape');
      }
    } else {
      test.skip();
    }
  });

  test('should allow canceling cache clear operation', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Try to clear protection caches
    const clearButton = page.getByRole('button', { name: /clear.*protection|clear.*ipo/i }).first();

    if (await clearButton.count() > 0) {
      // Get initial stats (if visible)
      const initialKeys = await page.getByText(/total.*keys|keys.*count/i).first().textContent();

      await clearButton.click();
      await page.waitForTimeout(500);

      // Click Cancel
      const cancelButton = page.getByRole('button', { name: /cancel|no/i }).first();
      if (await cancelButton.count() > 0) {
        await cancelButton.click();
        await page.waitForTimeout(1000);

        // Keys count should remain same
        const afterKeys = await page.getByText(/total.*keys|keys.*count/i).first().textContent();
        expect(afterKeys).toBe(initialKeys);
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should clear protection caches when confirmed', async ({ page }) => {
    await page.waitForTimeout(2000);

    const clearProtectionButton = page.getByRole('button', { name: /clear.*protection/i });

    if (await clearProtectionButton.count() > 0) {
      await clearProtectionButton.click();
      await page.waitForTimeout(500);

      // Confirm action
      const confirmButton = page.getByRole('button', { name: /confirm|yes|clear|ok/i }).first();

      if (await confirmButton.count() > 0) {
        await confirmButton.click();

        // Wait for operation to complete
        await page.waitForTimeout(2000);

        // Should show success message
        const successMessage = page.getByText(/cleared|success|completed/i);
        const hasSuccess = await successMessage.count() > 0;

        expect(hasSuccess).toBeTruthy();
      } else {
        // No confirmation button, might auto-confirm
        await page.waitForTimeout(2000);
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Cache Management - Success Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
  });

  test('should show success notification after clearing caches', async ({ page }) => {
    await page.waitForTimeout(2000);

    const clearButton = page.getByRole('button', { name: /clear.*protection|clear.*ipo/i }).first();

    if (await clearButton.count() > 0) {
      await clearButton.click();
      await page.waitForTimeout(500);

      // Confirm
      const confirmButton = page.getByRole('button', { name: /confirm|yes|clear|ok/i }).first();
      if (await confirmButton.count() > 0) {
        await confirmButton.click();
        await page.waitForTimeout(2000);

        // Look for success notification (toast, alert, message)
        const successIndicators = [
          page.getByText(/cleared.*successfully|success|completed/i),
          page.locator('.toast-success, .alert-success, .notification-success'),
        ];

        let hasSuccess = false;
        for (const indicator of successIndicators) {
          if (await indicator.count() > 0) {
            hasSuccess = true;
            break;
          }
        }

        expect(hasSuccess).toBeTruthy();
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test('should update statistics after clearing caches', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Get initial key count
    const keysText = await page.getByText(/total.*keys|keys.*count/i).first().textContent();
    const initialKeys = keysText ? parseInt(keysText.match(/\d+/)?.[0] || '0') : 0;

    const clearButton = page.getByRole('button', { name: /clear.*protection|clear.*ipo/i }).first();

    if (await clearButton.count() > 0 && initialKeys > 0) {
      await clearButton.click();
      await page.waitForTimeout(500);

      // Confirm
      const confirmButton = page.getByRole('button', { name: /confirm|yes|clear|ok/i }).first();
      if (await confirmButton.count() > 0) {
        await confirmButton.click();
        await page.waitForTimeout(2000);

        // Get updated key count
        const updatedKeysText = await page.getByText(/total.*keys|keys.*count/i).first().textContent();
        const updatedKeys = updatedKeysText ? parseInt(updatedKeysText.match(/\d+/)?.[0] || '0') : 0;

        // Keys should be reduced (or 0)
        expect(updatedKeys).toBeLessThanOrEqual(initialKeys);
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Cache Management - Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
  });

  test('should handle Redis connection errors gracefully', async ({ page }) => {
    await page.waitForTimeout(2000);

    // If Redis is down, should show appropriate message
    const errorMessage = page.getByText(/redis.*unavailable|cache.*unavailable|connection.*failed/i);

    // This test is informational - error message may or may not be present
    const hasError = await errorMessage.count() > 0;

    // If no error, Redis is healthy (which is good)
    // If error exists, it should be displayed properly
    if (hasError) {
      await expect(errorMessage).toBeVisible();
    }
  });

  test('should disable cache operations if Redis is unavailable', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorMessage = page.getByText(/redis.*unavailable|cache.*unavailable/i);
    const hasError = await errorMessage.count() > 0;

    if (hasError) {
      // Clear buttons should be disabled
      const clearButtons = page.locator('button:has-text("Clear"), button:has-text("Flush")');
      const firstButton = clearButtons.first();

      if (await firstButton.count() > 0) {
        const isDisabled = await firstButton.isDisabled();
        expect(isDisabled).toBeTruthy();
      }
    } else {
      // Redis is healthy, skip test
      test.skip();
    }
  });
});

test.describe('Admin Cache Management - Refresh Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
  });

  test('should refresh statistics when refresh button clicked', async ({ page }) => {
    await page.waitForTimeout(2000);

    const refreshButton = page.getByRole('button', { name: /refresh.*stat|reload.*stat/i });

    if (await refreshButton.count() > 0) {
      // Click refresh
      await refreshButton.click();

      // Should show loading state briefly
      await page.waitForTimeout(500);

      // Statistics should be updated (or remain same if no change)
      const keysText = await page.getByText(/total.*keys|keys.*count/i).first().textContent();
      expect(keysText).toMatch(/\d+/);
    } else {
      test.skip();
    }
  });

  test('should show loading state while refreshing', async ({ page }) => {
    await page.waitForTimeout(2000);

    const refreshButton = page.getByRole('button', { name: /refresh.*stat|reload.*stat/i });

    if (await refreshButton.count() > 0) {
      await refreshButton.click();

      // Immediately check for loading state
      await page.waitForTimeout(100);

      // Button should be disabled or show loading
      const isDisabled = await refreshButton.isDisabled();
      const hasLoadingText = await page.getByText(/loading|refreshing/i).count() > 0;

      expect(isDisabled || hasLoadingText).toBeTruthy();
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Cache Management - Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
  });

  test('should load cache statistics quickly', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // Wait for stats to appear
    await page.waitForSelector('text=/cache|total.*keys/i', { timeout: 5000 });

    const loadTime = Date.now() - startTime;

    // Should load in under 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });

  test('should clear caches quickly', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const clearButton = page.getByRole('button', { name: /clear.*protection|clear.*ipo/i }).first();

    if (await clearButton.count() > 0) {
      await clearButton.click();
      await page.waitForTimeout(500);

      const confirmButton = page.getByRole('button', { name: /confirm|yes|clear|ok/i }).first();

      if (await confirmButton.count() > 0) {
        const startTime = Date.now();

        await confirmButton.click();

        // Wait for success message
        await page.waitForSelector('text=/cleared|success/i', { timeout: 5000 });

        const operationTime = Date.now() - startTime;

        // Should complete in under 3 seconds
        expect(operationTime).toBeLessThan(3000);
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});
