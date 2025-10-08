import { test, expect } from '@playwright/test';

test.describe('Structured Data (JSON-LD)', () => {
  test.describe('Homepage - Organization Schema', () => {
    test('should have Organization schema', async ({ page }) => {
      await page.goto('/');

      const jsonLdScripts = await page.locator('script[type="application/ld+json"]').all();
      expect(jsonLdScripts.length).toBeGreaterThan(0);

      // Find Organization schema
      let orgSchema = null;
      for (const script of jsonLdScripts) {
        const content = await script.textContent();
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed['@type'] === 'Organization') {
            orgSchema = parsed;
            break;
          }
        }
      }

      expect(orgSchema).toBeTruthy();
      expect(orgSchema!['@context']).toBe('https://schema.org');
      expect(orgSchema!['@type']).toBe('Organization');
      expect(orgSchema!.name).toBe('IPODhan');
      expect(orgSchema!.url).toBeTruthy();
    });
  });

  test.describe('Sitemap and Robots.txt', () => {
    test('should have accessible robots.txt', async ({ page }) => {
      const response = await page.goto('/robots.txt');
      expect(response?.status()).toBe(200);

      const content = await page.textContent('body');
      expect(content).toContain('User-agent');
      expect(content).toContain('Sitemap');
      expect(content).toContain('Disallow: /api/');
    });

    test('should have accessible sitemap.xml', async ({ page }) => {
      const response = await page.goto('/sitemap.xml');
      expect(response?.status()).toBe(200);

      const content = await page.textContent('body');
      expect(content).toContain('<?xml');
      expect(content).toContain('<urlset');
      expect(content).toContain('<url>');
    });

    test('sitemap should include main pages', async ({ page }) => {
      await page.goto('/sitemap.xml');
      const content = await page.textContent('body');

      // Check for main pages in sitemap
      expect(content).toContain('<loc>');
      expect(content).toContain('ipodhan.com');
    });
  });

  test.describe('Breadcrumb Schema', () => {
    test('should validate breadcrumb schema structure', async ({ page }) => {
      await page.goto('/');

      const jsonLdScripts = await page.locator('script[type="application/ld+json"]').all();

      // Look for BreadcrumbList schema
      let breadcrumbSchema = null;
      for (const script of jsonLdScripts) {
        const content = await script.textContent();
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed['@type'] === 'BreadcrumbList') {
            breadcrumbSchema = parsed;
            break;
          }
        }
      }

      if (breadcrumbSchema) {
        expect(breadcrumbSchema['@context']).toBe('https://schema.org');
        expect(breadcrumbSchema['@type']).toBe('BreadcrumbList');
        expect(Array.isArray(breadcrumbSchema.itemListElement)).toBe(true);
      }
    });
  });
});
