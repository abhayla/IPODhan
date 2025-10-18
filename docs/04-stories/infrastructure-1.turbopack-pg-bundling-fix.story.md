# Story: Fix Turbopack/PostgreSQL Bundling Configuration

## Status
Ready

**Created by:** Bob (Scrum Master)
**Created date:** 2025-10-12
**Priority:** High
**Type:** Bug Fix / Infrastructure
**Epic:** Technical Debt / Infrastructure

## Story

**As a** developer,
**I want** the production build to succeed without bundling errors,
**so that** I can build the application for production and run E2E tests against the built app.

## Problem Statement

The current build configuration uses Turbopack (`next build --turbopack`) which attempts to bundle the PostgreSQL client (`pg` module) and its Node.js dependencies into the browser bundle. This causes build failures with "Module not found" errors for Node.js built-in modules (`net`, `tls`, `fs`, `dns`, `child_process`).

**Error Examples:**
```
Module not found: Can't resolve 'net'
Module not found: Can't resolve 'tls'
Module not found: Can't resolve 'fs'
```

**Impact:**
- ❌ Production build fails (`npm run build`)
- ❌ Cannot run E2E tests against built app
- ❌ Cannot deploy to production
- ✅ Dev server works fine (`npm run dev`)

**Root Cause:**
- Turbopack has incomplete support for `serverExternalPackages` configuration
- The `pg` module and its dependencies are being included in browser bundle despite configuration

## Acceptance Criteria

1. Production build completes successfully without errors (`npm run build`)
2. pg module and related packages excluded from browser bundle
3. All Node.js built-in modules properly externalized (fs, net, tls, dns, child_process)
4. E2E tests can run against built application
5. Dev server continues to work (`npm run dev`)
6. Build time remains reasonable (no significant performance regression)
7. All existing pages render correctly in production build
8. No console errors in production build

## Recommended Solution

### Option A: Remove Turbopack from Build (RECOMMENDED - 5 minutes)

**Changes Required:**

1. Edit `web/package.json`:
```json
{
  "scripts": {
    "dev": "next dev --turbopack",
-   "build": "next build --turbopack",
+   "build": "next build",
    "start": "next start"
  }
}
```

2. Verify build works:
```bash
cd web
npm run build
```

**Pros:**
- ✅ Immediate fix (5 minutes)
- ✅ Uses stable webpack bundler
- ✅ Webpack configuration already correct
- ✅ Low risk

**Cons:**
- ⚠️ Slower builds than Turbopack (but builds will work)
- ⚠️ Loses Turbopack's speed benefits

### Option B: Fix Turbopack Configuration (ALTERNATIVE - 2-3 hours)

Research and implement proper Turbopack configuration for server-only packages.

**Pros:**
- ✅ Keeps Turbopack's speed benefits
- ✅ Aligns with Next.js future direction

**Cons:**
- ⚠️ Time-consuming research
- ⚠️ Turbopack is still experimental
- ⚠️ May require Next.js version upgrade

## Tasks / Subtasks

### Option A Implementation (Recommended):

- [ ] Remove `--turbopack` flag from build script in `web/package.json`
- [ ] Run production build to verify: `cd web && npm run build`
- [ ] Verify build output in `.next` directory
- [ ] Test production server: `npm run start`
- [ ] Run E2E tests against built app: `npm run test:e2e`
- [ ] Verify all pages load without errors
- [ ] Check browser console for errors
- [ ] Document build time before/after (for metrics)
- [ ] Update documentation if needed
- [ ] Commit changes

### Option B Implementation (If pursuing Turbopack fix):

- [ ] Research Next.js/Turbopack serverExternalPackages support
- [ ] Check Next.js version compatibility
- [ ] Review Turbopack documentation for pg module handling
- [ ] Implement configuration changes
- [ ] Test build
- [ ] Fallback to Option A if unsuccessful after 2 hours

## Testing

### Manual Testing:
1. Run `npm run build` in web directory
2. Build should complete without errors
3. Run `npm run start` to test production server
4. Navigate to all major pages:
   - Homepage: http://localhost:3000
   - IPO Detail: http://localhost:3000/ipos/[any-ipo-slug]
   - Mainboard Calendar: http://localhost:3000/mainboard-ipo-calendar
   - Historical Performance: http://localhost:3000/historical-ipo-performance
5. Verify no console errors in browser
6. Check network tab for proper asset loading

### Automated Testing:
```bash
# After build fix
cd web
npm run build
npm run test:e2e
```

### Verification Checklist:
- [ ] `npm run build` exits with code 0
- [ ] `.next` directory created with optimized bundles
- [ ] Production server starts without errors
- [ ] All pages render correctly
- [ ] No browser console errors
- [ ] E2E tests pass
- [ ] Build time documented

## Dependencies

**Blocks:**
- E2E test execution for all stories
- Production deployment
- Build verification in CI/CD pipeline

**Related Stories:**
- Story 9.9a (blocked by this issue for E2E tests)
- Any future stories requiring E2E tests

## Notes

**Current Workarounds:**
- Dev server works fine for manual testing
- Unit tests run successfully
- Manual testing possible via `npm run dev`

**Configuration Already Added:**
The following configurations have already been added to `web/next.config.ts` but don't work with Turbopack:
- `serverExternalPackages: ['pg', 'pg-pool', 'pgpass']`
- `experimental.turbo.resolveAlias` with Node.js module exclusions
- `webpack.resolve.fallback` with Node.js module exclusions

**Next.js Version:** Check current version and compatibility

**Turbopack Status:** Experimental feature, may have incomplete support

## Estimated Effort

- **Option A:** 15 minutes (remove flag + verify)
- **Option B:** 2-3 hours (research + implement + test)

**Recommended:** Start with Option A for immediate fix.

## Success Metrics

- ✅ Build success rate: 100%
- ✅ E2E test execution: Enabled
- ✅ Build time: Documented and acceptable
- ✅ Zero browser bundle errors

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2025-10-12 | 1.0 | Initial story created for Turbopack/pg bundling fix | Bob (Scrum Master) |
