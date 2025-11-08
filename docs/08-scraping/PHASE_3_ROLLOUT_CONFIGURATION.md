# Phase 3: Data Consolidation Live Rollout Configuration

**Document Version**: 1.0
**Last Updated**: 2025-11-08
**Status**: IN PROGRESS - 10% Rollout

---

## Rollout Strategy

Progressive deployment of data consolidation from shadow mode to full production:
- **Phase 3.1**: 10% rollout (current)
- **Phase 3.2**: 50% rollout
- **Phase 3.3**: 100% rollout

---

## Current Configuration (10% Rollout)

### Feature Flags (.env)
```bash
# Core Features
ENABLE_DATA_CONSOLIDATION=true      # Master switch for consolidation service
ENABLE_SOURCE_TRACKING=true         # Track which scraper provided each field
ENABLE_CONFLICT_DETECTION=true      # Log conflicts between sources

# Rollout Control
SHADOW_MODE=false                   # ✅ PRODUCTION MODE - Writes to database
CONSOLIDATION_PERCENTAGE=10         # 10% of IPOs use smart consolidation
SOURCE_TRACKING_PERCENTAGE=10       # 10% get field source tracking
CONFLICT_DETECTION_PERCENTAGE=10    # 10% get conflict detection

# Debugging
DEBUG_DATA_FLOW=true                # Verbose logging for analysis
```

### What This Means

**Percentage-Based Rollout (10%):**
- Uses consistent hashing on IPO ID
- Same IPO always gets same treatment (no flapping)
- ~10% of IPOs will use new consolidation pipeline
- ~90% will use legacy "NSE wins all" merge

**Production Mode:**
- `SHADOW_MODE=false` means actual database writes
- Consolidation decisions are applied to database
- Field sources are tracked in `field_sources` JSONB column
- Conflicts are logged to `data_conflicts` table

**Feature Integration:**
When consolidation runs for an IPO, it:
1. Applies field priority matrix (NSE for core, DRHP for financials, Chittorgarh for GMP)
2. Normalizes values (currency, dates, company names)
3. Tracks source for each field in `field_sources`
4. Logs conflicts when sources disagree
5. Respects admin field protection

---

## Monitoring & Validation

### Success Criteria for 10% Rollout

**Performance Metrics:**
- [ ] Consolidation p95 latency < 500ms
- [ ] Zero timeout errors
- [ ] No database connection pool exhaustion

**Data Quality:**
- [ ] Conflict rate < 2%
- [ ] Zero CRITICAL conflicts
- [ ] Field source coverage > 95%

**System Stability:**
- [ ] Zero race conditions (duplicate IPOs)
- [ ] No data corruption
- [ ] Cache invalidation working

### What to Monitor

1. **Scraper Logs** - Check for:
   - Consolidation execution time
   - Conflict detection results
   - Field update counts

2. **Database** - Verify:
   - `field_sources` being populated
   - `data_conflicts` table entries
   - No duplicate IPOs created

3. **Performance** - Track:
   - p95 consolidation latency
   - Database query times
   - Redis lock timeouts

---

## Rollout Checklist

### Phase 3.1: 10% Rollout (CURRENT)

- [x] Update .env configuration
- [x] Document rollout configuration
- [ ] Run NSE scraper
- [ ] Run BSE scraper
- [ ] Analyze results with quick-consolidation-analysis.ts
- [ ] Verify field sources in database
- [ ] Verify conflict detection working
- [ ] Check performance metrics
- [ ] Decision: GO/NO-GO for 50% rollout

### Phase 3.2: 50% Rollout

- [ ] Update CONSOLIDATION_PERCENTAGE=50
- [ ] Update SOURCE_TRACKING_PERCENTAGE=50
- [ ] Update CONFLICT_DETECTION_PERCENTAGE=50
- [ ] Run all scrapers
- [ ] Monitor for 12-24 hours
- [ ] Analyze comprehensive results
- [ ] Decision: GO/NO-GO for 100% rollout

### Phase 3.3: 100% Rollout

- [ ] Update CONSOLIDATION_PERCENTAGE=100
- [ ] Update SOURCE_TRACKING_PERCENTAGE=100
- [ ] Update CONFLICT_DETECTION_PERCENTAGE=100
- [ ] Run all scrapers (NSE, BSE, Moneycontrol, Chittorgarh)
- [ ] Monitor comprehensive metrics
- [ ] Validate all success criteria
- [ ] Run for validation period (3+ successful cycles)
- [ ] Approval for Phase 4 (legacy removal)

---

## Rollback Procedure

If critical issues are detected:

```bash
# Immediate rollback to shadow mode
SHADOW_MODE=true
CONSOLIDATION_PERCENTAGE=0

# Restart scrapers
pm2 restart scraper
```

### Rollback Triggers

**CRITICAL (Immediate Rollback):**
- Data corruption detected
- Duplicate IPOs created
- Database connection failures
- p95 latency > 2000ms

**WARNING (Investigate, possible rollback):**
- Conflict rate > 5%
- CRITICAL conflicts detected
- Performance degradation (p95 > 1000ms)
- Field source coverage < 80%

---

## Analysis Scripts

### Quick Analysis
```bash
cd scraper
npx tsx scripts/quick-consolidation-analysis.ts
```

### Database Queries

**Check field sources:**
```sql
-- Count IPOs with field sources
SELECT COUNT(*) FROM ipos WHERE field_sources IS NOT NULL AND field_sources != '{}'::jsonb;

-- Sample field sources
SELECT id, company_name, field_sources FROM ipos WHERE field_sources IS NOT NULL LIMIT 10;
```

**Check conflicts:**
```sql
-- Conflict summary
SELECT conflict_reason, COUNT(*) FROM data_conflicts GROUP BY conflict_reason;

-- CRITICAL conflicts
SELECT * FROM data_conflicts WHERE conflict_reason = 'CRITICAL' AND resolved_at IS NULL;
```

**Performance check:**
```sql
-- Find slow consolidations (from logs)
SELECT * FROM scraper_logs
WHERE message LIKE '%consolidation%'
AND duration_ms > 500
ORDER BY created_at DESC LIMIT 20;
```

---

## Next Steps

1. **Run Scrapers** (Phase 3.2)
   - Execute NSE scraper
   - Execute BSE scraper
   - Monitor real-time logs

2. **Analyze Results** (Phase 3.3)
   - Run analysis script
   - Check database for field sources
   - Verify conflict detection

3. **Make GO/NO-GO Decision**
   - If all green: Proceed to 50%
   - If issues: Fix and re-test at 10%

---

## Historical Context

**Phase 1 (COMPLETE):**
- Core infrastructure built
- 98/98 unit tests passing
- Field priority matrix configured (45+ fields)
- Normalization engine validated

**Phase 2 (COMPLETE):**
- Shadow mode validation
- 31 IPOs processed (9 NSE, 22 BSE)
- 0 conflicts detected
- 12-39ms performance (excellent)
- Bug fixed: ipoId='new' UUID error

**Phase 3 (IN PROGRESS):**
- Live rollout beginning
- 10% of IPOs using consolidation
- Production database writes enabled
