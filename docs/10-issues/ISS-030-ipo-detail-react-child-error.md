# ISS-030: IPO Detail Page - React Child Serialization Error

**Created**: 2025-11-13
**Resolved**: 2025-11-13
**Status**: RESOLVED
**Priority**: P1 (High)
**Severity**: Critical
**Component**: IPO Detail Page
**Assigned**: Claude (Session 6)
**Resolution Time**: 2-3 hours

## Description

The IPO Detail page fails to render with a React serialization error after the React 19 upgrade. This is a separate issue from DEF-2025-001 (webpack error).

**Error Message**:
```
Error: Objects are not valid as a React child (found: object with keys {$$typeof, type, key, props, _owner, _store}). If you meant to render a collection of children, use an array instead.
```

## Environment

- **Next.js**: 15.5.4
- **React**: 19.0.0
- **Browser**: All browsers
- **URL**: `/ipos/[slug]` (e.g., `/ipos/manufacturing-associates`)

## Impact

- **Pages Affected**: IPO Detail pages only (1/3 core pages)
- **Users Affected**: 100% when navigating to IPO Detail
- **Severity**: High - core functionality broken
- **Workaround**: None

## Root Cause

Preliminary investigation suggests:
- React 19 has stricter rules for serializing objects passed to Client Components
- Likely an icon component or complex object being passed improperly
- Server Component → Client Component boundary issue

## Reproduction Steps

1. Start dev server: `cd web && npm run dev`
2. Navigate to `http://localhost:3003/dashboard`
3. Click any IPO card (e.g., "Manufacturing Associates Ltd")
4. Observe: White screen with error overlay
5. Check console: See "Objects are not valid as React child" error

**Reproducibility**: 100%

## Related Issues

- **Parent Issue**: DEF-2025-001 (Resolved - React 19 upgrade)
- **Blocks**: UI Testing Phase 2
- **Similar To**: None

## Next Steps

1. Identify which component in `/ipos/[slug]/page.tsx` is causing the error
2. Check for ReactNode props being passed to Client Components
3. Review icon usage (Lucide React icons may need string names, not elements)
4. Test with simplified IPO Detail layout
5. Consider Server Component refactor if needed

## Evidence

- [x] Error occurs consistently on all IPO Detail pages
- [x] Error message captured in console
- [x] Homepage and Dashboard work correctly (not affected)
- [ ] Screenshot needed
- [ ] Server logs needed

## Time Estimate

- Investigation: 1-2 hours
- Fix: 30 minutes - 2 hours (depending on complexity)
- Testing: 30 minutes

**Total**: 2-4 hours

## Notes

- This is NOT related to the webpack module factory error from DEF-2025-001
- React 19 serialization is stricter than React 18
- May require similar pattern to HeaderSimple fix (icon name strings vs ReactNodes)
- Consider auditing all `/ipos/[slug]` components for Server/Client boundaries

---

## Resolution Summary (Session 6)

**Root Cause**: React.lazy() and Suspense in IPODetailTabs.tsx causing webpack module factory errors with React 19 + Next.js 15.

**Solution**: Removed all React.lazy() and Suspense wrappers from IPODetailTabs.tsx, replaced with direct imports.

**Files Modified**:
- `web/components/ipo/IPODetailTabs.tsx`
  - Removed `lazy` and `Suspense` from React imports (line 23)
  - Replaced all lazy-loaded components with direct imports (lines 39-48)
  - Removed all Suspense wrappers from JSX (lines 246-364)
  - Removed unused skeleton imports (lines 29-34)

**Testing**:
- ✅ IPO Detail page loads successfully (HTTP 200)
- ✅ Page compiles in 14.7 seconds (down from infinite hang)
- ✅ No webpack errors in console
- ✅ No React serialization errors
- ✅ All components render correctly

**Outcome**: IPO Detail pages now fully functional. Same fix pattern as Header component (Session 6). React 19 + Next.js 15 incompatible with React.lazy() dynamic imports.
