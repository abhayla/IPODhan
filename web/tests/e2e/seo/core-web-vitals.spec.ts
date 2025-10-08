import { test, expect } from '@playwright/test';

test.describe('Core Web Vitals', () => {
  test.describe('Performance Metrics', () => {
    test('homepage should load quickly', async ({ page }) => {
      const startTime = Date.now();
      await page.goto('/');
      const loadTime = Date.now() - startTime;

      // Should load within 3 seconds
      expect(loadTime).toBeLessThan(3000);
    });

    test('should have no console errors on homepage', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Filter out known acceptable errors (if any)
      const criticalErrors = errors.filter(
        (error) => !error.includes('DevTools') && !error.includes('Extension')
      );

      expect(criticalErrors.length).toBe(0);
    });
  });

  test.describe('Image Optimization', () => {
    test('images should have alt attributes', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const images = await page.locator('img').all();

      for (const img of images) {
        const alt = await img.getAttribute('alt');
        const src = await img.getAttribute('src');

        // All images should have alt text (can be empty for decorative images)
        expect(alt).not.toBeNull();

        // Log images without meaningful alt text (for manual review)
        if (!alt || alt.trim() === '') {
          console.log(`Image without alt text: ${src}`);
        }
      }
    });

    test('should use lazy loading for below-fold images', async ({ page }) => {
      await page.goto('/');

      const images = await page.locator('img').all();
      let hasLazyLoading = false;

      for (const img of images) {
        const loading = await img.getAttribute('loading');
        if (loading === 'lazy') {
          hasLazyLoading = true;
          break;
        }
      }

      // At least some images should use lazy loading
      expect(hasLazyLoading).toBe(true);
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('should be mobile-friendly', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      // Check that content is visible
      await expect(page.locator('body')).toBeVisible();

      // No horizontal scroll (page width should be viewport width)
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);

      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
    });

    test('should have readable text on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      // Check font sizes (should be at least 12px for readability)
      const fontSize = await page.evaluate(() => {
        const body = document.querySelector('body');
        if (!body) return 0;
        return parseInt(window.getComputedStyle(body).fontSize);
      });

      expect(fontSize).toBeGreaterThanOrEqual(12);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper heading hierarchy', async ({ page }) => {
      await page.goto('/');

      const h1Count = await page.locator('h1').count();
      expect(h1Count).toBeGreaterThan(0);
      expect(h1Count).toBeLessThanOrEqual(2); // Generally should have only 1 H1
    });

    test('should have language attribute', async ({ page }) => {
      await page.goto('/');
      const lang = await page.locator('html').getAttribute('lang');
      expect(lang).toBeTruthy();
      expect(lang).toBe('en');
    });
  });
});
