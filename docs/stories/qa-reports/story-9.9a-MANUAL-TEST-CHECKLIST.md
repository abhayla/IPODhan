# Story 9.9a - Manual Testing Checklist

**Story:** Mainboard IPO Calendar Page
**Test Date:** 2025-10-12
**Tester:** _____________
**Dev Server:** http://localhost:3000
**Test Environment:** Development (npm run dev)

## Pre-Test Setup

- [ ] Dev server running on port 3000
- [ ] Browser: Chrome/Edge (latest)
- [ ] Browser console open (F12)
- [ ] Network tab open for debugging
- [ ] Clear browser cache

---

## Test Execution

### AC#1: Page Accessibility ✅

**Test:** Navigate to `/mainboard-ipo-calendar`

- [ ] Page loads without errors
- [ ] URL is `http://localhost:3000/mainboard-ipo-calendar`
- [ ] No 404 or error pages
- [ ] Page title visible in browser tab

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#2: Calendar Grid Display ✅

**Test:** Verify calendar grid structure

- [ ] Calendar displays as a grid on desktop (>768px)
- [ ] Grid has 7 columns (Sunday through Saturday)
- [ ] Days of week header row has green background
- [ ] Header text: "Sunday", "Monday", "Tuesday", etc.
- [ ] Current month displays correct number of days
  - October 2025: 31 days
  - Verify last day shows "31"

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#3: Month Navigation ✅

**Test:** Navigate between months

**Previous Month:**
- [ ] Click "Previous" button
- [ ] Calendar updates to previous month
- [ ] URL updates with query param: `?month=X&year=Y`
- [ ] Month name in header updates correctly

**Next Month:**
- [ ] Click "Next" button
- [ ] Calendar updates to next month
- [ ] URL updates with query param
- [ ] Month name in header updates correctly

**Month Wrapping:**
- [ ] Navigate to December 2025
- [ ] Click "Next" → Should show January 2026
- [ ] Navigate to January 2026
- [ ] Click "Previous" → Should show December 2025

**Browser Back/Forward:**
- [ ] Click browser back button → Previous month loads
- [ ] Click browser forward button → Next month loads

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#4: Mainboard Filter ✅

**Test:** Verify only Mainboard IPOs displayed

- [ ] Examine events in calendar
- [ ] Verify all events are Mainboard category
- [ ] No SME IPO events visible
- [ ] No NCDs, Rights Issues, or OFS events visible
- [ ] Check multiple months to confirm

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#5: No Tabs ✅

**Test:** Verify clean single-purpose page

- [ ] No tab navigation visible
- [ ] No category switcher (Mainboard/SME)
- [ ] Clean page design
- [ ] Single focused purpose

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#6: Events Display ✅

**Test:** Verify event information

**For each event in calendar:**
- [ ] Calendar icon (📅) visible
- [ ] Company name displayed clearly
- [ ] Event type shown: "Opens", "Closes", "Allotment Status", or "Lists"
- [ ] Multiple events per day displayed vertically

**Find a day with multiple events:**
- [ ] Both/all events visible
- [ ] Events stacked vertically
- [ ] Each event clearly separated

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#7: Event Links ✅

**Test:** Navigate via event links

**Pick any event:**
- [ ] Click company name link
- [ ] Navigates to IPO detail page: `/ipos/{slug}`
- [ ] Detail page loads correctly
- [ ] Click browser back → Returns to calendar
- [ ] Calendar state preserved (same month, search query)

**Test multiple events:**
- [ ] Test 3-5 different event links
- [ ] All navigate to correct detail pages

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#8: Color Coding ✅

**Test:** Verify day highlighting

**Find a day with 1 event:**
- [ ] Background is white/light gray (normal)
- [ ] No special highlighting

**Find a day with 2+ events:**
- [ ] Background is yellow/highlighted
- [ ] Clearly distinguishable from single-event days
- [ ] Multiple events visible

**Empty days:**
- [ ] Background is white/light gray
- [ ] No events displayed

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#9: Holidays Display ✅

**Test:** Verify holiday indicators

**Navigate to a month with holidays (check October 2, Gandhi Jayanti):**
- [ ] Holiday cell shows "Holiday - [name]"
- [ ] Holiday name is descriptive (e.g., "Gandhi Jayanti")
- [ ] Holiday indicator clearly visible
- [ ] Holiday can coexist with IPO events on same day

**If no holidays available:**
- [ ] Navigate through several months
- [ ] Document if no holidays found
- [ ] Note: Holidays are optional feature (graceful degradation)

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#10: Search Functionality ✅

**Test:** Search by company name

**Basic Search:**
- [ ] Type company name in search box (e.g., "ABC")
- [ ] Click "Search" button OR press Enter
- [ ] URL updates with `?search=ABC`
- [ ] Calendar filters to show only matching events
- [ ] Non-matching events hidden

**Clear Search:**
- [ ] "Clear" button appears when search active
- [ ] Click "Clear" button
- [ ] Search box clears
- [ ] URL removes search param
- [ ] All events visible again

**Search Edge Cases:**
- [ ] Search for non-existent company → No events shown
- [ ] Search with partial name (e.g., "AB") → Shows all matching
- [ ] Search is case-insensitive

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#11: Descriptive Header ✅

**Test:** Verify header text

- [ ] Header includes title: "Mainboard IPO Calendar"
- [ ] Descriptive text explains purpose
- [ ] Mentions: events, open dates, close dates, allotment, listing
- [ ] Explains yellow highlighting for multi-event days
- [ ] Text is clear and helpful

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#12: ISR Revalidation ✅

**Test:** Verify ISR configuration (code inspection)

**File:** `web/app/mainboard-ipo-calendar/page.tsx`

- [ ] File contains: `export const revalidate = 300`
- [ ] Value is 300 (5 minutes in seconds)
- [ ] Page is async server component

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#13: Responsive Design ✅

**Test:** Verify desktop and mobile layouts

**Desktop (>768px):**
- [ ] Resize browser to 1920x1080
- [ ] Calendar displays as 7-column grid
- [ ] All days visible
- [ ] Navigation buttons visible
- [ ] Search box full width

**Tablet (768px):**
- [ ] Resize browser to 768px width
- [ ] Grid still visible OR switches to list
- [ ] Layout adjusts gracefully

**Mobile (<768px):**
- [ ] Resize browser to 375px width (iPhone size)
- [ ] Calendar switches to list view
- [ ] Only days with events OR holidays shown
- [ ] Each day as a card/list item
- [ ] Event details readable
- [ ] Navigation buttons stack or adjust

**Test on actual devices if available:**
- [ ] iPhone/Android phone
- [ ] iPad/Android tablet

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#14: Empty State ✅

**Test:** Verify empty state message

**Navigate to a month with no events:**
- [ ] Try future months (e.g., December 2026)
- [ ] Empty state message displays
- [ ] Message text: "No Mainboard IPO events in [Month] [Year]"
- [ ] Message is clear and helpful
- [ ] Suggests trying different month or clearing search

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#15: Loading Skeleton ✅

**Test:** Verify loading state

**Throttle network (Chrome DevTools):**
- [ ] Open DevTools → Network tab
- [ ] Set throttling to "Slow 3G"
- [ ] Navigate to calendar page or change month
- [ ] Loading skeleton appears
- [ ] Skeleton shows calendar grid outline
- [ ] Skeleton disappears when data loads

**Without throttling:**
- [ ] Loading state may be too fast to see
- [ ] Verify skeleton component exists in code

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#16: SEO Metadata ✅

**Test:** Verify SEO configuration

**View page source (Right-click → View Page Source):**
- [ ] `<title>` tag includes "Mainboard IPO Calendar"
- [ ] Meta description tag exists
- [ ] Meta keywords tag exists
- [ ] Open Graph tags present (og:title, og:description)
- [ ] Structured data (JSON-LD) present for events

**Test social sharing preview:**
- [ ] Copy URL and paste in social media
- [ ] Preview shows correct title and description

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#17: Navigation Link ✅

**Test:** Verify navigation menu integration

**Desktop Navigation:**
- [ ] Hover over "Mainboard IPOs" in main navigation
- [ ] Dropdown menu appears
- [ ] "Mainboard IPO Calendar" link visible
- [ ] Link has calendar icon
- [ ] Click link → Navigates to calendar page

**Mobile Navigation:**
- [ ] Open mobile menu (hamburger icon)
- [ ] Find "Mainboard IPOs" section
- [ ] "Mainboard IPO Calendar" link visible
- [ ] Click link → Navigates to calendar page

**Link Position:**
- [ ] Third item in Mainboard IPOs submenu
- [ ] After: Performance Tracker, Prospectus
- [ ] Before: Reviews

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#18: Default Current Month ✅

**Test:** Verify default view

**Navigate to page without query params:**
- [ ] Go to `/mainboard-ipo-calendar` (no ?month= params)
- [ ] Current month displays (October 2025)
- [ ] Current year correct
- [ ] URL does NOT have month/year params initially
- [ ] After navigation, URL updates with params

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

### AC#19: Performance ✅

**Test:** Verify smooth rendering with many events

**Navigate to a busy month (or create test data):**
- [ ] Find month with 20+ events
- [ ] Page loads without lag
- [ ] Calendar renders smoothly
- [ ] No stuttering or freezing
- [ ] Scrolling is smooth
- [ ] Month navigation is instant

**Performance Metrics (Chrome DevTools → Performance):**
- [ ] LCP (Largest Contentful Paint) < 2.5s
- [ ] FID (First Input Delay) < 100ms
- [ ] CLS (Cumulative Layout Shift) < 0.1

**Result:** ⬜ Pass / ⬜ Fail
**Notes:** _______________________________________________

---

## Additional Tests

### Browser Compatibility

- [ ] Chrome (latest)
- [ ] Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (if available)

### Console Errors

- [ ] No JavaScript errors in console
- [ ] No React warnings
- [ ] No 404 errors in Network tab

### Accessibility

- [ ] Tab through interactive elements (keyboard navigation)
- [ ] Focus indicators visible
- [ ] ARIA labels present (check with screen reader if available)
- [ ] Color contrast meets WCAG AA standards

---

## Test Summary

**Total Tests:** 19 Acceptance Criteria
**Passed:** _____ / 19
**Failed:** _____ / 19
**Blocked:** _____ / 19

**Overall Status:** ⬜ PASS / ⬜ FAIL

**Critical Issues Found:** _____________________________________

**Minor Issues Found:** _____________________________________

**Recommendations:** _____________________________________

---

## Sign-Off

**Tester Name:** _____________________
**Date:** _____________________
**Signature:** _____________________

**Notes:** _______________________________________________
_______________________________________________
_______________________________________________
