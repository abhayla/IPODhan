# IPODhan Claude Code Skills

This directory contains specialized skills that enhance Claude Code's effectiveness when working on the IPODhan project. These skills encode critical domain knowledge, architectural patterns, and best practices.

---

## Available Skills

### 1. **ipo-domain-expert.md**
**Domain:** Indian IPO Market Knowledge

**Expertise:**
- IPO lifecycle stages (UPCOMING, OPEN, CLOSED, LISTED)
- Subscription categories (QIB, HNI, Retail)
- Financial metrics (GMP, P/E ratio, ROE)
- SEBI regulations and documentation
- IPO scoring algorithm (5-component methodology)

**When to use:**
- Working on IPO data models
- Implementing financial calculations
- Building IPO scoring features
- Writing user-facing content about IPOs
- Understanding subscription data

### 2. **repository-caching-expert.md**
**Domain:** Repository Pattern & Cache-Aside Implementation

**Expertise:**
- BaseRepository extension methodology
- Cache key conventions and TTL strategies
- Redis connection management with graceful fallback
- Cache invalidation patterns (direct, pattern-based)
- Query logging and performance tracking

**When to use:**
- Creating new repositories
- Implementing caching logic
- Debugging cache issues
- Optimizing data access patterns
- Understanding cache-aside pattern

### 3. **schema-migration-expert.md**
**Domain:** Database Schema Management

**Expertise:**
- Single source of truth (packages/shared/src/db/schema.ts)
- 13 table structures and relationships
- Migration workflow (Schema → Generate → Review → Migrate)
- Import patterns and type safety
- Incident history and lessons learned

**When to use:**
- Making schema changes
- Creating migrations
- Fixing type errors
- Understanding table relationships
- Resolving import errors

### 4. **web-scraping-expert.md**
**Domain:** Data Acquisition & Multi-Source Merging

**Expertise:**
- NSE hidden API endpoints (95%+ success rate)
- Puppeteer fallback strategies
- Multi-source priority system (ADMIN → DRHP → NSE → BSE)
- Data validation with Zod schemas
- Error handling and retry logic

**When to use:**
- Building scrapers
- Debugging data acquisition
- Implementing fallback logic
- Resolving data conflicts
- Understanding scraper architecture

### 5. **architecture-patterns-expert.md**
**Domain:** 3-Layer Architecture & Design Patterns

**Expertise:**
- Service layer rules (NEVER HTTP calls)
- Server vs Client component boundaries
- Data flow patterns (Component → Service → Repository)
- ESLint architectural enforcement
- Error handling patterns

**When to use:**
- Architecting new features
- Fixing architectural violations
- Code reviews
- Debugging build errors
- Understanding correct data flow

### 6. **performance-monitoring-expert.md**
**Domain:** Performance Optimization & Observability

**Expertise:**
- Performance targets (p95 < 500ms API, LCP < 2.5s)
- APM setup (Sentry, OpenTelemetry, Winston)
- 6 monitoring layers (Application, Database, Cache, System, Business, Alerts)
- Load testing with k6 (1000+ concurrent users)
- Query optimization strategies

**When to use:**
- Optimizing performance
- Setting up monitoring
- Analyzing bottlenecks
- Preparing for production
- Load testing

### 7. **nextjs-app-router-expert.md**
**Domain:** Next.js 15 App Router Patterns

**Expertise:**
- Server vs Client component boundaries
- Server Actions and form handling
- Parallel routes and intercepting routes
- Streaming and Suspense patterns
- Metadata API and SEO optimization
- Route handlers and middleware

**When to use:**
- Building new pages or features
- Implementing forms with Server Actions
- Setting up dynamic routes
- Optimizing page loading
- Debugging SSR/hydration issues

### 8. **postgresql-optimization-expert.md**
**Domain:** PostgreSQL Query Optimization

**Expertise:**
- Index strategies (B-tree, GIN, partial indexes)
- Query analysis with EXPLAIN ANALYZE
- Connection pooling (Drizzle connection limits)
- N+1 query prevention
- Materialized views and aggregations
- Database performance tuning

**When to use:**
- Slow database queries (>100ms)
- Optimizing list/search endpoints
- Designing new indexes
- Analyzing query plans
- Scaling for production

### 9. **typescript-monorepo-expert.md**
**Domain:** TypeScript Workspace Management

**Expertise:**
- Project references configuration
- Workspace dependency management
- Shared package patterns (@ipodhan/shared)
- Type safety across packages
- Build coordination and incremental builds

**When to use:**
- Adding new workspace packages
- Resolving type errors across packages
- Setting up project references
- Managing shared utilities
- Workspace build issues

### 10. **testing-strategy-expert.md**
**Domain:** Test Pyramid & Testing Patterns

**Expertise:**
- Test pyramid (70% unit, 20% integration, 10% E2E)
- Vitest unit test patterns
- Integration tests with real DB/Redis
- Playwright E2E tests
- Test coverage targets (80% overall, 90% repositories)
- Mocking strategies

**When to use:**
- Writing tests for new features
- Achieving coverage targets
- Debugging test failures
- Setting up test infrastructure
- Understanding testing architecture

### 11. **fuzzy-search-slug-expert.md**
**Domain:** Fuzzy Search & Slug Generation

**Expertise:**
- Canonical slug generation (13+ legal entity types)
- Fuse.js fuzzy matching configuration
- Similarity thresholds (0.3 search, 0.6 fallback)
- Slug collision detection
- Performance optimization (<500ms target)

**When to use:**
- Implementing search functionality
- Generating slugs for new IPOs
- API fallback strategies
- Handling typos and variants
- Debugging slug conflicts

### 12. **windows-deployment-expert.md**
**Domain:** Windows Server 2022 VPS Deployment

**Expertise:**
- PM2 process management (ecosystem.config.js)
- Windows Server configuration
- Environment variable setup
- Log management and rotation
- Health checks and monitoring
- Deployment and rollback procedures

**When to use:**
- Deploying to production
- Setting up PM2 processes
- Configuring production environment
- Troubleshooting deployment issues
- Managing production logs

### 13. **data-validation-expert.md**
**Domain:** Zod Validation & Data Quality

**Expertise:**
- Zod schema patterns for IPO data
- Multi-source conflict resolution
- Data quality scoring
- Priority system (ADMIN → DRHP → NSE → BSE)
- Validation error handling

**When to use:**
- Validating scraped data
- Resolving data conflicts
- Implementing validation schemas
- Ensuring data quality
- Handling validation errors

### 14. **api-design-expert.md**
**Domain:** RESTful API Design

**Expertise:**
- Standard response formats (success/error)
- Pagination patterns (cursor vs offset)
- Query parameters and filtering
- Error codes and status codes
- Rate limiting headers
- API versioning strategies

**When to use:**
- Designing new API endpoints
- Standardizing responses
- Implementing pagination
- Defining error codes
- API versioning

### 15. **security-patterns-expert.md**
**Domain:** Security Best Practices

**Expertise:**
- SQL injection prevention (Drizzle ORM)
- XSS prevention (React escaping, CSP)
- CSRF protection patterns
- Environment variable security
- Authentication patterns (JWT, sessions)
- Secure headers and input validation

**When to use:**
- Implementing authentication
- Securing API endpoints
- Handling sensitive data
- Preventing vulnerabilities
- Security code reviews

---

## How to Use Skills

### Method 1: Direct Invocation (Planned Feature)

In the future, you'll be able to explicitly invoke skills:

```
User: /skill ipo-domain-expert
User: I need to understand GMP calculations
```

### Method 2: Automatic Activation (Current)

Claude Code automatically activates relevant skills based on context:

**Example 1: IPO Domain**
```
User: "How do I calculate the IPO score based on subscription data?"
→ Claude activates ipo-domain-expert skill
→ Provides 5-component methodology, calculations, rating scale
```

**Example 2: Repository Pattern**
```
User: "Create a new repository for peer companies with caching"
→ Claude activates repository-caching-expert skill
→ Provides BaseRepository extension template, cache keys, TTLs
```

**Example 3: Schema Changes**
```
User: "Add a new column to the ipos table for anchor book status"
→ Claude activates schema-migration-expert skill
→ Walks through: Edit schema → Generate → Review → Migrate
```

**Example 4: Architecture Violations**
```
User: "Why am I getting 'Network request failed' in my service?"
→ Claude activates architecture-patterns-expert skill
→ Identifies HTTP call in service, suggests repository pattern
```

### Method 3: Combining Skills

Skills often work together for complex tasks:

**Task:** Create new IPO endpoint with caching
- **architecture-patterns-expert** - API route structure, data flow
- **repository-caching-expert** - Repository implementation, cache keys
- **ipo-domain-expert** - IPO data structure, field meanings

**Task:** Add financial metric to IPO scoring
- **schema-migration-expert** - Add column to financialData table
- **ipo-domain-expert** - Calculate metric, update scoring algorithm
- **performance-monitoring-expert** - Monitor impact on query performance

---

## Skill File Structure

Each skill file contains:

1. **Purpose Statement** - What this skill provides
2. **When to Invoke** - Specific use cases
3. **Core Concepts** - Key terminology and patterns
4. **Code Examples** - Practical implementation patterns
5. **Common Tasks** - Step-by-step workflows
6. **Troubleshooting** - Common issues and solutions
7. **Best Practices** - Do's and don'ts
8. **References** - Links to relevant documentation

**Average Length:** 500-700 lines per skill (comprehensive coverage)

---

## Benefits of Skills

### 1. **Consistency**
Ensures architectural patterns are followed consistently across the codebase.

**Example:** All repositories extend BaseRepository with correct type signatures.

### 2. **Speed**
Pre-loaded domain knowledge saves time researching and discovering patterns.

**Example:** Instead of searching for "how to cache in IPODhan", skill provides immediate guidance.

### 3. **Quality**
Encoded best practices prevent common mistakes and anti-patterns.

**Example:** Automatically prevents HTTP calls in services (learned from Nov 2025 incident).

### 4. **Onboarding**
New Claude Code instances get instant expertise on the project.

**Example:** Fresh instance knows about single-source-of-truth schema pattern immediately.

### 5. **Documentation**
Skills serve as living documentation that stays up-to-date with the codebase.

**Example:** IPO scoring methodology documented with actual algorithm code.

---

## Skill Maintenance

### When to Update Skills

Skills should be updated when:
1. **Architecture changes** - New patterns, refactorings
2. **Incidents occur** - Lessons learned, new anti-patterns discovered
3. **Features added** - New domain concepts, business logic
4. **Performance tuning** - New targets, optimization strategies
5. **Best practices evolve** - Better patterns discovered

### How to Update Skills

1. Edit the relevant `.md` file in `.claude/skills/`
2. Update code examples, thresholds, or guidance
3. Add new sections if needed
4. Update references to documentation
5. Commit changes with descriptive message

**Example Update:**
```bash
# After increasing cache TTL for IPO details
vim .claude/skills/repository-caching-expert.md
# Update CacheTTL.IPO_DETAIL from 900 to 1800
git commit -m "skill: Update IPO detail cache TTL to 30 minutes"
```

---

## Skill Development Guidelines

### Writing New Skills

When creating a new skill:

1. **Identify the domain** - What specific expertise does this encode?
2. **Define when to use** - Clear triggers for activation
3. **Provide examples** - Code snippets, not just theory
4. **Include troubleshooting** - Common issues and solutions
5. **Add references** - Link to related docs and code
6. **Keep it focused** - One skill = one domain

### Skill Quality Checklist

- [ ] Clear purpose statement
- [ ] Specific activation criteria
- [ ] Practical code examples (not pseudocode)
- [ ] Common tasks with step-by-step workflows
- [ ] Troubleshooting section with real issues
- [ ] Best practices (do's and don'ts)
- [ ] References to source files and docs
- [ ] 500-700 lines (comprehensive but focused)

---

## Frequently Asked Questions

### Q: Do skills affect Claude Code performance?

**A:** No. Skills are loaded on-demand based on context, not all at once.

### Q: Can I have too many skills?

**A:** No practical limit, but skills should be focused. Don't create a skill for every function - create them for domains, patterns, and critical knowledge areas.

### Q: What if skills conflict?

**A:** Skills are designed to be complementary. If conflict occurs, update skills to clarify boundaries or merge related skills.

### Q: How do I know if a skill is being used?

**A:** Claude Code will naturally incorporate skill knowledge into responses. You'll notice responses are more informed and follow project patterns closely.

### Q: Can I test skills before committing?

**A:** Yes. Create the skill file, ask Claude Code questions in that domain, and verify responses align with the skill content.

---

## Examples: Skills in Action

### Example 1: Creating New Repository

**User:** "Create a repository for market holidays"

**Without Skill:**
```
Claude: Here's a basic repository:
class MarketHolidayRepository {
  async findAll() {
    return db.select().from(marketHolidays);
  }
}
```

**With repository-caching-expert Skill:**
```
Claude: I'll create a MarketHolidayRepository following the cache-aside pattern:

1. Extend BaseRepository
2. Import schema from @ipodhan/shared/db/schema
3. Use correct type: NodePgDatabase<typeof schema>
4. Implement caching with 24h TTL (static data)
5. Add cache invalidation methods

[Provides complete implementation with caching]
```

### Example 2: Understanding IPO Score

**User:** "What factors go into IPO scoring?"

**Without Skill:**
```
Claude: IPO scoring typically considers financials, valuation, and market demand.
```

**With ipo-domain-expert Skill:**
```
Claude: IPODhan uses a 5-component scoring methodology (0-10 scale):

1. Financial Strength (3 pts):
   - Revenue growth: >20% YoY = 1.0 pt
   - Profit margin: >10% = 1.0 pt
   - ROE: >20% = 1.0 pt

2. Valuation (2 pts):
   - P/E vs Industry average
   - Price-to-Book ratio

[Continues with complete breakdown, calculation code, and rating scale]
```

### Example 3: Debugging Architectural Issue

**User:** "Why is my service getting 'Network request failed'?"

**Without Skill:**
```
Claude: Could be a network issue or wrong URL. Check your API endpoint.
```

**With architecture-patterns-expert Skill:**
```
Claude: This is an architectural violation. Services in IPODhan must NEVER make HTTP calls.

❌ Current (Wrong):
import { apiClient } from '@/lib/api-client';
const data = await apiClient.get('/api/ipos');

✅ Correct Pattern:
import { db } from '@/lib/db';
import { IPORepository } from '@/lib/repositories/ipo-repository';
const repo = new IPORepository(db, redis);
const data = await repo.findAll();

This pattern was enforced after the Nov 2025 incident where 9 files violated this rule.
```

---

## Conclusion

Skills make Claude Code significantly more effective for the IPODhan project by:

1. **Encoding critical domain knowledge** that would otherwise need to be discovered
2. **Enforcing architectural patterns** that prevent production issues
3. **Providing instant expertise** on complex topics (IPO market, caching strategies)
4. **Documenting lessons learned** from incidents and optimizations
5. **Ensuring consistency** across all development work

Think of skills as the "muscle memory" that makes Claude Code an expert IPODhan developer from the first line of code.

---

**Last Updated:** January 15, 2025
**Total Skills:** 15
**Total Lines:** ~8,500
**Coverage:**
- **Domain & Business:** IPO market knowledge, scoring algorithms
- **Architecture & Patterns:** 3-layer architecture, repository pattern, caching strategies
- **Database & Data:** PostgreSQL optimization, schema management, data validation
- **Framework & Tools:** Next.js 15 App Router, TypeScript monorepo, fuzzy search
- **Quality & Testing:** Test pyramid, integration tests, code quality
- **Security:** SQL injection, XSS, CSRF, authentication patterns
- **Operations:** Windows deployment, PM2, monitoring, performance optimization
- **API Design:** RESTful patterns, pagination, error handling
