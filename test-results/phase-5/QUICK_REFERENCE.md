# Phase 5 Endpoints - Quick Reference Guide

## Testing Endpoints Locally

### 1. Start Development Server
```bash
cd web
npm run dev
```

### 2. Test Priority 1 Endpoints (No Auth Required)

**Financial Data:**
```bash
curl http://localhost:3000/api/ipos/test-company-ipo/financials
```

**Documents:**
```bash
curl http://localhost:3000/api/ipos/test-company-ipo/documents
```

**Listing Performance:**
```bash
curl http://localhost:3000/api/ipos/test-company-ipo/listing-performance
```

**Peer Companies:**
```bash
curl http://localhost:3000/api/ipos/test-company-ipo/peers
```

### 3. Test Priority 2 Endpoints

**Subscription History:**
```bash
# All history
curl http://localhost:3000/api/subscription/history/{ipoId}

# Last 7 days
curl http://localhost:3000/api/subscription/history/{ipoId}?days=7
```

**GMP History:**
```bash
# All history
curl http://localhost:3000/api/gmp/history/{ipoId}

# Last 30 days
curl http://localhost:3000/api/gmp/history/{ipoId}?days=30
```

**Calendar:**
```bash
# All events
curl http://localhost:3000/api/calendar

# Filter by month
curl http://localhost:3000/api/calendar?month=2025-10

# Filter by category
curl http://localhost:3000/api/calendar?category=MAINBOARD

# Both filters
curl http://localhost:3000/api/calendar?month=2025-10&category=MAINBOARD
```

**Admin Create IPO (Requires Auth):**
```bash
curl -X POST http://localhost:3000/api/admin/ipos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "companyName": "Test IPO Company",
    "category": "MAINBOARD",
    "status": "UPCOMING",
    "issuePrice": 100,
    "lotSize": 150
  }'
```

**Admin Update IPO (Requires Auth):**
```bash
curl -X PATCH http://localhost:3000/api/admin/ipos/{ipoId} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "issuePrice": 150,
    "lotSize": 200
  }'
```

### 4. Test Priority 3 Endpoints

**Search:**
```bash
# Basic search
curl http://localhost:3000/api/search?q=test

# With limit
curl http://localhost:3000/api/search?q=test&limit=20
```

**Registrars:**
```bash
# All registrars
curl http://localhost:3000/api/registrars

# Search
curl http://localhost:3000/api/registrars?search=link
```

**Market Holidays:**
```bash
# All holidays
curl http://localhost:3000/api/market-holidays

# Filter by year
curl http://localhost:3000/api/market-holidays?year=2025

# Filter by exchange
curl http://localhost:3000/api/market-holidays?exchange=NSE
```

---

## Running Integration Tests

### All New Endpoint Tests
```bash
cd web
npm run test:integration -- new-endpoints.test.ts
```

### Specific Test Suite
```bash
# Priority 1 only
npm run test:integration -- -t "Priority 1"

# Priority 2 only
npm run test:integration -- -t "Priority 2"

# Cache validation
npm run test:integration -- -t "Cache"

# Performance tests
npm run test:integration -- -t "Performance"
```

### With Coverage
```bash
npm run test:coverage -- new-endpoints.test.ts
```

---

## Environment Setup

### Required Environment Variables

**Development (.env.local):**
```bash
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/ipodhan

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Admin Auth (NEW)
ADMIN_API_TOKEN=your-32-character-token-here
```

### Generate Admin Token
```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using OpenSSL
openssl rand -hex 32

# Using PowerShell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

---

## Cache Keys Reference

| Endpoint | Cache Key Pattern | TTL |
|----------|------------------|-----|
| Financials | `financial:${ipoId}` | 24h |
| Documents | `documents:${ipoId}` | 24h |
| Listing Performance | `listing:${ipoId}` | 15m |
| Peers | `peers:${ipoId}` | 7d |
| Subscription History | `subscription:history:${ipoId}:${days}` | 3m |
| GMP History | `gmp:history:${ipoId}:${days}` | 15m |
| Calendar | `calendar:*` | 5m |
| Search | `search:${query}:${limit}` | 5m |
| Registrars | `registrars:*` | 7d |
| Market Holidays | `reference:market-holidays` | 30d |

---

## Common Issues & Solutions

### Issue: 401 Unauthorized on Admin Endpoints

**Cause:** Missing or invalid ADMIN_API_TOKEN

**Solution:**
```bash
# 1. Generate token
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 2. Add to .env.local
echo "ADMIN_API_TOKEN=$TOKEN" >> .env.local

# 3. Restart dev server
npm run dev
```

### Issue: 404 Not Found on New Endpoints

**Cause:** Files not properly created or server not restarted

**Solution:**
```bash
# 1. Verify files exist
ls web/app/api/ipos/[slug]/financials/route.ts

# 2. Restart dev server
npm run dev

# 3. Check server logs for compilation errors
```

### Issue: Redis Connection Error

**Cause:** Redis not running or wrong connection details

**Solution:**
```bash
# 1. Check Redis is running
redis-cli ping
# Should return: PONG

# 2. If not running, start Redis
# Windows: Start Redis service
# Linux: sudo systemctl start redis

# 3. Verify connection details in .env.local
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Issue: Slow Response Times

**Cause:** Cache not warmed up or database not optimized

**Solution:**
```bash
# 1. Warm up cache by accessing endpoints
curl http://localhost:3000/api/ipos/test-company-ipo/financials

# 2. Check cache hit rate in logs
# Look for: [Cache] HIT: financial:${ipoId}

# 3. If cache misses persist, check Redis
redis-cli
> KEYS *
> GET "financial:some-id"
```

---

## Performance Monitoring

### Check Response Times
```bash
# Using curl with timing
curl -w "@-" -o /dev/null -s http://localhost:3000/api/search?q=test <<'EOF'
   time_namelookup:  %{time_namelookup}\n
      time_connect:  %{time_connect}\n
   time_appconnect:  %{time_appconnect}\n
  time_pretransfer:  %{time_pretransfer}\n
     time_redirect:  %{time_redirect}\n
time_starttransfer:  %{time_starttransfer}\n
                   ----------\n
        time_total:  %{time_total}\n
EOF
```

### Check Cache Hit Rate
```bash
# Redis CLI
redis-cli
> INFO stats
# Look for: keyspace_hits, keyspace_misses

# Calculate hit rate
# hit_rate = hits / (hits + misses) * 100
```

---

## Deployment Checklist

- [ ] All environment variables set in production
- [ ] `ADMIN_API_TOKEN` generated and secured
- [ ] Dependencies installed (`npm install fuse.js`)
- [ ] Production build successful (`npm run build`)
- [ ] Redis server running and accessible
- [ ] PostgreSQL database accessible
- [ ] Integration tests passing
- [ ] Admin token tested with POST/PATCH endpoints
- [ ] Cache warming completed (access key endpoints)
- [ ] Performance benchmarks verified (<500ms p95)
- [ ] Error monitoring configured (Sentry)
- [ ] API documentation updated

---

## Support & Documentation

**Full Documentation:**
- Implementation Report: `test-results/phase-5/missing-endpoints-implementation.md`
- Summary: `test-results/phase-5/SUMMARY.md`
- This Quick Reference: `test-results/phase-5/QUICK_REFERENCE.md`

**Architecture Docs:**
- Backend Architecture: `docs/02-architecture/backend-architecture.md`
- Caching Strategy: `docs/05-caching/CACHING_STRATEGY.md`
- API Specification: `docs/02-architecture/api-specification.md`

**Testing:**
- Integration Tests: `web/tests/integration/new-endpoints.test.ts`
- Testing Strategy: `docs/02-architecture/testing-strategy.md`

---

**Last Updated:** 2025-10-21
**Phase:** 5 - Missing API Endpoints Implementation
**Status:** ✅ COMPLETED
