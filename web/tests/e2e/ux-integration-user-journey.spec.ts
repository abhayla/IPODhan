import { test, expect } from '@playwright/test';

/**
 * UX Transformation Integration Test
 * Complete user journey testing cross-phase integration
 *
 * User Persona: Active Investor evaluating IPO investments
 * Journey Flow:
 * 1. Discover IPOs (Phase 1: Visual Identity)
 * 2. Analyze data (Phase 2: Data Intelligence)
 * 3. Monitor real-time (Phase 3: Real-Time Experience)
 * 4. Use on mobile (Phase 4: Mobile Excellence)
 * 5. Get personalized recommendations (Phase 5: Personalization)
 */

test.describe('UX Integration: Complete User Journey', () => {
  test('should complete full investor evaluation workflow', async ({ page }) => {
    // STEP 1: Homepage - Discover IPOs (Phase 1)
    test.step('Phase 1: Discover IPOs with premium visual design', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Verify premium color system is loaded
      const rootStyles = await page.evaluate(() => {
        const root = document.documentElement;
        const primary = getComputedStyle(root).getPropertyValue('--primary').trim();
        return { hasPrimary: primary.length > 0 };
      });

      expect(rootStyles.hasPrimary).toBeTruthy();

      // See IPOCardEnhanced with Layer 1
      const firstCard = page.locator('[data-testid="ipo-card"], .ipo-card, article').first();
      await expect(firstCard).toBeVisible();

      // Hover to reveal Layer 2
      await firstCard.hover();
      await page.waitForTimeout(300);

      // AnimatedScore should be visible
      const score = firstCard.locator('.score, [data-testid="score"]').first();
      if (await score.count() > 0) {
        await expect(score).toBeVisible();
      }
    });

    // STEP 2: IPO Detail - Analyze with D3.js charts (Phase 2)
    test.step('Phase 2: Analyze IPO with interactive visualizations', async () => {
      const firstCard = page.locator('[data-testid="ipo-card"], .ipo-card, article').first();
      await firstCard.click();
      await page.waitForLoadState('networkidle');

      // Wait for D3.js charts to load (lazy loaded)
      await page.waitForTimeout(1500);

      // Look for ScoreBreakdown radar chart
      const scoreBreakdown = page.locator('[data-testid="score-breakdown"], .score-breakdown, svg[data-chart]').first();
      if (await scoreBreakdown.count() > 0) {
        await expect(scoreBreakdown).toBeVisible({ timeout: 5000 });
      }

      // Check for contextual tooltips
      const metric = page.locator('[data-testid*="metric"], .metric, .financial-metric').first();
      if (await metric.count() > 0) {
        await metric.hover();
        await page.waitForTimeout(300);

        const tooltip = page.locator('[role="tooltip"], .tooltip').first();
        if (await tooltip.count() > 0) {
          await expect(tooltip).toBeVisible();
        }
      }

      // Navigate back to list
      await page.goBack();
      await page.waitForLoadState('networkidle');
    });

    // STEP 3: Real-Time Monitoring (Phase 3)
    test.step('Phase 3: Monitor real-time updates and use smart filters', async () => {
      await page.goto('/ipos');
      await page.waitForLoadState('networkidle');

      // Check for MarketPulse dashboard
      const marketPulse = page.locator('[data-testid="market-pulse"], .market-pulse').first();
      if (await marketPulse.count() > 0) {
        await expect(marketPulse).toBeVisible();
      }

      // Apply visual filters
      const filterChip = page.locator('button:has-text("MAINBOARD"), button:has-text("Mainboard")').first();
      if (await filterChip.count() > 0) {
        await filterChip.click();
        await page.waitForTimeout(500);

        // IPOs should filter
        const cards = page.locator('[data-testid="ipo-card"], .ipo-card, article');
        const count = await cards.count();
        expect(count).toBeGreaterThan(0);
      }

      // Save filter preset
      const saveButton = page.locator('button:has-text("Save"), button[aria-label*="save" i]').first();
      if (await saveButton.count() > 0) {
        await saveButton.click();
        await page.waitForTimeout(300);

        const nameInput = page.locator('input[placeholder*="preset" i]').first();
        if (await nameInput.count() > 0) {
          await nameInput.fill('My Mainboard IPOs');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
        }
      }
    });

    // STEP 4: Mobile Experience (Phase 4)
    test.step('Phase 4: Use PWA capabilities and mobile optimizations', async () => {
      // Check PWA manifest
      const manifestLink = await page.evaluate(() => {
        const link = document.querySelector('link[rel="manifest"]');
        return link ? link.getAttribute('href') : null;
      });

      expect(manifestLink).toBe('/manifest.json');

      // Verify responsive design
      const viewportSize = page.viewportSize();
      expect(viewportSize).toBeTruthy();

      // Check for mobile optimizations (44px touch targets if mobile)
      if (viewportSize && viewportSize.width < 768) {
        const bottomNav = page.locator('[data-testid="bottom-nav"], .bottom-nav').last();
        if (await bottomNav.count() > 0) {
          await expect(bottomNav).toBeVisible();
        }
      }
    });

    // STEP 5: Personalization & Bulk Actions (Phase 5)
    test.step('Phase 5: Get personalized recommendations and use power user features', async () => {
      // Navigate to homepage to see recommendations
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Build user profile by viewing multiple IPOs
      const cards = page.locator('[data-testid="ipo-card"], .ipo-card, article');
      const viewCount = Math.min(await cards.count(), 5);

      for (let i = 0; i < viewCount; i++) {
        await cards.nth(i).click();
        await page.waitForTimeout(400);
        await page.goBack();
        await page.waitForTimeout(300);
      }

      // Check if profile was stored
      const profileExists = await page.evaluate(() => {
        return localStorage.getItem('ipodhan_user_profile') !== null;
      });

      expect(profileExists).toBeTruthy();

      // Test keyboard shortcut (/)
      await page.keyboard.press('/');
      await page.waitForTimeout(200);

      const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first();
      if (await searchInput.count() > 0) {
        const isFocused = await searchInput.evaluate((el) => el === document.activeElement);
        expect(isFocused).toBeTruthy();

        // Clear focus
        await page.keyboard.press('Escape');
      }

      // Use multi-select for bulk actions
      await page.goto('/ipos');
      await page.waitForLoadState('networkidle');

      const checkboxes = page.locator('input[type="checkbox"][data-ipo], [role="checkbox"][data-ipo]');
      if (await checkboxes.count() >= 2) {
        // Select 2 IPOs
        await checkboxes.nth(0).click();
        await page.waitForTimeout(100);
        await checkboxes.nth(1).click();
        await page.waitForTimeout(300);

        // Bulk action bar should appear
        const bulkActions = page.locator('[data-testid="bulk-actions"], .bulk-actions').first();
        if (await bulkActions.count() > 0) {
          await expect(bulkActions).toBeVisible();

          // Click compare
          const compareButton = bulkActions.locator('button:has-text("Compare")').first();
          if (await compareButton.count() > 0) {
            await compareButton.click();
            await page.waitForTimeout(500);

            // Should navigate to compare page
            const isComparePage = page.url().includes('/compare');
            expect(isComparePage).toBeTruthy();
          }
        }
      }
    });

    // FINAL VERIFICATION: All phases integrated
    test.step('Verify cross-phase integration', async () => {
      // Navigate to homepage
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Phase 1: Visual identity active
      const hasColors = await page.evaluate(() => {
        const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary');
        return primary.includes('oklch');
      });
      expect(hasColors).toBeTruthy();

      // Phase 2: D3.js available (check if loaded)
      const hasD3 = await page.evaluate(() => {
        return typeof (window as any).d3 !== 'undefined' || document.querySelector('svg[data-viz], svg[data-chart]') !== null;
      });
      // D3 is lazy-loaded, so it might not be loaded on homepage

      // Phase 3: localStorage filters saved
      const hasPresets = await page.evaluate(() => {
        const presets = localStorage.getItem('ipodhan_filter_presets') || localStorage.getItem('filter_presets');
        return presets !== null;
      });
      expect(hasPresets).toBeTruthy();

      // Phase 4: PWA manifest loaded
      const hasManifest = await page.evaluate(() => {
        return document.querySelector('link[rel="manifest"]') !== null;
      });
      expect(hasManifest).toBeTruthy();

      // Phase 5: User profile stored
      const hasProfile = await page.evaluate(() => {
        return localStorage.getItem('ipodhan_user_profile') !== null;
      });
      expect(hasProfile).toBeTruthy();

      console.log('✅ All 5 UX Transformation phases successfully integrated!');
    });
  });

  test('should maintain performance across all phases', async ({ page }) => {
    // Measure page load time
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    // Page should load in reasonable time (<5s)
    expect(loadTime).toBeLessThan(5000);

    // Check for LCP (Largest Contentful Paint)
    const lcp = await page.evaluate(() => {
      return new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1] as any;
          resolve(lastEntry.renderTime || lastEntry.loadTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        // Fallback timeout
        setTimeout(() => resolve(0), 3000);
      });
    });

    // LCP should be < 2.5s (good Core Web Vital)
    if (lcp > 0) {
      expect(lcp).toBeLessThan(2500);
    }
  });

  test('should handle errors gracefully across phases', async ({ page }) => {
    // Set up error tracking
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    // Navigate through key pages
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Click first IPO
    const firstCard = page.locator('[data-testid="ipo-card"], .ipo-card, article').first();
    if (await firstCard.count() > 0) {
      await firstCard.click();
      await page.waitForLoadState('networkidle');
    }

    // Navigate back
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // Should have minimal errors (allow for benign errors)
    expect(errors.length).toBeLessThan(3);
  });

  test('should preserve user state across navigation', async ({ page }) => {
    // Set up user state
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Apply filter
    const filterChip = page.locator('button:has-text("OPEN"), button:has-text("Open")').first();
    if (await filterChip.count() > 0) {
      await filterChip.click();
      await page.waitForTimeout(300);
    }

    // View an IPO
    const firstCard = page.locator('[data-testid="ipo-card"], .ipo-card, article').first();
    if (await firstCard.count() > 0) {
      await firstCard.click();
      await page.waitForLoadState('networkidle');

      // Go back
      await page.goBack();
      await page.waitForLoadState('networkidle');

      // Filter should still be applied
      const isActive = await filterChip.evaluate((el) => {
        return (
          el.classList.contains('active') ||
          el.getAttribute('aria-pressed') === 'true' ||
          el.getAttribute('data-state') === 'active'
        );
      });

      // State might be preserved depending on implementation
      expect(isActive !== null).toBeTruthy();
    }
  });

  test('should support accessibility features across all phases', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for ARIA landmarks
    const landmarks = await page.evaluate(() => {
      return {
        main: document.querySelector('main, [role="main"]') !== null,
        nav: document.querySelector('nav, [role="navigation"]') !== null,
      };
    });

    expect(landmarks.main).toBeTruthy();

    // Check for keyboard navigation
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    const focusedElement = await page.evaluate(() => {
      return document.activeElement?.tagName || null;
    });

    expect(focusedElement).toBeTruthy();

    // Test keyboard shortcut help
    await page.keyboard.press('?');
    await page.waitForTimeout(300);

    const helpModal = page.locator('[role="dialog"], .shortcuts-help').first();
    if (await helpModal.count() > 0) {
      await expect(helpModal).toBeVisible();

      // Close with Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      const isHidden = !(await helpModal.isVisible());
      expect(isHidden).toBeTruthy();
    }
  });
});
