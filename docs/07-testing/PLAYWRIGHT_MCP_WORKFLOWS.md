# Playwright MCP Workflows - Headed Mode Testing

**Created**: 2025-11-12
**Purpose**: Quick reference guide for UI verification using Playwright MCP in headed mode
**Status**: Active - Primary testing approach (60% of testing effort)

---

## 🎯 Testing Strategy Update

### **New Distribution with Playwright MCP:**

- **60% Playwright MCP (Headed Mode)**: Interactive UI verification, visual testing, Claude-assisted exploration
- **30% Native Playwright (Automated)**: CI/CD pipeline, regression tests, cross-browser automation
- **10% Chrome DevTools MCP**: Performance profiling, memory analysis, optimization

### **Why Playwright MCP in Headed Mode?**

✅ **Visual Verification**: See UI changes in real-time
✅ **Interactive Debugging**: Claude guides you through UI exploration
✅ **Rapid Validation**: Quick manual checks during development
✅ **Screenshot Documentation**: Capture visual evidence of bugs/features
✅ **Accessibility Snapshot**: Better than screenshots for structure inspection

---

## 📋 Common Playwright MCP Commands

### Navigation & Page Interaction

```javascript
// Navigate to page
await mcp__playwright__browser_navigate('http://localhost:3000');

// Navigate back
await mcp__playwright__browser_navigate_back();

// Wait for text to appear
await mcp__playwright__browser_wait_for({ text: 'Latest IPOs' });

// Wait for text to disappear
await mcp__playwright__browser_wait_for({ textGone: 'Loading...' });

// Wait for time
await mcp__playwright__browser_wait_for({ time: 2 }); // 2 seconds
```

### Visual Inspection

```javascript
// Take accessibility snapshot (RECOMMENDED - better than screenshot)
await mcp__playwright__browser_snapshot();

// Take full page screenshot
await mcp__playwright__browser_take_screenshot({
  filename: 'homepage.png',
  fullPage: true
});

// Take element screenshot
await mcp__playwright__browser_take_screenshot({
  element: 'IPO Card',
  ref: 'css=.ipo-card',
  filename: 'ipo-card.png'
});

// Take viewport screenshot only
await mcp__playwright__browser_take_screenshot({
  filename: 'viewport.png',
  fullPage: false
});
```

### User Interactions

```javascript
// Click element
await mcp__playwright__browser_click({
  element: 'Login Button',
  ref: 'css=button[type="submit"]'
});

// Double click
await mcp__playwright__browser_click({
  element: 'Row',
  ref: 'css=tr',
  doubleClick: true
});

// Type text
await mcp__playwright__browser_type({
  element: 'Search Input',
  ref: 'css=input[type="search"]',
  text: 'Technology IPOs'
});

// Type slowly (trigger key handlers)
await mcp__playwright__browser_type({
  element: 'Search Input',
  ref: 'css=input[type="search"]',
  text: 'Tech',
  slowly: true
});

// Type and submit (press Enter)
await mcp__playwright__browser_type({
  element: 'Search Input',
  ref: 'css=input[type="search"]',
  text: 'Technology',
  submit: true
});

// Hover over element
await mcp__playwright__browser_hover({
  element: 'Tooltip Trigger',
  ref: 'css=.tooltip-trigger'
});

// Press keyboard key
await mcp__playwright__browser_press_key({ key: 'Escape' });
await mcp__playwright__browser_press_key({ key: 'Enter' });
await mcp__playwright__browser_press_key({ key: 'Tab' });
```

### Form Filling

```javascript
// Fill multiple form fields at once
await mcp__playwright__browser_fill_form({
  fields: [
    {
      name: 'Email',
      type: 'textbox',
      ref: 'css=input[name="email"]',
      value: 'user@example.com'
    },
    {
      name: 'Password',
      type: 'textbox',
      ref: 'css=input[name="password"]',
      value: 'securepassword'
    },
    {
      name: 'Remember Me',
      type: 'checkbox',
      ref: 'css=input[type="checkbox"]',
      value: 'true'
    }
  ]
});

// Select dropdown option
await mcp__playwright__browser_select_option({
  element: 'Sector Dropdown',
  ref: 'css=select[name="sector"]',
  values: ['Technology']
});

// Select multiple options
await mcp__playwright__browser_select_option({
  element: 'Multi-select',
  ref: 'css=select[multiple]',
  values: ['Technology', 'Healthcare']
});
```

### Debugging & Inspection

```javascript
// Get console messages (all)
await mcp__playwright__browser_console_messages();

// Get only errors
await mcp__playwright__browser_console_messages({ onlyErrors: true });

// Get network requests
await mcp__playwright__browser_network_requests();

// Execute JavaScript
await mcp__playwright__browser_evaluate({
  function: '() => document.title'
});

// Execute JavaScript on element
await mcp__playwright__browser_evaluate({
  element: 'IPO Card',
  ref: 'css=.ipo-card',
  function: '(element) => element.textContent'
});
```

### Viewport & Tab Management

```javascript
// Resize browser
await mcp__playwright__browser_resize({ width: 375, height: 667 }); // iPhone SE
await mcp__playwright__browser_resize({ width: 768, height: 1024 }); // iPad
await mcp__playwright__browser_resize({ width: 1920, height: 1080 }); // Desktop

// List tabs
await mcp__playwright__browser_tabs({ action: 'list' });

// Create new tab
await mcp__playwright__browser_tabs({ action: 'new' });

// Close current tab
await mcp__playwright__browser_tabs({ action: 'close' });

// Select tab by index
await mcp__playwright__browser_tabs({ action: 'select', index: 0 });

// Close browser
await mcp__playwright__browser_close();
```

---

## 🔧 Common Testing Workflows

### Workflow 1: Visual Regression Baseline Creation

```javascript
// 1. Navigate to page
await mcp__playwright__browser_navigate('http://localhost:3000/dashboard');

// 2. Wait for content to load
await mcp__playwright__browser_wait_for({ text: 'Dashboard' });

// 3. Take accessibility snapshot (see structure)
await mcp__playwright__browser_snapshot();

// 4. Visually verify in headed mode (you see the browser)

// 5. Take baseline screenshot
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-dashboard.png',
  fullPage: true
});

// 6. Test responsive versions
await mcp__playwright__browser_resize({ width: 375, height: 667 });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-dashboard-mobile.png',
  fullPage: true
});
```

### Workflow 2: Bug Investigation & Reproduction

```javascript
// 1. Navigate to problematic page
await mcp__playwright__browser_navigate('http://localhost:3000/ipos/problem-ipo');

// 2. Check console for errors
const errors = await mcp__playwright__browser_console_messages({ onlyErrors: true });

// 3. Take screenshot of error state
await mcp__playwright__browser_take_screenshot({
  filename: 'bug-error-state.png',
  fullPage: true
});

// 4. Try to reproduce the bug (interact with UI)
await mcp__playwright__browser_click({ element: 'Trigger Button' });
await mcp__playwright__browser_wait_for({ time: 1 });

// 5. Capture final state
await mcp__playwright__browser_snapshot();
await mcp__playwright__browser_take_screenshot({
  filename: 'bug-after-interaction.png',
  fullPage: true
});

// 6. Document network requests (check for failed API calls)
await mcp__playwright__browser_network_requests();
```

### Workflow 3: Interactive Form Testing

```javascript
// 1. Navigate to form page
await mcp__playwright__browser_navigate('http://localhost:3000/tools/lot-calculator');

// 2. Fill form fields
await mcp__playwright__browser_fill_form({
  fields: [
    { name: 'Price per Share', type: 'textbox', ref: 'css=#price', value: '150' },
    { name: 'Lot Size', type: 'textbox', ref: 'css=#lotSize', value: '100' },
    { name: 'Number of Lots', type: 'textbox', ref: 'css=#numLots', value: '5' }
  ]
});

// 3. Submit form
await mcp__playwright__browser_click({
  element: 'Calculate Button',
  ref: 'css=button[type="submit"]'
});

// 4. Wait for results
await mcp__playwright__browser_wait_for({ text: 'Total Investment' });

// 5. Verify visually and capture
await mcp__playwright__browser_take_screenshot({
  filename: 'lot-calculator-results.png'
});

// 6. Extract calculated value (if needed)
const result = await mcp__playwright__browser_evaluate({
  function: '() => document.querySelector("#totalInvestment").textContent'
});
```

### Workflow 4: Mobile Viewport Testing

```javascript
// 1. Resize to mobile
await mcp__playwright__browser_resize({ width: 375, height: 667 });

// 2. Navigate
await mcp__playwright__browser_navigate('http://localhost:3000');

// 3. Test bottom navigation (mobile-specific)
await mcp__playwright__browser_click({
  element: 'Dashboard Tab',
  ref: 'css=.bottom-nav button[data-tab="dashboard"]'
});
await mcp__playwright__browser_wait_for({ text: 'Dashboard' });

// 4. Screenshot mobile layout
await mcp__playwright__browser_take_screenshot({
  filename: 'mobile-dashboard.png',
  fullPage: true
});

// 5. Test swipe-like interactions (click and drag)
await mcp__playwright__browser_drag({
  startElement: 'IPO Card 1',
  startRef: 'css=.ipo-card:nth-child(1)',
  endElement: 'IPO Card 5',
  endRef: 'css=.ipo-card:nth-child(5)'
});

// 6. Verify mobile menu
await mcp__playwright__browser_click({
  element: 'Mobile Menu Button',
  ref: 'css=button.mobile-menu'
});
await mcp__playwright__browser_snapshot();
```

### Workflow 5: Accessibility Verification

```javascript
// 1. Navigate to page
await mcp__playwright__browser_navigate('http://localhost:3000/mainboard-ipos');

// 2. Take accessibility snapshot (BEST for a11y inspection)
await mcp__playwright__browser_snapshot();
// This shows:
// - Element hierarchy
// - ARIA labels
// - Role attributes
// - Focusable elements
// - Text content

// 3. Test keyboard navigation
await mcp__playwright__browser_press_key({ key: 'Tab' }); // Focus first element
await mcp__playwright__browser_take_screenshot({ filename: 'focus-state-1.png' });

await mcp__playwright__browser_press_key({ key: 'Tab' }); // Focus second element
await mcp__playwright__browser_take_screenshot({ filename: 'focus-state-2.png' });

await mcp__playwright__browser_press_key({ key: 'Enter' }); // Activate element
await mcp__playwright__browser_wait_for({ time: 1 });

// 4. Verify ARIA labels exist
const ariaLabels = await mcp__playwright__browser_evaluate({
  function: '() => Array.from(document.querySelectorAll("[aria-label]")).map(el => el.getAttribute("aria-label"))'
});

// 5. Document results
await mcp__playwright__browser_take_screenshot({
  filename: 'accessibility-verification.png',
  fullPage: true
});
```

### Workflow 6: Data Validation (DB to UI)

```javascript
// 1. Query database first (outside MCP, using Node.js)
// const dbData = await db.query.ipos.findFirst({ where: eq(ipos.slug, 'example-ipo') });

// 2. Navigate to IPO detail page
await mcp__playwright__browser_navigate('http://localhost:3000/ipos/example-ipo');

// 3. Take snapshot to see structure
await mcp__playwright__browser_snapshot();

// 4. Extract UI data using JavaScript
const uiCompanyName = await mcp__playwright__browser_evaluate({
  function: '() => document.querySelector("h1").textContent'
});

const uiPriceRange = await mcp__playwright__browser_evaluate({
  function: '() => document.querySelector(".price-range").textContent'
});

// 5. Compare with DB data (outside MCP)
// expect(uiCompanyName).toBe(dbData.companyName);

// 6. Screenshot for documentation
await mcp__playwright__browser_take_screenshot({
  filename: 'data-validation-ipo-detail.png',
  fullPage: true
});
```

---

## 🎨 Visual Regression Testing Pattern

### Complete Pattern for One Page

```javascript
// === STEP 1: Create Baseline ===
await mcp__playwright__browser_navigate('http://localhost:3000/mainboard-ipos');
await mcp__playwright__browser_wait_for({ text: 'Mainboard IPO Listings' });

// Verify visually in headed mode (you see browser window)
await mcp__playwright__browser_snapshot(); // Check structure

// Capture baseline
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mainboard-ipos.png',
  fullPage: true
});

// === STEP 2: Test Different States ===
// State 1: Filtered
await mcp__playwright__browser_click({ element: 'Filter Button' });
await mcp__playwright__browser_select_option({
  element: 'Status Filter',
  ref: 'css=select[name="status"]',
  values: ['OPEN']
});
await mcp__playwright__browser_wait_for({ text: 'Open IPOs' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mainboard-ipos-filtered.png',
  fullPage: true
});

// State 2: Searched
await mcp__playwright__browser_type({
  element: 'Search Input',
  ref: 'css=input[type="search"]',
  text: 'Technology',
  submit: true
});
await mcp__playwright__browser_wait_for({ text: 'Search Results' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mainboard-ipos-searched.png',
  fullPage: true
});

// === STEP 3: Mobile Responsive ===
await mcp__playwright__browser_resize({ width: 375, height: 667 });
await mcp__playwright__browser_navigate('http://localhost:3000/mainboard-ipos');
await mcp__playwright__browser_wait_for({ text: 'Mainboard IPO Listings' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mainboard-ipos-mobile.png',
  fullPage: true
});

// === STEP 4: Tablet ===
await mcp__playwright__browser_resize({ width: 768, height: 1024 });
await mcp__playwright__browser_navigate('http://localhost:3000/mainboard-ipos');
await mcp__playwright__browser_wait_for({ text: 'Mainboard IPO Listings' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mainboard-ipos-tablet.png',
  fullPage: true
});
```

---

## 🚨 Troubleshooting Common Issues

### Issue 1: Element Not Found

```javascript
// Problem: browser_click fails with "element not found"
// Solution: Use browser_snapshot to see what's actually on the page

await mcp__playwright__browser_navigate('http://localhost:3000');
await mcp__playwright__browser_snapshot(); // Shows all interactive elements

// Then retry with correct ref
await mcp__playwright__browser_click({
  element: 'Correct Button Name',
  ref: 'css=button.actual-class-name'
});
```

### Issue 2: Page Not Fully Loaded

```javascript
// Problem: Screenshot shows loading state
// Solution: Wait for specific content

await mcp__playwright__browser_navigate('http://localhost:3000/dashboard');
await mcp__playwright__browser_wait_for({ text: 'Dashboard Loaded' });
await mcp__playwright__browser_wait_for({ time: 1 }); // Extra buffer
await mcp__playwright__browser_take_screenshot({ filename: 'dashboard.png' });
```

### Issue 3: Console Errors After Navigation

```javascript
// Problem: Need to check if navigation caused errors
// Solution: Check console after each navigation

await mcp__playwright__browser_navigate('http://localhost:3000/ipos/test-ipo');
const errors = await mcp__playwright__browser_console_messages({ onlyErrors: true });

// If errors found, take screenshot and document
if (errors.length > 0) {
  await mcp__playwright__browser_take_screenshot({
    filename: 'errors-found.png'
  });
}
```

---

## 📊 When to Use Playwright MCP vs Native Playwright

| Use Case | Playwright MCP (Headed) | Native Playwright (Automated) |
|----------|------------------------|-------------------------------|
| **Visual verification during development** | ✅ Primary | ❌ |
| **Creating baseline screenshots** | ✅ Primary | ⚠️ Secondary |
| **Bug reproduction & debugging** | ✅ Primary | ⚠️ Secondary |
| **Interactive UI exploration** | ✅ Primary | ❌ |
| **Manual testing with Claude help** | ✅ Primary | ❌ |
| **CI/CD automated tests** | ❌ | ✅ Primary |
| **Cross-browser testing** | ⚠️ Limited (Chromium only) | ✅ Primary (7 browsers) |
| **Regression test suites** | ❌ | ✅ Primary |
| **Performance testing** | ❌ | ✅ (with Lighthouse) |
| **Accessibility testing** | ⚠️ Snapshot only | ✅ (with axe-core) |

---

## 🎯 Best Practices

### 1. Always Use Headed Mode for Visual Verification
- You can see what's happening in real-time
- Easier to debug issues
- Confirm UI state before capturing screenshots

### 2. Use `browser_snapshot` Before Screenshots
- Shows accessibility tree structure
- Better for understanding what's on the page
- Reveals ARIA labels and roles

### 3. Wait for Content to Load
- Use `browser_wait_for` with specific text
- Add small time buffer if needed
- Avoid screenshots of loading states

### 4. Organize Screenshots with Descriptive Names
```javascript
// ✅ Good
'baseline-dashboard-filtered-by-sector.png'

// ❌ Bad
'screenshot1.png'
```

### 5. Document Your Testing Session
- Take screenshots at key steps
- Use console messages to understand errors
- Create before/after comparisons for bug fixes

### 6. Resize Browser for Responsive Testing
- Test at least 3 viewports: mobile (375px), tablet (768px), desktop (1920px)
- Take screenshots of each responsive breakpoint

### 7. Combine with Native Playwright for CI/CD
- Use MCP for baseline creation and verification
- Use native Playwright scripts for automated regression tests

---

## 📝 Example Testing Session

**Task**: Verify Dashboard Page Works Correctly

```javascript
// 1. Start fresh
await mcp__playwright__browser_navigate('http://localhost:3000/dashboard');

// 2. Check for errors
const errors = await mcp__playwright__browser_console_messages({ onlyErrors: true });
console.log(`Errors found: ${errors.length}`);

// 3. Visual verification (see in headed mode)
await mcp__playwright__browser_snapshot();

// 4. Test filters
await mcp__playwright__browser_click({ element: 'Filter Button' });
await mcp__playwright__browser_select_option({
  element: 'Sector',
  ref: 'css=select[name="sector"]',
  values: ['Technology']
});
await mcp__playwright__browser_wait_for({ text: 'Technology IPOs' });

// 5. Screenshot filtered state
await mcp__playwright__browser_take_screenshot({
  filename: 'dashboard-filtered-technology.png',
  fullPage: true
});

// 6. Test search
await mcp__playwright__browser_type({
  element: 'Search',
  ref: 'css=input[type="search"]',
  text: 'Software',
  submit: true
});
await mcp__playwright__browser_wait_for({ text: 'Search Results' });

// 7. Screenshot search results
await mcp__playwright__browser_take_screenshot({
  filename: 'dashboard-search-software.png',
  fullPage: true
});

// 8. Test mobile view
await mcp__playwright__browser_resize({ width: 375, height: 667 });
await mcp__playwright__browser_navigate('http://localhost:3000/dashboard');
await mcp__playwright__browser_wait_for({ text: 'Dashboard' });
await mcp__playwright__browser_take_screenshot({
  filename: 'dashboard-mobile.png',
  fullPage: true
});

// 9. Check network requests (any failures?)
const networkRequests = await mcp__playwright__browser_network_requests();

// 10. Final verification
console.log('Dashboard testing complete!');
console.log('Errors:', errors.length);
console.log('Screenshots saved: 3');
```

---

**Last Updated**: 2025-11-12
**Related Docs**:
- [Comprehensive UI Testing Plan](./COMPREHENSIVE_UI_TESTING_PLAN.md)
- [MCP Status Report](./MCP_STATUS_REPORT.md)
- [Chrome DevTools MCP Integration](./CHROME_DEVTOOLS_MCP_INTEGRATION.md)
