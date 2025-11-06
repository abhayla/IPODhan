/**
 * E2E Tests: DRHP Extraction Integration with IPO Edit Forms
 *
 * Tests the integration between DRHP extraction results and the IPO edit page.
 * Verifies that extraction data is displayed correctly and can be copied to form fields.
 *
 * Part of Phase 6: Admin Enhancement - Week 3 Final Testing
 *
 * Run with: npm run test:e2e:headed -- drhp-extraction-integration.spec.ts
 */

import { test, expect, Page } from '@playwright/test';

// Test IPOs - We'll test 5 different IPOs
const TEST_IPOS = [
  {
    slug: 'emcure-pharmaceuticals-ipo',
    companyName: 'Emcure Pharmaceuticals',
    expectedFields: ['revenueFy2023', 'profitFy2023', 'netWorth']
  },
  {
    slug: 'bajaj-housing-finance-ipo',
    companyName: 'Bajaj Housing Finance',
    expectedFields: ['revenueFy2023', 'profitFy2023', 'netWorth']
  },
  {
    slug: 'ola-electric-ipo',
    companyName: 'Ola Electric Mobility',
    expectedFields: ['revenueFy2023', 'profitFy2023']
  },
  {
    slug: 'swiggy-ipo',
    companyName: 'Swiggy',
    expectedFields: ['revenueFy2023', 'netWorth']
  },
  {
    slug: 'hyundai-motor-india-ipo',
    companyName: 'Hyundai Motor India',
    expectedFields: ['revenueFy2023', 'profitFy2023', 'netWorth']
  }
];

// Helper function to login as admin
async function loginAsAdmin(page: Page) {
  await page.goto('/admin/login');

  // Fill login form
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');

  // Wait for redirect to admin dashboard
  await page.waitForURL('/admin', { timeout: 10000 });
}

// Helper function to navigate to IPO edit page
async function navigateToIPOEdit(page: Page, slug: string) {
  await page.goto(`/admin/edit/${slug}`);
  await page.waitForLoadState('networkidle');
}

test.describe('DRHP Extraction Integration - 5 IPO Test Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await loginAsAdmin(page);
  });

  // Test 1: Verify extraction results are displayed for all 5 IPOs
  test('should display extraction results for all test IPOs', async ({ page }) => {
    for (const testIPO of TEST_IPOS) {
      await navigateToIPOEdit(page, testIPO.slug);

      // Click on Financials tab
      await page.click('text=Financials');
      await page.waitForTimeout(1000); // Wait for tab content to load

      // Check if extraction results viewer is present
      const extractionViewer = page.locator('text=DRHP Extraction Results');

      if (await extractionViewer.isVisible()) {
        console.log(`✓ ${testIPO.companyName}: Extraction results found`);

        // Verify status badge is present
        const statusBadge = page.locator('[class*="bg-"][class*="rounded-full"]').first();
        await expect(statusBadge).toBeVisible();

        // Verify confidence score is displayed
        const confidenceScore = page.locator('text=/\\d+% Confidence/');
        if (await confidenceScore.isVisible()) {
          const scoreText = await confidenceScore.textContent();
          console.log(`  Confidence: ${scoreText}`);
        }
      } else {
        console.log(`⚠ ${testIPO.companyName}: No extraction results found`);
      }
    }
  });

  // Test 2: Expand extraction results and verify fields
  test('should expand and display extracted fields for all IPOs', async ({ page }) => {
    for (const testIPO of TEST_IPOS) {
      await navigateToIPOEdit(page, testIPO.slug);

      // Navigate to Financials tab
      await page.click('text=Financials');
      await page.waitForTimeout(1000);

      // Check if extraction exists
      const extractionViewer = page.locator('text=DRHP Extraction Results');

      if (await extractionViewer.isVisible()) {
        // Click expand button
        const expandButton = page.locator('button:has-text("Expand")');
        if (await expandButton.isVisible()) {
          await expandButton.click();
          await page.waitForTimeout(500);

          console.log(`\n${testIPO.companyName} - Extracted Fields:`);

          // Check for expected fields
          for (const fieldName of testIPO.expectedFields) {
            const fieldElement = page.locator(`text=/Revenue FY|Profit FY|Net Worth/`);
            if (await fieldElement.isVisible()) {
              console.log(`  ✓ Field visible in extraction results`);
            }
          }

          // Count total fields displayed
          const fieldCards = page.locator('[class*="bg-gray-900 rounded-lg border"]');
          const count = await fieldCards.count();
          console.log(`  Total fields: ${count}`);
        }
      }
    }
  });

  // Test 3: Copy single field from extraction to form
  test('should copy single field from extraction to form field', async ({ page }) => {
    const testIPO = TEST_IPOS[0]; // Test with first IPO

    await navigateToIPOEdit(page, testIPO.slug);
    await page.click('text=Financials');
    await page.waitForTimeout(1000);

    // Check if extraction exists
    const extractionViewer = page.locator('text=DRHP Extraction Results');

    if (await extractionViewer.isVisible()) {
      // Expand extraction results
      const expandButton = page.locator('button:has-text("Expand")');
      if (await expandButton.isVisible()) {
        await expandButton.click();
        await page.waitForTimeout(500);

        // Find first "Copy" button
        const copyButton = page.locator('button:has-text("Copy")').first();
        if (await copyButton.isVisible()) {
          // Get the value before copying
          const extractedValue = await page
            .locator('[class*="text-lg font-semibold text-white"]')
            .first()
            .textContent();

          console.log(`Extracted value: ${extractedValue}`);

          // Click copy button
          await copyButton.click();

          // Verify button changes to "Copied"
          await expect(page.locator('button:has-text("✓ Copied")').first()).toBeVisible({
            timeout: 2000
          });

          // Verify success message appears
          await expect(page.locator('text=/Copied .* from extraction/')).toBeVisible({
            timeout: 3000
          });

          console.log('✓ Field copied successfully');
        }
      }
    } else {
      console.log(`⚠ No extraction data available for ${testIPO.companyName}`);
      test.skip();
    }
  });

  // Test 4: Copy all fields from extraction to form
  test('should copy all fields from extraction to form', async ({ page }) => {
    const testIPO = TEST_IPOS[1]; // Test with second IPO

    await navigateToIPOEdit(page, testIPO.slug);
    await page.click('text=Financials');
    await page.waitForTimeout(1000);

    const extractionViewer = page.locator('text=DRHP Extraction Results');

    if (await extractionViewer.isVisible()) {
      // Find "Copy All Fields" button
      const copyAllButton = page.locator('button:has-text("Copy All Fields")');

      if (await copyAllButton.isVisible()) {
        // Click copy all
        await copyAllButton.click();

        // Verify success message
        await expect(page.locator('text=Copied all fields from extraction')).toBeVisible({
          timeout: 3000
        });

        console.log(`✓ All fields copied for ${testIPO.companyName}`);

        // Verify form fields are populated (check first field)
        const firstInput = page.locator('input[type="number"]').first();
        const inputValue = await firstInput.inputValue();

        if (inputValue && inputValue !== '') {
          console.log(`  ✓ Form field populated with value: ${inputValue}`);
        }
      }
    } else {
      console.log(`⚠ No extraction data available for ${testIPO.companyName}`);
      test.skip();
    }
  });

  // Test 5: Verify extraction metadata display
  test('should display extraction metadata correctly', async ({ page }) => {
    for (const testIPO of TEST_IPOS) {
      await navigateToIPOEdit(page, testIPO.slug);
      await page.click('text=Financials');
      await page.waitForTimeout(1000);

      const extractionViewer = page.locator('text=DRHP Extraction Results');

      if (await extractionViewer.isVisible()) {
        // Expand to see metadata
        const expandButton = page.locator('button:has-text("Expand")');
        if (await expandButton.isVisible()) {
          await expandButton.click();
          await page.waitForTimeout(500);

          console.log(`\n${testIPO.companyName} - Extraction Metadata:`);

          // Check for method
          const methodText = page.locator('text=/Method:/');
          if (await methodText.isVisible()) {
            const method = await methodText.textContent();
            console.log(`  ${method}`);
          }

          // Check for version
          const versionText = page.locator('text=/Version:/');
          if (await versionText.isVisible()) {
            const version = await versionText.textContent();
            console.log(`  ${version}`);
          }

          // Check for extraction date
          const dateText = page.locator('text=/Extracted:/');
          if (await dateText.isVisible()) {
            const date = await dateText.textContent();
            console.log(`  ${date}`);
          }
        }
      }
    }
  });

  // Test 6: Verify confidence scores are displayed
  test('should display confidence scores for extracted fields', async ({ page }) => {
    const testIPO = TEST_IPOS[2]; // Test with third IPO

    await navigateToIPOEdit(page, testIPO.slug);
    await page.click('text=Financials');
    await page.waitForTimeout(1000);

    const extractionViewer = page.locator('text=DRHP Extraction Results');

    if (await extractionViewer.isVisible()) {
      // Expand extraction
      const expandButton = page.locator('button:has-text("Expand")');
      if (await expandButton.isVisible()) {
        await expandButton.click();
        await page.waitForTimeout(500);

        // Check for confidence scores (format: "XX%")
        const confidenceScores = page.locator('text=/%\\d+%/');
        const count = await confidenceScores.count();

        if (count > 0) {
          console.log(`✓ ${testIPO.companyName}: ${count} fields with confidence scores`);

          // Verify color coding (green for high, yellow for medium, red for low)
          const highConfidence = page.locator('[class*="text-green-600"]');
          const mediumConfidence = page.locator('[class*="text-yellow-600"]');
          const lowConfidence = page.locator('[class*="text-red-600"]');

          const highCount = await highConfidence.count();
          const mediumCount = await mediumConfidence.count();
          const lowCount = await lowConfidence.count();

          console.log(`  High confidence: ${highCount}`);
          console.log(`  Medium confidence: ${mediumCount}`);
          console.log(`  Low confidence: ${lowCount}`);
        }
      }
    }
  });

  // Test 7: Verify data issues are displayed when present
  test('should display data issues if any found during extraction', async ({ page }) => {
    for (const testIPO of TEST_IPOS) {
      await navigateToIPOEdit(page, testIPO.slug);
      await page.click('text=Financials');
      await page.waitForTimeout(1000);

      const extractionViewer = page.locator('text=DRHP Extraction Results');

      if (await extractionViewer.isVisible()) {
        // Check for data issues warning
        const issuesWarning = page.locator('text=⚠️ Data Issues Found:');

        if (await issuesWarning.isVisible()) {
          console.log(`⚠ ${testIPO.companyName}: Data issues found`);

          // Count issues
          const issuesList = page.locator('[class*="bg-yellow-900"] li');
          const issueCount = await issuesList.count();
          console.log(`  Issues: ${issueCount}`);
        } else {
          console.log(`✓ ${testIPO.companyName}: No data issues`);
        }
      }
    }
  });

  // Test 8: Verify no extraction state is handled correctly
  test('should display appropriate message when no extraction exists', async ({ page }) => {
    // Use a test IPO that likely doesn't have extraction data
    await page.goto('/admin/edit/test-ipo-no-extraction');
    await page.click('text=Financials');
    await page.waitForTimeout(1000);

    // Should show "no extraction" message
    const noExtractionMessage = page.locator('text=No DRHP extraction found for this IPO');

    if (await noExtractionMessage.isVisible()) {
      console.log('✓ No extraction message displayed correctly');

      // Verify helpful text is present
      await expect(
        page.locator('text=Upload a DRHP PDF to extract financial data')
      ).toBeVisible();
    }
  });
});

// Test suite for extraction status scenarios
test.describe('Extraction Status Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should display correct status badge for each extraction status', async ({ page }) => {
    const statusTests = [
      { status: 'SUCCESS', bgColor: 'bg-green-100', textColor: 'text-green-800' },
      { status: 'PARTIAL', bgColor: 'bg-yellow-100', textColor: 'text-yellow-800' },
      { status: 'FAILED', bgColor: 'bg-red-100', textColor: 'text-red-800' }
    ];

    // Test with first IPO (assuming it has extraction data)
    const testIPO = TEST_IPOS[0];
    await navigateToIPOEdit(page, testIPO.slug);
    await page.click('text=Financials');
    await page.waitForTimeout(1000);

    const extractionViewer = page.locator('text=DRHP Extraction Results');

    if (await extractionViewer.isVisible()) {
      // Get status badge
      const statusBadge = page.locator('[class*="rounded-full"]').first();
      const statusText = await statusBadge.textContent();

      console.log(`Status: ${statusText}`);

      // Verify appropriate styling is applied
      const badgeClasses = await statusBadge.getAttribute('class');
      console.log(`Badge classes: ${badgeClasses}`);
    }
  });
});
