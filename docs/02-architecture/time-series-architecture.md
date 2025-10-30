# Time-Series Data Architecture

**Focus:** Price-wise Demand Graph & Subscription Tracking
**Created:** October 30, 2025
**Status:** Production-Ready

---

## 🎯 Overview

IPODhan captures and stores time-series data for real-time IPO metrics, particularly price-wise demand visualization and subscription tracking. This architecture handles high-frequency updates during IPO bidding periods with efficient storage and retrieval patterns.

---

## 📊 Time-Series Data Types

### 1. Price-wise Demand Graph (`ipo_demand_graph` table)

**Purpose:** Track cumulative demand at each price point over time

**Data Characteristics:**
- **Volume:** 48-96 data points per IPO per update
- **Update Frequency:** Every 30 minutes during OPEN status
- **Retention:** 90 days (recommended)
- **Growth Rate:** ~100 rows per IPO per day

**Schema Design:**
```sql
CREATE TABLE ipo_demand_graph (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  price_point NUMERIC(10,2),  -- NULL for cut-off
  is_cut_off BOOLEAN DEFAULT FALSE,
  cumulative_quantity BIGINT NOT NULL,
  exchange exchange_enum NOT NULL,  -- NSE/BSE/BOTH
  created_at TIMESTAMP DEFAULT NOW()
);

-- Composite index for efficient queries
CREATE INDEX idx_demand_graph_lookup
ON ipo_demand_graph(ipo_id, timestamp DESC, exchange);

-- Partitioning strategy (future)
-- PARTITION BY RANGE (timestamp) for monthly partitions
```

### 2. Subscription Time-Series (`subscriptions` table)

**Purpose:** Track subscription evolution during bidding period

**Data Characteristics:**
- **Volume:** 10-20 snapshots per IPO
- **Update Frequency:** Every 10 minutes during OPEN status
- **Retention:** Permanent (historical reference)
- **Sub-categories:** 15+ fields for granular tracking

---

## 🏗️ Architecture Patterns

### Data Ingestion Pipeline

```
NSE API → Scraper → Transform → Batch Insert → Cache Invalidation
   ↓         ↓          ↓            ↓              ↓
 JSON    Extract    Normalize    PostgreSQL    Redis Keys
         Fields     & Validate   (100+ rows)    Cleared
```

### Batch Insert Pattern

**Implementation:** `IPORepository.saveDemandGraph()`

```typescript
async saveDemandGraph(ipoId: string, demandData: DemandGraphEntry[]): Promise<void> {
  // Transform data for batch insert
  const records = demandData.map(entry => ({
    ipoId,
    timestamp: new Date(),
    pricePoint: entry.price,
    isCutOff: entry.isCutOff,
    cumulativeQuantity: entry.quantity,
    exchange: entry.exchange
  }));

  // Single batch insert for efficiency
  await this.db.insert(ipoDemandGraph)
    .values(records)
    .execute();

  // Invalidate related caches
  await this.invalidateCache([
    getDemandGraphKey(ipoId),
    getDemandSnapshotKey(ipoId)
  ]);
}
```

**Performance Optimization:**
- Use single INSERT with multiple VALUES
- Prepare data in memory before insert
- Non-blocking cache invalidation
- Connection pooling for concurrent writes

### Query Patterns

#### Latest Snapshot Query
```typescript
async getLatestDemandSnapshot(ipoId: string): Promise<DemandSnapshot> {
  const result = await this.db
    .select({
      timestamp: max(ipoDemandGraph.timestamp),
      totalCutOffBids: sum(
        sql`CASE WHEN is_cut_off THEN cumulative_quantity ELSE 0 END`
      ),
      pricePoints: countDistinct(ipoDemandGraph.pricePoint)
    })
    .from(ipoDemandGraph)
    .where(eq(ipoDemandGraph.ipoId, ipoId))
    .groupBy(ipoDemandGraph.ipoId);

  return result[0];
}
```

#### Time-Range Query with Aggregation
```typescript
async getDemandTrend(ipoId: string, hours: number = 24): Promise<DemandTrend[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  return this.db
    .select({
      hour: sql`DATE_TRUNC('hour', timestamp)`,
      avgDemand: avg(ipoDemandGraph.cumulativeQuantity),
      maxDemand: max(ipoDemandGraph.cumulativeQuantity),
      dataPoints: count()
    })
    .from(ipoDemandGraph)
    .where(and(
      eq(ipoDemandGraph.ipoId, ipoId),
      gte(ipoDemandGraph.timestamp, since)
    ))
    .groupBy(sql`DATE_TRUNC('hour', timestamp)`)
    .orderBy(sql`DATE_TRUNC('hour', timestamp)`);
}
```

---

## 🚀 Performance Optimization

### 1. Database Optimization

**Indexing Strategy:**
```sql
-- Primary lookup index
CREATE INDEX idx_demand_graph_lookup
ON ipo_demand_graph(ipo_id, timestamp DESC, exchange);

-- Price analysis index
CREATE INDEX idx_demand_price_analysis
ON ipo_demand_graph(ipo_id, price_point, timestamp DESC)
WHERE is_cut_off = false;

-- Exchange-specific queries
CREATE INDEX idx_demand_exchange
ON ipo_demand_graph(exchange, timestamp DESC);
```

**Partitioning (Future):**
```sql
-- Monthly partitions for scalability
CREATE TABLE ipo_demand_graph_2025_10
PARTITION OF ipo_demand_graph
FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
```

### 2. Caching Strategy

**Multi-layer Cache:**
```typescript
// L1: Latest snapshot (5 min TTL)
const snapshot = await redis.get(`demand:snapshot:${ipoId}`);

// L2: Full demand graph (5 min TTL)
const fullData = await redis.get(`demand:graph:${ipoId}:${exchange}`);

// L3: Aggregated stats (15 min TTL)
const stats = await redis.get(`demand:stats:${ipoId}`);
```

### 3. Data Retention Policy

**Automated Archival:**
```sql
-- Archive old data (run daily)
INSERT INTO ipo_demand_graph_archive
SELECT * FROM ipo_demand_graph
WHERE timestamp < NOW() - INTERVAL '90 days';

-- Delete from main table
DELETE FROM ipo_demand_graph
WHERE timestamp < NOW() - INTERVAL '90 days';

-- Vacuum to reclaim space
VACUUM ANALYZE ipo_demand_graph;
```

---

## 📈 Monitoring & Metrics

### Key Performance Indicators

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Batch insert time (100 rows) | < 500ms | > 1000ms |
| Query response (latest snapshot) | < 50ms | > 200ms |
| Query response (full graph) | < 100ms | > 300ms |
| Cache hit rate | > 85% | < 70% |
| Table size growth | < 1GB/month | > 2GB/month |

### Monitoring Queries

```sql
-- Data freshness check
SELECT
  ipo_id,
  MAX(timestamp) as last_update,
  NOW() - MAX(timestamp) as data_age,
  COUNT(*) as data_points
FROM ipo_demand_graph
WHERE ipo_id IN (
  SELECT id FROM ipos WHERE status = 'OPEN'
)
GROUP BY ipo_id
HAVING NOW() - MAX(timestamp) > INTERVAL '1 hour';

-- Storage analysis
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE '%demand_graph%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 🔄 Data Flow Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  NSE API     │────▶│   Scraper    │────▶│  Transform   │
│ (Raw JSON)   │     │  (Extract)   │     │  (Normalize) │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Redis     │◀────│   Repository │◀────│ Batch Insert │
│   (Cache)    │     │  (Invalidate)│     │ (PostgreSQL) │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   API Route  │────▶│   Frontend   │────▶│    Chart     │
│   (JSON)     │     │  (Component) │     │  (Recharts)  │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## 🎯 Best Practices

### Do's ✅
- Batch inserts for multiple data points
- Use composite indexes for common query patterns
- Implement data retention policies early
- Monitor table growth and query performance
- Cache aggregated results, not raw data
- Use time-based partitioning for large datasets

### Don'ts ❌
- Don't insert row-by-row in loops
- Don't store redundant calculated fields
- Don't query without time range filters
- Don't cache volatile data for > 5 minutes
- Don't forget to VACUUM after bulk deletes

---

## 🔮 Future Enhancements

### Phase 1: Optimization (3 months)
- Implement table partitioning
- Add TimescaleDB for advanced time-series features
- Create materialized views for common aggregations

### Phase 2: Real-time (6 months)
- WebSocket connection for live updates
- Server-sent events for demand changes
- Real-time chart updates without page refresh

### Phase 3: Analytics (12 months)
- Predictive demand modeling
- Pattern recognition for subscription trends
- Investor behavior analytics

---

## 📚 Related Documentation

- [Backend Architecture](backend-architecture.md) - Repository patterns
- [Caching Strategy](../05-caching/CACHING_STRATEGY.md) - Cache implementation
- [API Specification](api-specification.md) - Demand graph endpoint
- [Database Schema](../../packages/shared/src/db/schema.ts) - Table definitions

---

**Architecture Owner:** System Architect (Winston)
**Review Date:** October 30, 2025
**Next Review:** January 30, 2026