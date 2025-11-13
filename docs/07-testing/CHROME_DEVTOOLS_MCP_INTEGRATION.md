# Chrome DevTools MCP Integration

**Created**: 2025-11-12
**Status**: Installed - Pending Activation
**Location**: `.vscode/settings.json`

---

## Installation Summary

✅ **Chrome DevTools MCP has been added to VS Code settings**

### Configuration Added:
```json
{
  "claudeCode.mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    }
  }
}
```

---

## Next Steps

### 1. Activate the MCP Server

**⚠️ IMPORTANT**: You need to restart VS Code or reload the Claude Code extension to activate the Chrome DevTools MCP server.

**Options:**
- **Option A**: Restart VS Code completely
- **Option B**: Reload VS Code window (Ctrl+Shift+P → "Developer: Reload Window")
- **Option C**: Restart Claude Code extension

### 2. Verify Installation

After restarting, verify the Chrome DevTools MCP is active by:
1. Checking available MCP functions in Claude Code
2. Looking for chrome-devtools related functions
3. Testing a simple Chrome DevTools command

---

## Expected Capabilities

Once activated, Chrome DevTools MCP should provide:

### Performance Profiling
- **CPU profiling**: Track JavaScript execution time
- **Memory profiling**: Heap snapshots and leak detection
- **Timeline recording**: Frame-by-frame analysis

### Network Analysis
- **Request waterfall**: Visualize loading sequence
- **Response timing**: DNS, TCP, SSL, and request times
- **Resource caching**: Cache hit/miss analysis

### Core Web Vitals
- **LCP (Largest Contentful Paint)**: Currently 2.8-3.2s → Target: <2.5s
- **FID (First Input Delay)**: Measure input responsiveness
- **CLS (Cumulative Layout Shift)**: Currently 0.03-0.08 (good)

### Code Coverage
- **JavaScript coverage**: Identify unused code
- **CSS coverage**: Find unused styles
- **Bundle optimization**: Dead code elimination

### Runtime Analysis
- **JavaScript execution**: Profile function calls
- **Layout performance**: Reflow/repaint tracking
- **Rendering performance**: Paint profiling

---

## Integration with Testing Plan

### Enhanced Testing Strategy

**Original Distribution:**
- 95% Native Playwright
- 5% Playwright MCP (debugging)

**With Chrome DevTools MCP:**
- **85% Native Playwright**: Core automated testing
- **10% Chrome DevTools MCP**: Performance & profiling
- **5% Playwright MCP**: Interactive debugging

### Specific Use Cases

#### Week 6: Performance Testing (Phase 6)

**Before Chrome DevTools MCP:**
- Lighthouse CI only
- Basic Core Web Vitals
- Limited profiling data

**With Chrome DevTools MCP:**
- ✅ Deep CPU profiling
- ✅ Memory leak detection
- ✅ Network waterfall analysis
- ✅ JavaScript execution breakdown
- ✅ Rendering performance metrics
- ✅ Frame-by-frame timeline

#### Performance Testing Workflow

```typescript
// Example: Profile IPO Detail page performance
// 1. Navigate to page
await chromeDevTools.navigate('http://localhost:3000/ipos/example-ipo');

// 2. Start performance profiling
await chromeDevTools.startProfiling();

// 3. Perform user actions (scroll, click, etc.)
await chromeDevTools.scroll({ y: 500 });
await chromeDevTools.click({ selector: '.financial-tab' });

// 4. Stop profiling and analyze
const profile = await chromeDevTools.stopProfiling();

// 5. Extract metrics
const metrics = {
  lcp: profile.largestContentfulPaint,
  fid: profile.firstInputDelay,
  cls: profile.cumulativeLayoutShift,
  totalExecutionTime: profile.javascriptExecutionTime
};

// 6. Validate against targets
expect(metrics.lcp).toBeLessThan(2500); // < 2.5s target
expect(metrics.cls).toBeLessThan(0.1);
```

---

## Testing Coverage by Tool

| Testing Need | Native Playwright | Chrome DevTools MCP | Playwright MCP |
|-------------|------------------|---------------------|----------------|
| **E2E Tests** | ✅ Primary | ❌ N/A | ⚠️ Debugging |
| **Visual Regression** | ✅ Primary | ❌ N/A | ⚠️ Screenshots |
| **Accessibility** | ✅ With axe-core | ❌ N/A | ❌ N/A |
| **Performance** | ⚠️ Lighthouse only | ✅ **Deep profiling** | ❌ N/A |
| **Network Analysis** | ⚠️ Basic | ✅ **Waterfall** | ⚠️ Basic |
| **Memory Profiling** | ❌ N/A | ✅ **Heap snapshots** | ❌ N/A |
| **CPU Profiling** | ❌ N/A | ✅ **Execution time** | ❌ N/A |
| **Code Coverage** | ⚠️ Vitest only | ✅ **Runtime coverage** | ❌ N/A |
| **Cross-Browser** | ✅ 7 browsers | ⚠️ Chromium only | ⚠️ Chromium only |

---

## Performance Testing Targets

### Current Performance Issues (from testing plan)
- **LCP**: 2.8-3.2s (Target: <2.5s) ⚠️ NEEDS OPTIMIZATION
- **FID**: Good (Target: <100ms) ✅
- **CLS**: 0.03-0.08 (Target: <0.1) ✅

### Chrome DevTools MCP Can Help With:

#### 1. LCP Optimization (Priority: P0)
**Problem**: Dashboard & IPO Detail pages load slowly

**Chrome DevTools Analysis:**
- Identify which resource is the LCP element
- Measure resource loading time
- Detect render-blocking resources
- Profile JavaScript execution during initial load

**Action Items:**
- Optimize LCP resource loading (preload, priority hints)
- Reduce JavaScript execution time
- Eliminate render-blocking resources
- Optimize image loading (WebP, lazy load)

#### 2. JavaScript Bundle Optimization
**Problem**: Unknown if dead code exists

**Chrome DevTools Analysis:**
- Run JavaScript coverage analysis
- Identify unused code in bundles
- Measure JavaScript execution time per file

**Action Items:**
- Remove dead code
- Implement code splitting
- Lazy load non-critical features

#### 3. Memory Leak Detection
**Problem**: Unknown if SPAs have memory leaks

**Chrome DevTools Analysis:**
- Take heap snapshots before/after navigation
- Identify detached DOM nodes
- Track memory growth over time

**Action Items:**
- Fix memory leaks in chart components
- Clean up event listeners
- Optimize React component lifecycle

---

## Example Testing Scripts

### Script 1: LCP Optimization Analysis

```javascript
// Analyze what's causing slow LCP on Dashboard
const results = await chromeDevTools.analyze({
  url: 'http://localhost:3000/dashboard',
  metrics: ['lcp', 'fcp', 'ttfb'],
  profiling: true
});

console.log('LCP Element:', results.lcp.element);
console.log('LCP Load Time:', results.lcp.loadTime);
console.log('Render-blocking resources:', results.renderBlocking);
```

### Script 2: Memory Leak Detection

```javascript
// Check for memory leaks during IPO navigation
await chromeDevTools.navigate('/dashboard');
const snapshot1 = await chromeDevTools.takeHeapSnapshot();

// Navigate multiple times
for (let i = 0; i < 10; i++) {
  await chromeDevTools.navigate('/ipos/example-ipo');
  await chromeDevTools.navigate('/dashboard');
}

const snapshot2 = await chromeDevTools.takeHeapSnapshot();

// Compare snapshots
const memoryGrowth = snapshot2.totalSize - snapshot1.totalSize;
console.log('Memory growth:', memoryGrowth / 1024 / 1024, 'MB');

if (memoryGrowth > 5_000_000) { // 5MB threshold
  console.error('Potential memory leak detected!');
}
```

### Script 3: JavaScript Bundle Analysis

```javascript
// Analyze JavaScript execution time
const coverage = await chromeDevTools.startCoverage();

await chromeDevTools.navigate('/ipos/example-ipo');
await chromeDevTools.waitForIdle();

const coverageReport = await chromeDevTools.stopCoverage();

// Find unused code
const unusedCode = coverageReport.filter(entry =>
  entry.usedPercentage < 50
);

console.log('Unused bundles:', unusedCode);
```

---

## Documentation & Workflows

### Performance Testing Workflow (Week 6)

**Day 1: Baseline Measurement**
1. Use Chrome DevTools MCP to profile all 49 pages
2. Record LCP, FID, CLS for each page
3. Identify top 10 slowest pages

**Day 2: Deep Analysis**
1. CPU profile slowest pages
2. Network waterfall analysis
3. JavaScript execution breakdown
4. Memory heap snapshots

**Day 3: Optimization**
1. Implement fixes based on Chrome DevTools data
2. Re-profile to validate improvements
3. Document optimization techniques

**Day 4: Regression Testing**
1. Add performance tests to CI/CD
2. Set performance budgets
3. Create alerts for regressions

### Integration with CI/CD

**Cannot Use Chrome DevTools MCP in CI/CD** (requires manual interaction)

**Instead:**
- Use Lighthouse CI for automated performance testing
- Use Chrome DevTools MCP for local development/debugging
- Document performance issues found via Chrome DevTools
- Create Lighthouse assertions based on Chrome DevTools findings

---

## Limitations of Chrome DevTools MCP

### Cannot Replace Native Tools For:
1. **Cross-browser testing** (Chromium only)
2. **Automated CI/CD** (requires interactive session)
3. **Component unit tests** (browser-based only)
4. **Accessibility testing** (no axe-core integration)

### Best Used For:
1. ✅ **Interactive performance debugging**
2. ✅ **Memory leak investigation**
3. ✅ **JavaScript profiling**
4. ✅ **Network waterfall analysis**
5. ✅ **Code coverage analysis**

---

## Success Metrics

### Performance Improvements (Week 6 Target)

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| **LCP** | 2.8-3.2s | <2.5s | ⏳ Pending |
| **FID** | Good | <100ms | ✅ Met |
| **CLS** | 0.03-0.08 | <0.1 | ✅ Met |
| **JavaScript Execution** | Unknown | <1s | ⏳ Pending |
| **Memory Leaks** | Unknown | 0 detected | ⏳ Pending |
| **Bundle Size** | Unknown | <200KB gzipped | ⏳ Pending |

### Chrome DevTools MCP Contribution

**Expected Impact:**
- LCP optimization: 0.5-1.0s improvement (2.8s → 1.8-2.3s)
- Memory leak detection: Identify and fix 3-5 leaks
- Dead code removal: 10-20% bundle size reduction
- JavaScript optimization: 20-30% execution time reduction

---

## Next Actions

### Immediate (After VS Code Restart)

1. ✅ **Verify Chrome DevTools MCP is active**
   - Check for chrome-devtools functions in Claude Code
   - Test simple navigation command
   - Confirm profiling capabilities

2. ⏳ **Test basic functionality**
   - Navigate to localhost:3000
   - Take performance profile
   - Capture network waterfall
   - Take heap snapshot

3. ⏳ **Document available functions**
   - List all chrome-devtools MCP functions
   - Create usage examples
   - Add to testing handbook

### Week 6: Performance Testing Phase

1. **Profile all 49 pages** using Chrome DevTools MCP
2. **Identify performance bottlenecks**
3. **Optimize LCP to <2.5s**
4. **Detect and fix memory leaks**
5. **Reduce JavaScript bundle size**
6. **Document optimization techniques**

---

## References

- [Comprehensive UI Testing Plan](./COMPREHENSIVE_UI_TESTING_PLAN.md)
- [Phase 6: Performance Testing](./COMPREHENSIVE_UI_TESTING_PLAN.md#phase-6-performance--load-testing-week-6)
- Chrome DevTools MCP Documentation: (to be added after activation)

---

**Last Updated**: 2025-11-12
**Status**: Installed - Awaiting Activation (Restart VS Code)
**Next Step**: Restart VS Code and verify Chrome DevTools MCP functions
