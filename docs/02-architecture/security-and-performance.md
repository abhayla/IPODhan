# Security and Performance

## Security Requirements

**Frontend Security:**
- **CSP Headers:** Content Security Policy to prevent XSS
- **XSS Prevention:** React automatic escaping + DOMPurify for markdown
- **Secure Storage:** No sensitive data in LocalStorage
- **HTTPS Only:** Enforced via Cloudflare

**Backend Security:**
- **Input Validation:** Zod schemas for all API endpoints
- **Rate Limiting:** Redis-based rate limiting (10-100 req/min depending on endpoint)
- **CORS Policy:** Allow all origins (public API)
- **SQL Injection Prevention:** Drizzle ORM parameterized queries only

**Authentication Security (Phase 2):**
- **Token Storage:** httpOnly, Secure, SameSite cookies
- **Session Management:** 30-day expiry, sliding sessions
- **Password Policy:** 12+ characters, bcrypt hashing

## Performance Optimization

**Frontend Performance:**
- **Bundle Size Target:** <200KB initial JS (gzipped)
- **Loading Strategy:** Dynamic imports for charts/modals
- **Caching Strategy:** Aggressive CDN caching for static assets
- **Image Optimization:** next/image for all images
- **Font Optimization:** next/font for Google Fonts

**Performance Targets:** 🔵 **MVP**
- **Aspirational Goal:** <2 seconds total page load time
- **Minimum Requirement (Web Vitals):**
  - Performance Score: >90
  - LCP (Largest Contentful Paint): <2.5s
  - FID (First Input Delay): <100ms
  - CLS (Cumulative Layout Shift): <0.1
- **Rationale:** Target 2s as aggressive goal for competitive advantage, use LCP <2.5s as measurable success metric aligned with industry standards

**Backend Performance:**
- **Response Time Target:** <500ms (p95)
- **Database Queries:** <100ms with proper indexes
- **Cache Hits:** <10ms via Redis
- **Connection Pooling:** Max 20 PostgreSQL connections

**Caching Strategy:**

| Data Type | Cache TTL | Invalidation |
|-----------|-----------|--------------|
| IPO List | 5 min | On scraper update |
| IPO Detail | 15 min | On scraper update |
| Subscription | 10 min | On scraper update |
| GMP History | 30 min | On manual entry |

---
