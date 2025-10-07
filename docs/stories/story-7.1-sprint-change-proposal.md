# Sprint Change Proposal: Story 7.1 - NSE Scraper Implementation

**Date:** 2025-10-07
**Prepared By:** Bob (Scrum Master)
**Status:** Awaiting User Approval
**Change Type:** Documentation Enhancement (Additive)

---

## Executive Summary

The Product Owner has reviewed Story 7.1 (NSE Scraper Implementation) and found it to be **excellent quality** but requiring specific fixes before approval. This proposal addresses all PO feedback through additive documentation enhancements with zero impact on project scope, timeline, or architecture.

**PO Validation Status:** CHANGES REQUIRED
**Recommended Path:** Direct Adjustment (Documentation Enhancement)
**Impact Level:** Low (Story-level only, no epic or artifact conflicts)

---

## 1. Analysis Summary

### Triggering Issue
Story 7.1 was submitted for PO review and returned with feedback identifying missing critical security documentation and recommended configuration enhancements. The PO categorized feedback into three priority levels:

1. **MUST FIX (Blocks Approval):** Security Requirements subsection missing
2. **SHOULD FIX (Highly Recommended):** TypeScript path aliases configuration, performance testing task
3. **OPTIONAL (Nice-to-Have):** Dry-run mode, data diff logging, health check endpoint, scraper metrics

### Root Cause Analysis
The initial story draft focused on functional implementation details but lacked comprehensive security guidance that a dev agent would need. While the story referenced existing architecture documents (e.g., security-and-performance.md), it did not provide scraper-specific security implementation details.

**This is a documentation completeness issue, not a technical or architectural problem.**

### Impact Assessment

**Epic Level:** ✅ Zero Impact
- Epic 7 (Data Pipeline & Automation) can proceed as planned
- No changes to epic scope, timeline, or story sequence
- Downstream stories (7.2, 7.3, 7.4, 7.5) unaffected

**Artifact Level:** ✅ Zero Conflicts
- PRD: No changes needed (requirements unchanged)
- Architecture Documents: No changes needed (security patterns already documented)
- Frontend Spec: Not applicable (backend story)
- Other Artifacts: No changes needed

**Story Level:** ⚠️ Additive Changes Only
- Add Security Requirements subsection (MUST FIX)
- Add TypeScript path aliases configuration (SHOULD FIX)
- Add performance testing task (SHOULD FIX)
- All changes are supplementary - no deletions or replacements of existing content

---

## 2. Recommended Path Forward

**Selected Path:** **Option 1 - Direct Adjustment / Integration**

**Rationale:**
1. All PO feedback is specific, actionable, and well-defined
2. Changes are purely additive documentation enhancements
3. No technical dead-ends or architectural conflicts exist
4. Zero impact on timeline or downstream dependencies
5. Story implementation can proceed immediately after approval

**Effort Estimate:** 30 minutes to integrate changes + 15 minutes for final review

**Risk Assessment:** Minimal
- No breaking changes
- No rollback needed
- No coordination with other agents required

---

## 3. Specific Proposed Edits

### Edit 1: Add Security Requirements Subsection (MUST FIX)

**Location:** Dev Notes section, insert after "Environment Configuration" subsection (after line 790)

**Action:** INSERT the following new subsection:

```markdown

---

### Security Requirements

**Source:** [docs/architecture/security-and-performance.md]

**Environment Security:**
- **Environment Variables:**
  - Store all sensitive configuration in `.env` file (DATABASE_URL, REDIS_URL, API keys)
  - Add `scraper/.env` to `.gitignore` to prevent accidental commits
  - Create `scraper/.env.example` with placeholder values for documentation:
    ```bash
    # Database
    DATABASE_URL=postgresql://user:password@localhost:5432/ipodhan

    # Redis
    REDIS_URL=redis://localhost:6379

    # NSE Scraper
    NSE_URL=https://www.nseindia.com/market-data/public-issues
    SCRAPER_TIMEOUT=30000
    RETRY_ATTEMPTS=3
    RETRY_DELAYS=1000,2000,4000

    # Logging
    LOG_LEVEL=info
    ```
  - Never commit actual credentials or API keys
  - Use different credentials for development, staging, and production environments

**Database Security:**
- **SSL/TLS Configuration:**
  - Enable SSL for PostgreSQL connections in production
  - Configure Drizzle ORM connection with SSL options:
    ```typescript
    // scraper/src/config.ts
    export const dbConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : false
    };
    ```
  - Verify SSL certificate validation is enabled (rejectUnauthorized: true)
  - Use connection pooling with appropriate max connections limit (default: 10)

**Redis Security:**
- **Authentication Configuration:**
  - Use Redis AUTH password in production: `redis://:<password>@host:port`
  - Configure Redis client with authentication:
    ```typescript
    import { createClient } from 'redis';

    const redisClient = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD, // Required in production
      socket: {
        tls: process.env.NODE_ENV === 'production', // Enable TLS in production
        rejectUnauthorized: true
      }
    });
    ```
  - Enable TLS for Redis connections in production
  - Restrict Redis access to localhost or VPN in production (firewall rules)

**Scraping Compliance:**
- **robots.txt Compliance:**
  - Check NSE India robots.txt: `https://www.nseindia.com/robots.txt`
  - Respect Disallow directives (if any apply to `/market-data/public-issues`)
  - If scraping is disallowed: switch to IPO Alerts API as primary source (Story 7.3)
  - Add robots.txt check to scraper initialization:
    ```typescript
    async function checkRobotsTxt(baseUrl: string, path: string): Promise<boolean> {
      // Fetch and parse robots.txt
      // Return true if path is allowed, false otherwise
    }
    ```

- **Terms of Service:**
  - Review NSE India Terms of Service: `https://www.nseindia.com/terms-of-service`
  - Ensure scraping for IPODhan's use case complies with terms
  - If terms prohibit scraping: use IPO Alerts API exclusively
  - Document ToS review date and any restrictions in `scraper/README.md`

- **Polite Scraping Practices:**
  - Use reasonable scraping intervals (15-30 minutes, not seconds)
  - Set proper User-Agent header identifying IPODhan: `Mozilla/5.0 (compatible; IPODhan/1.0; +https://ipodhan.com)`
  - Implement exponential backoff on errors (1s, 2s, 4s)
  - Do not overwhelm NSE servers with rapid-fire requests
  - Monitor for 429 (Too Many Requests) or 403 (Forbidden) responses
  - If blocked: increase scraping interval, add request delays, or switch to API

**Input Sanitization Strategy:**
- **Zod Validation (Primary Defense):**
  - All scraped data validated with Zod schemas before database insertion
  - Schemas enforce type safety, format validation, business rules
  - Invalid data rejected and logged (never inserted to DB)

- **Additional Sanitization Layers:**
  - **HTML/Script Injection Prevention:**
    - Escape HTML entities in extracted text fields (company names, descriptions)
    - Use DOMPurify or similar library if storing any HTML content
    - Strip `<script>`, `<iframe>`, and other dangerous tags

  - **SQL Injection Prevention:**
    - Use Drizzle ORM parameterized queries exclusively (never raw SQL with string concatenation)
    - Repository layer already provides SQL injection protection
    - Never construct queries with unsanitized user input or scraped data

  - **NoSQL Injection Prevention:**
    - Validate Redis keys before use (no user input in cache keys)
    - Use predefined cache key templates from `web/lib/cache/cache-keys.ts`
    - Never use scraped data directly as Redis keys without validation

  - **Path Traversal Prevention:**
    - Do not use scraped data to construct file paths
    - If file operations needed: whitelist allowed paths, validate against allowed patterns

  - **Command Injection Prevention:**
    - Never execute shell commands with scraped data
    - Avoid `eval()`, `Function()`, or other dynamic code execution with external data

- **Data Sanitization Examples:**
  ```typescript
  // Company name sanitization
  function sanitizeCompanyName(name: string): string {
    return name
      .trim()
      .replace(/[<>]/g, '') // Remove angle brackets
      .slice(0, 200); // Limit length
  }

  // Numeric sanitization
  function sanitizeSubscriptionNumber(value: any): number {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0) {
      throw new Error('Invalid subscription number');
    }
    return Math.min(parsed, 10000); // Cap at reasonable max (10000x subscribed)
  }
  ```

**Security Testing Requirements:**
- Test Zod validation with malicious inputs (SQL injection attempts, XSS payloads)
- Test database SSL connection in staging environment
- Test Redis AUTH failure handling (wrong password)
- Verify `.env` is in `.gitignore` (pre-commit hook check)
- Audit logs for any unintentional credential exposure

---
```

**Rationale:** This subsection provides comprehensive security guidance across five critical areas: environment security, database security, Redis security, scraping compliance, and input sanitization. It goes beyond Zod validation to address potential security vulnerabilities and compliance requirements. This is the MUST FIX requirement from the PO.

---

### Edit 2: Update Scraper Infrastructure Task for TypeScript Path Aliases (SHOULD FIX)

**Location:** Tasks section, lines 33-39

**Action:** REPLACE existing task content with enhanced version:

**OLD:**
```markdown
- [ ] Set up scraper project infrastructure (AC: 12)
  - [ ] Create directory structure: `scraper/src/scrapers/`, `scraper/src/utils/`, `scraper/src/services/`
  - [ ] Initialize `scraper/package.json` with workspace configuration
  - [ ] Install dependencies: `puppeteer@22+`, `zod@3.22+`, `pino@8.19+`, `dotenv`
  - [ ] Configure TypeScript for scraper workspace: `scraper/tsconfig.json`
  - [ ] Add scraper workspace to root `package.json` workspaces array
  - [ ] Create `scraper/.env` file for configuration (NSE_URL, DATABASE_URL, REDIS_URL)
```

**NEW:**
```markdown
- [ ] Set up scraper project infrastructure (AC: 12)
  - [ ] Create directory structure: `scraper/src/scrapers/`, `scraper/src/utils/`, `scraper/src/services/`
  - [ ] Initialize `scraper/package.json` with workspace configuration
  - [ ] Install dependencies: `puppeteer@22+`, `zod@3.22+`, `pino@8.19+`, `dotenv`
  - [ ] Configure TypeScript for scraper workspace: `scraper/tsconfig.json` with path aliases:
    - Add `baseUrl` and `paths` configuration to resolve workspace imports
    - Configure path aliases: `@web/*` -> `../web/*`, `@shared/*` -> `../packages/shared/src/*`
    - Enable `moduleResolution: "bundler"` or `"node16"` for ESM support
    - Example tsconfig.json:
      ```json
      {
        "compilerOptions": {
          "target": "ES2022",
          "module": "ESNext",
          "moduleResolution": "bundler",
          "baseUrl": ".",
          "paths": {
            "@web/*": ["../web/*"],
            "@shared/*": ["../packages/shared/src/*"]
          },
          "esModuleInterop": true,
          "strict": true
        }
      }
      ```
  - [ ] Add scraper workspace to root `package.json` workspaces array
  - [ ] Create `scraper/.env` file for configuration (NSE_URL, DATABASE_URL, REDIS_URL)
  - [ ] Create `scraper/.env.example` with placeholder values (see Security Requirements)
```

**Rationale:** This adds explicit TypeScript path aliases configuration to avoid brittle relative path imports from the web workspace. It also adds the `.env.example` creation step to support the security requirements.

---

**Action:** ALSO INSERT new subsection in Dev Notes after "Dependencies Installation" (after line 841):

```markdown

---

### TypeScript Path Aliases Configuration

**Source:** [docs/architecture/unified-project-structure.md]

**Problem:** Scraper workspace needs to import from web workspace (repositories, database client, Redis client). Without path aliases, imports become brittle with relative paths like `../../web/lib/repositories/ipo-repository`.

**Solution:** Configure TypeScript path aliases in `scraper/tsconfig.json` for clean, maintainable imports.

**Configuration:**
```json
// scraper/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler", // or "node16" for Node.js ESM
    "baseUrl": ".",
    "paths": {
      "@web/*": ["../web/*"],
      "@shared/*": ["../packages/shared/src/*"],
      "@scraper/*": ["./src/*"]
    },
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Usage Examples:**
```typescript
// Before (brittle relative paths)
import { IPORepository } from '../../web/lib/repositories/ipo-repository';
import { db } from '../../web/lib/db';
import { redis } from '../../web/lib/cache/redis-client';

// After (clean path aliases)
import { IPORepository } from '@web/lib/repositories/ipo-repository';
import { db } from '@web/lib/db';
import { redis } from '@web/lib/cache/redis-client';
import { logger } from '@scraper/utils/logger';
```

**Runtime Resolution:**
- TypeScript path aliases are compile-time only
- Use `tsx` (Node.js TypeScript executor) for development: supports path aliases natively
- For production: use `tsc` to compile, then use `tsc-alias` or similar tool to resolve paths
- Alternative: use `tsconfig-paths` package to register paths at runtime

**Package.json Scripts:**
```json
{
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "build": "tsc && tsc-alias",
    "test": "vitest"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "tsc-alias": "^1.8.8"
  }
}
```

**Testing with Path Aliases:**
- Vitest supports path aliases via `vitest.config.ts`:
  ```typescript
  import { defineConfig } from 'vitest/config';
  import path from 'path';

  export default defineConfig({
    test: {
      globals: true,
    },
    resolve: {
      alias: {
        '@web': path.resolve(__dirname, '../web'),
        '@shared': path.resolve(__dirname, '../packages/shared/src'),
        '@scraper': path.resolve(__dirname, './src'),
      },
    },
  });
  ```

---
```

**Rationale:** This addresses the PO's SHOULD FIX requirement for TypeScript path aliases configuration. It provides both the configuration details and usage guidance to prevent import path issues in a monorepo workspace setup.

---

### Edit 3: Add Performance Testing Task (SHOULD FIX)

**Location:** Tasks section, lines 223-230

**Action:** REPLACE existing task content with enhanced version:

**OLD:**
```markdown
- [ ] Write E2E test for manual scraper execution (AC: 12)
  - [ ] Create file `scraper/tests/e2e/nse-scraper.e2e.test.ts`
  - [ ] Test: Run scraper CLI command (`npm start` in scraper workspace)
  - [ ] Verify scraper logs output (success message, IPO count)
  - [ ] Verify scraper exits with code 0 on success
  - [ ] Verify database contains scraped IPO data (query PostgreSQL)
  - [ ] Verify cache was invalidated (query Redis, ensure keys are deleted)
  - [ ] Test scraper execution time is reasonable (<60 seconds for typical data)
```

**NEW:**
```markdown
- [ ] Write E2E test for manual scraper execution (AC: 12)
  - [ ] Create file `scraper/tests/e2e/nse-scraper.e2e.test.ts`
  - [ ] Test: Run scraper CLI command (`npm start` in scraper workspace)
  - [ ] Verify scraper logs output (success message, IPO count)
  - [ ] Verify scraper exits with code 0 on success
  - [ ] Verify database contains scraped IPO data (query PostgreSQL)
  - [ ] Verify cache was invalidated (query Redis, ensure keys are deleted)
  - [ ] **Performance Test: Verify scraper execution time meets <60s target**
    - Measure total scraper execution time from start to finish
    - Test with realistic NSE data (10-20 IPOs, typical subscription data)
    - Assert execution time < 60 seconds (target from Dev Notes > Performance Considerations)
    - Test with mocked NSE page (controlled data size) for consistent benchmarking
    - Log performance breakdown: browser launch time, page load time, data extraction time, database upsert time, cache invalidation time
    - Example test:
      ```typescript
      test('scraper completes within 60 seconds for typical data', async () => {
        const startTime = Date.now();
        const result = await runNSEScraper();
        const duration = Date.now() - startTime;

        expect(result.success).toBe(true);
        expect(duration).toBeLessThan(60000); // 60 seconds
        expect(result.iposProcessed).toBeGreaterThan(0);
      });
      ```
    - If test fails: profile bottlenecks (browser launch, page load, DB queries)
    - Optimization targets: browser launch <3s, page load <10s, DB upsert <100ms per IPO
```

**Rationale:** This addresses the PO's SHOULD FIX requirement for performance testing. It enhances the existing E2E test task with a specific performance testing subtask that verifies the <60 second execution time target mentioned in the Dev Notes. The test includes concrete benchmarking steps and optimization guidance.

---

## 4. Optional Enhancements (Not Implemented in This Proposal)

The PO identified the following NICE-TO-HAVE enhancements that are **NOT included** in this proposal (can be considered for future iterations or Story 7.5):

1. **Dry-run mode:** Scraper runs without database writes for safer testing
2. **Data diff logging:** Log what changed between scraper runs for debugging
3. **Health check endpoint:** HTTP endpoint for monitoring scraper health
4. **Scraper metrics export:** Expose Prometheus metrics for monitoring dashboard

**Rationale for Exclusion:** These are valuable features but not critical for MVP. They can be added in Story 7.5 (Error Handling & Monitoring) or a future enhancement story to avoid scope creep.

---

## 5. PRD MVP Impact

**Impact:** None

- MVP scope unchanged
- Core requirements unchanged
- No feature additions or removals
- Timeline unchanged

These are documentation-only enhancements that improve implementation quality without affecting the product scope or user-facing features.

---

## 6. High-Level Action Plan

1. **Immediate (Post-Approval):**
   - ✅ Scrum Master: Integrate approved edits into Story 7.1
   - ✅ Scrum Master: Update story status to "Ready for Dev"
   - ✅ Scrum Master: Submit updated story to PO for final sign-off

2. **Next Phase (Dev Implementation):**
   - Dev Agent: Implement Story 7.1 with enhanced security guidance
   - Dev Agent: Configure TypeScript path aliases in scraper workspace
   - Dev Agent: Implement performance testing in E2E test suite

3. **Validation:**
   - QA Agent: Validate security requirements are implemented
   - QA Agent: Verify TypeScript imports use path aliases correctly
   - QA Agent: Run performance test and verify <60s execution time

---

## 7. Agent Handoff Plan

**Current Phase:** Scrum Master → User Approval
**Next Phase (Post-Approval):** Scrum Master → Product Owner (Final Sign-Off)
**Implementation Phase:** Product Owner → Dev Agent (Story 7.1 Implementation)

**No Coordination Required With:**
- PM (no PRD changes)
- Architect (no architecture changes)
- Design Architect (no UI/UX changes)

---

## 8. Success Criteria

This Sprint Change Proposal is considered successful when:

1. ✅ User approves all proposed edits
2. ✅ Story 7.1 is updated with approved changes
3. ✅ PO reviews updated story and grants approval
4. ✅ Dev Agent confirms security guidance is clear and actionable
5. ✅ Dev Agent confirms TypeScript path aliases configuration is correct
6. ✅ Performance testing task is implemented and passes (<60s execution time)

---

## 9. Final Review Checklist

- [x] **Change Trigger Understood:** PO review feedback documented
- [x] **Epic Impact Assessed:** Zero impact on Epic 7 or downstream stories
- [x] **Artifact Conflicts Reviewed:** Zero conflicts with PRD, architecture, or other docs
- [x] **Path Forward Evaluated:** Direct Adjustment selected as optimal path
- [x] **Specific Edits Drafted:** Three edits clearly defined with exact text
- [x] **Optional Enhancements Noted:** Nice-to-have features documented for future consideration
- [x] **MVP Impact Assessed:** Zero impact on MVP scope or timeline
- [x] **Action Plan Defined:** Clear next steps for all agents
- [x] **Success Criteria Established:** Clear validation checkpoints defined

---

## Appendix: PO Feedback Summary

**Original PO Validation Report:**

**MUST FIX (Blocks Approval):**
1. Add Security Requirements subsection to Dev Notes with:
   - Environment security (.env gitignore, sample env file)
   - Database SSL/TLS configuration
   - Redis authentication configuration
   - Scraping compliance (robots.txt, Terms of Service)
   - Input sanitization strategy beyond Zod validation

**SHOULD FIX (Highly Recommended):**
2. Add TypeScript path aliases configuration for workspace imports to avoid import issues
3. Add performance testing task to verify <60s execution time target

**OPTIONAL (Nice-to-Have):**
- Dry-run mode for safer testing
- Data diff logging for debugging
- Health check endpoint
- Scraper metrics export

**PO Sign-Off Statement:** "Story will be APPROVED upon completion of MUST FIX security documentation."

---

**End of Sprint Change Proposal**

**Next Step:** Awaiting user approval to integrate changes into Story 7.1
