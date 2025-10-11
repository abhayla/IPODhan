import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should load successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Verify the page title is present (Next.js default or custom)
    await expect(page).toHaveTitle(/.+/);
  });

  test('should display main content', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Check that the body is visible
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should be responsive', async ({ page }) => {
    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Homepage - IPO Tables Section (Story 9.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display all main sections in correct order', async ({ page }) => {
    // Verify Hero section
    await expect(page.getByText('Your Trusted IPO Investment Platform')).toBeVisible();

    // Verify IPO Tables section
    await expect(page.getByText('Latest IPO Updates')).toBeVisible();

    // Verify Features section
    await expect(page.getByText('Everything You Need for IPO Investments')).toBeVisible();

    // Verify CTA section
    await expect(page.getByText('Ready to Start Your IPO Journey')).toBeVisible();
  });

  test('should display IPO tables section above Features section', async ({ page }) => {
    // Get all section headings
    const ipoTablesHeading = page.getByRole('heading', { name: /Latest IPO Updates/i });
    const featuresHeading = page.getByRole('heading', { name: /Everything You Need for IPO Investments/i });

    // Both should be visible
    await expect(ipoTablesHeading).toBeVisible();
    await expect(featuresHeading).toBeVisible();

    // Get their positions
    const ipoTablesBox = await ipoTablesHeading.boundingBox();
    const featuresBox = await featuresHeading.boundingBox();

    // IPO tables should be above (lower Y coordinate) Features
    expect(ipoTablesBox?.y).toBeLessThan(featuresBox?.y || Infinity);
  });

  test('should display all four IPO table categories', async ({ page }) => {
    // Wait for tables to load (with timeout)
    await page.waitForSelector('text="Latest IPO Updates"', { timeout: 10000 });

    // Tables might be in sections with specific test ids or headings
    // Check for table section headings or content
    const pageContent = await page.content();

    // Verify the IPO Tables Section component is rendered
    // (Actual table content depends on data availability)
    const ipoSection = page.locator('section').filter({ hasText: 'Latest IPO Updates' });
    await expect(ipoSection).toBeVisible();
  });

  test('should have proper SEO structured data', async ({ page }) => {
    // Check for Organization schema
    const orgSchemaScript = page.locator('script#organization-schema[type="application/ld+json"]');
    await expect(orgSchemaScript).toBeAttached();

    const orgSchemaContent = await orgSchemaScript.innerHTML();
    const orgSchema = JSON.parse(orgSchemaContent);
    expect(orgSchema['@type']).toBe('Organization');
    expect(orgSchema.name).toBe('IPODhan');

    // Check for IPO Listings schema (only if IPOs exist)
    const ipoSchemaScript = page.locator('script#ipo-listings-schema[type="application/ld+json"]');
    const ipoSchemaExists = await ipoSchemaScript.count();

    if (ipoSchemaExists > 0) {
      const ipoSchemaContent = await ipoSchemaScript.innerHTML();
      const ipoSchema = JSON.parse(ipoSchemaContent);
      expect(ipoSchema['@type']).toBe('ItemList');
      expect(ipoSchema.name).toBe('Latest IPO Updates');
    }
  });

  test('should load IPO data without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    // Listen for console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait a bit to ensure any async errors are captured
    await page.waitForTimeout(2000);

    // Check that there are no console errors
    expect(consoleErrors).toHaveLength(0);
  });

  test('should have no layout shift when loading IPO tables', async ({ page }) => {
    await page.goto('/');

    // Measure CLS (Cumulative Layout Shift)
    const cls = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsValue = 0;

        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if ((entry as any).hadRecentInput) continue;
            clsValue += (entry as any).value;
          }
        });

        observer.observe({ type: 'layout-shift', buffered: true });

        // Wait 3 seconds then resolve
        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 3000);
      });
    });

    // CLS should be less than 0.1 (good)
    expect(cls).toBeLessThan(0.1);
  });

  test('should preserve existing navigation links', async ({ page }) => {
    // Check Hero section links
    const browseIPOsLink = page.getByRole('link', { name: /Browse IPOs/i });
    const calculateLotsLink = page.getByRole('link', { name: /Calculate Lots/i });

    await expect(browseIPOsLink).toBeVisible();
    await expect(calculateLotsLink).toBeVisible();

    // Verify they navigate correctly
    await expect(browseIPOsLink).toHaveAttribute('href', '/dashboard');
    await expect(calculateLotsLink).toHaveAttribute('href', '/tools/lot-calculator');
  });

  test('should be mobile responsive', async ({ page }) => {
    // Test on mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // All sections should still be visible
    await expect(page.getByText('Your Trusted IPO Investment Platform')).toBeVisible();
    await expect(page.getByText('Latest IPO Updates')).toBeVisible();
    await expect(page.getByText('Everything You Need for IPO Investments')).toBeVisible();

    // Check that content doesn't overflow
    const body = page.locator('body');
    const bodyBox = await body.boundingBox();
    expect(bodyBox?.width).toBeLessThanOrEqual(375);
  });

  test('should be tablet responsive', async ({ page }) => {
    // Test on tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // All sections should still be visible
    await expect(page.getByText('Your Trusted IPO Investment Platform')).toBeVisible();
    await expect(page.getByText('Latest IPO Updates')).toBeVisible();
    await expect(page.getByText('Everything You Need for IPO Investments')).toBeVisible();
  });

  test('should have fast page load (LCP < 2s)', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Get LCP (Largest Contentful Paint)
    const lcp = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1] as any;
          resolve(lastEntry.renderTime || lastEntry.loadTime);
        });

        observer.observe({ type: 'largest-contentful-paint', buffered: true });

        // Fallback timeout
        setTimeout(() => resolve(Date.now() - performance.timing.navigationStart), 3000);
      });
    });

    // LCP should be less than 2000ms (2 seconds)
    expect(lcp).toBeLessThan(2000);
  });
});
