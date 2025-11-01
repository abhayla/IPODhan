# Architectural Violations - Fix Report - November 1, 2025

**Session**: November 1, 2025
**Engineer**: Claude Code AI Assistant
**Status**: 🟡 **PARTIALLY FIXED** - 1/7 files fixed, 6 remaining

---

## Executive Summary

During production build testing, discovered critical architectural violations where **Service Layer** and **Server Components** are using HTTP API calls instead of direct repository access. This violates the documented 3-layer architecture and causes "Network request failed" errors in production builds.

### Fix Progress

| Component | Status | Notes |
|-----------|--------|-------|
| `web/app/ipos/[slug]/page.tsx` | ✅ FIXED | Converted from `apiClient.getIPOBySlug()` to `IPORepository.findBySlugWithFallback()` |
| `web/lib/services/ncd-service.ts` | ⏳ TODO | Uses `getIPOs()` from api-client (line 102) |
| `web/lib/services/ofs-service.ts` | ⏳ TODO | Uses `getIPOs()` from api-client (line 117) |
| `web/lib/services/sme-calendar-service.ts` | ⏳ TODO | Confirmed uses `apiClient` (grep results) |
| `web/lib/services/mainboard-calendar-service.ts` | ⏳ TODO | Confirmed uses `apiClient` (grep results) |
| `web/lib/services/rights-service.ts` | ⏳ TODO | Likely affected (build errors show rights page failing) |
| Additional service files | ⏳ TODO | Need full audit |

---

## Root Cause Analysis

### Architectural Violation

**Documented Pattern** (`docs/02-architecture/backend-architecture.md`):
```
API Routes (Next.js)
    ↓ (orchestration)
Service Layer
    ↓ (business logic)
Repository Layer
    ↓ (data access + caching)
Database (PostgreSQL) + Cache (Redis)
```

**Current Implementation** (WRONG):
```
Server Component
    ↓
Service Layer
    ↓ (HTTP fetch - WRONG!)
API Client (fetch to localhost)
    ↓
API Route
    ↓
Repository
    ↓
Database
```

**Root Issue**: Service layer is making HTTP calls to internal API routes, which fails in production because:
1. Server-side `apiClient` uses `https://localhost:3000/api` (protocol mismatch)
2. Network overhead for internal calls (adds 200-300ms latency)
3. Violates separation of concerns (services should use repositories, not HTTP)

---

## Fixed Implementation Pattern

### Before (Architectural Violation)

```typescript
// web/lib/services/ncd-service.ts (BROKEN)
import { getIPOs } from '@/lib/api-client';  // ❌ HTTP client

export async function getNCDIssues(): Promise<NCDData[]> {
  return getCachedOrFetch(CACHE_KEY, async () => {
    const response = await getIPOs({  // ❌ HTTP API call
      segment: 'MAINBOARD',
      offeringType: 'NCD',
      limit: 100,
    });
    return response.data.map(transformNCDData);
  });
}
```

### After (Correct Architecture)

```typescript
// web/lib/services/ncd-service.ts (FIXED)
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function getNCDIssues(): Promise<NCDData[]> {
  return getCachedOrFetch(CACHE_KEY, async () => {
    // Initialize repository
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Use repository directly
    const result = await ipoRepository.findAll({
      segment: ['MAINBOARD'],
      offeringType: 'NCD',
      limit: 100,
      sortBy: 'openDate',
      sortOrder: 'desc',
    });

    return result.data.map(transformNCDData);
  });
}
```

---

## Fix Implementation Steps

### Phase 1: Fix Service Layer (Priority: P0 - CRITICAL)

**Files to Fix** (in order):
1. ✅ `web/app/ipos/[slug]/page.tsx` - COMPLETED
2. ⏳ `web/lib/services/ncd-service.ts`
3. ⏳ `web/lib/services/ofs-service.ts`
4. ⏳ `web/lib/services/rights-service.ts`
5. ⏳ `web/lib/services/sme-calendar-service.ts`
6. ⏳ `web/lib/services/mainboard-calendar-service.ts`

**Pattern to Apply**:
```typescript
// 1. Replace imports
- import { getIPOs, getIPOBySlug } from '@/lib/api-client';
+ import { db } from '@/lib/db/index';
+ import { getRedisClient } from '@/lib/cache/redis-client';
+ import { IPORepository } from '@/lib/repositories/ipo-repository';

// 2. Replace function calls
- const response = await getIPOs({ ...filters });
+ const redis = getRedisClient();
+ const ipoRepository = new IPORepository(db, redis);
+ const result = await ipoRepository.findAll({ ...filters });

// 3. Update data access
- const data = response.data;
+ const data = result.data;
```

### Phase 2: Comprehensive Audit (Priority: P1)

1. **Search all service files** for `apiClient` or `getIPOs` usage:
   ```bash
   grep -rn "apiClient\|getIPOs\|getIPOBySlug" web/lib/services/
   ```

2. **Document findings** in spreadsheet:
   - File path
   - Function name
   - What HTTP call it makes
   - Required repository method
   - Estimated fix time

3. **Prioritize fixes** by user impact:
   - P0: Homepage, IPO Detail, Dashboard (core user journeys)
   - P1: Calendar pages, Listings pages
   - P2: Admin pages, Tools pages

### Phase 3: Add Architectural Enforcement (Priority: P2)

**ESLint Rule** to prevent future violations:

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['*/api-client'],
            importNames: ['getIPOs', 'getIPOBySlug', 'apiClient'],
            message: 'Services should use repositories directly, not HTTP API calls. Import IPORepository from @/lib/repositories/ipo-repository instead.',
          },
        ],
      },
    ],
  },
};
```

**TypeScript Path Alias Restriction**:
- Consider removing `@/lib/api-client` from service layer imports
- Only allow in client components

---

## Build Errors Catalog

### Errors Found During `npm run build`

```
Error fetching NCD issues: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR', status: 0

Error fetching OFS issues: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR', status: 0

Error fetching upcoming SME IPOs: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR', status: 0

Error fetching mainboard IPOs: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR', status: 0

Error fetching upcoming mainboard IPOs: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR', status: 0

Error fetching SME IPOs: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR', status: 0
```

**Pages Affected**:
- `/ncd` (NCD Issues page)
- `/ofs` (Offer for Sale page)
- `/sme-ipos` (SME IPOs page)
- `/mainboard-ipos` (Mainboard IPOs page)
- `/sme-ipo-calendar` (SME Calendar page)
- `/mainboard-ipo-calendar` (Mainboard Calendar page)

---

## Testing Strategy

### Unit Tests
- Mock `db` and `redis` clients
- Test service functions return correct data structure
- Verify error handling (graceful degradation)

### Integration Tests
- Use real PostgreSQL + Redis (test database)
- Verify repository calls work correctly
- Verify caching behavior

### Production Build Tests
```bash
# 1. Clean build
cd web
rm -rf .next
npm run build

# 2. Start production server
npm start

# 3. Test affected pages
curl http://localhost:3000/ncd
curl http://localhost:3000/ofs
curl http://localhost:3000/sme-ipos
curl http://localhost:3000/mainboard-ipos

# 4. Verify no "Network request failed" errors in logs
```

---

## Estimated Fix Time

| Phase | Tasks | Estimated Time |
|-------|-------|---------------|
| **Phase 1** | Fix 6 service files | 3-4 hours |
| **Phase 2** | Comprehensive audit + document | 2 hours |
| **Phase 3** | Add ESLint rules | 1 hour |
| **Testing** | Unit + Integration + E2E | 2 hours |
| **Total** | All phases | **8-9 hours** |

---

## Next Steps

### Immediate (Today)

1. ✅ Fix IPO Detail page - COMPLETED
2. ⏳ Fix NCD service (`web/lib/services/ncd-service.ts`)
3. ⏳ Fix OFS service (`web/lib/services/ofs-service.ts`)
4. ⏳ Test NCD and OFS pages in production build
5. ⏳ Continue with remaining service files

### Short-term (This Week)

1. Fix all identified service files
2. Add comprehensive tests for service layer
3. Implement ESLint rules to prevent future violations
4. Update architecture documentation with explicit warnings

### Long-term (This Month)

1. Conduct full architectural audit of codebase
2. Add pre-commit hooks to catch violations
3. Create developer training on 3-layer architecture
4. Implement automated E2E tests for production builds

---

## Lessons Learned

### What Went Wrong

1. **Architectural pattern not enforced**: No automated checks to prevent wrong patterns
2. **Development mode masks issues**: HTTP calls work in dev, fail in production
3. **Incomplete testing**: Production build testing not part of CI/CD

### What Went Right

1. **Systematic approach**: Following testing protocol caught the issue before deployment
2. **Clear architecture docs**: `backend-architecture.md` provides correct pattern
3. **Repository pattern works**: Proven fix for IPO Detail page

### Improvements Needed

1. **Mandatory Production Build Testing**: Always test `npm start`, not just `npm run dev`
2. **Automated Architecture Checks**: ESLint rules + TypeScript strict checks
3. **Developer Education**: Training on when to use repositories vs HTTP APIs
4. **CI/CD Integration**: Add production build test to GitHub Actions

---

## Related Documentation

- **Backend Architecture**: `docs/02-architecture/backend-architecture.md`
- **Repository Pattern**: `web/lib/repositories/base-repository.ts`
- **Service Layer Guidelines**: `docs/02-architecture/service-layer-guidelines.md` (TODO: Create)
- **Original Issue Report**: `docs/07-testing/ui-tests/CRITICAL_ARCHITECTURAL_ISSUES_NOV_1_2025.md`

---

**Report Generated**: November 1, 2025
**Report Author**: Claude Code AI Assistant
**Status**: 🟡 IN PROGRESS - Systematic fixes ongoing
**Next Review**: After all service files fixed
