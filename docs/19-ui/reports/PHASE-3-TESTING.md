# Phase 3: Real-Time Experience - Testing Documentation

**Test Page:** `/test/live-updates`
**Created:** 2025-11-09
**Status:** Ready for Manual Testing

---

## Test Environment Setup

### Prerequisites

1. **Start Development Server:**
   ```bash
   cd web
   npm run dev
   ```

2. **Open Test Page:**
   ```
   http://localhost:3000/test/live-updates
   ```

3. **Open Browser DevTools:**
   - Console tab (for connection logs)
   - Network tab (for SSE monitoring)
   - Application tab (for localStorage inspection)

---

## Test Scenarios

### Test 1: Normal Operation ✅

**Objective:** Verify all live components receive updates without errors.

**Steps:**
1. Navigate to test page
2. Observe connection status shows "CONNECTED" with green pulse
3. Watch for live updates:
   - LiveSubscriptionTracker: Updates every 30s
   - LiveGMPTicker: Updates every 10s
   - ViewerCount: Updates every 5s
   - MarketPulse: Updates every 60s
   - HotRightNow: Auto-refresh every 60s

**Expected Results:**
- All components show "LIVE" indicator
- Numbers animate smoothly (AnimatedScore integration)
- No console errors
- Timestamps update correctly ("Just now", "5s ago", etc.)

**Pass Criteria:**
- ✅ All components receive updates within expected intervals
- ✅ No JavaScript errors in console
- ✅ Connection status remains "CONNECTED"
- ✅ UI remains responsive

---

### Test 2: Reconnection with Disconnect Button 🔄

**Objective:** Verify automatic reconnection after manual disconnect.

**Steps:**
1. Click "Disconnect" button on test page
2. Observe connection status changes to "DISCONNECTED"
3. Wait for automatic reconnection (max 30 seconds)
4. Verify connection status returns to "CONNECTED"

**Expected Results:**
- Status changes: CONNECTED → DISCONNECTED → CONNECTING → CONNECTED
- Reconnection attempts visible in console:
  - Attempt 1: ~1000ms delay
  - Attempt 2: ~1500ms delay (exponential backoff)
  - Attempt 3: ~2250ms delay
  - Max delay: 30000ms
- Components resume live updates after reconnection

**Pass Criteria:**
- ✅ Automatic reconnection succeeds within 10 seconds
- ✅ Exponential backoff log visible in console
- ✅ No data loss or corruption
- ✅ UI updates resume normally

---

### Test 3: Network Interruption Simulation 📡

**Objective:** Test graceful handling of network failures.

**Steps:**
1. Open DevTools → Network tab
2. Toggle "Offline" checkbox to simulate network loss
3. Observe connection status changes to "ERROR"
4. Check console for reconnection attempts
5. Re-enable network (uncheck "Offline")
6. Verify connection recovery

**Expected Results:**
- Immediate status change to "ERROR" when offline
- Reconnection attempts logged (max 10 attempts)
- Error boundaries prevent app crash
- Connection restores within 5 seconds after network returns

**Pass Criteria:**
- ✅ Graceful error state (no crash)
- ✅ Clear error indicators in UI
- ✅ Successful recovery when network returns
- ✅ Data consistency maintained

---

### Test 4: Long-Running Connection Stability ⏱️

**Objective:** Verify connection remains stable over extended periods.

**Steps:**
1. Leave test page open for 30+ minutes
2. Monitor console for heartbeat messages (every 15s)
3. Check DevTools → Memory tab for memory leaks
4. Verify components continue updating throughout

**Expected Results:**
- Heartbeat messages every 15 seconds: `: heartbeat`
- No memory growth beyond initial load
- Connection remains active (no disconnections)
- Update intervals consistent

**Pass Criteria:**
- ✅ Connection active for full test duration
- ✅ Memory usage stable (<50MB growth)
- ✅ No reconnection attempts
- ✅ All timers/intervals functioning

---

### Test 5: Multiple Concurrent Subscriptions 🎯

**Objective:** Ensure no conflicts when multiple components subscribe to same updates.

**Steps:**
1. Verify test page has 3 instances of subscription updates:
   - LiveSubscriptionTracker (detailed)
   - Compact card in header
   - Dashboard widget
2. Observe all receive updates simultaneously
3. Check console for duplicate event handlers

**Expected Results:**
- All components show identical data
- Single SSE connection shared across components
- No duplicate network requests
- Updates propagate to all subscribers

**Pass Criteria:**
- ✅ Single SSE connection (verify in Network tab)
- ✅ All components update in sync
- ✅ No duplicate event handlers
- ✅ Efficient resource usage

---

### Test 6: Filter Persistence (localStorage) 💾

**Objective:** Verify filter presets save and load correctly.

**Steps:**
1. Set filters in VisualFilterBuilder:
   - Segment: MAINBOARD
   - Status: OPEN
   - Score: 7.5 - 10
2. Click "Save Current" in FilterPresets
3. Name preset "High Quality Open IPOs"
4. Reload page (F5 or Ctrl+R)
5. Load saved preset
6. Verify filters match original configuration

**Expected Results:**
- Preset appears in list after save
- localStorage stores preset data
- Reload preserves all presets
- Load applies correct filters

**Pass Criteria:**
- ✅ Preset saves successfully
- ✅ Data persists across reloads
- ✅ Preset loads exact filter configuration
- ✅ Rename and delete operations work

---

### Test 7: Browser Compatibility 🌐

**Objective:** Verify cross-browser support for SSE.

**Browsers to Test:**
- Chrome 120+ ✅ (Primary)
- Firefox 120+ ✅ (Test)
- Safari 17+ ✅ (Test)
- Edge 120+ ✅ (Test)

**Steps:**
1. Open test page in each browser
2. Verify SSE connection establishes
3. Monitor live updates for 5 minutes
4. Test reconnection logic

**Expected Results:**
- EventSource API supported (95%+ browsers)
- Identical behavior across browsers
- No browser-specific errors

**Pass Criteria:**
- ✅ All browsers connect successfully
- ✅ Live updates work identically
- ✅ No browser-specific bugs
- ✅ Performance consistent

---

### Test 8: Stress Test (100+ Concurrent Updates) 🔥

**Objective:** Verify performance under high update frequency.

**Steps:**
1. Modify SSE endpoint to send updates every 1 second (all types)
2. Open test page
3. Monitor performance in DevTools → Performance tab
4. Record for 60 seconds
5. Check for frame drops, lag, or memory issues

**Expected Results:**
- Smooth animations maintained (60fps)
- UI remains responsive
- No significant memory growth
- CPU usage <20% during updates

**Pass Criteria:**
- ✅ Frame rate >55fps consistently
- ✅ No UI lag or jank
- ✅ Memory usage <100MB increase
- ✅ CPU usage acceptable

---

## Console Logs to Monitor

### Connection Lifecycle
```
[RealtimeClient] Connecting via SSE...
[SSE] Client connected
[RealtimeClient] SSE connected
[RealtimeClient] Status changed: connected
```

### Reconnection Attempts
```
[RealtimeClient] SSE error: [error]
[RealtimeClient] Status changed: error
[RealtimeClient] Reconnecting in 1000ms (attempt 1/10)
[RealtimeClient] Connecting via SSE...
```

### Heartbeat Messages
```
: heartbeat
: heartbeat
: heartbeat
```

---

## Network Tab Verification

### SSE Connection
- **Request URL:** `http://localhost:3000/api/live-updates`
- **Request Method:** GET
- **Status:** 200 (pending/streaming)
- **Type:** eventsource
- **Content-Type:** text/event-stream

### Message Flow
```
data: {"type":"connected","data":{"message":"Live updates connected"},"timestamp":1699999999999}

data: {"type":"subscription","ipoId":"test-ipo-1","data":{...},"timestamp":1699999999999}

data: {"type":"gmp","ipoId":"test-ipo-1","data":{...},"timestamp":1699999999999}

: heartbeat

data: {"type":"viewers","data":{...},"timestamp":1699999999999}
```

---

## localStorage Inspection

### Application Tab → Local Storage
```json
{
  "ipodhan-filter-presets": [
    {
      "id": "preset-1699999999999",
      "name": "High Quality Open IPOs",
      "filters": {
        "segments": ["MAINBOARD"],
        "statuses": ["OPEN"],
        "sectors": [],
        "scoreRange": [7.5, 10],
        "subscriptionRange": [0, 100],
        "priceRange": [0, 10000]
      },
      "createdAt": 1699999999999,
      "lastUsed": 1699999999999
    }
  ]
}
```

---

## Common Issues & Troubleshooting

### Issue 1: Connection Fails Immediately

**Symptoms:**
- Status shows "ERROR" on page load
- Console: "Failed to construct 'EventSource'"

**Possible Causes:**
- SSE endpoint not running (`npm run dev` not started)
- Port 3000 blocked by firewall
- Browser doesn't support EventSource

**Solutions:**
1. Verify dev server is running
2. Check browser console for specific error
3. Try different browser
4. Check network/firewall settings

---

### Issue 2: Reconnection Loop

**Symptoms:**
- Constant reconnection attempts
- Console flooded with reconnection logs
- Status flickers between states

**Possible Causes:**
- SSE endpoint returning errors
- Heartbeat interval too short
- Network instability

**Solutions:**
1. Check SSE endpoint logs
2. Increase heartbeat interval
3. Verify network stability
4. Check server resources (CPU/memory)

---

### Issue 3: Memory Leak

**Symptoms:**
- Memory usage grows continuously
- Page becomes slow over time
- Browser tab crashes after prolonged use

**Possible Causes:**
- Event handlers not cleaned up
- Timers not cleared
- Component unmount issues

**Solutions:**
1. Profile memory in DevTools
2. Check for cleanup in `useEffect` hooks
3. Verify `unsubscribe` functions called
4. Test with single component

---

### Issue 4: localStorage Quota Exceeded

**Symptoms:**
- Cannot save new presets
- Console: "QuotaExceededError"

**Possible Causes:**
- Too many saved presets (>100)
- Other data consuming localStorage
- Browser quota limits (5-10MB)

**Solutions:**
1. Delete old presets
2. Clear localStorage manually
3. Implement preset limit (max 50)
4. Use IndexedDB for larger datasets

---

## Performance Benchmarks

### Target Metrics

| Metric | Target | Acceptable | Poor |
|--------|--------|------------|------|
| Connection Time | <500ms | <1000ms | >1000ms |
| Update Latency | <100ms | <300ms | >300ms |
| Memory Usage | <50MB | <100MB | >100MB |
| CPU Usage | <10% | <20% | >20% |
| Frame Rate | 60fps | 55fps | <55fps |

---

## Test Results Template

Copy this template for each test session:

```markdown
## Test Session: YYYY-MM-DD HH:MM

**Tester:** [Name]
**Browser:** [Chrome 120 / Firefox 120 / Safari 17 / Edge 120]
**Duration:** [30 minutes / 1 hour / etc.]

### Test Results

- [ ] Test 1: Normal Operation
  - Status: PASS / FAIL
  - Notes:

- [ ] Test 2: Reconnection
  - Status: PASS / FAIL
  - Notes:

- [ ] Test 3: Network Interruption
  - Status: PASS / FAIL
  - Notes:

- [ ] Test 4: Long-Running Stability
  - Status: PASS / FAIL
  - Notes:

- [ ] Test 5: Concurrent Subscriptions
  - Status: PASS / FAIL
  - Notes:

- [ ] Test 6: Filter Persistence
  - Status: PASS / FAIL
  - Notes:

- [ ] Test 7: Browser Compatibility
  - Status: PASS / FAIL
  - Notes:

- [ ] Test 8: Stress Test
  - Status: PASS / FAIL
  - Notes:

### Issues Found

1. [Issue description]
   - Severity: P0 (Critical) / P1 (High) / P2 (Medium) / P3 (Low)
   - Steps to reproduce:
   - Expected:
   - Actual:

### Performance Metrics

- Connection Time: XXXms
- Average Update Latency: XXXms
- Memory Usage: XXmb
- CPU Usage: XX%
- Frame Rate: XXfps

### Overall Assessment

- [ ] PASS - Production ready
- [ ] PASS WITH MINOR ISSUES - Deploy with monitoring
- [ ] FAIL - Critical issues require fixes

**Comments:**
```

---

## Automated Testing (Future)

### Unit Tests (Vitest)
```typescript
// tests/unit/websocket/client.test.ts
describe('RealtimeClient', () => {
  it('should connect to SSE endpoint', async () => {
    const client = new RealtimeClient({ endpoint: '/api/live-updates' });
    client.connect();
    // Assert connection established
  });

  it('should reconnect after disconnection', async () => {
    // Test exponential backoff
  });

  it('should handle message parsing', () => {
    // Test JSON parsing and type discrimination
  });
});
```

### Integration Tests (Playwright)
```typescript
// tests/e2e/live-updates.spec.ts
test('Live updates flow', async ({ page }) => {
  await page.goto('/test/live-updates');

  // Wait for connection
  await page.waitForSelector('[data-status="connected"]');

  // Verify live update
  const initialValue = await page.textContent('[data-testid="viewer-count"]');
  await page.waitForTimeout(6000);
  const updatedValue = await page.textContent('[data-testid="viewer-count"]');

  expect(updatedValue).not.toBe(initialValue);
});
```

---

## Next Steps

After completing manual tests:

1. ✅ Document test results
2. ✅ Fix any P0/P1 issues found
3. ✅ Create Phase 3 completion report
4. ➡️ Begin Phase 4: Mobile Excellence
5. ⏳ Add automated E2E tests (future enhancement)

---

**Testing Status:** ⏳ **PENDING MANUAL VERIFICATION**

**Access Test Page:** `http://localhost:3000/test/live-updates`

---

*Last Updated: 2025-11-09*
