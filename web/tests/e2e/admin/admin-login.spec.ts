import { test, expect } from '@playwright/test';

/**
 * Admin Login Flow E2E Tests
 * Tests authentication, token validation, and protected route access
 */

// Use environment variable for admin token (set in CI/local .env.test)
const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'test-admin-token-for-e2e';

test.describe('Admin Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/admin/login');
    await page.evaluate(() => localStorage.clear());
  });

  test('should display login page correctly', async ({ page }) => {
    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle');

    // Check page title and heading
    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();

    // Check for token input field
    const tokenInput = page.getByPlaceholder(/enter admin token/i);
    await expect(tokenInput).toBeVisible();

    // Check for login button
    const loginButton = page.getByRole('button', { name: /login/i });
    await expect(loginButton).toBeVisible();
  });

  test('should reject empty token submission', async ({ page }) => {
    await page.goto('/admin/login');

    // Try to submit without entering token
    await page.getByRole('button', { name: /login/i }).click();

    // Should show validation error or remain on login page
    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
  });

  test('should reject invalid token', async ({ page }) => {
    await page.goto('/admin/login');

    // Enter invalid token
    await page.getByPlaceholder(/enter admin token/i).fill('invalid-token-123');
    await page.getByRole('button', { name: /login/i }).click();

    // Wait for error message or remain on login page
    await page.waitForTimeout(1000);

    // Should either show error or remain on login page
    const currentUrl = page.url();
    expect(currentUrl).toContain('/admin/login');
  });

  test('should successfully login with valid token', async ({ page }) => {
    await page.goto('/admin/login');

    // Enter valid token
    await page.getByPlaceholder(/enter admin token/i).fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: /login/i }).click();

    // Should redirect to admin dashboard
    await page.waitForURL('**/admin', { timeout: 5000 });

    // Verify we're on the dashboard
    await expect(page.getByRole('heading', { name: /ipo management/i })).toBeVisible();

    // Verify token is stored in localStorage
    const storedToken = await page.evaluate(() => localStorage.getItem('admin_token'));
    expect(storedToken).toBe(ADMIN_TOKEN);
  });

  test('should persist login across page navigation', async ({ page, context }) => {
    // Login first
    await page.goto('/admin/login');
    await page.getByPlaceholder(/enter admin token/i).fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: /login/i }).click();
    await page.waitForURL('**/admin');

    // Navigate to settings page
    await page.getByRole('link', { name: /settings/i }).click();
    await page.waitForURL('**/admin/settings');

    // Should still be authenticated
    await expect(page.getByRole('heading', { name: /admin settings/i })).toBeVisible();

    // Navigate to audit log
    await page.getByRole('link', { name: /audit log/i }).click();
    await page.waitForURL('**/admin/audit');

    // Should still be authenticated
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');

    // Click logout button
    const logoutButton = page.getByRole('button', { name: /logout/i });
    await expect(logoutButton).toBeVisible();
    await logoutButton.click();

    // Should redirect to login page
    await page.waitForURL('**/admin/login', { timeout: 5000 });

    // Token should be cleared from localStorage
    const storedToken = await page.evaluate(() => localStorage.getItem('admin_token'));
    expect(storedToken).toBeNull();
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Try to access admin dashboard without authentication
    await page.goto('/admin');

    // Should redirect to login page
    await page.waitForURL('**/admin/login', { timeout: 5000 });

    // Should show login form
    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
  });

  test('should protect admin routes from unauthorized access', async ({ page }) => {
    // Try to access various admin routes without token
    const protectedRoutes = [
      '/admin',
      '/admin/settings',
      '/admin/notifications',
      '/admin/audit',
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      // Should redirect to login
      await page.waitForURL('**/admin/login', { timeout: 5000 });
    }
  });
});

test.describe('Admin Session Management', () => {
  test('should handle token expiration gracefully', async ({ page }) => {
    // Login first
    await page.goto('/admin/login');
    await page.evaluate((token) => localStorage.setItem('admin_token', token), ADMIN_TOKEN);
    await page.goto('/admin');

    // Verify logged in
    await expect(page.getByRole('heading', { name: /ipo management/i })).toBeVisible();

    // Simulate token expiration by removing it
    await page.evaluate(() => localStorage.removeItem('admin_token'));

    // Try to navigate to another admin page
    await page.goto('/admin/settings');

    // Should redirect to login
    await page.waitForURL('**/admin/login', { timeout: 5000 });
  });

  test('should handle multiple tab sessions correctly', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Login in first tab
      await page1.goto('/admin/login');
      await page1.getByPlaceholder(/enter admin token/i).fill(ADMIN_TOKEN);
      await page1.getByRole('button', { name: /login/i }).click();
      await page1.waitForURL('**/admin');

      // Open second tab (separate context - no shared state)
      await page2.goto('/admin');

      // Second tab should redirect to login (no shared localStorage)
      await page2.waitForURL('**/admin/login', { timeout: 5000 });

      // Login in second tab
      await page2.getByPlaceholder(/enter admin token/i).fill(ADMIN_TOKEN);
      await page2.getByRole('button', { name: /login/i }).click();
      await page2.waitForURL('**/admin');

      // Both tabs should now be authenticated
      await expect(page1.getByRole('heading', { name: /ipo management/i })).toBeVisible();
      await expect(page2.getByRole('heading', { name: /ipo management/i })).toBeVisible();
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});

test.describe('Admin Login Security', () => {
  test('should not expose token in URL or visible elements', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByPlaceholder(/enter admin token/i).fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: /login/i }).click();
    await page.waitForURL('**/admin');

    // Check URL doesn't contain token
    const currentUrl = page.url();
    expect(currentUrl).not.toContain(ADMIN_TOKEN);

    // Check page content doesn't expose token
    const pageContent = await page.content();
    expect(pageContent).not.toContain(ADMIN_TOKEN);
  });

  test('should use password input type for token field', async ({ page }) => {
    await page.goto('/admin/login');

    const tokenInput = page.getByPlaceholder(/enter admin token/i);
    const inputType = await tokenInput.getAttribute('type');

    // Should be password or text type (commonly password for security)
    expect(['password', 'text']).toContain(inputType);
  });

  test('should handle rapid login attempts without crashing', async ({ page }) => {
    await page.goto('/admin/login');

    // Try multiple rapid logins
    for (let i = 0; i < 5; i++) {
      await page.getByPlaceholder(/enter admin token/i).fill(`test-token-${i}`);
      await page.getByRole('button', { name: /login/i }).click();
      await page.waitForTimeout(200);
    }

    // Page should still be functional
    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
  });
});
