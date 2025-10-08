import { test, expect } from '@playwright/test';

test.describe('SEO Meta Tags', () => {
  test.describe('Homepage', () => {
    test('should have correct title tag', async ({ page }) => {
      await page.goto('/');
      const title = await page.title();
      expect(title).toContain('IPODhan');
      expect(title.length).toBeLessThanOrEqual(60);
    });

    test('should have meta description', async ({ page }) => {
      await page.goto('/');
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description).toBeTruthy();
      expect(description!.length).toBeLessThanOrEqual(160);
    });

    test('should have Open Graph tags', async ({ page }) => {
      await page.goto('/');

      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
      const ogDescription = await page.locator('meta[property="og:description"]').getAttribute('content');
      const ogType = await page.locator('meta[property="og:type"]').getAttribute('content');
      const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');

      expect(ogTitle).toBeTruthy();
      expect(ogDescription).toBeTruthy();
      expect(ogType).toBe('website');
      expect(ogImage).toContain('og-image');
    });

    test('should have Twitter Card tags', async ({ page }) => {
      await page.goto('/');

      const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute('content');
      const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute('content');
      const twitterDescription = await page.locator('meta[name="twitter:description"]').getAttribute('content');

      expect(twitterCard).toBe('summary_large_image');
      expect(twitterTitle).toBeTruthy();
      expect(twitterDescription).toBeTruthy();
    });

    test('should have canonical URL', async ({ page }) => {
      await page.goto('/');
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toBeTruthy();
      expect(canonical).toMatch(/^https?:\/\//);
    });
  });

  test.describe('IPO Listing Page', () => {
    test('should have SEO meta tags', async ({ page }) => {
      await page.goto('/dashboard');

      const title = await page.title();
      expect(title).toContain('IPO');
      expect(title.length).toBeLessThanOrEqual(60);

      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description).toBeTruthy();
      expect(description!.length).toBeLessThanOrEqual(160);
    });

    test('should have canonical URL pointing to /ipos', async ({ page }) => {
      await page.goto('/dashboard');
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain('/ipos');
    });
  });

  test.describe('Lot Calculator Page', () => {
    test('should have correct SEO meta tags', async ({ page }) => {
      await page.goto('/tools/lot-calculator');

      const title = await page.title();
      expect(title).toContain('Calculator');

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain('lot-calculator');
    });
  });

  test.describe('Comparison Tool Page', () => {
    test('should have correct SEO meta tags', async ({ page }) => {
      await page.goto('/tools/compare');

      const title = await page.title();
      expect(title).toContain('Comparison');

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain('compare');
    });
  });

  test.describe('Registrars Page', () => {
    test('should have correct SEO meta tags', async ({ page }) => {
      await page.goto('/registrars');

      const title = await page.title();
      expect(title).toContain('Registrar');

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain('registrars');
    });
  });

  test.describe('Market Holidays Page', () => {
    test('should have correct SEO meta tags', async ({ page }) => {
      await page.goto('/market-holidays');

      const title = await page.title();
      expect(title).toContain('Market Holidays');

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain('market-holidays');
    });
  });

  test.describe('Historical IPOs Page', () => {
    test('should have correct SEO meta tags', async ({ page }) => {
      await page.goto('/history');

      const title = await page.title();
      expect(title).toContain('Historical');

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain('history');
    });
  });
});

test.describe('Robots Meta Tag', () => {
  test('should allow indexing on public pages', async ({ page }) => {
    const pages = ['/', '/dashboard', '/tools/lot-calculator', '/registrars'];

    for (const path of pages) {
      await page.goto(path);
      const robots = await page.locator('meta[name="robots"]').getAttribute('content');

      // Either no robots tag (allows indexing) or has 'index' in content
      if (robots) {
        expect(robots).toContain('index');
      }
    }
  });
});
