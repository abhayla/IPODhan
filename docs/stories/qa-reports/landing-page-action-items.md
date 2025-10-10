# Landing Page QA - Action Items for Development Team

**Date:** 2025-10-10
**QA Report:** [landing-page-qa-report.md](./landing-page-qa-report.md)
**Overall Status:** ✓ PASSED with Recommended Improvements
**Quality Score:** 7.5/10 → Target: 9/10

---

## Critical Issues (0)
**None identified** ✅

---

## High Priority Issues (3)

### 1. Create Missing Legal Pages
**Issue ID:** #1
**Severity:** HIGH
**Priority:** MUST FIX before production launch
**Status:** 🔴 BLOCKING

**Problem:**
- Footer links to `/privacy`, `/terms`, and `/disclaimer` all return 404 errors
- This is a legal compliance and trust issue

**Evidence:**
- Tested all three links - confirmed 404 responses
- Screenshot: `privacy-404-error.png`

**Required Actions:**
1. Create `web/app/privacy/page.tsx` with Privacy Policy content
2. Create `web/app/terms/page.tsx` with Terms of Service content
3. Create `web/app/disclaimer/page.tsx` with Disclaimer content
4. Ensure legal content is reviewed by legal team (if available)
5. Link privacy policy from affiliate disclosure section

**Acceptance Criteria:**
- [ ] All three legal pages return 200 status codes
- [ ] Pages contain appropriate legal content
- [ ] Pages follow same layout/design as rest of site
- [ ] Footer links navigate correctly

**Estimated Effort:** 2-4 hours (depending on legal content availability)

---

### 2. Fix Skip Link Accessibility Issue
**Issue ID:** #2
**Severity:** HIGH (Accessibility)
**Priority:** SHOULD FIX before production launch
**Status:** 🟡 MEDIUM

**Problem:**
- Skip to main content link is intercepted by header logo when clicked
- Keyboard navigation works (Tab key), but mouse users cannot click it
- This violates WCAG 2.1 guidelines for skip links

**Evidence:**
- Click test failed: "element intercepts pointer events"
- Screenshot: `skip-link-focused.png` (shows skip link when focused)

**Required Actions:**
1. Increase z-index of skip link to be higher than header logo
2. Ensure skip link is clickable when visible (on focus)
3. Test with both keyboard (Tab) and mouse click

**File to Modify:**
- Likely in `web/app/layout.tsx` or header component

**Suggested Fix:**
```tsx
// Increase z-index on skip link
className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] ..." // changed from z-50 to z-[100]
```

**Acceptance Criteria:**
- [ ] Skip link is clickable with mouse when focused
- [ ] Skip link is accessible via keyboard (Tab key)
- [ ] Skip link jumps to main content when activated
- [ ] No z-index conflicts with other elements

**Estimated Effort:** 30 minutes

---

### 3. Add Mobile Menu Smooth Transitions
**Issue ID:** #3
**Severity:** MEDIUM (UX Polish)
**Priority:** SHOULD FIX before production launch
**Status:** 🟡 MEDIUM

**Problem:**
- Mobile navigation menu appears/disappears instantly without animation
- Creates jarring user experience on mobile devices
- Lacks professional polish expected from modern web apps

**Evidence:**
- Tested on 375px mobile viewport
- Menu opens/closes instantly with no transition
- Screenshot: `landing-page-mobile-menu-open.png`

**Required Actions:**
1. Add CSS transition for menu slide-in/slide-out effect
2. Add backdrop overlay to indicate modal state
3. Implement smooth open/close animations (300ms duration)

**File to Modify:**
- Mobile navigation component (likely in Header component)

**Suggested Implementation:**
```tsx
// Add transition classes
<nav className={`
  fixed inset-y-0 right-0 w-64 bg-background shadow-xl
  transform transition-transform duration-300 ease-in-out
  ${isOpen ? 'translate-x-0' : 'translate-x-full'}
`}>
  {/* menu content */}
</nav>

// Add backdrop overlay
{isOpen && (
  <div
    className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
    onClick={onClose}
    aria-hidden="true"
  />
)}
```

**Acceptance Criteria:**
- [ ] Menu slides in from right when opened (300ms transition)
- [ ] Menu slides out to right when closed (300ms transition)
- [ ] Backdrop overlay fades in/out with menu
- [ ] Clicking backdrop closes menu
- [ ] Animation is smooth on mobile devices (60fps)

**Estimated Effort:** 1-2 hours

---

## Medium Priority Issues (4)

### 4. Add Backdrop Overlay for Mobile Menu
**Issue ID:** #4
**Severity:** MEDIUM
**Priority:** Nice to have
**Status:** 🟢 ENHANCEMENT

**Problem:**
- Mobile menu lacks visual indication of modal state
- No darkened background to focus user attention
- No clickable area to close menu (besides close button)

**Required Actions:**
- Add semi-transparent backdrop when menu is open
- Make backdrop clickable to close menu
- Fade backdrop in/out with menu animation

**Note:** This can be combined with Issue #3 (Mobile Menu Transitions)

**Estimated Effort:** Included in Issue #3

---

### 5. Implement Loading States for Initial Page Load
**Issue ID:** #5
**Severity:** MEDIUM
**Priority:** Nice to have
**Status:** 🟢 ENHANCEMENT

**Problem:**
- No loading indicator during initial page load
- User may see layout shift or blank page momentarily
- Reduces perceived performance

**Required Actions:**
1. Create `web/app/loading.tsx` with skeleton screens
2. Add hero section skeleton
3. Add feature cards skeleton
4. Ensure smooth transition from skeleton to content

**Suggested Implementation:**
```tsx
// web/app/loading.tsx
export default function Loading() {
  return (
    <div className="flex flex-col">
      {/* Hero skeleton */}
      <section className="container mx-auto px-4 py-20 md:py-32">
        <div className="mx-auto max-w-4xl text-center">
          <div className="h-20 bg-muted animate-pulse rounded-lg mb-8" />
          <div className="h-6 bg-muted animate-pulse rounded-lg w-3/4 mx-auto" />
        </div>
      </section>
      {/* Feature cards skeleton */}
      <section className="border-t bg-muted/50 py-20 md:py-32">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 bg-card border rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
```

**Acceptance Criteria:**
- [ ] Loading skeleton displays during initial page load
- [ ] Skeleton layout matches actual page structure
- [ ] Smooth transition from skeleton to content (no flash)
- [ ] No layout shift when content loads (CLS = 0)

**Estimated Effort:** 1-2 hours

---

### 6. Add aria-expanded to Mobile Menu Button
**Issue ID:** #6
**Severity:** MEDIUM (Accessibility)
**Priority:** Should fix
**Status:** 🟡 ACCESSIBILITY

**Problem:**
- Mobile menu button lacks `aria-expanded` attribute
- Screen reader users don't know if menu is open or closed
- Violates ARIA best practices for disclosure widgets

**Required Actions:**
1. Add `aria-expanded="false"` when menu is closed
2. Add `aria-expanded="true"` when menu is open
3. Update attribute dynamically on state change

**File to Modify:**
- Mobile menu button component

**Suggested Fix:**
```tsx
<button
  aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
  aria-expanded={isOpen}
  onClick={toggleMenu}
>
  {/* hamburger icon */}
</button>
```

**Acceptance Criteria:**
- [ ] Button has `aria-expanded` attribute
- [ ] Attribute updates correctly when menu opens/closes
- [ ] Screen reader announces menu state changes

**Estimated Effort:** 15 minutes

---

### 7. Add aria-current to Active Navigation Items
**Issue ID:** #7
**Severity:** MEDIUM (Accessibility)
**Priority:** Should fix
**Status:** 🟡 ACCESSIBILITY

**Problem:**
- Navigation links lack `aria-current="page"` on active items
- Screen reader users cannot identify current page location
- Reduces navigation clarity for assistive technology users

**Required Actions:**
1. Detect current page URL
2. Add `aria-current="page"` to matching navigation link
3. Ensure visual indicator for active state (if not already present)

**File to Modify:**
- Navigation component (both desktop and mobile)

**Suggested Implementation:**
```tsx
import { usePathname } from 'next/navigation';

const pathname = usePathname();

<Link
  href="/dashboard"
  aria-current={pathname === '/dashboard' ? 'page' : undefined}
  className={pathname === '/dashboard' ? 'font-bold' : ''}
>
  Dashboard
</Link>
```

**Acceptance Criteria:**
- [ ] Current page link has `aria-current="page"` attribute
- [ ] Visual indicator shows active state (bold text or underline)
- [ ] Works correctly on all navigation links

**Estimated Effort:** 30 minutes

---

## Low Priority Issues (3)

### 8. Add Hover Effect to Logo
**Issue ID:** #8
**Severity:** LOW
**Priority:** Optional
**Status:** 🟢 POLISH

**Problem:**
- Logo is clickable but lacks hover state
- Minor UX inconsistency (other links have hover effects)

**Suggested Fix:**
```tsx
<Link href="/" className="hover:opacity-80 transition-opacity">
  {/* logo */}
</Link>
```

**Estimated Effort:** 5 minutes

---

### 9. Enhance Feature Card Icons
**Issue ID:** #9
**Severity:** LOW
**Priority:** Optional
**Status:** 🟢 DESIGN

**Problem:**
- Current SVG icons are functional but generic
- Opportunity for visual enhancement with custom icons

**Suggested Actions:**
- Consider using Lucide icons or Heroicons library
- Design custom IPO-specific iconography
- Add more visual interest to feature cards

**Estimated Effort:** 2-4 hours (design + implementation)

---

### 10. Add Parallax Scrolling Effects
**Issue ID:** #10
**Severity:** LOW
**Priority:** Optional
**Status:** 🟢 ENHANCEMENT

**Problem:**
- Landing page has good animations, but could add depth with parallax
- Optional UX enhancement for modern feel

**Suggested Implementation:**
- Add subtle parallax to hero section background
- Consider parallax on CTA section
- Use libraries like `react-parallax` or `framer-motion`

**Estimated Effort:** 2-3 hours

---

## Summary Checklist

### Must Fix (Before Production Launch)
- [ ] **Issue #1:** Create legal pages (Privacy, Terms, Disclaimer)
- [ ] **Issue #2:** Fix skip link accessibility issue

### Should Fix (Before Production Launch)
- [ ] **Issue #3:** Add mobile menu smooth transitions
- [ ] **Issue #6:** Add aria-expanded to mobile menu button
- [ ] **Issue #7:** Add aria-current to active navigation items

### Nice to Have (Post-Launch)
- [ ] **Issue #4:** Add backdrop overlay for mobile menu (included in #3)
- [ ] **Issue #5:** Implement loading states
- [ ] **Issue #8:** Add hover effect to logo
- [ ] **Issue #9:** Enhance feature card icons
- [ ] **Issue #10:** Add parallax scrolling effects

---

## Estimated Total Effort

### Critical Path (Must Fix):
- Legal pages: 2-4 hours
- Skip link fix: 30 minutes
- **Total:** 2.5-4.5 hours

### Full Implementation (Must + Should):
- Legal pages: 2-4 hours
- Skip link fix: 30 minutes
- Mobile menu transitions: 1-2 hours
- ARIA enhancements: 45 minutes
- **Total:** 4.25-7.25 hours

### Complete Implementation (All Issues):
- **Total:** 9-16 hours

---

## Priority Order

1. **Create legal pages** (blocking production launch)
2. **Fix skip link accessibility** (WCAG compliance)
3. **Add mobile menu transitions** (UX polish)
4. **Add ARIA attributes** (accessibility enhancement)
5. **Implement loading states** (performance perception)
6. **Design polish** (logo hover, icons, parallax)

---

## Next Steps

1. **Immediate:** Assign Issue #1 (legal pages) to development team
2. **Week 1:** Complete all "Must Fix" items
3. **Week 2:** Complete all "Should Fix" items
4. **Post-Launch:** Address "Nice to Have" items as bandwidth allows

---

## Contact

**QA Lead:** Quinn (Test Architect)
**Report Date:** 2025-10-10
**Report Location:** `docs/stories/qa-reports/landing-page-qa-report.md`

For questions or clarifications, please refer to the full QA report or contact the QA team.

---

**End of Action Items**
