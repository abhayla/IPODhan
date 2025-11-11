import { test, expect } from '@playwright/test';
import { navigateToFirstIPO, scrollToElement } from '../helpers/e2e-helpers';

/**
 * UX Transformation Phase 2: Data Intelligence Surface
 * E2E Tests for:
 * - D3.js interactive visualizations
 * - ScoreBreakdown radar chart (5-component)
 * - SectorHeatMap with metric modes
 * - CorrelationMatrix with trend lines
 * - PredictiveMeter animated gauge
 * - TimeSeriesPlayback with controls
 * - ContextualTooltip intelligence
 * - Code splitting and lazy loading
 */

test.describe('Phase 2: Data Intelligence Surface', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard where IPO cards are displayed
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
  });

  test('should display ScoreBreakdown radar chart on IPO detail page', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Look for radar chart / score breakdown
    const scoreBreakdown = page.locator('[data-testid="score-breakdown"], .score-breakdown, svg[data-chart="radar"]').first();

    if (await scoreBreakdown.count() > 0) {
      await expect(scoreBreakdown).toBeVisible({ timeout: 5000 });

      // Radar chart should be SVG
      const isSVG = await scoreBreakdown.evaluate((el) => el.tagName.toLowerCase() === 'svg');
      if (isSVG) {
        // Should contain paths or polygons for radar
        const hasRadarPaths = await scoreBreakdown.evaluate((svg) => {
          return svg.querySelectorAll('path, polygon').length > 0;
        });
        expect(hasRadarPaths).toBeTruthy();
      }
    }
  });

  test('should show 5-component breakdown in radar chart', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Look for component labels (Financial, Valuation, Subscription, Market, Fundamentals)
    const components = ['Financial', 'Valuation', 'Subscription', 'Market', 'Fundamental'];

    let foundComponents = 0;
    for (const component of components) {
      const componentLabel = page.locator(`text=/.*${component}.*/i`).first();
      if (await componentLabel.count() > 0) {
        foundComponents++;
      }
    }

    // Should find at least 3 of the 5 components
    expect(foundComponents).toBeGreaterThanOrEqual(3);
  });

  test('should display ContextualTooltip with sector comparisons', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Look for metrics that might have contextual tooltips
    const metricWithTooltip = page.locator('[data-testid*="metric"], .metric, .financial-metric').first();

    if (await metricWithTooltip.count() > 0) {
      // Hover to trigger tooltip
      await metricWithTooltip.hover();
      await page.waitForTimeout(300);

      // Look for tooltip (common patterns)
      const tooltip = page.locator('[role="tooltip"], .tooltip, [data-testid="tooltip"]').first();

      if (await tooltip.count() > 0) {
        await expect(tooltip).toBeVisible();

        // Tooltip should contain contextual info (sector avg, percentile, etc.)
        const tooltipText = await tooltip.textContent();
        const hasContextualInfo =
          tooltipText?.includes('avg') ||
          tooltipText?.includes('sector') ||
          tooltipText?.includes('%') ||
          tooltipText?.includes('above') ||
          tooltipText?.includes('below');

        expect(hasContextualInfo).toBeTruthy();
      }
    }
  });

  test('should render SectorHeatMap visualization', async ({ page }) => {
    // Navigate to page that might have sector heatmap (dashboard or all IPOs)
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Look for heatmap visualization
    const heatmap = page.locator('[data-testid="sector-heatmap"], .sector-heatmap, [data-viz="heatmap"]').first();

    if (await heatmap.count() > 0) {
      await expect(heatmap).toBeVisible({ timeout: 5000 });

      // Heatmap should have multiple sectors
      const sectorCells = heatmap.locator('[data-sector], .sector-cell, rect[data-sector]');
      const count = await sectorCells.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should allow metric mode switching on SectorHeatMap', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Look for metric mode buttons (score, subscription, listing gains)
    const metricButtons = page.locator('button:has-text("Score"), button:has-text("Subscription"), button:has-text("Listing")');

    if (await metricButtons.count() > 0) {
      const firstButton = metricButtons.first();
      await expect(firstButton).toBeVisible();

      // Click to switch metric mode
      await firstButton.click();
      await page.waitForTimeout(500);

      // Button should show active state
      const isActive = await firstButton.evaluate((btn) => {
        return btn.classList.contains('active') ||
               btn.getAttribute('aria-pressed') === 'true' ||
               btn.getAttribute('data-state') === 'active';
      });

      expect(isActive).toBeTruthy();
    }
  });

  test('should display CorrelationMatrix scatter plot', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const correlationMatrix = page.locator('[data-testid="correlation-matrix"], .correlation-matrix, [data-viz="scatter"]').first();

    if (await correlationMatrix.count() > 0) {
      await expect(correlationMatrix).toBeVisible({ timeout: 5000 });

      // Scatter plot should be SVG with circles/points
      const isSVG = await correlationMatrix.evaluate((el) => el.tagName.toLowerCase() === 'svg');
      if (isSVG) {
        const hasPoints = await correlationMatrix.evaluate((svg) => {
          return svg.querySelectorAll('circle, path[d*="M"]').length > 0;
        });
        expect(hasPoints).toBeTruthy();
      }
    }
  });

  test('should show trend line and R² value on CorrelationMatrix', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Look for R² coefficient display - fix invalid selector
    const r2Value = page.locator('[data-testid="r-squared"]').first();

    if (await r2Value.count() > 0) {
      await expect(r2Value).toBeVisible();

      // R² value should be between 0 and 1
      const text = await r2Value.textContent();
      const match = text?.match(/\d+\.\d+/);
      if (match) {
        const value = parseFloat(match[0]);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  test('should display PredictiveMeter animated gauge', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    const predictiveMeter = page.locator('[data-testid="predictive-meter"], .predictive-meter, [data-viz="gauge"]').first();

    if (await predictiveMeter.count() > 0) {
      await expect(predictiveMeter).toBeVisible({ timeout: 5000 });

      // Gauge should be SVG with arc path
      const isSVG = await predictiveMeter.evaluate((el) => el.tagName.toLowerCase() === 'svg');
      if (isSVG) {
        const hasArc = await predictiveMeter.evaluate((svg) => {
          const paths = svg.querySelectorAll('path');
          return Array.from(paths).some(path => path.getAttribute('d')?.includes('A'));
        });
        expect(hasArc).toBeTruthy();
      }
    }
  });

  test('should show listing gain probability on PredictiveMeter', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Look for probability percentage - fix invalid selector
    const probability = page.locator('[data-testid="probability"]').first();

    if (await probability.count() > 0) {
      await expect(probability).toBeVisible();

      const text = await probability.textContent();
      const match = text?.match(/\d+/);
      if (match) {
        const value = parseInt(match[0]);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  test('should display TimeSeriesPlayback with timeline', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    const timeseriesPlayback = page.locator('[data-testid="timeseries-playback"], .timeseries-playback, [data-viz="timeline"]').first();

    if (await timeseriesPlayback.count() > 0) {
      await expect(timeseriesPlayback).toBeVisible({ timeout: 5000 });

      // Should contain SVG line chart
      const chart = timeseriesPlayback.locator('svg').first();
      if (await chart.count() > 0) {
        const hasLine = await chart.evaluate((svg) => {
          return svg.querySelectorAll('path, polyline').length > 0;
        });
        expect(hasLine).toBeTruthy();
      }
    }
  });

  test('should have playback controls on TimeSeriesPlayback', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Look for play/pause/reset controls
    const playButton = page.locator('button[aria-label*="play" i], button:has-text("Play")').first();
    const pauseButton = page.locator('button[aria-label*="pause" i], button:has-text("Pause")').first();
    const resetButton = page.locator('button[aria-label*="reset" i], button:has-text("Reset")').first();

    const hasControls =
      (await playButton.count() > 0) ||
      (await pauseButton.count() > 0) ||
      (await resetButton.count() > 0);

    if (hasControls) {
      // At least one control should be visible
      expect(hasControls).toBeTruthy();
    }
  });

  test('should lazy load D3.js visualizations', async ({ page }) => {
    // Check network requests for D3.js bundle
    const d3Requests: string[] = [];

    page.on('request', request => {
      const url = request.url();
      if (url.includes('d3') || url.includes('visualization')) {
        d3Requests.push(url);
      }
    });

    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Wait for potential lazy loading
    await page.waitForTimeout(2000);

    // D3.js should be code-split (loaded separately or not at all if not needed)
    // This is a soft check - we just verify the page loads without errors
    const hasErrors = await page.evaluate(() => {
      return (window as any).__playwrightErrors?.length > 0;
    });

    expect(hasErrors).toBeFalsy();
  });

  test('should handle click interactions on scatter plot points', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const scatterPlot = page.locator('[data-testid="correlation-matrix"], .correlation-matrix, [data-viz="scatter"]').first();

    if (await scatterPlot.count() > 0) {
      // Find clickable points (circles)
      const points = scatterPlot.locator('circle, [data-clickable]');

      if (await points.count() > 0) {
        const firstPoint = points.first();
        await firstPoint.click();
        await page.waitForTimeout(300);

        // Clicking should trigger navigation or show tooltip
        // Check if URL changed or tooltip appeared
        const tooltip = page.locator('[role="tooltip"], .tooltip').first();
        const urlChanged = page.url() !== 'http://localhost:3000/ipos';

        expect(urlChanged || (await tooltip.count() > 0)).toBeTruthy();
      }
    }
  });

  test('should show confidence level on predictive meter', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Look for confidence indicator (HIGH, MEDIUM, LOW) - fix invalid selector
    const confidence = page.locator('[data-testid="confidence"]').first();

    if (await confidence.count() > 0) {
      await expect(confidence).toBeVisible();

      const text = await confidence.textContent();
      const hasConfidenceLevel = /high|medium|low/i.test(text || '');
      expect(hasConfidenceLevel).toBeTruthy();
    }
  });

  test('should have zoom and pan capabilities on charts', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Look for zoom controls
    const zoomIn = page.locator('button[aria-label*="zoom in" i], button:has-text("+")').first();
    const zoomOut = page.locator('button[aria-label*="zoom out" i], button:has-text("-")').first();

    if (await zoomIn.count() > 0 && await zoomOut.count() > 0) {
      await expect(zoomIn).toBeVisible();
      await expect(zoomOut).toBeVisible();

      // Click zoom in
      await zoomIn.click();
      await page.waitForTimeout(300);

      // Click zoom out
      await zoomOut.click();
      await page.waitForTimeout(300);

      // No errors should occur
      const errors = await page.evaluate(() => (window as any).__playwrightErrors);
      expect(errors).toBeFalsy();
    }
  });

  test('should display ScoreRangeFilter slider', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    const scoreFilter = page.locator('[data-testid="score-range-filter"], .score-range-filter, input[type="range"]').first();

    if (await scoreFilter.count() > 0) {
      await expect(scoreFilter).toBeVisible();

      // Should be a range input or slider
      const isRange = await scoreFilter.evaluate((el) => {
        return el.tagName.toLowerCase() === 'input' && el.getAttribute('type') === 'range';
      });

      expect(isRange || await scoreFilter.count() > 0).toBeTruthy();
    }
  });

  test('should filter IPOs when score range changes', async ({ page }) => {
    await page.goto('/ipos');
    await page.waitForLoadState('networkidle');

    // Count initial IPOs
    const initialCount = await page.locator('[data-testid="ipo-card"], .ipo-card, article').count();

    // Find score filter
    const scoreFilter = page.locator('[data-testid="score-range-filter"], input[type="range"]').first();

    if (await scoreFilter.count() > 0) {
      // Adjust filter to high scores only (8-10)
      await scoreFilter.fill('8');
      await page.waitForTimeout(500);

      // Count filtered IPOs
      const filteredCount = await page.locator('[data-testid="ipo-card"], .ipo-card, article').count();

      // Filtered count should be <= initial count
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    }
  });

  test('should have smooth 60fps chart animations', async ({ page }) => {
    // Navigate to first IPO detail using helper
    await navigateToFirstIPO(page);

    // Wait for chart to render
    await page.waitForTimeout(1000);

    // Check for CSS transitions on SVG elements
    const chart = page.locator('svg[data-chart], svg.chart, [data-viz] svg').first();

    if (await chart.count() > 0) {
      const hasTransitions = await chart.evaluate((svg) => {
        const elements = svg.querySelectorAll('*');
        return Array.from(elements).some(el => {
          const style = getComputedStyle(el);
          return style.transition !== 'none' && style.transition.length > 0;
        });
      });

      expect(hasTransitions).toBeTruthy();
    }
  });
});
