# Comprehensive UI/UX Testing Guide for IPODhan

## Overview
This guide provides a systematic approach to test all screens using Playwright MCP in headed mode. The browser will remain open throughout testing, allowing you to observe each interaction in real-time.

---

## Testing Methodology

### What We Test:
1. **Visual Elements**: Layout, spacing, alignment, colors, fonts
2. **Navigation**: Links, buttons, routing
3. **Interactive Components**: Dropdowns, filters, search, forms
4. **Data Display**: Cards, tables, lists
5. **Responsive Design**: Different viewport sizes
6. **Accessibility**: ARIA labels, keyboard navigation
7. **Error States**: Empty states, loading states, error messages
8. **Performance**: Page load times, API responses

### How to Use This Guide:
For each screen, Playwright MCP will:
- Navigate to the page
- Take full-page screenshots
- Test interactive elements
- Verify links and buttons
- Test form inputs and validations
- Check responsive behavior
- Document findings in test-results.md

---

## Test Checklist by Screen

### ✅ 1. HOME PAGE (/)
**Status**: IN PROGRESS

**Elements to Test:**
- [x] Header navigation
- [x] Tools dropdown (4 items)
- [ ] CTA buttons (Browse IPOs, Calculate Lots)
- [ ] Feature cards (6 cards)
- [ ] Footer links
- [ ] Logo navigation
- [ ] Responsive layout

**Screenshots:**
- home-page-full.png
- home-tools-dropdown.png

---

### 🔄 2. DASHBOARD (/dashboard)
**Status**: IN PROGRESS

**Elements to Test:**
- [ ] Grid/List view toggle
- [ ] Search functionality
- [ ] Status filter (Open, Closed, Upcoming, Listed)
- [ ] Category filter (Mainboard, SME, Rights, NCD)
- [ ] Sector filter
- [ ] Clear filters button
- [ ] IPO cards (12 per page)
- [ ] Pagination (Next/Previous, Page numbers)
- [ ] IPO card clicks (navigate to detail)
- [ ] Data loading state
- [ ] Empty state
- [ ] Responsive grid

**Test Data:**
- Total IPOs shown: 22
- Default filter: Open
- Default view: Grid
- Items per page: 12

---

### ⏳ 3. IPO DETAIL PAGE (/ipos/[slug])
**Elements to Test:**
- [ ] IPO header information
- [ ] Tabs (Overview, Financials, Subscription, etc.)
- [ ] Apply buttons/links
- [ ] Subscription data tables
- [ ] Timeline/dates display
- [ ] Related IPOs section
- [ ] Back to dashboard link
- [ ] Share buttons
- [ ] Responsive layout

**Test IPOs:**
- /ipos/bhairav-enterprises-limited
- /ipos/cdg-petchem-ltd
- /ipos/healthy-life-agritec-ltd (SME category)

---

### ⏳ 4. LOT SIZE CALCULATOR (/tools/lot-calculator)
**Elements to Test:**
- [ ] IPO selection dropdown
- [ ] Investment amount input
- [ ] Price selection (Min/Max/Custom)
- [ ] Calculate button
- [ ] Results display
- [ ] Input validation
- [ ] Clear/Reset functionality
- [ ] Error messages
- [ ] Responsive layout

**Test Cases:**
- Valid input: Amount=10000, Price=19
- Invalid input: Negative numbers
- Empty input
- Very large numbers
- Decimal numbers

---

### ⏳ 5. COMPARE IPOs (/tools/compare)
**Elements to Test:**
- [ ] IPO selection dropdowns (3)
- [ ] Add/Remove IPO buttons
- [ ] Comparison table
- [ ] Clear all button
- [ ] Side-by-side layout
- [ ] Data accuracy
- [ ] Empty state (no IPOs selected)
- [ ] Responsive table

**Test Cases:**
- Compare 2 IPOs
- Compare 3 IPOs
- Remove IPO from comparison
- Clear all

---

### ⏳ 6. MARKET HOLIDAYS (/market-holidays)
**Elements to Test:**
- [ ] Holiday list/calendar
- [ ] NSE holidays
- [ ] BSE holidays
- [ ] Year filter
- [ ] Search functionality
- [ ] Data display format
- [ ] Responsive layout

---

### ⏳ 7. REGISTRARS (/registrars)
**Elements to Test:**
- [ ] Registrar list/cards
- [ ] Search functionality
- [ ] Contact information display
- [ ] Website links (external)
- [ ] Email links
- [ ] Phone numbers
- [ ] Responsive grid

---

### ⏳ 8. HISTORY (/history)
**Elements to Test:**
- [ ] Historical IPO list
- [ ] Date filters
- [ ] Status filters
- [ ] Search functionality
- [ ] Sorting options
- [ ] Pagination
- [ ] Data display
- [ ] Responsive table

---

### ⏳ 9. ABOUT (/about)
**Elements to Test:**
- [ ] Page content
- [ ] Section navigation
- [ ] Images/graphics
- [ ] Links
- [ ] Responsive layout

---

### ⏳ 10. AFFILIATES (/affiliates)
**Elements to Test:**
- [ ] Affiliate program details
- [ ] Sign-up forms/links
- [ ] Terms and conditions
- [ ] Responsive layout

---

### ⏳ 11. RESOURCES (/resources)
**Elements to Test:**
- [ ] Resource categories
- [ ] Download links
- [ ] External links
- [ ] Search functionality
- [ ] Responsive layout

---

### ⏳ 12. PRIVACY POLICY (/privacy)
**Elements to Test:**
- [ ] Content sections
- [ ] Table of contents
- [ ] Anchor links
- [ ] Last updated date
- [ ] Responsive layout

---

### ⏳ 13. TERMS OF SERVICE (/terms)
**Elements to Test:**
- [ ] Content sections
- [ ] Table of contents
- [ ] Anchor links
- [ ] Last updated date
- [ ] Responsive layout

---

### ⏳ 14. DISCLAIMER (/disclaimer)
**Elements to Test:**
- [ ] Content sections
- [ ] Important notices
- [ ] Links
- [ ] Responsive layout

---

### ⏳ 15. RESPONSIVE TESTING
**Viewports to Test:**
- [ ] Mobile (375x667) - iPhone SE
- [ ] Mobile Large (414x896) - iPhone 11 Pro
- [ ] Tablet (768x1024) - iPad
- [ ] Desktop Small (1280x720)
- [ ] Desktop Large (1920x1080)

**Test on Each Viewport:**
- Navigation menu (mobile hamburger)
- Content layout
- Images and media
- Forms and inputs
- Tables and data display
- Buttons and CTAs

---

## Common Issues to Look For

### UI Issues:
- Misaligned elements
- Overlapping content
- Incorrect spacing/padding
- Font size inconsistencies
- Color contrast issues
- Missing or broken images
- Truncated text

### UX Issues:
- Non-functional buttons/links
- Slow loading times
- Confusing navigation
- Missing error messages
- Poor form validation
- Unclear CTAs
- Inconsistent interactions

### Accessibility Issues:
- Missing alt text
- Poor keyboard navigation
- Insufficient color contrast
- Missing ARIA labels
- No focus indicators

---

## Testing Commands for Playwright MCP

### Basic Navigation:
```
browser_navigate(url: "http://localhost:3000/[page]")
```

### Take Screenshots:
```
browser_take_screenshot(filename: "page-name.png", fullPage: true)
```

### Click Elements:
```
browser_click(element: "Button name", ref: "e123")
```

### Type Input:
```
browser_type(element: "Input field", ref: "e123", text: "test value")
```

### Select Dropdown:
```
browser_select_option(element: "Dropdown", ref: "e123", values: ["value"])
```

### Resize Browser (Responsive):
```
browser_resize(width: 375, height: 667)
```

### Wait for Content:
```
browser_wait_for(time: 2)
```

---

## Test Results Documentation

All findings will be documented in `test-results.md` with:
- Issue description
- Severity (Critical, High, Medium, Low)
- Screenshot reference
- Steps to reproduce
- Expected vs Actual behavior

---

## Next Steps

1. Continue systematic testing of Dashboard
2. Test each screen in order
3. Document all findings
4. Create responsive test matrix
5. Generate final test report
6. Create issue list for fixes

