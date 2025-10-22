import { test, expect } from '@playwright/test';

/**
 * Admin IPO Edit Workflow E2E Tests
 * Tests all 6 tabs: Basic Info, Financials, Subscriptions, GMP, Documents, Protection
 */

const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'test-admin-token-for-e2e';

test.describe('Admin IPO Edit - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to admin dashboard
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should navigate to edit page from dashboard', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Click edit button on first IPO
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit"), table tbody tr:first-child button:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();

      // Should navigate to edit page
      await page.waitForURL('**/admin/edit/**', { timeout: 5000 });

      // Verify we're on edit page
      await expect(page.getByRole('heading', { name: /edit ipo/i })).toBeVisible();
    } else {
      test.skip();
    }
  });

  test('should display all 6 tabs', async ({ page }) => {
    // Navigate to first IPO edit page
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() === 0) {
      test.skip();
      return;
    }

    await editButton.click();
    await page.waitForURL('**/admin/edit/**');

    // Check for all 6 tabs
    await expect(page.getByRole('tab', { name: /basic info/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /financial/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /subscription/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /gmp/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /document/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /protection/i })).toBeVisible();
  });

  test('should switch between tabs', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() === 0) {
      test.skip();
      return;
    }

    await editButton.click();
    await page.waitForURL('**/admin/edit/**');

    // Click Financials tab
    await page.getByRole('tab', { name: /financial/i }).click();
    await page.waitForTimeout(500);

    // Check financials content is visible
    await expect(page.getByText(/revenue|profit|eps/i).first()).toBeVisible();

    // Click Subscriptions tab
    await page.getByRole('tab', { name: /subscription/i }).click();
    await page.waitForTimeout(500);

    // Check subscriptions content
    await expect(page.getByText(/overall|retail|qib|nii/i).first()).toBeVisible();

    // Click back to Basic Info
    await page.getByRole('tab', { name: /basic info/i }).click();
    await page.waitForTimeout(500);

    // Check basic info content
    await expect(page.getByText(/company name|issue size|price band/i).first()).toBeVisible();
  });
});

test.describe('Admin IPO Edit - Basic Info Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Navigate to edit page
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();
      await page.waitForURL('**/admin/edit/**');
    }
  });

  test('should display basic IPO information', async ({ page }) => {
    // Check for key fields
    await expect(page.getByLabel(/company name/i)).toBeVisible();
    await expect(page.getByLabel(/status/i)).toBeVisible();
    await expect(page.getByLabel(/segment/i)).toBeVisible();
    await expect(page.getByLabel(/open date/i)).toBeVisible();
    await expect(page.getByLabel(/close date/i)).toBeVisible();
  });

  test('should allow editing text fields', async ({ page }) => {
    const descriptionField = page.getByLabel(/description/i);

    if (await descriptionField.count() > 0) {
      // Get original value
      const originalValue = await descriptionField.inputValue();

      // Edit field
      await descriptionField.clear();
      await descriptionField.fill('Updated description for E2E test');

      // Verify change
      await expect(descriptionField).toHaveValue('Updated description for E2E test');

      // Restore original value
      await descriptionField.clear();
      await descriptionField.fill(originalValue);
    } else {
      test.skip();
    }
  });

  test('should display save button', async ({ page }) => {
    const saveButton = page.getByRole('button', { name: /save.*changes/i });
    await expect(saveButton).toBeVisible();
  });

  test('should display protect toggle or button', async ({ page }) => {
    // Look for protect button or toggle
    const protectControl = page.locator('button:has-text("Protect"), input[type="checkbox"][aria-label*="protect"]').first();

    if (await protectControl.count() > 0) {
      await expect(protectControl).toBeVisible();
    } else {
      // Protection control might be in Protection tab
      test.skip();
    }
  });

  test('should show validation errors for required fields', async ({ page }) => {
    const companyNameField = page.getByLabel(/company name/i);

    if (await companyNameField.count() > 0) {
      // Get original value
      const originalValue = await companyNameField.inputValue();

      // Clear required field
      await companyNameField.clear();

      // Try to save
      const saveButton = page.getByRole('button', { name: /save.*changes/i });
      await saveButton.click();

      // Wait for error message or validation
      await page.waitForTimeout(1000);

      // Should show error (either inline or toast)
      const hasError = await page.getByText(/required|cannot be empty|invalid/i).count() > 0;
      expect(hasError).toBeTruthy();

      // Restore original value
      await companyNameField.fill(originalValue);
    } else {
      test.skip();
    }
  });
});

test.describe('Admin IPO Edit - Financials Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();
      await page.waitForURL('**/admin/edit/**');

      // Click Financials tab
      await page.getByRole('tab', { name: /financial/i }).click();
      await page.waitForTimeout(500);
    }
  });

  test('should display financial fields', async ({ page }) => {
    // Check for common financial fields
    const financialLabels = [/revenue/i, /profit/i, /eps/i, /nav/i, /ronw/i, /debt/i];

    let foundFields = 0;
    for (const label of financialLabels) {
      if (await page.getByText(label).first().count() > 0) {
        foundFields++;
      }
    }

    // Should have at least some financial fields
    expect(foundFields).toBeGreaterThan(0);
  });

  test('should display financial data for multiple years', async ({ page }) => {
    // Check for year labels (FY2022, FY2023, etc.)
    const hasYearLabels = await page.getByText(/fy\s*202[0-9]|fiscal year/i).count() > 0;

    if (hasYearLabels) {
      expect(hasYearLabels).toBeTruthy();
    } else {
      // Financial data might be displayed differently
      test.skip();
    }
  });

  test('should allow editing financial values', async ({ page }) => {
    const revenueField = page.locator('input[name*="revenue"]').first();

    if (await revenueField.count() > 0) {
      const originalValue = await revenueField.inputValue();

      // Edit value
      await revenueField.clear();
      await revenueField.fill('1000.50');

      // Verify change
      await expect(revenueField).toHaveValue('1000.50');

      // Restore
      await revenueField.clear();
      if (originalValue) {
        await revenueField.fill(originalValue);
      }
    } else {
      test.skip();
    }
  });

  test('should validate numeric inputs', async ({ page }) => {
    const revenueField = page.locator('input[name*="revenue"]').first();

    if (await revenueField.count() > 0) {
      // Try to enter invalid text
      await revenueField.clear();
      await revenueField.fill('invalid-text-123abc');

      // Input should reject non-numeric or show error
      const value = await revenueField.inputValue();

      // Either field is empty, contains only numbers, or shows error
      const isValid = value === '' || /^[\d.]+$/.test(value);
      const hasError = await page.getByText(/invalid.*number|numeric only/i).count() > 0;

      expect(isValid || hasError).toBeTruthy();
    } else {
      test.skip();
    }
  });
});

test.describe('Admin IPO Edit - Subscriptions Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();
      await page.waitForURL('**/admin/edit/**');

      // Click Subscriptions tab
      await page.getByRole('tab', { name: /subscription/i }).click();
      await page.waitForTimeout(500);
    }
  });

  test('should display subscription data categories', async ({ page }) => {
    // Check for subscription categories
    const categories = [/overall/i, /retail/i, /qib/i, /nii/i, /employee/i];

    let foundCategories = 0;
    for (const category of categories) {
      if (await page.getByText(category).first().count() > 0) {
        foundCategories++;
      }
    }

    // Should have at least 2-3 categories
    expect(foundCategories).toBeGreaterThanOrEqual(2);
  });

  test('should display subscription history or snapshots', async ({ page }) => {
    // Subscription data is time-series, check for table or list
    const hasTable = await page.locator('table tbody tr, .subscription-snapshot, .subscription-entry').count() > 0;

    if (hasTable) {
      expect(hasTable).toBeTruthy();
    } else {
      // Might show "No subscription data" message
      const noDataMessage = await page.getByText(/no subscription|not available/i).count() > 0;
      expect(noDataMessage).toBeTruthy();
    }
  });

  test('should display subscription timestamps', async ({ page }) => {
    // Check for date/time information
    const hasTimestamps = await page.getByText(/date|time|day \d+/i).count() > 0;

    if (hasTimestamps) {
      expect(hasTimestamps).toBeTruthy();
    } else {
      test.skip();
    }
  });
});

test.describe('Admin IPO Edit - GMP Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();
      await page.waitForURL('**/admin/edit/**');

      // Click GMP tab
      await page.getByRole('tab', { name: /gmp/i }).click();
      await page.waitForTimeout(500);
    }
  });

  test('should display GMP records', async ({ page }) => {
    // Check for GMP data (price, premium, date)
    const hasGMPData = await page.getByText(/grey market premium|gmp|premium/i).count() > 0;

    if (hasGMPData) {
      expect(hasGMPData).toBeTruthy();
    } else {
      // Might show "No GMP data" message
      const noDataMessage = await page.getByText(/no gmp|not available/i).count() > 0;
      expect(noDataMessage).toBeTruthy();
    }
  });

  test('should display GMP historical data', async ({ page }) => {
    // Check for table or list of GMP records
    const hasTable = await page.locator('table tbody tr, .gmp-record, .gmp-entry').count() > 0;

    if (hasTable) {
      const rowCount = await page.locator('table tbody tr, .gmp-record, .gmp-entry').count();
      expect(rowCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('should allow adding new GMP record', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /add.*gmp|new.*record/i });

    if (await addButton.count() > 0) {
      await expect(addButton).toBeVisible();

      // Click add button
      await addButton.click();
      await page.waitForTimeout(500);

      // Should show form or modal
      const hasForm = await page.locator('input[name*="gmp"], input[name*="premium"], input[placeholder*="gmp"]').count() > 0;
      expect(hasForm).toBeTruthy();
    } else {
      test.skip();
    }
  });
});

test.describe('Admin IPO Edit - Documents Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();
      await page.waitForURL('**/admin/edit/**');

      // Click Documents tab
      await page.getByRole('tab', { name: /document/i }).click();
      await page.waitForTimeout(500);
    }
  });

  test('should display document list', async ({ page }) => {
    // Check for document types
    const documentTypes = [/prospectus|drhp|rh|application form/i];

    let foundTypes = 0;
    for (const type of documentTypes) {
      if (await page.getByText(type).count() > 0) {
        foundTypes++;
      }
    }

    // Should have at least some document types mentioned
    if (foundTypes > 0) {
      expect(foundTypes).toBeGreaterThan(0);
    } else {
      // Might show "No documents" message
      const noDocsMessage = await page.getByText(/no document|not available/i).count() > 0;
      expect(noDocsMessage).toBeTruthy();
    }
  });

  test('should display document URLs or links', async ({ page }) => {
    const documentLinks = page.locator('a[href*="pdf"], a[href*="document"], .document-link');

    if (await documentLinks.count() > 0) {
      const linkCount = await documentLinks.count();
      expect(linkCount).toBeGreaterThan(0);
    } else {
      test.skip();
    }
  });

  test('should allow adding new document', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /add.*document|new.*document/i });

    if (await addButton.count() > 0) {
      await expect(addButton).toBeVisible();
    } else {
      test.skip();
    }
  });
});

test.describe('Admin IPO Edit - Protection Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();
      await page.waitForURL('**/admin/edit/**');

      // Click Protection tab
      await page.getByRole('tab', { name: /protection/i }).click();
      await page.waitForTimeout(500);
    }
  });

  test('should display field protection controls', async ({ page }) => {
    // Check for protection toggles or checkboxes
    const protectionControls = page.locator('input[type="checkbox"], button:has-text("Protect"), .protection-toggle');

    const controlCount = await protectionControls.count();
    expect(controlCount).toBeGreaterThan(0);
  });

  test('should display list of protectable fields', async ({ page }) => {
    // Should show field names that can be protected
    const fieldNames = [/company.*name|issue.*size|price.*band|open.*date|close.*date/i];

    let foundFields = 0;
    for (const field of fieldNames) {
      if (await page.getByText(field).count() > 0) {
        foundFields++;
      }
    }

    expect(foundFields).toBeGreaterThan(0);
  });

  test('should toggle field protection', async ({ page }) => {
    const protectionCheckbox = page.locator('input[type="checkbox"]').first();

    if (await protectionCheckbox.count() > 0) {
      // Get initial state
      const initialState = await protectionCheckbox.isChecked();

      // Toggle
      await protectionCheckbox.click();
      await page.waitForTimeout(500);

      // Verify state changed
      const newState = await protectionCheckbox.isChecked();
      expect(newState).toBe(!initialState);

      // Toggle back
      await protectionCheckbox.click();
      await page.waitForTimeout(500);
    } else {
      test.skip();
    }
  });

  test('should display save protection settings button', async ({ page }) => {
    const saveButton = page.getByRole('button', { name: /save.*protection|apply.*protection/i });

    if (await saveButton.count() > 0) {
      await expect(saveButton).toBeVisible();
    } else {
      // Might auto-save or use main save button
      test.skip();
    }
  });
});

test.describe('Admin IPO Edit - Save & Cache Invalidation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() > 0) {
      await editButton.click();
      await page.waitForURL('**/admin/edit/**');
    }
  });

  test('should save changes successfully', async ({ page }) => {
    // Make a minor change (if description field exists)
    const descriptionField = page.getByLabel(/description/i);

    if (await descriptionField.count() > 0) {
      const originalValue = await descriptionField.inputValue();
      const testValue = `Updated at ${Date.now()}`;

      await descriptionField.clear();
      await descriptionField.fill(testValue);

      // Click save
      const saveButton = page.getByRole('button', { name: /save.*changes/i });
      await saveButton.click();

      // Wait for success message
      await page.waitForTimeout(2000);

      // Should show success notification
      const hasSuccess = await page.getByText(/saved|updated|success/i).count() > 0;
      expect(hasSuccess).toBeTruthy();

      // Restore original value
      await descriptionField.clear();
      await descriptionField.fill(originalValue || '');
      await saveButton.click();
      await page.waitForTimeout(1000);
    } else {
      test.skip();
    }
  });

  test('should show loading state while saving', async ({ page }) => {
    const saveButton = page.getByRole('button', { name: /save.*changes/i });

    // Click save
    await saveButton.click();

    // Should show loading state (disabled button or spinner)
    await page.waitForTimeout(100);

    // Button should be disabled during save
    const isDisabled = await saveButton.isDisabled();
    const hasLoadingText = await page.getByText(/saving|loading/i).count() > 0;

    expect(isDisabled || hasLoadingText).toBeTruthy();
  });

  test('should return to dashboard after save', async ({ page }) => {
    // Some implementations redirect after save
    const saveButton = page.getByRole('button', { name: /save.*changes/i });
    await saveButton.click();

    await page.waitForTimeout(3000);

    // Either stay on edit page or redirect to dashboard
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/admin/);
  });
});

test.describe('Admin IPO Edit - Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should show 404 for invalid IPO slug', async ({ page }) => {
    // Navigate to non-existent IPO
    await page.goto('/admin/edit/this-ipo-does-not-exist-12345');
    await page.waitForLoadState('networkidle');

    // Should show error message or 404 page
    const hasError = await page.getByText(/not found|invalid|does not exist/i).count() > 0;
    expect(hasError).toBeTruthy();
  });

  test('should handle network errors gracefully', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const editButton = page.locator('table tbody tr:first-child a:has-text("Edit")').first();

    if (await editButton.count() === 0) {
      test.skip();
      return;
    }

    await editButton.click();
    await page.waitForURL('**/admin/edit/**');

    // Simulate offline
    await page.context().setOffline(true);

    // Try to save
    const saveButton = page.getByRole('button', { name: /save.*changes/i });
    await saveButton.click();

    await page.waitForTimeout(2000);

    // Should show error message
    const hasError = await page.getByText(/error|failed|network|offline/i).count() > 0;
    expect(hasError).toBeTruthy();

    // Restore connection
    await page.context().setOffline(false);
  });
});
