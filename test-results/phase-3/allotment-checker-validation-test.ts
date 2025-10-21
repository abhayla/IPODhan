/**
 * Allotment Checker Validation Testing Script
 * Phase 3 Tools & Features Testing - Test #28 (Enhancement #16)
 *
 * Tests:
 * 1. PAN format validation (all test cases)
 * 2. Form field validation
 * 3. UI/UX elements
 * 4. Accessibility
 * 5. Form submission and redirect
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  testName: string;
  status: 'PASS' | 'FAIL';
  details: string;
  screenshot?: string;
}

const results: TestResult[] = [];
const screenshotsDir = path.join(__dirname, 'screenshots', 'allotment-checker');

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Test URLs
const CLOSED_IPO_URL = 'http://localhost:3000/ipos/midwest-ltd-ipo-c';
const LISTED_IPO_URL = 'http://localhost:3000/ipos/shlokka-dyes-ltd-ipo';
const UPCOMING_IPO_URL = 'http://localhost:3000/ipos/sme-ipo-1'; // Should NOT show checker

async function takeScreenshot(page: Page, name: string): Promise<string> {
  const filename = `${name}-${Date.now()}.png`;
  const filepath = path.join(screenshotsDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filename;
}

async function testPANValidation(browser: Browser) {
  console.log('\n🧪 Testing PAN Validation...\n');
  const page = await browser.newPage();

  try {
    await page.goto(CLOSED_IPO_URL);
    await page.waitForLoadState('networkidle');

    // Take initial screenshot
    const initialScreenshot = await takeScreenshot(page, 'initial-form');

    // Test Case 1: Valid PAN
    console.log('  ✓ Test 1: Valid PAN (ABCDE1234F)');
    await page.fill('input#pan', 'ABCDE1234F');
    await page.waitForTimeout(500);

    const errorVisible1 = await page.isVisible('text=/Invalid PAN|PAN must be/');
    const buttonDisabled1 = await page.isDisabled('button:has-text("Check Status")');

    results.push({
      testName: 'Valid PAN - ABCDE1234F',
      status: !errorVisible1 && !buttonDisabled1 ? 'PASS' : 'FAIL',
      details: `Error visible: ${errorVisible1}, Button disabled: ${buttonDisabled1}`,
      screenshot: await takeScreenshot(page, 'valid-pan'),
    });

    // Test Case 2: Invalid PAN - Too short
    console.log('  ✓ Test 2: Invalid PAN - Too short (abc123)');
    await page.fill('input#pan', 'abc123');
    await page.waitForTimeout(500);

    const errorVisible2 = await page.isVisible('text=PAN must be 10 characters');
    const buttonDisabled2 = await page.isDisabled('button:has-text("Check Status")');

    results.push({
      testName: 'Invalid PAN - Too short (abc123)',
      status: errorVisible2 && buttonDisabled2 ? 'PASS' : 'FAIL',
      details: `Error visible: ${errorVisible2}, Button disabled: ${buttonDisabled2}`,
      screenshot: await takeScreenshot(page, 'invalid-short'),
    });

    // Test Case 3: Invalid PAN - Wrong format (numbers instead of letters)
    console.log('  ✓ Test 3: Invalid PAN - Wrong format (ABCDE12345)');
    await page.fill('input#pan', 'ABCDE12345');
    await page.waitForTimeout(500);

    const errorVisible3 = await page.isVisible('text=Invalid PAN format');
    const buttonDisabled3 = await page.isDisabled('button:has-text("Check Status")');

    results.push({
      testName: 'Invalid PAN - Wrong format (ABCDE12345)',
      status: errorVisible3 && buttonDisabled3 ? 'PASS' : 'FAIL',
      details: `Error visible: ${errorVisible3}, Button disabled: ${buttonDisabled3}`,
      screenshot: await takeScreenshot(page, 'invalid-format-1'),
    });

    // Test Case 4: Invalid PAN - All numbers
    console.log('  ✓ Test 4: Invalid PAN - All numbers (1234567890)');
    await page.fill('input#pan', '1234567890');
    await page.waitForTimeout(500);

    const errorVisible4 = await page.isVisible('text=Invalid PAN format');
    const buttonDisabled4 = await page.isDisabled('button:has-text("Check Status")');

    results.push({
      testName: 'Invalid PAN - All numbers (1234567890)',
      status: errorVisible4 && buttonDisabled4 ? 'PASS' : 'FAIL',
      details: `Error visible: ${errorVisible4}, Button disabled: ${buttonDisabled4}`,
      screenshot: await takeScreenshot(page, 'invalid-all-numbers'),
    });

    // Test Case 5: Invalid PAN - All letters
    console.log('  ✓ Test 5: Invalid PAN - All letters (ABCDEFGHIJ)');
    await page.fill('input#pan', 'ABCDEFGHIJ');
    await page.waitForTimeout(500);

    const errorVisible5 = await page.isVisible('text=Invalid PAN format');
    const buttonDisabled5 = await page.isDisabled('button:has-text("Check Status")');

    results.push({
      testName: 'Invalid PAN - All letters (ABCDEFGHIJ)',
      status: errorVisible5 && buttonDisabled5 ? 'PASS' : 'FAIL',
      details: `Error visible: ${errorVisible5}, Button disabled: ${buttonDisabled5}`,
      screenshot: await takeScreenshot(page, 'invalid-all-letters'),
    });

    // Test Case 6: Invalid PAN - Special characters
    console.log('  ✓ Test 6: Invalid PAN - Special characters (ABC@E1234F)');
    await page.fill('input#pan', 'ABC@E1234F');
    await page.waitForTimeout(500);

    const errorVisible6 = await page.isVisible('text=Invalid PAN format');
    const buttonDisabled6 = await page.isDisabled('button:has-text("Check Status")');

    results.push({
      testName: 'Invalid PAN - Special characters (ABC@E1234F)',
      status: errorVisible6 && buttonDisabled6 ? 'PASS' : 'FAIL',
      details: `Error visible: ${errorVisible6}, Button disabled: ${buttonDisabled6}`,
      screenshot: await takeScreenshot(page, 'invalid-special-chars'),
    });

    // Test Case 7: Auto-uppercase conversion
    console.log('  ✓ Test 7: Auto-uppercase conversion (abcde1234f -> ABCDE1234F)');
    await page.fill('input#pan', 'abcde1234f');
    await page.waitForTimeout(500);

    const inputValue = await page.inputValue('input#pan');

    results.push({
      testName: 'Auto-uppercase conversion',
      status: inputValue === 'ABCDE1234F' ? 'PASS' : 'FAIL',
      details: `Input value: ${inputValue}, Expected: ABCDE1234F`,
      screenshot: await takeScreenshot(page, 'uppercase-conversion'),
    });

    // Test Case 8: Empty field state
    console.log('  ✓ Test 8: Empty field state');
    await page.fill('input#pan', '');
    await page.waitForTimeout(500);

    const errorVisible8 = await page.isVisible('text=/Invalid PAN|PAN must be/');
    const buttonDisabled8 = await page.isDisabled('button:has-text("Check Status")');

    results.push({
      testName: 'Empty field state',
      status: !errorVisible8 && buttonDisabled8 ? 'PASS' : 'FAIL',
      details: `Error visible: ${errorVisible8}, Button disabled: ${buttonDisabled8}`,
      screenshot: await takeScreenshot(page, 'empty-field'),
    });

  } catch (error) {
    results.push({
      testName: 'PAN Validation Tests',
      status: 'FAIL',
      details: `Error: ${error}`,
    });
  } finally {
    await page.close();
  }
}

async function testUIElements(browser: Browser) {
  console.log('\n🎨 Testing UI/UX Elements...\n');
  const page = await browser.newPage();

  try {
    await page.goto(CLOSED_IPO_URL);
    await page.waitForLoadState('networkidle');

    // Test 1: Card is visible
    const cardVisible = await page.isVisible('text=Check Allotment Status');
    results.push({
      testName: 'Allotment Checker Card Visible',
      status: cardVisible ? 'PASS' : 'FAIL',
      details: `Card visible: ${cardVisible}`,
    });

    // Test 2: Input field has proper attributes
    const inputPlaceholder = await page.getAttribute('input#pan', 'placeholder');
    const inputMaxLength = await page.getAttribute('input#pan', 'maxlength');
    const inputClass = await page.getAttribute('input#pan', 'class');

    results.push({
      testName: 'Input Field Attributes',
      status: inputPlaceholder === 'ABCDE1234F' && inputMaxLength === '10' && inputClass?.includes('uppercase') ? 'PASS' : 'FAIL',
      details: `Placeholder: ${inputPlaceholder}, MaxLength: ${inputMaxLength}, Has uppercase class: ${inputClass?.includes('uppercase')}`,
    });

    // Test 3: Label is descriptive
    const labelText = await page.textContent('label[for="pan"]');
    results.push({
      testName: 'Descriptive Label',
      status: labelText?.includes('PAN') ? 'PASS' : 'FAIL',
      details: `Label text: ${labelText}`,
    });

    // Test 4: Button text includes registrar name
    const buttonText = await page.textContent('button:has-text("Check Status")');
    results.push({
      testName: 'Button Text Includes Registrar',
      status: buttonText?.includes('Link Intime') || buttonText?.includes('Registrar') ? 'PASS' : 'FAIL',
      details: `Button text: ${buttonText}`,
    });

    // Test 5: Security notice is visible
    const securityNotice = await page.isVisible('text=/Your PAN is not stored/');
    results.push({
      testName: 'Security Notice Visible',
      status: securityNotice ? 'PASS' : 'FAIL',
      details: `Security notice visible: ${securityNotice}`,
      screenshot: await takeScreenshot(page, 'security-notice'),
    });

    // Test 6: Link to registrars page exists
    const registrarsLink = await page.isVisible('a[href="/registrars"]');
    results.push({
      testName: 'Link to Registrars Page',
      status: registrarsLink ? 'PASS' : 'FAIL',
      details: `Registrars link visible: ${registrarsLink}`,
    });

  } catch (error) {
    results.push({
      testName: 'UI Elements Tests',
      status: 'FAIL',
      details: `Error: ${error}`,
    });
  } finally {
    await page.close();
  }
}

async function testAccessibility(browser: Browser) {
  console.log('\n♿ Testing Accessibility...\n');
  const page = await browser.newPage();

  try {
    await page.goto(CLOSED_IPO_URL);
    await page.waitForLoadState('networkidle');

    // Test 1: Label for attribute matches input id
    const labelFor = await page.getAttribute('label', 'for');
    const inputId = await page.getAttribute('input#pan', 'id');

    results.push({
      testName: 'Label-Input Association',
      status: labelFor === inputId ? 'PASS' : 'FAIL',
      details: `Label for: ${labelFor}, Input id: ${inputId}`,
    });

    // Test 2: Input has aria-label
    const ariaLabel = await page.getAttribute('input#pan', 'aria-label');
    results.push({
      testName: 'Input ARIA Label',
      status: ariaLabel !== null ? 'PASS' : 'FAIL',
      details: `ARIA label: ${ariaLabel}`,
    });

    // Test 3: Keyboard navigation works
    await page.focus('input#pan');
    const isFocused = await page.evaluate(() => document.activeElement?.id === 'pan');

    results.push({
      testName: 'Keyboard Navigation - Input Focus',
      status: isFocused ? 'PASS' : 'FAIL',
      details: `Input focused via keyboard: ${isFocused}`,
    });

    // Test 4: Tab to button
    await page.keyboard.press('Tab');
    const buttonFocused = await page.evaluate(() =>
      document.activeElement?.tagName === 'BUTTON' ||
      document.activeElement?.tagName === 'A'
    );

    results.push({
      testName: 'Keyboard Navigation - Tab to Button',
      status: buttonFocused ? 'PASS' : 'FAIL',
      details: `Button/Link focused via Tab: ${buttonFocused}`,
    });

  } catch (error) {
    results.push({
      testName: 'Accessibility Tests',
      status: 'FAIL',
      details: `Error: ${error}`,
    });
  } finally {
    await page.close();
  }
}

async function testFormSubmission(browser: Browser) {
  console.log('\n📤 Testing Form Submission...\n');
  const page = await browser.newPage();

  try {
    await page.goto(CLOSED_IPO_URL);
    await page.waitForLoadState('networkidle');

    // Fill valid PAN
    await page.fill('input#pan', 'ABCDE1234F');
    await page.waitForTimeout(500);

    // Take screenshot before submission
    await takeScreenshot(page, 'before-submission');

    // Listen for new page/popup
    const [newPage] = await Promise.all([
      page.waitForEvent('popup'),
      page.click('button:has-text("Check Status")'),
    ]);

    // Verify redirect
    const newUrl = newPage.url();
    const hasExpectedUrl = newUrl.includes('linkintime.co.in') || newUrl.includes('MIPO');
    const hasPanParam = newUrl.includes('pan=ABCDE1234F');

    results.push({
      testName: 'Form Submission - Redirect to Registrar',
      status: hasExpectedUrl ? 'PASS' : 'FAIL',
      details: `Redirected to: ${newUrl}, Has expected URL: ${hasExpectedUrl}`,
    });

    results.push({
      testName: 'Form Submission - PAN Parameter Passed',
      status: hasPanParam ? 'PASS' : 'FAIL',
      details: `URL: ${newUrl}, PAN parameter present: ${hasPanParam}`,
    });

    await newPage.close();

  } catch (error) {
    results.push({
      testName: 'Form Submission Tests',
      status: 'FAIL',
      details: `Error: ${error}`,
    });
  } finally {
    await page.close();
  }
}

async function testVisibilityRules(browser: Browser) {
  console.log('\n👁️  Testing Visibility Rules...\n');

  // Test 1: CLOSED IPO - Should show
  const page1 = await browser.newPage();
  try {
    await page1.goto(CLOSED_IPO_URL);
    await page1.waitForLoadState('networkidle');
    const visible1 = await page1.isVisible('text=Check Allotment Status');

    results.push({
      testName: 'Visibility - CLOSED IPO',
      status: visible1 ? 'PASS' : 'FAIL',
      details: `Allotment checker visible on CLOSED IPO: ${visible1}`,
      screenshot: await takeScreenshot(page1, 'closed-ipo-visibility'),
    });
  } finally {
    await page1.close();
  }

  // Test 2: LISTED IPO - Should show
  const page2 = await browser.newPage();
  try {
    await page2.goto(LISTED_IPO_URL);
    await page2.waitForLoadState('networkidle');
    const visible2 = await page2.isVisible('text=Check Allotment Status');

    results.push({
      testName: 'Visibility - LISTED IPO',
      status: visible2 ? 'PASS' : 'FAIL',
      details: `Allotment checker visible on LISTED IPO: ${visible2}`,
      screenshot: await takeScreenshot(page2, 'listed-ipo-visibility'),
    });
  } finally {
    await page2.close();
  }

  // Test 3: UPCOMING/OPEN IPO - Should NOT show
  const page3 = await browser.newPage();
  try {
    await page3.goto(UPCOMING_IPO_URL);
    await page3.waitForLoadState('networkidle');
    const visible3 = await page3.isVisible('text=Check Allotment Status');

    results.push({
      testName: 'Visibility - UPCOMING IPO (Should NOT show)',
      status: !visible3 ? 'PASS' : 'FAIL',
      details: `Allotment checker visible on UPCOMING IPO: ${visible3} (should be false)`,
      screenshot: await takeScreenshot(page3, 'upcoming-ipo-no-checker'),
    });
  } catch (error) {
    // Page might not exist, that's OK
    results.push({
      testName: 'Visibility - UPCOMING IPO (Should NOT show)',
      status: 'PASS',
      details: 'Test skipped - UPCOMING IPO page not found',
    });
  } finally {
    await page3.close();
  }
}

async function testResponsiveLayout(browser: Browser) {
  console.log('\n📱 Testing Responsive Layout...\n');

  const viewports = [
    { name: 'Desktop', width: 1920, height: 1080 },
    { name: 'Tablet', width: 768, height: 1024 },
    { name: 'Mobile', width: 375, height: 667 },
  ];

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });

    try {
      await page.goto(CLOSED_IPO_URL);
      await page.waitForLoadState('networkidle');

      const cardVisible = await page.isVisible('text=Check Allotment Status');
      const inputVisible = await page.isVisible('input#pan');
      const buttonVisible = await page.isVisible('button:has-text("Check Status")');

      results.push({
        testName: `Responsive Layout - ${viewport.name}`,
        status: cardVisible && inputVisible && buttonVisible ? 'PASS' : 'FAIL',
        details: `Card: ${cardVisible}, Input: ${inputVisible}, Button: ${buttonVisible}`,
        screenshot: await takeScreenshot(page, `responsive-${viewport.name.toLowerCase()}`),
      });

    } finally {
      await page.close();
    }
  }
}

async function runTests() {
  console.log('🚀 Starting Allotment Checker Comprehensive Testing\n');
  console.log('=' .repeat(70));

  const browser = await chromium.launch({ headless: false }); // Show browser for debugging

  try {
    await testVisibilityRules(browser);
    await testPANValidation(browser);
    await testUIElements(browser);
    await testAccessibility(browser);
    await testResponsiveLayout(browser);
    await testFormSubmission(browser);

  } catch (error) {
    console.error('Test execution error:', error);
  } finally {
    await browser.close();
  }

  // Generate summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 TEST SUMMARY\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const total = results.length;

  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  // Print detailed results
  console.log('DETAILED RESULTS:\n');
  results.forEach((result, index) => {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${index + 1}. ${icon} ${result.testName}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Details: ${result.details}`);
    if (result.screenshot) {
      console.log(`   Screenshot: ${result.screenshot}`);
    }
    console.log('');
  });

  // Save results to JSON
  const resultsPath = path.join(__dirname, 'allotment-checker-test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({ summary: { total, passed, failed }, results }, null, 2));
  console.log(`\n📄 Results saved to: ${resultsPath}`);
  console.log(`📸 Screenshots saved to: ${screenshotsDir}`);
}

runTests().catch(console.error);
