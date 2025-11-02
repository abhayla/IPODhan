# WCAG AA Accessibility Audit Checklist - IPO Details Page

**Date Created**: 2025-11-02
**Phase**: 5 - Polish & Optimization
**WCAG Version**: 2.1 Level AA
**Target Compliance**: WCAG 2.1 AA (with AAA enhancements)

---

## Executive Summary

This checklist ensures the IPO Details Page meets WCAG 2.1 Level AA accessibility standards, with select AAA enhancements already implemented (e.g., prefers-reduced-motion support).

**Current Status** (as of 2025-11-02):
- ✅ **WCAG AAA**: Animation from Interactions (2.3.3) - prefers-reduced-motion support
- 🟡 **WCAG AA**: Pending full audit (this checklist)
- ⏳ **Tools Used**: Manual review, WAVE, axe DevTools, screen readers

---

## Audit Tools

### Automated Tools
1. **WAVE (Web Accessibility Evaluation Tool)**
   - Browser extension (free)
   - Identifies errors, alerts, structural elements
   - Color contrast checker
   - **URL**: https://wave.webaim.org/extension/

2. **axe DevTools**
   - Chrome/Firefox extension (free)
   - Automated accessibility testing
   - WCAG 2.1 AA/AAA compliance
   - **URL**: https://www.deque.com/axe/devtools/

3. **Lighthouse Accessibility Audit**
   - Built into Chrome DevTools
   - Automated scoring (0-100)
   - Performance + Accessibility combined
   - **Command**: F12 → Lighthouse → Accessibility

### Manual Testing Tools
4. **Screen Readers**
   - **NVDA** (Windows, free): https://www.nvaccess.org/
   - **JAWS** (Windows, paid): https://www.freedomscientific.com/products/software/jaws/
   - **VoiceOver** (macOS/iOS, built-in): Cmd+F5
   - **TalkBack** (Android, built-in)

5. **Keyboard Navigation**
   - Tab, Shift+Tab, Enter, Space, Arrow keys
   - No mouse/trackpad allowed

6. **Color Contrast Analyzers**
   - **WebAIM Contrast Checker**: https://webaim.org/resources/contrastchecker/
   - **Colour Contrast Analyser** (desktop app): https://www.tpgi.com/color-contrast-checker/

---

## WCAG 2.1 AA Success Criteria Checklist

### Principle 1: Perceivable

#### 1.1 Text Alternatives

##### 1.1.1 Non-text Content (Level A) ✅
**Requirement**: All non-text content has text alternatives.

**Test**:
- [ ] All images have `alt` attributes
- [ ] Decorative images have `alt=""` (empty alt)
- [ ] Logo has descriptive alt text (e.g., "IPODhan Logo")
- [ ] Chart icons have `aria-label` or `aria-labelledby`
- [ ] Status badges have text equivalents (not just colors)

**Components to Check**:
- [ ] Company logo: `alt="[Company Name] Logo"`
- [ ] Timeline widget milestone icons: `aria-label="Announcement Date"`
- [ ] Chart legend icons: `aria-hidden="true"` (text adjacent) or `aria-label`
- [ ] Expand/collapse chevron icons: `aria-hidden="true"` (button has text)

**Expected**:
```tsx
// Good
<img src="/logo.png" alt="XYZ Corporation Logo" />
<ChevronDownIcon aria-hidden="true" /> {/* Adjacent text: "Expand" */}

// Bad
<img src="/logo.png" /> {/* Missing alt */}
<ChevronDownIcon /> {/* No alt, no adjacent text */}
```

---

#### 1.2 Time-based Media
**N/A**: No video or audio content on IPO details page.

---

#### 1.3 Adaptable

##### 1.3.1 Info and Relationships (Level A) ✅
**Requirement**: Information, structure, and relationships can be programmatically determined.

**Test**:
- [ ] Headings use semantic HTML (`<h1>`, `<h2>`, etc., not just styled `<div>`)
- [ ] Lists use `<ul>`/`<ol>`/`<li>`, not `<div>` with bullets
- [ ] Tables use `<table>`, `<th>`, `<td>` with proper headers
- [ ] Forms use `<label>` associated with inputs
- [ ] Sections use semantic HTML5 (`<section>`, `<article>`, `<nav>`)

**Components to Check**:
- [ ] IPO header: `<h1>` for company name
- [ ] Section headers: `<h2>` for "Financial Performance", etc.
- [ ] Sub-sections: `<h3>` for chart titles
- [ ] Peer comparison table: `<table>` with `<th scope="col">`
- [ ] CollapsibleSection: `role="region"` with `aria-labelledby`

**Expected Heading Hierarchy**:
```
<h1>XYZ Corporation IPO</h1>
  <h2>Key Highlights</h2>
  <h2>Financial Performance Analysis</h2>
    <h3>Revenue Trend</h3>
    <h3>Profit/Loss</h3>
  <h2>Subscription Analytics</h2>
    <h3>Overall Subscription</h3>
```

---

##### 1.3.2 Meaningful Sequence (Level A) ✅
**Requirement**: Reading order is logical and matches visual order.

**Test**:
- [ ] Tab order follows visual flow (top to bottom, left to right)
- [ ] Screen reader announces content in correct order
- [ ] Sticky elements don't disrupt reading flow
- [ ] Charts announced before/after related content

**Components to Check**:
- [ ] Sticky dashboard: Should be early in DOM order (after header)
- [ ] Section control bar: After sticky dashboard, before sections
- [ ] Collapsible sections: Follow visual order
- [ ] Charts within sections: Logical order (overview → details)

---

##### 1.3.3 Sensory Characteristics (Level A) ✅
**Requirement**: Don't rely solely on sensory characteristics (shape, color, size, location, sound).

**Test**:
- [ ] Instructions don't use "click the green button" (use "click the Save button")
- [ ] Status not conveyed by color alone (use icons + text)
- [ ] Chart legends use patterns + colors
- [ ] Important info not position-dependent ("above" / "below")

**Components to Check**:
- [ ] Status badges: Icon + text (not just color)
  - ✅ Good: 🟢 OPEN (green circle + "OPEN" text)
  - ❌ Bad: 🟢 (green circle only)
- [ ] Chart series: Patterns + colors
  - ✅ Good: Red line (dashed) + legend "Revenue"
  - ❌ Bad: Red line (no label, no pattern)
- [ ] Success/error messages: Icon + color + text
  - ✅ Good: ❌ Error: Failed to load data
  - ❌ Bad: Red background only

---

#### 1.4 Distinguishable

##### 1.4.1 Use of Color (Level A) ✅
**Requirement**: Color is not the only visual means of conveying information.

**Test** (overlap with 1.3.3):
- [ ] Links underlined or otherwise distinguished (not just color)
- [ ] Form errors indicated with icons + text (not just red border)
- [ ] Chart data distinguishable without color (patterns, labels)
- [ ] Required fields marked with asterisk + "required" text

**Components to Check**:
- [ ] Links in text: Underlined or bold (not just blue)
- [ ] Positive/negative values: ▲/▼ icons + color
- [ ] Chart bars/lines: Different patterns or labels

---

##### 1.4.3 Contrast (Minimum) (Level AA) 🔴
**Requirement**: Text has 4.5:1 contrast ratio (3:1 for large text ≥18pt or 14pt bold).

**Test**:
- [ ] Body text (16px): ≥4.5:1 contrast
- [ ] Small text (14px): ≥4.5:1 contrast
- [ ] Large text (≥18px): ≥3:1 contrast
- [ ] Chart labels (12-14px): ≥4.5:1 contrast
- [ ] Status badges: ≥4.5:1 contrast
- [ ] Button text: ≥4.5:1 contrast

**Tool**: WebAIM Contrast Checker (https://webaim.org/resources/contrastchecker/)

**Common IPODhan Colors to Test**:
| Element | Foreground | Background | Ratio | Pass? |
|---------|-----------|-----------|-------|-------|
| Body text | #1F2937 (gray-800) | #FFFFFF | 15.3:1 | ✅ |
| Small text | #6B7280 (gray-500) | #FFFFFF | 4.6:1 | ✅ |
| Primary button | #FFFFFF | #3B82F6 | 4.0:1 | 🟡 (borderline) |
| Success badge | #FFFFFF | #10B981 | 3.1:1 | ❌ (fails for small text) |
| Error badge | #FFFFFF | #EF4444 | 4.3:1 | 🟡 (borderline) |
| Chart labels | #4B5563 (gray-600) | #FFFFFF | 7.2:1 | ✅ |

**Action Items**:
- [ ] Test all color combinations with WAVE or axe
- [ ] Fix any failures (darken text or lighten background)
- [ ] Ensure status badges have sufficient contrast

---

##### 1.4.4 Resize Text (Level AA) ✅
**Requirement**: Text can be resized up to 200% without loss of content or functionality.

**Test**:
- [ ] Browser zoom to 200% (Ctrl+Plus)
- [ ] No horizontal scrolling required
- [ ] No text overlap
- [ ] Charts scale or become scrollable
- [ ] Buttons remain clickable

**Components to Check**:
- [ ] Sticky dashboard: Adapts or scrolls at 200%
- [ ] Charts: Scale or horizontal scroll
- [ ] Collapsible sections: Text wraps, no overlap
- [ ] Navigation: Remains functional

---

##### 1.4.5 Images of Text (Level AA) ✅
**Requirement**: Use text instead of images of text (exceptions: logos, customizable).

**Test**:
- [ ] No text embedded in images (use HTML text)
- [ ] Charts use SVG text (scalable)
- [ ] Logos are acceptable (exception)

**Components to Check**:
- [ ] Company logo: Image (acceptable)
- [ ] Chart labels: SVG text (acceptable)
- [ ] Status badges: HTML/CSS (not images)

---

##### 1.4.10 Reflow (Level AA) ✅
**Requirement**: No 2D scrolling at 320px width and 400% zoom.

**Test**:
- [ ] Set viewport to 320px (iPhone SE width)
- [ ] Zoom to 400% (or test at 1280px width)
- [ ] No horizontal scroll required
- [ ] Content reflows vertically
- [ ] Charts stack or scroll independently

**Components to Check**:
- [ ] Sticky dashboard: Disabled or collapses on mobile
- [ ] Charts: Stack vertically or horizontal scroll within container
- [ ] Tables: Responsive or scroll within wrapper (not page-level scroll)
- [ ] Section control bar: Full width or wraps

---

##### 1.4.11 Non-text Contrast (Level AA) 🔴
**Requirement**: UI components and graphical objects have 3:1 contrast.

**Test**:
- [ ] Focus indicators: ≥3:1 contrast
- [ ] Chart bars/lines: ≥3:1 contrast against background
- [ ] Buttons: ≥3:1 border/background contrast
- [ ] Form inputs: ≥3:1 border contrast
- [ ] Icons: ≥3:1 contrast

**Components to Check**:
- [ ] Focus ring (2px primary): 3:1 against white? (need to test)
- [ ] Chart lines: Various colors against #FFFFFF
- [ ] Timeline progress bar: Blue against gray
- [ ] Expand/collapse chevron: Gray against white

---

##### 1.4.12 Text Spacing (Level AA) ✅
**Requirement**: No loss of content when user adjusts text spacing.

**Test** (apply these CSS overrides):
```css
* {
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
p {
  margin-bottom: 2em !important;
}
```

- [ ] Text doesn't overflow containers
- [ ] Buttons remain readable
- [ ] Chart labels don't overlap
- [ ] No clipped text

---

##### 1.4.13 Content on Hover or Focus (Level AA) ✅
**Requirement**: Hover/focus content can be dismissed, hoverable, and persistent.

**Test**:
- [ ] Tooltips dismissible (Esc key or click outside)
- [ ] Tooltips remain visible when hovering over them
- [ ] Tooltips don't disappear when moving mouse to them
- [ ] Focus indicators visible

**Components to Check**:
- [ ] Chart tooltips: Hoverable and dismissible
- [ ] Info icons: Tooltips persistent until dismissed
- [ ] Dropdown menus: Hoverable

---

### Principle 2: Operable

#### 2.1 Keyboard Accessible

##### 2.1.1 Keyboard (Level A) 🔴
**Requirement**: All functionality available via keyboard.

**Test** (no mouse allowed):
- [ ] Tab to all interactive elements
- [ ] Enter/Space activates buttons
- [ ] Arrow keys navigate within components
- [ ] Esc dismisses modals/tooltips
- [ ] No keyboard traps

**Components to Check**:
- [ ] Section control bar "Expand All": Tab + Enter ✅
- [ ] Collapsible section headers: Tab + Enter ✅
- [ ] Chart interactive elements: Tab + Enter
- [ ] Links in text: Tab + Enter ✅
- [ ] "Compare" button: Tab + Enter ✅

**Keyboard Flow**:
```
Tab:     Header → Logo → Breadcrumb → Compare Button →
         Sticky Dashboard → Timeline → Metrics →
         Section Control Bar → Expand All Button →
         Section 1 Header → Section 1 Content → ...
```

---

##### 2.1.2 No Keyboard Trap (Level A) ✅
**Requirement**: Focus can be moved away from all components.

**Test**:
- [ ] Tab out of all modals/dialogs
- [ ] Tab out of chart interactive areas
- [ ] No infinite Tab loops
- [ ] Esc closes modals and returns focus

---

##### 2.1.4 Character Key Shortcuts (Level A) ⚠️
**Requirement**: Single-key shortcuts can be disabled/remapped or only active on focus.

**Test**:
- [ ] No single-character shortcuts (e.g., pressing "E" triggers action)
- [ ] If shortcuts exist, can be disabled or require modifier (Ctrl+)

**Current Status**: No single-key shortcuts detected ✅

---

#### 2.2 Enough Time

##### 2.2.1 Timing Adjustable (Level A) ⚠️
**Requirement**: User can turn off, adjust, or extend time limits.

**Test**:
- [ ] No auto-refresh without user control
- [ ] Session timeout warnings with extend option

**Current Status**: No time limits on IPO details page ✅

---

##### 2.2.2 Pause, Stop, Hide (Level A) ⚠️
**Requirement**: Moving/blinking/scrolling content can be paused.

**Test**:
- [ ] Auto-playing animations can be paused
- [ ] Carousels have pause button
- [ ] Auto-updating content (e.g., live subscription data) can be paused

**Components to Check**:
- [ ] Skeleton shimmer animation: Not auto-playing (only shows during load) ✅
- [ ] Chart animations: Complete within 5 seconds ✅
- [ ] Expand All stagger: Completes within 450ms ✅

**Current Status**: No perpetual animations ✅

---

#### 2.3 Seizures and Physical Reactions

##### 2.3.1 Three Flashes or Below Threshold (Level A) ✅
**Requirement**: No content flashes more than 3 times per second.

**Test**:
- [ ] No flashing animations
- [ ] Loading spinners rotate (don't flash)
- [ ] Skeleton shimmer is gradual (not strobe)

**Current Status**: No flashing content ✅

---

##### 2.3.3 Animation from Interactions (Level AAA) ✅ IMPLEMENTED
**Requirement**: Respect `prefers-reduced-motion` for animations triggered by interaction.

**Test**:
- [ ] Enable "Reduce motion" in OS settings
- [ ] Verify animations disabled or reduced
- [ ] Collapsible sections expand/collapse instantly
- [ ] "Expand All" stagger disabled (instant toggle)

**Implementation**:
- ✅ `useReducedMotion` hook detects preference
- ✅ CollapsibleSection respects preference
- ✅ useSectionControl skips stagger if reduced motion

**Testing**:
- **macOS**: System Preferences → Accessibility → Display → Reduce motion
- **Windows**: Settings → Ease of Access → Display → Show animations
- **Chrome**: DevTools → Rendering → Emulate CSS media feature prefers-reduced-motion

---

#### 2.4 Navigable

##### 2.4.1 Bypass Blocks (Level A) ✅
**Requirement**: Skip navigation links to bypass repeated content.

**Test**:
- [ ] "Skip to main content" link (hidden until focused)
- [ ] Keyboard user can skip header/nav and go straight to content

**Expected**:
```tsx
<a href="#main-content" className="sr-only focus:not-sr-only">
  Skip to main content
</a>
```

**Action**: Add skip link if not present

---

##### 2.4.2 Page Titled (Level A) ✅
**Requirement**: Page has descriptive `<title>`.

**Test**:
- [ ] `<title>` describes page content
- [ ] Format: "Company Name IPO - IPODhan"

**Expected**:
```html
<title>XYZ Corporation IPO - Details, Analysis & Performance | IPODhan</title>
```

---

##### 2.4.3 Focus Order (Level A) 🔴
**Requirement**: Focus order is logical and meaningful.

**Test**:
- [ ] Tab order matches visual order
- [ ] No surprising focus jumps
- [ ] Modals trap focus (Tab cycles within modal)
- [ ] Closing modal returns focus to trigger

**Components to Check**:
- [ ] Sticky dashboard: Focus order top → bottom
- [ ] Section control bar: Before sections (not after)
- [ ] Collapsible sections: Header → Content (when expanded)
- [ ] Charts: Interactive elements in logical order

---

##### 2.4.4 Link Purpose (In Context) (Level A) ✅
**Requirement**: Link purpose clear from link text or context.

**Test**:
- [ ] Avoid "click here" or "read more" (use descriptive text)
- [ ] Link text describes destination

**Examples**:
- ✅ Good: "View XYZ Corporation prospectus"
- ❌ Bad: "Click here for prospectus"

---

##### 2.4.5 Multiple Ways (Level AA) ⚠️
**Requirement**: More than one way to find pages (search, sitemap, nav).

**Test**:
- [ ] Search function works
- [ ] Breadcrumb navigation present
- [ ] Sitemap exists

**Current Status**: Check if search and breadcrumb implemented

---

##### 2.4.6 Headings and Labels (Level AA) ✅
**Requirement**: Headings and labels describe topic or purpose.

**Test**:
- [ ] Headings are descriptive (not "Section 1", "Section 2")
- [ ] Form labels describe input purpose
- [ ] Section titles clear

**Examples**:
- ✅ Good: "Financial Performance Analysis"
- ❌ Bad: "Section 2"

---

##### 2.4.7 Focus Visible (Level AA) 🔴
**Requirement**: Keyboard focus indicator is visible.

**Test**:
- [ ] Tab through page - all interactive elements show focus
- [ ] Focus indicator: ≥2px outline or border
- [ ] Focus color contrasts with background (≥3:1)
- [ ] Custom focus styles don't remove default outlines

**Components to Check**:
- [ ] Buttons: `focus:ring-2 focus:ring-primary-500`
- [ ] Links: Visible outline or underline
- [ ] Section headers: Focus visible
- [ ] Chart interactive elements: Focus visible

**Expected CSS**:
```css
button:focus {
  outline: 2px solid #3B82F6; /* Primary color */
  outline-offset: 2px;
}
```

---

### Principle 3: Understandable

#### 3.1 Readable

##### 3.1.1 Language of Page (Level A) ✅
**Requirement**: Page language specified in HTML.

**Test**:
- [ ] `<html lang="en">` or appropriate language

**Expected**:
```html
<html lang="en">
```

---

##### 3.1.2 Language of Parts (Level AA) ⚠️
**Requirement**: Language changes marked with `lang` attribute.

**Test**:
- [ ] Foreign language text has `lang` attribute
- [ ] Example: `<span lang="hi">नमस्ते</span>` (Hindi)

**Current Status**: Check if any foreign language content

---

#### 3.2 Predictable

##### 3.2.1 On Focus (Level A) ✅
**Requirement**: Focus doesn't trigger unexpected changes.

**Test**:
- [ ] Tabbing to element doesn't submit forms
- [ ] Focus doesn't auto-play videos
- [ ] Focus doesn't open modals

**Current Status**: No focus-triggered changes ✅

---

##### 3.2.2 On Input (Level A) ✅
**Requirement**: Changing settings doesn't cause unexpected changes.

**Test**:
- [ ] Typing doesn't submit forms
- [ ] Selecting dropdown doesn't navigate
- [ ] Toggling checkbox doesn't refresh page

**Current Status**: No input-triggered changes (page is mostly read-only) ✅

---

##### 3.2.3 Consistent Navigation (Level AA) ✅
**Requirement**: Navigation is consistent across pages.

**Test**:
- [ ] Header navigation same on all pages
- [ ] Breadcrumb format consistent
- [ ] Footer links same order

---

##### 3.2.4 Consistent Identification (Level AA) ✅
**Requirement**: Components with same functionality have same identification.

**Test**:
- [ ] "Compare" button labeled same everywhere
- [ ] Expand/collapse icons consistent
- [ ] Status badges use same format

---

#### 3.3 Input Assistance

##### 3.3.1 Error Identification (Level A) ⚠️
**Requirement**: Errors identified and described in text.

**Test**:
- [ ] Form validation errors shown in text (not just color)
- [ ] Error messages specific ("Email required" not "Error")

**Current Status**: No forms on details page (read-only) ✅

---

##### 3.3.2 Labels or Instructions (Level A) ⚠️
**Requirement**: Labels provided for user input.

**Test**:
- [ ] All form inputs have `<label>` or `aria-label`
- [ ] Required fields marked

**Current Status**: No forms on details page ✅

---

### Principle 4: Robust

#### 4.1 Compatible

##### 4.1.1 Parsing (Level A) ✅
**Requirement**: HTML is valid and well-formed.

**Test**:
- [ ] No duplicate IDs
- [ ] Opening and closing tags match
- [ ] Attributes properly quoted
- [ ] Valid HTML5

**Tool**: W3C HTML Validator (https://validator.w3.org/)

---

##### 4.1.2 Name, Role, Value (Level A) 🔴
**Requirement**: UI components have name, role, and state.

**Test**:
- [ ] Buttons have accessible names (`aria-label` or text)
- [ ] Custom components have ARIA roles
- [ ] State changes announced (expanded/collapsed)

**Components to Check**:
- [ ] Expand All button:
  ```tsx
  <button
    aria-label="Expand all sections"
    aria-pressed={allExpanded}
  >
    Expand All
  </button>
  ```
- [ ] Collapsible section header:
  ```tsx
  <button
    aria-expanded={isExpanded}
    aria-controls="section-content-id"
  >
    Section Title
  </button>
  <div id="section-content-id" role="region">
    Content
  </div>
  ```
- [ ] Chart containers:
  ```tsx
  <div role="img" aria-label="Revenue trend chart showing growth from 2020-2024">
    <ResponsiveContainer>...</ResponsiveContainer>
  </div>
  ```

---

## ARIA Best Practices

### Current ARIA Usage Audit

#### 1. CollapsibleSection Component
**Expected ARIA**:
```tsx
<button
  aria-expanded={isExpanded}      // ✅ Implemented
  aria-controls="content-id"       // ✅ Implemented
  aria-label="Toggle section"      // ⚠️ Check if present
>
  <ChevronDownIcon aria-hidden="true" /> {/* ✅ Icon hidden from screen readers */}
  Section Title
</button>

<div
  id="content-id"
  role="region"                    // ✅ Implemented
  aria-labelledby="header-id"      // ⚠️ Check if present
>
  Content
</div>
```

---

#### 2. SectionControlBar Component
**Expected ARIA**:
```tsx
<button
  aria-label={allExpanded ? 'Collapse all sections' : 'Expand all sections'}  // ✅ Implemented
  aria-pressed={allExpanded}       // ✅ Implemented
>
  <ChevronDoubleUpIcon aria-hidden="true" />  // ✅ Icons hidden
  {allExpanded ? 'Collapse All' : 'Expand All'}
</button>
```

---

#### 3. Chart Components
**Expected ARIA**:
```tsx
<div
  role="img"                       // ⚠️ Add if missing
  aria-label="Financial performance chart showing revenue, profit, and EBITDA trends from 2020-2024"
>
  <ResponsiveContainer>
    <LineChart data={data}>
      {/* Chart internals */}
    </LineChart>
  </ResponsiveContainer>
</div>
```

**Alternative** (if chart is interactive):
```tsx
<div
  role="figure"
  aria-labelledby="chart-title"
  aria-describedby="chart-description"
>
  <h3 id="chart-title">Revenue Trend</h3>
  <p id="chart-description">
    Line chart showing revenue growth from ₹100 Cr in 2020 to ₹500 Cr in 2024.
  </p>
  <LineChart data={data} />
</div>
```

---

#### 4. Timeline Widget
**Expected ARIA**:
```tsx
<div
  role="progressbar"               // ⚠️ Add if missing
  aria-valuenow={currentMilestone}
  aria-valuemin={0}
  aria-valuemax={4}
  aria-label="IPO timeline progress"
>
  {/* Timeline visuals */}
</div>
```

---

## Screen Reader Testing

### Test Scripts

#### 1. NVDA (Windows) Test Script
**Setup**: Install NVDA → Insert+Space (NVDA modifier)

**Test**:
1. Open page in browser
2. Start NVDA (Ctrl+Alt+N)
3. Navigate with:
   - **H**: Next heading
   - **Tab**: Next interactive element
   - **Ctrl+Alt+Arrow**: Read by element
   - **Insert+Down Arrow**: Read all
4. Verify announcements:
   - [ ] Page title announced
   - [ ] Headings announced with level (e.g., "Heading level 2: Financial Performance")
   - [ ] Buttons announced with state (e.g., "Expand All button, not pressed")
   - [ ] Sections announced with state (e.g., "Section collapsed")
   - [ ] Charts described (e.g., "Image: Revenue trend chart")

---

#### 2. VoiceOver (macOS) Test Script
**Setup**: Cmd+F5 to toggle VoiceOver

**Test**:
1. Open page in Safari
2. Enable VoiceOver (Cmd+F5)
3. Navigate with:
   - **Ctrl+Option+Right Arrow**: Next element
   - **Ctrl+Option+Cmd+H**: Next heading
   - **Tab**: Next interactive element
4. Verify announcements match NVDA results

---

#### 3. Common Screen Reader Issues
| Issue | Cause | Fix |
|-------|-------|-----|
| "Unlabeled button" | Missing `aria-label` or text | Add descriptive label |
| "Clickable, unlabeled" | Empty button or link | Add text or `aria-label` |
| "Image" (no description) | Missing `alt` or `aria-label` | Add descriptive text |
| "Expanded" not announced | Missing `aria-expanded` | Add attribute |
| Chart not described | No `role="img"` or `aria-label` | Add ARIA attributes |

---

## Automated Testing Results

### WAVE Report Template
**Run**: https://wave.webaim.org/extension/ → Scan page

**Expected Results**:
| Category | Target | Notes |
|----------|--------|-------|
| **Errors** | 0 | Must fix all |
| **Alerts** | <5 | Review and address |
| **Features** | 15+ | ARIA landmarks, headings |
| **Structural Elements** | 20+ | Headings, lists, links |
| **Contrast Errors** | 0 | Must fix all |

**Common Errors to Fix**:
- Missing alt text
- Missing form labels
- Low contrast
- Missing ARIA attributes
- Duplicate IDs

---

### axe DevTools Report Template
**Run**: F12 → axe DevTools → Scan all of my page

**Expected Results**:
| Category | Target | Notes |
|----------|--------|-------|
| **Critical Issues** | 0 | Must fix |
| **Serious Issues** | 0 | Must fix |
| **Moderate Issues** | <3 | Should fix |
| **Minor Issues** | <5 | Nice to fix |

**Common Issues**:
- Color contrast failures
- Missing ARIA attributes
- Keyboard navigation issues
- Focus management problems

---

### Lighthouse Accessibility Score
**Run**: F12 → Lighthouse → Accessibility → Generate report

**Expected Results**:
| Metric | Target | Current |
|--------|--------|---------|
| **Accessibility Score** | ≥90 | [TBD] |
| **Best Practices Score** | ≥90 | [TBD] |

**Common Deductions**:
- -5 points: Missing ARIA attributes
- -10 points: Color contrast failures
- -15 points: Missing alt text
- -5 points: Keyboard navigation issues

---

## Manual Testing Checklist

### Keyboard Navigation Test
**Test without mouse** (unplug mouse or don't use it):

1. **Tab through entire page**:
   - [ ] All interactive elements reachable
   - [ ] Focus visible on all elements
   - [ ] Tab order logical (top → bottom, left → right)

2. **Activate elements**:
   - [ ] Enter/Space: Activate buttons
   - [ ] Enter: Follow links
   - [ ] Esc: Close modals/tooltips
   - [ ] Arrow keys: Navigate within components (if applicable)

3. **Specific components**:
   - [ ] "Expand All" button: Tab + Enter
   - [ ] Collapsible sections: Tab + Enter
   - [ ] Links in text: Tab + Enter
   - [ ] "Compare" button: Tab + Enter

4. **No keyboard traps**:
   - [ ] Can Tab out of all components
   - [ ] Can Esc out of modals
   - [ ] No infinite loops

---

### Color Contrast Test
**Test all color combinations**:

1. **Use WebAIM Contrast Checker** (https://webaim.org/resources/contrastchecker/)

2. **Test these combinations**:
   - [ ] Body text (#1F2937) on white (#FFFFFF)
   - [ ] Small text (#6B7280) on white
   - [ ] Primary button text (#FFFFFF) on blue (#3B82F6)
   - [ ] Success badge (#FFFFFF) on green (#10B981)
   - [ ] Error badge (#FFFFFF) on red (#EF4444)
   - [ ] Chart labels (#4B5563) on white
   - [ ] Focus indicators (#3B82F6) on white

3. **Fix failures**:
   - Darken text or lighten background
   - Ensure ≥4.5:1 for small text, ≥3:1 for large text

---

### Mobile Accessibility Test
**Test on mobile device** (iPhone or Android):

1. **Enable screen reader**:
   - iOS: Settings → Accessibility → VoiceOver
   - Android: Settings → Accessibility → TalkBack

2. **Navigate with gestures**:
   - **Swipe right**: Next element
   - **Swipe left**: Previous element
   - **Double tap**: Activate element

3. **Verify**:
   - [ ] All elements announced
   - [ ] Touch targets ≥44×44px
   - [ ] Gestures work smoothly
   - [ ] No content hidden or clipped

---

## Known Accessibility Issues (To Fix)

### High Priority (P0)
1. **Missing alt text on charts** (if any)
   - **Impact**: Screen readers can't describe charts
   - **Fix**: Add `role="img"` and `aria-label` to chart containers

2. **Low color contrast on badges** (to verify)
   - **Impact**: Low vision users can't read text
   - **Fix**: Darken text or lighten background to ≥4.5:1 ratio

3. **Missing focus indicators** (to verify)
   - **Impact**: Keyboard users can't see focus
   - **Fix**: Add `:focus` styles with ≥2px outline

### Medium Priority (P1)
4. **Chart tooltips not keyboard accessible** (to verify)
   - **Impact**: Keyboard users can't see data values
   - **Fix**: Add keyboard controls or data table alternative

5. **Expand All button state not announced** (to verify)
   - **Impact**: Screen reader users don't know if sections are expanded
   - **Fix**: Ensure `aria-pressed` attribute present

### Low Priority (P2)
6. **Timeline widget not announced as progress** (to verify)
   - **Impact**: Screen readers describe as generic container
   - **Fix**: Add `role="progressbar"` with aria-valuenow

---

## Accessibility Statement

### Target Compliance
This page aims to meet **WCAG 2.1 Level AA** with select **Level AAA** enhancements:
- ✅ **AAA**: Animation from Interactions (2.3.3) - prefers-reduced-motion support
- 🟡 **AA**: Full audit in progress (90+ success criteria)

### Known Limitations
- Charts may not be fully accessible to screen readers (providing text alternatives)
- Some color contrasts may need adjustment
- Keyboard navigation for chart interactions may be limited

### Contact
For accessibility issues or feedback, contact: [accessibility@ipodhan.com] (placeholder)

---

## Sign-Off Checklist

### Before Marking Complete
- [ ] Ran WAVE scan: 0 errors
- [ ] Ran axe DevTools scan: 0 critical/serious issues
- [ ] Lighthouse accessibility score: ≥90
- [ ] Tested with NVDA or VoiceOver: All content accessible
- [ ] Keyboard navigation: All functionality reachable
- [ ] Color contrast: All combinations pass WCAG AA
- [ ] Mobile screen reader: Tested on iOS or Android
- [ ] Fixed all P0 issues
- [ ] Documented remaining issues in tracker

### Documentation
- [ ] Update IMPLEMENTATION_TRACKER.md with accessibility status
- [ ] Add accessibility audit results to Phase 5 report
- [ ] Create accessibility statement for website
- [ ] Share findings with team

---

## Resources

### Tools
- **WAVE**: https://wave.webaim.org/extension/
- **axe DevTools**: https://www.deque.com/axe/devtools/
- **Lighthouse**: Built into Chrome DevTools
- **WebAIM Contrast Checker**: https://webaim.org/resources/contrastchecker/
- **NVDA**: https://www.nvaccess.org/
- **W3C Validator**: https://validator.w3.org/

### Documentation
- **WCAG 2.1**: https://www.w3.org/WAI/WCAG21/quickref/
- **ARIA Authoring Practices**: https://www.w3.org/WAI/ARIA/apg/
- **WebAIM Articles**: https://webaim.org/articles/
- **Inclusive Components**: https://inclusive-components.design/

---

**Checklist Version**: 1.0
**Last Updated**: 2025-11-02
**Author**: Claude Code
**Status**: Ready for audit

---

**End of Checklist**
