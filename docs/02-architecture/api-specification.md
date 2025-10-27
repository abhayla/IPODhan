# API Specification

IPODhan uses a **REST API** pattern with Next.js API Routes. All endpoints follow RESTful conventions and return JSON responses.

## Base URL

- **Production:** `https://ipodhan.com/api`
- **Development:** `http://localhost:3000/api`

## Authentication

No authentication required for MVP (all endpoints public, read-only). Phase 2 will add NextAuth.js for user accounts.

## Key Endpoints

**IPO Endpoints:** 🔵 **MVP**
- `GET /api/ipos` - List IPOs with filtering and pagination
- `GET /api/ipos/{slug}` - Get detailed IPO information
- `GET /api/ipos/{slug}/subscription` - Get subscription history
- `GET /api/ipos/{slug}/gmp` - Get GMP history (enhanced with Subject/Kostak rates)
- `GET /api/ipos/{slug}/peers` - Get peer comparison data (full metrics: P/E, EPS, Diluted EPS, RoNW, NAV, P/BV)
- `POST /api/ipos/compare` - Compare multiple IPOs side-by-side

**Search:** 🔵 **MVP**
- `GET /api/search` - Search IPOs by company name

**Email Subscription:** 🟢 **Phase 2**
- `POST /api/subscribers` - Subscribe to email alerts
- `GET /api/subscribers/verify` - Verify email subscription
- `POST /api/subscribers/unsubscribe` - Unsubscribe from alerts

**Market Holidays:** 🔵 **MVP**
- `GET /api/holidays` - Get market holidays (query params: year, exchange)
- `GET /api/holidays/upcoming` - Get next 5 upcoming holidays

**Registrar Directory:** 🔵 **MVP**
- `GET /api/registrars` - List all active registrars
- `GET /api/registrars/{id}` - Get registrar details
- `GET /api/registrars/search` - Search registrars by name

**Tools & Calculators:** 🔵 **MVP**
- `POST /api/tools/lot-calculator` - Calculate lot size based on investment amount
  - Body: `{ ipoSlug: string, investmentAmount: number }`
  - Returns: `{ lots: number, totalShares: number, totalAmount: number }`
- `POST /api/tools/compare` - Compare multiple IPOs side-by-side
  - Body: `{ ipoSlugs: string[] }`
  - Returns: Comparison data for selected IPOs

**Broker Affiliates:** 🔵 **MVP**
- `GET /api/affiliates` - Get active broker affiliate links (simple, no tracking)

**IPO Detail Enhancements:** ✅ **Epic 11** (Stories 11.9-11.16)
- `GET /api/ipos/{slug}/anchor-investors` - Get anchor investor allocation data (Story 11.10)
  - Returns: List of anchor investors with allocation amounts, lock-in periods
- `GET /api/ipos/{slug}/score` - Get real-time IPO quality score (Story 11.11)
  - Returns: Score breakdown with 5 components (financial strength, valuation, subscription, market performance, fundamentals)
- `GET /api/ipos/{slug}/reviews` - Get aggregated review summary (Story 11.16)
  - Returns: Average rating, recommendation split, top reasons (apply/avoid)
- `GET /api/ipos/{slug}/reviews/list` - Get approved reviews with pagination (Story 11.16)
  - Query params: `limit` (default: 10)
  - Returns: List of approved reviews

**Admin Endpoints:** ✅ **Epic 11** (Authentication Required - Admin Only)
- `GET /api/admin/reviews` - List pending reviews awaiting moderation (Story 11.16)
  - Returns: Pending reviews ordered by creation date
  - Cache: 5 minutes
- `POST /api/admin/reviews/{id}/approve` - Approve a review for display (Story 11.16)
  - Body: `{ adminUserId: string }`
  - Returns: Updated review with approval metadata
  - Invalidates: Review summary cache + pending reviews cache
- `POST /api/admin/reviews/{id}/reject` - Reject a review (Story 11.16)
  - Body: `{ adminUserId: string, reason?: string }`
  - Returns: Updated review with rejection metadata
  - Invalidates: Pending reviews cache
- `POST /api/admin/update-field` - Update protected IPO field (Admin data management)
  - Body: `{ ipoId: string, tableName: string, fieldName: string, value: any, editNote?: string }`
  - Returns: Updated field with protection status
  - Invalidates: Related IPO caches

**IPO News:** 🟢 **Phase 2**
- `GET /api/ipos/{slug}/news` - Get news for specific IPO
- `GET /api/news` - Get all IPO news (paginated, filterable by type)

**Health Check:** 🔵 **MVP**
- `GET /api/health` - Service health status

## Caching Strategy

| Endpoint | Cache TTL | Invalidation |
|----------|-----------|--------------|
| `GET /api/ipos` (listing) | 5 minutes | On scraper update |
| `GET /api/ipos/{slug}` (detail) | 15 minutes | On scraper update |
| `GET /api/ipos/{slug}/subscription` | 10 minutes | On scraper update |
| `GET /api/ipos/{slug}/gmp` | 30 minutes | On manual GMP entry |
| `GET /api/ipos/{slug}/anchor-investors` | 15 minutes | On admin update (Epic 11) |
| `GET /api/ipos/{slug}/score` | 1 hour (OPEN) / 24 hours (LISTED) | On financial data change (Epic 11) |
| `GET /api/ipos/{slug}/reviews` | 15 minutes | On review approval/rejection (Epic 11) |
| `GET /api/admin/reviews` | 5 minutes | On moderation action (Epic 11) |

## Rate Limiting

- **Search endpoint:** 10 requests/minute per IP
- **Email subscription:** 5 requests/hour per IP
- **Other endpoints:** 100 requests/minute per IP

---
