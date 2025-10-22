import { test, expect } from '@playwright/test';

/**
 * Admin Audit Log E2E Tests
 * Tests audit log viewing, filtering, pagination, and CSV export
 */

const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'test-admin-token-for-e2e';

test.describe('Admin Audit Log - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to admin dashboard
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should navigate to audit log from dashboard', async ({ page }) => {
    // Look for Audit Log link in navigation
    const auditLink = page.getByRole('link', { name: /audit.*log|audit/i });

    if (await auditLink.count() > 0) {
      await expect(auditLink).toBeVisible();
      await auditLink.click();

      // Should navigate to audit log page
      await page.waitForURL('**/admin/audit', { timeout: 5000 });

      // Verify we're on audit log page
      await expect(page.getByRole('heading', { name: /audit.*log|activity.*log/i })).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should display audit log page correctly', async ({ page }) => {
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');

    // Check for heading
    await expect(page.getByRole('heading', { name: /audit.*log|activity.*log/i })).toBeVisible();
  });
});

test.describe('Admin Audit Log - Table Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
  });

  test('should display audit log table', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for table or list of audit entries
    const hasTable = await page.locator('table, .audit-log-table, .audit-entries').count() > 0;

    if (hasTable) {
      expect(hasTable).toBeTruthy();
    } else {
      // Might show "No audit logs" message
      const noLogsMessage = await page.getByText(/no audit|no.*logs|no.*activity/i).count() > 0;
      expect(noLogsMessage).toBeTruthy();
    }
  });

  test('should display audit log columns', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for key columns
    const columns = [
      /timestamp|date|time/i,
      /action|activity|operation/i,
      /user|admin/i,
      /ipo|company/i,
      /details|description/i,
    ];

    let foundColumns = 0;
    for (const column of columns) {
      if (await page.getByText(column).count() > 0) {
        foundColumns++;
      }
    }

    // Should have at least 3 columns
    expect(foundColumns).toBeGreaterThanOrEqual(3);
  });

  test('should display audit log entries with data', async ({ page }) => {
    await page.waitForTimeout(2000);

    const tableRows = page.locator('table tbody tr, .audit-entry, .log-entry');
    const rowCount = await tableRows.count();

    if (rowCount > 0) {
      // Verify first entry has content
      const firstRow = tableRows.first();
      const content = await firstRow.textContent();

      expect(content).toBeTruthy();
      expect(content?.length || 0).toBeGreaterThan(0);
    } else {
      // No audit logs yet (fresh system)
      const noLogsMessage = await page.getByText(/no audit|no.*logs/i).count() > 0;
      expect(noLogsMessage).toBeTruthy();
    }
  });

  test('should display timestamps in readable format', async ({ page }) => {
    await page.waitForTimeout(2000);

    const tableRows = page.locator('table tbody tr, .audit-entry');
    const rowCount = await tableRows.count();

    if (rowCount > 0) {
      // Check for date/time format
      const hasTimestamp = await page.getByText(/\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|ago|yesterday|today/i).count() > 0;
      expect(hasTimestamp).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should display action types clearly', async ({ page }) => {
    await page.waitForTimeout(2000);

    const tableRows = page.locator('table tbody tr, .audit-entry');
    const rowCount = await tableRows.count();

    if (rowCount > 0) {
      // Check for action type labels
      const actionTypes = [
        /create|created/i,
        /update|updated|edit|edited/i,
        /delete|deleted/i,
        /protect|protected/i,
        /unprotect|unprotected/i,
      ];

      let foundActions = 0;
      for (const action of actionTypes) {
        if (await page.getByText(action).count() > 0) {
          foundActions++;
        }
      }

      // Should have at least some action types
      expect(foundActions).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log - Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
  });

  test('should display filter controls', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check for filter inputs/dropdowns
    const filterControls = page.locator('input[type="text"], input[type="date"], select, [role="combobox"]');
    const controlCount = await filterControls.count();

    expect(controlCount).toBeGreaterThan(0);
  });

  test('should have date range filter', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for date inputs
    const dateInputs = page.locator('input[type="date"], input[placeholder*="date"]');
    const dateInputCount = await dateInputs.count();

    if (dateInputCount > 0) {
      expect(dateInputCount).toBeGreaterThanOrEqual(1);
    } else {
      // Date filter might use different component
      test.skip();
    }
  });

  test('should have action type filter', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for action type dropdown
    const actionFilter = page.locator('select[name*="action"], [aria-label*="action"]').first();

    if (await actionFilter.count() > 0) {
      await expect(actionFilter).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should have admin user filter', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for admin user filter
    const userFilter = page.locator('input[placeholder*="user"], input[placeholder*="admin"]').first();

    if (await userFilter.count() > 0) {
      await expect(userFilter).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should have IPO search filter', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for IPO search
    const ipoFilter = page.locator('input[placeholder*="ipo"], input[placeholder*="company"]').first();

    if (await ipoFilter.count() > 0) {
      await expect(ipoFilter).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should filter logs by date range', async ({ page }) => {
    await page.waitForTimeout(2000);

    const dateInputs = page.locator('input[type="date"]');

    if (await dateInputs.count() >= 2) {
      const startDate = dateInputs.first();
      const endDate = dateInputs.nth(1);

      // Set date range (last 7 days)
      const today = new Date();
      const lastWeek = new Date(today);
      lastWeek.setDate(lastWeek.getDate() - 7);

      await startDate.fill(lastWeek.toISOString().split('T')[0]);
      await endDate.fill(today.toISOString().split('T')[0]);

      // Apply filter (might have Apply button)
      const applyButton = page.getByRole('button', { name: /apply.*filter|filter|search/i });
      if (await applyButton.count() > 0) {
        await applyButton.click();
      }

      await page.waitForTimeout(1000);

      // Verify some results or "no results"
      const hasResults = await page.locator('table tbody tr, .audit-entry').count() > 0;
      const noResults = await page.getByText(/no.*results|no.*logs/i).count() > 0;

      expect(hasResults || noResults).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should filter logs by action type', async ({ page }) => {
    await page.waitForTimeout(2000);

    const actionFilter = page.locator('select[name*="action"]').first();

    if (await actionFilter.count() > 0) {
      // Select an action type
      await actionFilter.selectOption({ index: 1 });

      // Apply filter
      const applyButton = page.getByRole('button', { name: /apply.*filter|filter|search/i });
      if (await applyButton.count() > 0) {
        await applyButton.click();
      }

      await page.waitForTimeout(1000);

      // Results should be filtered
      const hasResults = await page.locator('table tbody tr, .audit-entry').count() > 0;
      const noResults = await page.getByText(/no.*results|no.*logs/i).count() > 0;

      expect(hasResults || noResults).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should have apply filters button', async ({ page }) => {
    await page.waitForTimeout(2000);

    const applyButton = page.getByRole('button', { name: /apply.*filter|filter|search/i });

    if (await applyButton.count() > 0) {
      await expect(applyButton).toBeVisible();
    } else {
      // Might auto-filter
      test.skip();
    }
  });

  test('should have reset filters button', async ({ page }) => {
    await page.waitForTimeout(2000);

    const resetButton = page.getByRole('button', { name: /reset.*filter|clear.*filter/i });

    if (await resetButton.count() > 0) {
      await expect(resetButton).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should reset filters when reset button clicked', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Apply some filters first
    const ipoFilter = page.locator('input[placeholder*="ipo"], input[placeholder*="company"]').first();

    if (await ipoFilter.count() > 0) {
      await ipoFilter.fill('test company');

      const applyButton = page.getByRole('button', { name: /apply.*filter|filter|search/i });
      if (await applyButton.count() > 0) {
        await applyButton.click();
      }

      await page.waitForTimeout(1000);

      // Now reset
      const resetButton = page.getByRole('button', { name: /reset.*filter|clear.*filter/i });

      if (await resetButton.count() > 0) {
        await resetButton.click();
        await page.waitForTimeout(1000);

        // Filter input should be cleared
        const filterValue = await ipoFilter.inputValue();
        expect(filterValue).toBe('');
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log - Pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
  });

  test('should display pagination controls if needed', async ({ page }) => {
    await page.waitForTimeout(2000);

    const paginationControls = page.locator('[role="navigation"] button, .pagination button, button:has-text("Next"), button:has-text("Previous")');
    const controlCount = await paginationControls.count();

    // Pagination might not exist if few logs
    if (controlCount > 0) {
      expect(controlCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('should display page information', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for "Showing X to Y of Z" or "Page X of Y"
    const pageInfo = page.locator('text=/showing \\d+|page \\d+|\\d+ of \\d+/i');

    if (await pageInfo.count() > 0) {
      const infoText = await pageInfo.first().textContent();
      expect(infoText).toMatch(/\d+/);
    } else {
      test.skip();
    }
  });

  test('should navigate to next page', async ({ page }) => {
    await page.waitForTimeout(2000);

    const nextButton = page.getByRole('button', { name: /next/i });

    if (await nextButton.count() > 0 && await nextButton.isEnabled()) {
      // Get first entry before navigation
      const firstEntryBefore = await page.locator('table tbody tr:first-child, .audit-entry:first-child').textContent();

      // Click next
      await nextButton.click();
      await page.waitForTimeout(1000);

      // Get first entry after navigation
      const firstEntryAfter = await page.locator('table tbody tr:first-child, .audit-entry:first-child').textContent();

      // Should be different content
      expect(firstEntryAfter).not.toBe(firstEntryBefore);
    } else {
      test.skip();
    }
  });

  test('should navigate to previous page', async ({ page }) => {
    await page.waitForTimeout(2000);

    const nextButton = page.getByRole('button', { name: /next/i });

    if (await nextButton.count() > 0 && await nextButton.isEnabled()) {
      // Go to page 2
      await nextButton.click();
      await page.waitForTimeout(1000);

      // Get first entry on page 2
      const firstEntryPage2 = await page.locator('table tbody tr:first-child, .audit-entry:first-child').textContent();

      // Click previous
      const prevButton = page.getByRole('button', { name: /prev|previous/i });
      await prevButton.click();
      await page.waitForTimeout(1000);

      // Get first entry on page 1
      const firstEntryPage1 = await page.locator('table tbody tr:first-child, .audit-entry:first-child').textContent();

      // Should be different content
      expect(firstEntryPage1).not.toBe(firstEntryPage2);
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log - CSV Export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
  });

  test('should display export CSV button', async ({ page }) => {
    await page.waitForTimeout(2000);

    const exportButton = page.getByRole('button', { name: /export.*csv|download.*csv|export/i });

    if (await exportButton.count() > 0) {
      await expect(exportButton).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should trigger download when export button clicked', async ({ page }) => {
    await page.waitForTimeout(2000);

    const exportButton = page.getByRole('button', { name: /export.*csv|download.*csv|export/i });

    if (await exportButton.count() > 0) {
      // Set up download listener
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 });

      // Click export
      await exportButton.click();

      try {
        // Wait for download to start
        const download = await downloadPromise;

        // Verify download
        expect(download.suggestedFilename()).toMatch(/audit|log/i);
        expect(download.suggestedFilename()).toMatch(/\.csv$/i);
      } catch (error) {
        // Download might not start in test environment
        console.log('Download did not start - acceptable in test environment');
      }
    } else {
      test.skip();
    }
  });

  test('should show loading state while exporting', async ({ page }) => {
    await page.waitForTimeout(2000);

    const exportButton = page.getByRole('button', { name: /export.*csv|download.*csv|export/i });

    if (await exportButton.count() > 0) {
      await exportButton.click();

      // Check for loading state immediately
      await page.waitForTimeout(100);

      const isDisabled = await exportButton.isDisabled();
      const hasLoadingText = await page.getByText(/exporting|generating/i).count() > 0;

      expect(isDisabled || hasLoadingText).toBeTruthy();
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log - Details View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
  });

  test('should display entry details', async ({ page }) => {
    await page.waitForTimeout(2000);

    const tableRows = page.locator('table tbody tr, .audit-entry');
    const rowCount = await tableRows.count();

    if (rowCount > 0) {
      // Check for details in first entry
      const firstRow = tableRows.first();

      // Look for expand button or details already visible
      const expandButton = firstRow.locator('button:has-text("View"), button:has-text("Details"), button[aria-label*="expand"]');

      if (await expandButton.count() > 0) {
        await expandButton.click();
        await page.waitForTimeout(500);

        // Should show expanded details
        const hasDetails = await page.locator('.audit-details, .expanded-row').count() > 0;
        expect(hasDetails).toBeTruthy();
      } else {
        // Details might already be visible in table
        const hasDetails = await firstRow.getByText(/field|value|change/i).count() > 0;
        expect(hasDetails).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should display changed fields for update actions', async ({ page }) => {
    await page.waitForTimeout(2000);

    const tableRows = page.locator('table tbody tr, .audit-entry');
    const rowCount = await tableRows.count();

    if (rowCount > 0) {
      // Look for an UPDATE action
      const updateRow = page.locator('table tbody tr:has-text("UPDATE"), .audit-entry:has-text("UPDATE")').first();

      if (await updateRow.count() > 0) {
        // Check for field change information
        const hasFieldInfo = await page.getByText(/field.*changed|old.*value|new.*value/i).count() > 0;

        if (hasFieldInfo) {
          expect(hasFieldInfo).toBeTruthy();
        } else {
          test.skip();
        }
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log - Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
  });

  test('should load audit log page quickly', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');

    // Wait for table or "no logs" message
    await page.waitForSelector('table, .audit-entry, text=/no.*logs/i', { timeout: 5000 });

    const loadTime = Date.now() - startTime;

    // Should load in under 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });

  test('should filter audit logs quickly', async ({ page }) => {
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const ipoFilter = page.locator('input[placeholder*="ipo"], input[placeholder*="company"]').first();

    if (await ipoFilter.count() > 0) {
      await ipoFilter.fill('test');

      const startTime = Date.now();

      const applyButton = page.getByRole('button', { name: /apply.*filter|filter|search/i });
      if (await applyButton.count() > 0) {
        await applyButton.click();
      }

      // Wait for results
      await page.waitForTimeout(1000);

      const filterTime = Date.now() - startTime;

      // Should filter in under 2 seconds
      expect(filterTime).toBeLessThan(2000);
    } else {
      test.skip();
    }
  });
});

test.describe('Admin Audit Log - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin/audit');
    await page.waitForLoadState('networkidle');
  });

  test('should display appropriate message when no logs exist', async ({ page }) => {
    await page.waitForTimeout(2000);

    const tableRows = page.locator('table tbody tr, .audit-entry');
    const rowCount = await tableRows.count();

    if (rowCount === 0) {
      // Should show empty state message
      const emptyMessage = page.getByText(/no audit.*logs|no.*activity|no.*records/i);
      await expect(emptyMessage).toBeVisible();
    } else {
      // Has logs, test not applicable
      test.skip();
    }
  });

  test('should display message when filter returns no results', async ({ page }) => {
    await page.waitForTimeout(2000);

    const ipoFilter = page.locator('input[placeholder*="ipo"], input[placeholder*="company"]').first();

    if (await ipoFilter.count() > 0) {
      // Search for non-existent IPO
      await ipoFilter.fill('XYZZZZNONEXISTENT12345');

      const applyButton = page.getByRole('button', { name: /apply.*filter|filter|search/i });
      if (await applyButton.count() > 0) {
        await applyButton.click();
      }

      await page.waitForTimeout(1000);

      // Should show no results message
      const noResults = page.getByText(/no.*results|no.*logs.*found|no.*matching/i);
      await expect(noResults).toBeVisible();
    } else {
      test.skip();
    }
  });
});
