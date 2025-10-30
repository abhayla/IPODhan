# Real-time Components Architecture

**Focus:** Client-side Real-time Updates & Interactive Visualizations
**Created:** October 30, 2025
**Components:** UPIDeadlineTimer, DemandGraphChart, Subscription Trackers

---

## 🎯 Architecture Principles

1. **Progressive Enhancement** - Static content first, real-time as enhancement
2. **Resource Efficiency** - Minimize CPU/memory usage on client
3. **Graceful Degradation** - Components work without JavaScript
4. **State Synchronization** - Server as single source of truth
5. **Performance First** - Sub-second response times

---

## ⏰ UPI Deadline Timer Component

### Architecture Pattern

```typescript
// Component: web/components/ipo-detail/UPIDeadlineTimer.tsx
export function UPIDeadlineTimer({
  closeDate,          // IPO closing date (ISO string)
  upiCutoffTime,      // "5:00 PM" format
  status              // OPEN/CLOSED/UPCOMING
}) {
  // State management
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [urgencyLevel, setUrgencyLevel] = useState<UrgencyLevel>('normal');

  // Effect with cleanup
  useEffect(() => {
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);  // Critical: cleanup
  }, [closeDate, upiCutoffTime]);
}
```

### Performance Optimization

**Single Timer Context (for multiple timers):**
```typescript
// Context provider for shared timer
const TimerContext = createContext<TimerContextType>();

export function TimerProvider({ children }) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <TimerContext.Provider value={{ currentTime }}>
      {children}
    </TimerContext.Provider>
  );
}

// Individual timer consumes context
function UPITimer({ deadline }) {
  const { currentTime } = useContext(TimerContext);
  const timeLeft = deadline - currentTime;
  // ... render logic
}
```

### Urgency Level State Machine

```
NORMAL (>24h) → WARNING (24h-2h) → CRITICAL (<2h) → EXPIRED (0)
     │               │                  │              │
     Green          Yellow             Red           Gray
     Calm           Alert            Urgent         Closed
```

### Memory Management

```typescript
// Prevent memory leaks
useEffect(() => {
  let mounted = true;
  const timer = setInterval(() => {
    if (mounted) {
      calculateTimeLeft();
    }
  }, 1000);

  return () => {
    mounted = false;
    clearInterval(timer);
  };
}, [dependencies]);
```

---

## 📊 Demand Graph Chart Component

### Architecture Pattern

```typescript
// Component: web/components/ipo-detail/DemandGraphChart.tsx
export function DemandGraphChart({
  ipoSlug,
  priceRangeMin,
  priceRangeMax
}) {
  // State management
  const [data, setData] = useState<DemandGraphData | null>(null);
  const [selectedExchange, setSelectedExchange] = useState<Exchange>('ALL');
  const [loading, setLoading] = useState(true);

  // Data fetching with exchange filter
  useEffect(() => {
    fetchDemandData(ipoSlug, selectedExchange);
  }, [ipoSlug, selectedExchange]);
}
```

### Data Flow Architecture

```
User Interaction → Exchange Selection → API Call → Data Transform → Chart Update
        ↓                   ↓               ↓            ↓              ↓
    Click/Touch      State Update      Fetch API    Process Data    Recharts
                                      (Debounced)   (Memoized)      Render
```

### Performance Optimizations

#### 1. Debounced Exchange Switching
```typescript
const debouncedExchangeChange = useMemo(
  () => debounce((exchange: Exchange) => {
    setSelectedExchange(exchange);
  }, 200),
  []
);
```

#### 2. Memoized Data Processing
```typescript
const chartData = useMemo(() => {
  if (!data) return [];

  return data.demandGraph
    .filter(d => selectedExchange === 'ALL' || d.exchange === selectedExchange)
    .sort((a, b) => (a.price || 0) - (b.price || 0))
    .map(d => ({
      name: d.pricePoint,
      price: d.price,
      demand: d.quantity / 1000000, // Convert to millions
      isCutOff: d.isCutOff
    }));
}, [data, selectedExchange]);
```

#### 3. Virtual Scrolling (for large datasets)
```typescript
import { FixedSizeList } from 'react-window';

function VirtualizedDemandList({ data }) {
  return (
    <FixedSizeList
      height={400}
      itemCount={data.length}
      itemSize={50}
      width="100%"
    >
      {({ index, style }) => (
        <div style={style}>
          {data[index].pricePoint}: {data[index].quantity}
        </div>
      )}
    </FixedSizeList>
  );
}
```

### Chart Rendering Strategy

```typescript
// Lazy load chart library
const AreaChart = lazy(() =>
  import('recharts').then(module => ({ default: module.AreaChart }))
);

// Progressive loading with skeleton
<Suspense fallback={<ChartSkeleton />}>
  <AreaChart data={chartData}>
    {/* Chart configuration */}
  </AreaChart>
</Suspense>
```

---

## 🔄 State Management Patterns

### Local State vs Global State

```typescript
// Local State (component-specific)
- Timer countdown values
- UI interaction states (hover, selected)
- Form inputs
- Loading states

// Global State (shared across components)
- User preferences (exchange preference)
- Cached API responses
- WebSocket connections (future)
- Authentication state (future)
```

### State Synchronization Pattern

```typescript
// SWR for server state synchronization
import useSWR from 'swr';

function useDemandGraph(ipoSlug: string, exchange?: Exchange) {
  const { data, error, mutate } = useSWR(
    `/api/ipos/${ipoSlug}/demand-graph?exchange=${exchange}`,
    fetcher,
    {
      refreshInterval: 30000,  // Auto-refresh every 30s
      revalidateOnFocus: true,
      dedupingInterval: 5000
    }
  );

  return {
    data,
    isLoading: !error && !data,
    isError: error,
    refresh: mutate
  };
}
```

---

## 🚀 Performance Patterns

### 1. Code Splitting & Lazy Loading

```typescript
// Route-based splitting
const IPODetailPage = lazy(() => import('./pages/ipo-detail'));

// Component-based splitting
const DemandGraphChart = lazy(() =>
  import('./components/DemandGraphChart')
);

// Library splitting
const Recharts = lazy(() => import('recharts'));
```

### 2. Render Optimization

```typescript
// Memoize expensive components
const MemoizedChart = memo(DemandGraphChart, (prev, next) => {
  return prev.data === next.data && prev.exchange === next.exchange;
});

// Use callback for event handlers
const handleExchangeChange = useCallback((exchange: Exchange) => {
  setSelectedExchange(exchange);
}, []);
```

### 3. Bundle Size Optimization

```typescript
// Tree-shake chart library imports
import { AreaChart, XAxis, YAxis } from 'recharts';
// Instead of: import * as Recharts from 'recharts';

// Dynamic imports for heavy components
if (showChart) {
  const { DemandGraphChart } = await import('./DemandGraphChart');
}
```

---

## 📱 Responsive Design Patterns

### Mobile-First Architecture

```typescript
// Responsive timer display
function ResponsiveTimer({ timeLeft }) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  if (isMobile) {
    return <CompactTimer timeLeft={timeLeft} />;
  }

  return <FullTimer timeLeft={timeLeft} />;
}

// Touch-optimized chart
<AreaChart
  onTouchStart={handleTouchStart}
  onTouchMove={handleTouchMove}
  margin={{ top: 5, right: 5, left: 5, bottom: 5 }}  // Mobile margins
/>
```

### Adaptive Loading

```typescript
// Load different chart resolutions based on device
const useChartData = (ipoSlug: string) => {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const dataPoints = isMobile ? 20 : 100;  // Fewer points on mobile

  return useSWR(
    `/api/demand-graph?slug=${ipoSlug}&points=${dataPoints}`
  );
};
```

---

## 🔌 WebSocket Architecture (Future)

### Real-time Updates Pattern

```typescript
// WebSocket connection manager
class WSManager {
  private ws: WebSocket | null = null;
  private subscribers = new Map<string, Set<Function>>();

  connect() {
    this.ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL);

    this.ws.onmessage = (event) => {
      const { channel, data } = JSON.parse(event.data);
      this.notify(channel, data);
    };

    this.ws.onerror = () => {
      this.reconnect();
    };
  }

  subscribe(channel: string, callback: Function) {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(callback);

    // Subscribe on server
    this.ws?.send(JSON.stringify({ action: 'subscribe', channel }));
  }

  private notify(channel: string, data: any) {
    this.subscribers.get(channel)?.forEach(cb => cb(data));
  }
}

// Usage in component
useEffect(() => {
  const ws = WSManager.getInstance();

  ws.subscribe(`ipo.${ipoSlug}.demand`, (data) => {
    setDemandData(data);
  });

  return () => ws.unsubscribe(`ipo.${ipoSlug}.demand`);
}, [ipoSlug]);
```

---

## 📊 Monitoring & Analytics

### Performance Metrics

```typescript
// Track component render performance
const measurePerformance = (componentName: string) => {
  const startTime = performance.now();

  return () => {
    const endTime = performance.now();
    const renderTime = endTime - startTime;

    // Send to analytics
    analytics.track('component_render', {
      component: componentName,
      duration: renderTime,
      timestamp: new Date().toISOString()
    });
  };
};

// Usage
useEffect(() => {
  const measure = measurePerformance('DemandGraphChart');
  return measure;
}, []);
```

### Error Boundaries

```typescript
class ChartErrorBoundary extends ErrorBoundary {
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to monitoring service
    Sentry.captureException(error, {
      contexts: {
        react: errorInfo,
        component: 'DemandGraphChart'
      }
    });
  }

  render() {
    if (this.state.hasError) {
      return <ChartFallback />;
    }
    return this.props.children;
  }
}
```

---

## 🎯 Best Practices Checklist

### Component Development
- [ ] Implement proper cleanup in useEffect
- [ ] Use React.memo for expensive components
- [ ] Implement error boundaries
- [ ] Add loading states
- [ ] Handle edge cases (null data, network errors)
- [ ] Use proper TypeScript types
- [ ] Implement accessibility (ARIA labels)

### Performance
- [ ] Lazy load heavy components
- [ ] Debounce user interactions
- [ ] Memoize expensive calculations
- [ ] Use virtual scrolling for long lists
- [ ] Optimize bundle size
- [ ] Monitor render performance

### Testing
- [ ] Unit tests for logic
- [ ] Integration tests for data flow
- [ ] Performance tests for render time
- [ ] Accessibility tests
- [ ] Mobile responsiveness tests

---

## 📚 Related Documentation

- [Frontend Architecture](front-end-architecture.md) - Component patterns
- [Performance Targets](security-and-performance.md) - Metrics & goals
- [Testing Strategy](testing-strategy.md) - Testing patterns
- [Time-series Architecture](time-series-architecture.md) - Data patterns

---

**Architecture Owner:** System Architect (Winston)
**Review Date:** October 30, 2025
**Next Review:** January 30, 2026