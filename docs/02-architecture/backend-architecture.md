# Backend Architecture

## Service Architecture

**Controller/Route Organization:**
- `app/api/ipos/route.ts` - GET /api/ipos
- `app/api/ipos/[slug]/route.ts` - GET /api/ipos/[slug]
- `app/api/ipos/[slug]/subscription/route.ts` - GET subscription data
- `app/api/search/route.ts` - GET search
- `app/api/subscribers/route.ts` - POST subscribe

## Repository Pattern Implementation

**IPORepository:**
- `findAll(filters)` - Query with filters and pagination
- `findBySlug(slug)` - Get IPO with relations
- `search(query)` - Fuzzy search by company name

**SubscriptionRepository:**
- `findByIPO(ipoId)` - Get subscription history
- `findLatest(ipoId)` - Get latest snapshot
- `createSnapshot(ipoId, data)` - Insert new subscription data

**Cache-Aside Pattern:**
- Check Redis before PostgreSQL
- Populate cache on miss with TTL
- Explicit invalidation on data updates

## Database Architecture

**Drizzle ORM Schema:**
- Type-safe schema definitions in `lib/db/schema.ts`
- Relations for type-safe joins
- Migration-based schema management

**Connection Pooling:**
- Max 20 connections
- Idle timeout: 30 seconds
- Connection timeout: 2 seconds

---
