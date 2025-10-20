# Appendix C: Architecture References

**[← Back to Index](README.md)**

This appendix provides a complete reference guide to all architecture documents and their relevance to each testing phase.

---

## Document Map

| Document | Location | Purpose | Key Sections |
|----------|----------|---------|--------------|
| **Backend Architecture** | `docs/02-architecture/backend-architecture.md` | Repository pattern, service layer, 3-tier architecture | Repository Pattern, BaseRepository, Service Layer, Cache-Aside Pattern |
| **Caching Strategy** | `docs/05-caching/CACHING_STRATEGY.md` | Redis caching patterns, TTL strategy, invalidation | Cache Keys, TTL Values, Invalidation Patterns, Graceful Degradation |
| **Security & Performance** | `docs/02-architecture/security-and-performance.md` | Performance targets, security requirements | API Response Times, Core Web Vitals, Database Query Targets |
| **Testing Strategy** | `docs/02-architecture/testing-strategy.md` | Automated testing approach, coverage targets | Unit Tests, Integration Tests, E2E Tests, Coverage Goals |
| **API Specification** | `docs/02-architecture/api-specification.md` | REST API patterns, response formats | Standard Response Format, Error Handling, Pagination |
| **Database Schema** | `packages/shared/src/db/schema.ts` | Single source of truth for schema | 16 Tables, Relations, Enums |
| **Schema Management** | `docs/16-database/SCHEMA_MANAGEMENT.md` | Migration workflow, incident log | Schema → Migration → Database Workflow |
| **UI-Database Mapping** | `docs/16-database/screen-table-database-field-mapping.md` | UI screens mapped to database tables | 32 Screens, Field Coverage, Scrape Sources |
| **Scraper Architecture** | `scraper/README.md` | Scraper implementation details | NSE, BSE, Moneycontrol, Chittorgarh |
| **Scraping Strategy** | `scraper/docs/SCRAPING_STRATEGY.md` | NSE API discovery, multi-source strategy | Hidden NSE APIs, Error Handling |
| **Deployment Architecture** | `docs/02-architecture/deployment-architecture.md` | VPS deployment, PM2 configuration | Server Setup, Process Management |

---

## Phase-Specific References

### Phase 1: Data Quality & Scraping Validation

**Must Read:**
- `packages/shared/src/db/schema.ts` - Database schema (single source of truth)
- `docs/16-database/SCHEMA_MANAGEMENT.md` - Schema workflow and migration process
- `scraper/README.md` - Scraper architecture and implementation

**Key Concepts:**
- **16 Database Tables**: ipos, subscriptions, gmpRecords, financialData, documents, listingPerformance, marketHolidays, registrars, peerCompanies, brokerAffiliates, affiliateClicks, scraperLogs, ipoReviews, ipoScores, ipoDetails, ipoFinancials
- **Schema Drift Prevention**: Never modify schema outside `packages/shared/src/db/schema.ts`
- **Migration Workflow**: Schema changes → `db:generate` → review SQL → `db:migrate`
- **Scraper Sources**: NSE (primary), BSE (secondary), Moneycontrol (fallback), Chittorgarh (historical)

**Relevant Sections:**
- Schema Management: Complete workflow (Schema → Migration → Database)
- Scraper Logs: Monitoring and failure tracking
- Field Coverage: Critical, Important, Enhanced field categories

---

### Phase 2: Core Pages Testing

**Must Read:**
- `docs/02-architecture/backend-architecture.md` - Repository and service patterns
- `docs/02-architecture/api-specification.md` - API response formats
- `docs/16-database/screen-table-database-field-mapping.md` - UI to database mapping

**Key Concepts:**
- **3-Layer Architecture**: API Routes → Services → Repositories
- **Repository Pattern**: All repositories extend BaseRepository with cache-aside
- **Service Layer**: Business logic orchestration, compose multiple repositories
- **API Response Format**: Standardized success/error response structure

**Relevant Sections:**
- Repository Pattern: Type requirements, naming conventions
- Service Layer: Orchestration patterns
- UI-Database Mapping: 32 screens mapped to tables
- API Routes: Standard response format, error handling

---

### Phase 3: Tools & Features Testing

**Must Read:**
- `docs/02-architecture/backend-architecture.md` - Service layer patterns
- `docs/16-database/screen-table-database-field-mapping.md` - Tool calculations

**Key Concepts:**
- **Lot Calculator**: `floor(investment / (lotSize * price))`
- **IPO Compare**: Multi-IPO data aggregation
- **Allotment Checker**: Form validation and registrar integration

**Relevant Sections:**
- Service Layer: Complex calculation logic
- Data Validation: Input sanitization
- Error Handling: User-friendly error messages

---

### Phase 4: Category Pages Testing

**Must Read:**
- `docs/16-database/screen-table-database-field-mapping.md` - Category filtering
- `docs/02-architecture/api-specification.md` - Pagination and filtering

**Key Concepts:**
- **Category Enum**: MAINBOARD, SME, OFS, NCD, RIGHTS, FPO
- **Mainboard Pages**: 6 distinct pages (landing, calendar, performance, prospectus, listings, reviews)
- **SME Pages**: Same structure as mainboard, separate category filter

**Relevant Sections:**
- Category Filtering: Database enum filtering
- Pagination: Limit/offset implementation
- Empty States: Handling categories with no data

---

### Phase 5: Integration & Performance Testing

**Must Read:**
- `docs/05-caching/CACHING_STRATEGY.md` - Complete caching strategy
- `docs/02-architecture/security-and-performance.md` - Performance targets
- `docs/02-architecture/backend-architecture.md` - Repository caching patterns

**Key Concepts:**
- **Cache-Aside Pattern**: Check cache → if miss, query DB → populate cache → return data
- **Performance Targets**: API p95 < 500ms, p99 < 1000ms; DB queries < 100ms
- **Cache Invalidation**: Pattern-based deletion after mutations
- **Graceful Degradation**: App continues functioning when Redis is down

**Relevant Sections:**
- Cache Keys: Naming conventions (`entity:identifier[:variant]`)
- TTL Strategy: IPO_DETAIL (900s), IPO_LIST (300s), SUBSCRIPTION (180s), GMP (900s)
- Invalidation Patterns: INSERT → list caches, UPDATE → detail + list, DELETE → all related
- Performance Benchmarking: p95/p99 percentile targets per endpoint type

---

## Quick Reference Tables

### Cache Key Conventions

| Pattern | Example | TTL | Description |
|---------|---------|-----|-------------|
| `ipo:slug:{slug}` | `ipo:slug:bajaj-housing-finance-ipo` | 900s | IPO detail page |
| `ipo:list:{filters}` | `ipo:list:mainboard-open` | 300s | Filtered IPO list |
| `subscription:latest:{id}` | `subscription:latest:ipo-123` | 180s | Latest subscription data |
| `gmp:latest:{id}` | `gmp:latest:ipo-123` | 900s | Latest GMP data |
| `gmp:history:{id}` | `gmp:history:ipo-123` | 3600s | Historical GMP trend |

### Performance Targets Summary

| Metric | Target | Source |
|--------|--------|--------|
| **API Response Time (p95)** | < 500ms | security-and-performance.md |
| **API Response Time (p99)** | < 1000ms | security-and-performance.md |
| **Single DB Query** | < 10ms | security-and-performance.md |
| **List Queries** | < 50ms | security-and-performance.md |
| **Complex Joins** | < 100ms | security-and-performance.md |
| **Full-Text Search** | < 200ms | security-and-performance.md |
| **Cache Hit Rate** | > 80% | caching-strategy.md |
| **LCP (Largest Contentful Paint)** | < 2.5s | security-and-performance.md |
| **FID (First Input Delay)** | < 100ms | security-and-performance.md |

### Database Table Overview

| Table | Purpose | Key Fields | Related Tables |
|-------|---------|------------|----------------|
| **ipos** | Core IPO entity | id, slug, company_name, status, category, open_date, close_date | All others (parent) |
| **subscriptions** | Time-series subscription data | ipo_id, timestamp, qib_times, nii_times, retail_times | ipos |
| **gmp_records** | Time-series GMP tracking | ipo_id, timestamp, price, premium | ipos |
| **financial_data** | One-to-one financial metrics | ipo_id, revenue, profit, roce, roe | ipos |
| **documents** | One-to-many IPO documents | ipo_id, document_type, document_url | ipos |
| **listing_performance** | One-to-one listing data | ipo_id, listing_price, listing_gain | ipos |
| **ipo_scores** | AI-powered IPO scoring | ipo_id, total_score, fundamental_score, sentiment_score | ipos |
| **peer_companies** | Peer comparison data | ipo_id, peer_name, market_cap, pe_ratio | ipos |
| **broker_affiliates** | Affiliate links | broker_code, affiliate_url, display_order | - |
| **affiliate_clicks** | Click tracking | ipo_id, broker_id, clicked_at | ipos, broker_affiliates |

### Repository Pattern Reference

```typescript
// All repositories must follow this pattern
export class ExampleRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>, // Type from @ipodhan/shared/db/schema
    protected redis: Redis
  ) {
    super(db, redis);
  }

  async findById(id: string): Promise<Example | null> {
    const cacheKey = getExampleByIdKey(id);
    return this.getFromCache(cacheKey, async () => {
      return await this.db.query.examples.findFirst({
        where: eq(schema.examples.id, id)
      });
    }, CacheTTL.EXAMPLE_DETAIL);
  }
}
```

**Key Requirements:**
- Extend `BaseRepository`
- Use `NodePgDatabase<typeof schema>` type
- Import schema from `@ipodhan/shared/db/schema`
- Use cache-aside pattern via `getFromCache()`
- Invalidate cache after mutations

---

## Architecture Decision Records (ADRs)

### ADR-001: Single Source of Truth for Schema
**Decision**: All database schema defined in `packages/shared/src/db/schema.ts`
**Rationale**: Prevent schema drift, enable type sharing across packages
**Consequences**: Never modify schema outside shared package

### ADR-002: Cache-Aside Pattern
**Decision**: Implement cache-aside in BaseRepository, not service layer
**Rationale**: Consistent caching across all repositories, easier invalidation
**Consequences**: All repositories must extend BaseRepository

### ADR-003: Graceful Degradation for Redis
**Decision**: Application must continue functioning when Redis is unavailable
**Rationale**: Prevent single point of failure, maintain availability
**Consequences**: All cache operations must have fallback to database

### ADR-004: Approval-Gated Production Testing
**Decision**: All data modifications require explicit approval before execution
**Rationale**: Prevent accidental data loss on production database
**Consequences**: Testing workflow includes approval checkpoints

---

## Cross-Reference Index

**By Feature:**
- IPO Listing → ipos table, IPORepository, GET /api/ipos
- Subscription Tracking → subscriptions table, SubscriptionRepository, GET /api/subscriptions
- GMP Data → gmpRecords table, GMPRepository, GET /api/gmp
- IPO Scoring → ipoScores table, ScoringService, GET /api/ipos/[slug]/rating
- Peer Comparison → peerCompanies table, PeerRepository, GET /api/ipos/[slug]/peers

**By Performance:**
- Slow API? → Check repository caching (backend-architecture.md)
- Low cache hit rate? → Review cache keys (caching-strategy.md)
- Slow database query? → Check indexes (security-and-performance.md)
- High memory usage? → Review cache TTL (caching-strategy.md)

---

## Document Reading Order

**For Comprehensive Understanding:**
1. Start: `backend-architecture.md` (architecture overview)
2. Then: `packages/shared/src/db/schema.ts` (data model)
3. Then: `caching-strategy.md` (caching patterns)
4. Then: `security-and-performance.md` (performance targets)
5. Finally: `testing-strategy.md` (automated testing)

**For Quick Testing:**
1. Start: `schema.ts` (what tables exist)
2. Then: Relevant phase document
3. Reference: This appendix for specific lookups

---

**Questions?** Use Ctrl+F to search this appendix, or consult the specific architecture document listed above.
