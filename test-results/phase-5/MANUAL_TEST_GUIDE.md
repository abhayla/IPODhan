# Redis Fault Tolerance - Manual Testing Guide

**Quick Reference for Manual Integration Testing**

---

## Prerequisites

- ✅ Next.js application running on port 3007
- ✅ Redis running on port 6379 (PID 5864)
- ✅ API endpoints responding (fix hanging issue first)
- ✅ PowerShell or Command Prompt with admin rights

---

## Quick Test Commands

### Find Redis Process

```bash
# Windows
tasklist | findstr redis

# Expected Output:
redis-server.exe    5864 Services    0    3,608 K
```

### Test API Endpoints (Baseline)

```bash
# Test /api/health
curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/health

# Test /api/ipos
curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/ipos

# Test /api/ipos/history
curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/ipos/history
```

**Record baseline times** (expected: 100-300ms)

---

## Scenario 1: Redis Unavailable at Startup

### Steps:

1. **Stop Redis**:
   ```bash
   taskkill /F /PID 5864
   ```

2. **Verify Redis is stopped**:
   ```bash
   tasklist | findstr redis
   # Should return nothing
   ```

3. **Restart Next.js application**:
   ```bash
   cd D:\Abhay\VibeCoding\IPODhan\web
   npm run dev
   ```

4. **Check startup logs**:
   - Look for: `[Redis] Connection error`
   - Look for: `[Redis] Max retries reached`
   - Application should still start successfully

5. **Test API endpoints**:
   ```bash
   curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/health
   curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/ipos
   ```

### Expected Results:

- ✅ Application starts without crash
- ✅ All endpoints return HTTP 200 (not 500)
- ✅ Response times: 2-3 seconds (timeout overhead + DB query)
- ✅ Logs show `[Cache] Error` but application continues

### Pass/Fail Criteria:

- **PASS**: All endpoints return 200, no exceptions
- **FAIL**: Any 500 errors or application crashes

---

## Scenario 2: Redis Fails During Operation

### Steps:

1. **Ensure Redis is running**:
   ```bash
   redis-server.exe
   ```

2. **Make baseline request** (warm up cache):
   ```bash
   curl -w "\nTime: %{time_total}s\n" http://localhost:3007/api/ipos
   ```
   Record time (expected: ~100-200ms with cache hit)

3. **Stop Redis during operation**:
   ```bash
   # In a separate terminal
   taskkill /F /PID 5864
   ```

4. **Immediately make same request**:
   ```bash
   curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/ipos
   ```

5. **Make 5 more requests** (test consistency):
   ```bash
   for i in {1..5}; do
     curl -w "\nRequest $i - Status: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/ipos
   done
   ```

### Expected Results:

- ✅ No request failures (all HTTP 200)
- ✅ Automatic fallback to database
- ✅ Response time: ~2-3 seconds (timeout + DB)
- ✅ Logs show:
  - `[Cache] Error getting key`
  - `[DB] IPORepository.findAll - XXXms`
  - No exceptions thrown

### Pass/Fail Criteria:

- **PASS**: Zero 500 errors, all requests succeed
- **FAIL**: Any request failures or application crashes

---

## Scenario 3: Redis Recovers After Failure

### Steps:

1. **Start with Redis down** (from Scenario 2)

2. **Restart Redis**:
   ```bash
   redis-server.exe
   ```

3. **Wait 3 seconds** (for automatic reconnection):
   ```bash
   timeout /t 3
   ```

4. **Check Next.js logs**:
   - Look for: `[Redis] Attempting to reconnect...`
   - Look for: `[Redis] Connected successfully`
   - Look for: `[Redis] Ready to accept commands`

5. **Make first request** (cache empty):
   ```bash
   curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/ipos
   ```
   Record time (expected: ~300-600ms, DB query without cache)

6. **Make second request** (cache populated):
   ```bash
   curl -w "\nStatus: %{http_code} | Time: %{time_total}s\n" http://localhost:3007/api/ipos
   ```
   Record time (expected: ~100-200ms, cache hit)

7. **Monitor cache repopulation**:
   ```bash
   # Make 10 requests to same endpoint
   for i in {1..10}; do
     curl -w "\nRequest $i - Time: %{time_total}s\n" http://localhost:3007/api/ipos
   done
   ```

### Expected Results:

- ✅ Automatic reconnection within 3 seconds
- ✅ First request: ~500ms (cache miss, DB query)
- ✅ Second request: ~100ms (cache hit)
- ✅ Cache hit rate improves with each request
- ✅ Logs show:
  - `[Redis] Connected successfully`
  - `[Cache] MISS` on first request
  - `[Cache] HIT` on subsequent requests

### Pass/Fail Criteria:

- **PASS**: Automatic reconnection, cache operations resume, response times return to baseline
- **FAIL**: Manual intervention needed, cache not working, slow response times persist

---

## Performance Comparison Table

Fill in actual values during testing:

| Metric | Redis Working | Redis Down | After Recovery (1st req) | After Recovery (2nd req) |
|--------|---------------|------------|--------------------------|--------------------------|
| /api/health | _____ ms | _____ ms | _____ ms | _____ ms |
| /api/ipos | _____ ms | _____ ms | _____ ms | _____ ms |
| /api/ipos/history | _____ ms | _____ ms | _____ ms | _____ ms |
| **Average** | _____ ms | _____ ms | _____ ms | _____ ms |

**Degradation Factor**: _____ x slower without Redis

---

## Common Issues & Troubleshooting

### Issue: API endpoints still hanging

**Solution**:
1. Check database connection: `psql -h 103.118.16.189 -U postgres -d ipodhan`
2. Check rate limiter configuration
3. Review Next.js logs for errors
4. Restart Next.js application

### Issue: Redis won't start

**Solution**:
```bash
# Check if port 6379 is in use
netstat -ano | findstr :6379

# Start Redis manually
redis-server.exe
```

### Issue: Application crashes on startup without Redis

**Status**: ❌ FAILED - Graceful degradation not working

**Action**: Review code in `web/lib/cache/redis-client.ts` and `web/lib/repositories/base-repository.ts`

### Issue: Requests fail with 500 errors when Redis is down

**Status**: ❌ FAILED - Database fallback not working

**Action**: Check `getFromCache()` error handling in `base-repository.ts`

---

## Log Patterns to Watch For

### ✅ GOOD - Graceful Degradation Working

```
[Redis] Connection error: connect ECONNREFUSED 127.0.0.1:6379
[Redis] Attempting to reconnect...
[Redis] Max retries reached, stopping reconnection attempts
[Cache] Error getting key ipo:list:abc123: Connection is closed
[DB] IPORepository.findAll - 456ms
```

### ❌ BAD - Fault Tolerance Failing

```
ERROR: Cannot read property 'get' of null
ERROR: Unhandled promise rejection
ERROR: Connection pool exhausted
```

---

## Quick Recovery Commands

**Restart Redis**:
```bash
redis-server.exe
```

**Restart Next.js**:
```bash
cd D:\Abhay\VibeCoding\IPODhan\web
npm run dev
```

**Check if services are running**:
```bash
# Redis
netstat -ano | findstr :6379

# Next.js
netstat -ano | findstr :3007
```

---

## Test Report Template

Copy and fill out after testing:

```markdown
## Test Execution Results

**Date**: ___________
**Tester**: ___________
**Environment**: Windows Server 2022, Redis 3.0.504, Next.js 15.5.4

### Scenario 1: Redis Unavailable at Startup
- [ ] Application starts successfully
- [ ] All endpoints return HTTP 200
- [ ] Response times < 3 seconds
- [ ] Logs show graceful degradation

**Status**: PASS / FAIL
**Notes**: ___________

### Scenario 2: Redis Fails During Operation
- [ ] Zero request failures
- [ ] Automatic fallback to database
- [ ] Response time ~2-3 seconds
- [ ] Logs show cache error → database fallback

**Status**: PASS / FAIL
**Notes**: ___________

### Scenario 3: Redis Recovers After Failure
- [ ] Automatic reconnection within 3 seconds
- [ ] First request ~500ms (cache miss)
- [ ] Second request ~100ms (cache hit)
- [ ] Logs show successful reconnection

**Status**: PASS / FAIL
**Notes**: ___________

### Overall Result
- [ ] All scenarios passed
- [ ] Graceful degradation confirmed
- [ ] Zero downtime verified

**Final Verdict**: PASS / FAIL
```

---

## Next Steps After Testing

1. If all tests **PASS**:
   - Update `test-results/phase-5/redis-fault-tolerance-tests.md` with actual results
   - Mark Enhancement #24 as COMPLETE
   - Proceed to Phase 5 Journey Testing

2. If any test **FAILS**:
   - Document failure details in test report
   - Create bug ticket with:
     - Exact steps to reproduce
     - Expected vs actual behavior
     - Log excerpts
     - Screenshots if applicable
   - Fix issues before marking enhancement complete

---

**Document Version**: 1.0
**Last Updated**: 2025-10-21
**Related Documents**:
- `test-results/phase-5/redis-fault-tolerance-tests.md` (Main test report)
- `docs/05-caching/CACHING_STRATEGY.md` (Architecture reference)
