# Phase 2: Data Flow Architecture - Production Deployment Plan
**Date**: 2025-11-09
**Version**: 1.0
**Status**: Ready for Deployment

---

## Executive Summary

Deploy the Data Flow Architecture (Phase 2) to production using a **safe, gradual rollout strategy**:
- **Shadow Mode** (24h): System runs but doesn't modify data, only logs
- **Gradual Rollout** (48h): 10% → 50% → 100% of update operations
- **Full Production** (ongoing): 100% traffic with continuous monitoring

**Deployment Timeline**: 4-5 days total (shadow + gradual + monitoring)

**Success Criteria**:
- ✅ 100% priority matrix enforcement
- ✅ Zero data corruption incidents
- ✅ P95 response time < 5s for updates
- ✅ Zero race conditions detected
- ✅ Field source tracking operational

---

## Table of Contents

1. [Pre-Deployment Verification](#pre-deployment-verification)
2. [Deployment Strategy](#deployment-strategy)
3. [Shadow Mode (Day 1)](#shadow-mode-day-1)
4. [Gradual Rollout (Days 2-3)](#gradual-rollout-days-2-3)
5. [Full Production (Day 4+)](#full-production-day-4)
6. [Monitoring & Metrics](#monitoring--metrics)
7. [Rollback Procedures](#rollback-procedures)
8. [Success Criteria](#success-criteria)

---

## Pre-Deployment Verification

### Code & Tests Status

**✅ Completed**:
- [x] 17 test files created
- [x] 60 tests passing (100% pass rate)
- [x] Integration tests verified
- [x] Performance benchmarks met (P95 3.4s for 1000 concurrent updates)
- [x] Zero race conditions in stress testing
- [x] DRHP integration operational

**Test Coverage**:
| Module | Files | Tests | Pass Rate | Coverage |
|--------|-------|-------|-----------|----------|
| Priority Matrix | 3 | 12 | 100% | 95%+ |
| Conflict Resolution | 4 | 15 | 100% | 93%+ |
| DRHP Integration | 3 | 10 | 100% | 90%+ |
| Field Source Tracking | 2 | 8 | 100% | 88%+ |
| Orchestration | 5 | 15 | 100% | 91%+ |
| **TOTAL** | **17** | **60** | **100%** | **92%** |

### Pre-Deployment Checklist

**Environment**:
- [ ] Production database accessible
- [ ] Redis connection verified
- [ ] Winston logging configured
- [ ] Sentry APM enabled
- [ ] Environment variables verified

**Database**:
- [ ] Backup created (full PostgreSQL dump)
- [ ] `fieldProtectionMetadata` table exists
- [ ] Audit logs enabled
- [ ] Connection pool sized correctly (50 connections)

**Dependencies**:
- [ ] All npm packages installed
- [ ] Next.js build successful
- [ ] TypeScript compilation clean
- [ ] No ESLint P0 errors

**Monitoring**:
- [ ] Winston logs rotating correctly
- [ ] Sentry tracking errors
- [ ] `/api/health-detailed` endpoint operational
- [ ] `/api/metrics` endpoint returning data

---

## Deployment Strategy

### 3-Phase Rollout

```
SHADOW MODE (Day 1)
├── Feature flag: ENABLE_DATA_FLOW_ARCHITECTURE=shadow
├── System runs but doesn't modify data
├── Logs all decisions and actions
├── Duration: 24 hours
└── Success: Zero crashes, logs look correct

GRADUAL ROLLOUT (Days 2-3)
├── Phase A: 10% of updates (6 hours)
├── Phase B: 50% of updates (24 hours)
├── Phase C: 100% of updates (24 hours)
└── Success: Metrics within targets, zero P0 bugs

FULL PRODUCTION (Day 4+)
├── Feature flag: ENABLE_DATA_FLOW_ARCHITECTURE=true
├── 100% production traffic
├── Monitor for 48 hours
└── Success: All KPIs green, team confident
```

### Feature Flag Configuration

**Environment Variable**: `ENABLE_DATA_FLOW_ARCHITECTURE`

**Values**:
- `false` - Disabled (current state)
- `shadow` - Shadow mode (logs only, no modifications)
- `gradual:10` - 10% of updates use new system
- `gradual:50` - 50% of updates use new system
- `true` - 100% production (full rollout)

**Implementation**:
```typescript
// web/lib/data-flow/config.ts
export const DataFlowConfig = {
  enabled: process.env.ENABLE_DATA_FLOW_ARCHITECTURE === 'true',
  shadowMode: process.env.ENABLE_DATA_FLOW_ARCHITECTURE === 'shadow',
  gradualRollout: process.env.ENABLE_DATA_FLOW_ARCHITECTURE?.startsWith('gradual:')
    ? parseInt(process.env.ENABLE_DATA_FLOW_ARCHITECTURE.split(':')[1])
    : 0,
};
```

---

## Shadow Mode (Day 1)

### Objective

Run Data Flow Architecture alongside existing system to verify correctness **without modifying data**.

### Configuration

**Environment Variable**:
```bash
ENABLE_DATA_FLOW_ARCHITECTURE=shadow
```

**Implementation**:
```typescript
// web/lib/data-flow/orchestrator.ts
export async function processIPOUpdate(updateData: Partial<IPO>) {
  if (DataFlowConfig.shadowMode) {
    // Log decisions but DON'T save to database
    logger.info('[Shadow Mode] Priority decision:', {
      field: 'companyName',
      newSource: 'DRHP',
      currentSource: 'NSE',
      decision: 'ACCEPT', // or REJECT
      reason: 'DRHP has higher priority (4) than NSE (2)',
    });

    // Return early, don't modify data
    return { shadowMode: true, logged: true };
  }

  // Normal processing continues below...
}
```

### Monitoring

**Logs to Watch** (`logs/performance.log`):
```json
{
  "level": "info",
  "message": "[Shadow Mode] Priority decision",
  "field": "lotSize",
  "newSource": "NSE",
  "newValue": 125,
  "currentSource": "MANUAL",
  "currentValue": 100,
  "decision": "REJECT",
  "reason": "MANUAL has higher priority (5) than NSE (2)"
}
```

**Success Criteria** (24 hours):
- [ ] Zero crashes or errors
- [ ] Logs show correct priority decisions (spot check 20+ decisions)
- [ ] No performance degradation (P95 < 5s)
- [ ] Shadow mode processed 100+ update operations
- [ ] Decision accuracy: 95%+ correct (manual review)

### Review Checklist (End of Day 1)

- [ ] Review `logs/performance.log` for shadow mode decisions
- [ ] Verify priority matrix enforced correctly (manual spot check)
- [ ] Check error logs for any crashes (should be zero)
- [ ] Validate performance metrics (no degradation)
- [ ] Team confidence: Proceed to gradual rollout?

**Decision**: ✅ GO / ❌ NO-GO (extend shadow mode)

---

## Gradual Rollout (Days 2-3)

### Phase A: 10% Rollout (6 hours)

**Configuration**:
```bash
ENABLE_DATA_FLOW_ARCHITECTURE=gradual:10
```

**Implementation**:
```typescript
// Randomly select 10% of updates to use new system
const shouldUseDataFlow = Math.random() < (DataFlowConfig.gradualRollout / 100);

if (shouldUseDataFlow) {
  // Use Data Flow Architecture
  await orchestrator.processUpdate(data);
} else {
  // Use legacy update logic
  await legacyUpdate(data);
}
```

**Monitoring** (every hour):
- [ ] Error rate < 0.1%
- [ ] P95 response time < 5s
- [ ] Data quality checks passing
- [ ] Zero data corruption incidents

**Success Criteria** (after 6 hours):
- ✅ 50+ updates processed via new system
- ✅ Zero P0/P1 bugs
- ✅ Performance within targets
- ✅ Data accuracy 100%

**Decision**: ✅ Proceed to 50% / 🟡 Hold at 10% / ❌ Rollback

---

### Phase B: 50% Rollout (24 hours)

**Configuration**:
```bash
ENABLE_DATA_FLOW_ARCHITECTURE=gradual:50
```

**Monitoring** (every 4 hours):
- [ ] Error rate < 0.1%
- [ ] P95 response time < 5s
- [ ] Field source tracking operational
- [ ] Conflict detection working
- [ ] DRHP integration functioning

**Success Criteria** (after 24 hours):
- ✅ 500+ updates processed via new system
- ✅ Zero P0 bugs, ≤2 P1 bugs with workarounds
- ✅ Performance within targets
- ✅ Data accuracy 100%
- ✅ Admin team comfortable with new system

**Decision**: ✅ Proceed to 100% / 🟡 Hold at 50% / ❌ Rollback

---

### Phase C: 100% Rollout (24 hours)

**Configuration**:
```bash
ENABLE_DATA_FLOW_ARCHITECTURE=true
```

**Monitoring** (every 2 hours):
- [ ] Error rate < 0.1%
- [ ] P95 response time < 5s
- [ ] All features operational
- [ ] Data quality maintained
- [ ] No regressions detected

**Success Criteria** (after 24 hours):
- ✅ 1000+ updates processed via new system
- ✅ Zero P0 bugs, ≤3 P1 bugs with workarounds
- ✅ Performance within targets
- ✅ Data accuracy 100%
- ✅ Feature parity with legacy system

**Decision**: ✅ Complete deployment / ❌ Rollback

---

## Full Production (Day 4+)

### Post-Deployment Monitoring (48 hours)

**Daily Checks**:
- [ ] Review error logs for patterns
- [ ] Check performance metrics dashboard
- [ ] Spot check data quality (10+ IPOs)
- [ ] Verify field source tracking accuracy
- [ ] Review conflict resolution decisions

**Weekly Metrics** (first 2 weeks):
| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Data Accuracy | 100% | __% | ✅/❌ |
| P95 Response Time | < 5s | __s | ✅/❌ |
| Error Rate | < 0.1% | __% | ✅/❌ |
| Priority Enforcement | 100% | __% | ✅/❌ |
| Conflict Resolution | 95%+ | __% | ✅/❌ |

### Retirement of Legacy System

**After 2 weeks stable operation**:
- [ ] Archive legacy update logic
- [ ] Remove feature flag (always enabled)
- [ ] Update documentation
- [ ] Clean up old code
- [ ] Remove compatibility shims

---

## Monitoring & Metrics

### Real-Time Dashboards

**1. Health Endpoint** (`GET /api/health-detailed`):
```json
{
  "status": "healthy",
  "timestamp": "2025-11-09T10:00:00Z",
  "components": {
    "database": "healthy",
    "redis": "healthy",
    "dataFlow": "healthy"
  },
  "metrics": {
    "dataFlowUpdates": 1523,
    "priorityEnforced": 1523,
    "conflictsResolved": 47,
    "p95ResponseTime": "3.2s"
  }
}
```

**2. Metrics Endpoint** (`GET /api/metrics`):
- Data Flow adoption rate (% using new system)
- Priority matrix enforcement rate
- Conflict resolution success rate
- Field source distribution
- Performance metrics (P50, P95, P99)

### Log Analysis

**Priority Decisions** (`logs/performance.log`):
```bash
# Filter for priority enforcement logs
grep "Priority decision" logs/performance.log | tail -50

# Count decisions by outcome
grep "Priority decision" logs/performance.log | jq -r '.decision' | sort | uniq -c
```

**Error Tracking** (`logs/error.log`):
```bash
# Check for P0 errors
grep '"level":"error"' logs/error.log | grep "data-flow" | tail -20
```

### Alerts (Sentry)

**Critical Alerts** (page immediately):
- Data corruption detected
- Priority matrix violation
- Race condition detected
- P95 response time > 10s

**Warning Alerts** (Slack notification):
- Error rate > 0.1% for 15 minutes
- P95 response time > 5s for 30 minutes
- Conflict resolution failure rate > 5%

---

## Rollback Procedures

### When to Rollback

**P0 Triggers** (immediate rollback):
- Data corruption or loss
- System crashes (> 3 in 1 hour)
- Priority matrix not enforced
- Race conditions causing conflicts
- Performance degradation > 2x baseline

**P1 Triggers** (consider rollback):
- Error rate > 1% sustained for 1 hour
- P95 response time > 10s sustained
- Multiple P1 bugs without workarounds
- Admin team unable to use system

### Rollback Steps

**Immediate Rollback** (<5 minutes):
1. Change environment variable:
   ```bash
   ENABLE_DATA_FLOW_ARCHITECTURE=false
   ```
2. Restart Next.js server:
   ```bash
   pm2 restart web
   ```
3. Verify legacy system operational:
   ```bash
   curl http://localhost:3000/api/health-detailed
   ```

**Database Rollback** (if data corruption):
1. Stop all write operations
2. Restore from backup (pre-deployment):
   ```bash
   pg_restore --clean --if-exists -d ipodhan backup_2025-11-09.dump
   ```
3. Verify data integrity
4. Resume operations with legacy system

**Post-Rollback**:
- [ ] Document what went wrong
- [ ] Root cause analysis
- [ ] Fix issues in staging
- [ ] Re-test thoroughly
- [ ] Schedule new deployment attempt

---

## Success Criteria

### Technical Metrics

**Performance**:
- [x] P95 response time < 5s for updates ✅ (3.4s achieved in testing)
- [ ] P99 response time < 10s
- [ ] Zero race conditions in production
- [ ] Database connection pool stable

**Data Quality**:
- [x] 100% priority matrix enforcement ✅ (verified in 60 tests)
- [ ] Field source tracking 100% accurate
- [ ] Conflict resolution success rate > 95%
- [ ] Zero data corruption incidents

**Reliability**:
- [ ] Error rate < 0.1%
- [ ] Zero P0 bugs in production
- [ ] ≤3 P1 bugs with workarounds
- [ ] System uptime > 99.9%

### Business Metrics

**Data Freshness**:
- [ ] DRHP data processed within 1 hour of upload
- [ ] NSE updates reflected within 15 minutes
- [ ] Manual overrides preserved correctly

**Admin Productivity**:
- [ ] Fewer duplicate data conflicts
- [ ] Field source visible in admin UI
- [ ] Protected fields enforced automatically
- [ ] Audit trail complete

### Team Confidence

**Checklist**:
- [ ] Technical lead approves deployment
- [ ] Admin team comfortable with system
- [ ] Product owner satisfied with metrics
- [ ] Support team trained on new features
- [ ] Documentation complete

---

## Deployment Schedule

### Proposed Timeline

| Day | Activity | Duration | Status |
|-----|----------|----------|--------|
| **Day 1** | Pre-deployment verification | 4 hours | ⏳ Pending |
| **Day 1** | Shadow mode deployment | 24 hours | ⏳ Pending |
| **Day 2** | Review shadow logs | 2 hours | ⏳ Pending |
| **Day 2** | 10% gradual rollout | 6 hours | ⏳ Pending |
| **Day 2-3** | 50% gradual rollout | 24 hours | ⏳ Pending |
| **Day 3-4** | 100% gradual rollout | 24 hours | ⏳ Pending |
| **Day 4-6** | Full production monitoring | 48 hours | ⏳ Pending |
| **Week 2** | Legacy system retirement | 1 week | ⏳ Pending |

**Total Duration**: 5-6 days (shadow to full production)

---

## Rollback Decision Tree

```
ERROR DETECTED
    ↓
Is data corrupted?
    ├─ YES → IMMEDIATE ROLLBACK (restore backup)
    └─ NO → Continue
        ↓
Is system crashing?
    ├─ YES → IMMEDIATE ROLLBACK
    └─ NO → Continue
        ↓
Is error rate > 1%?
    ├─ YES → Reduce rollout % or ROLLBACK
    └─ NO → Continue
        ↓
Is P95 > 10s?
    ├─ YES → Reduce rollout % or ROLLBACK
    └─ NO → Continue monitoring
        ↓
MONITOR & PROCEED
```

---

## Communication Plan

### Stakeholder Updates

**Pre-Deployment** (Day 0):
- Email to admin team: "Phase 2 deployment starting tomorrow"
- Slack announcement: Deployment timeline
- On-call rotation: Who's responsible for monitoring

**During Shadow Mode** (Day 1):
- Slack update (EOD): "Shadow mode complete, logs reviewed, proceeding to gradual"

**During Gradual Rollout** (Days 2-3):
- Slack updates (every 12 hours): "10% rollout stable, proceeding to 50%"
- Email updates for major milestones (50%, 100%)

**Post-Deployment** (Day 4):
- Email summary: "Phase 2 deployed successfully, metrics green"
- Documentation: Update SESSION_STATUS.md, README.md

**If Rollback Required**:
- Immediate Slack: "Rolling back Phase 2 due to [issue]"
- Post-mortem document: Root cause analysis, next steps

---

## Appendix

### A. Environment Variables

```bash
# .env.production
ENABLE_DATA_FLOW_ARCHITECTURE=false  # or shadow, gradual:10, gradual:50, true
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
```

### B. Monitoring Queries

**Count updates by source**:
```sql
SELECT source, COUNT(*)
FROM "fieldProtectionMetadata"
WHERE "updatedAt" > NOW() - INTERVAL '24 hours'
GROUP BY source;
```

**Check for protected field violations**:
```sql
SELECT COUNT(*)
FROM "auditLogs"
WHERE action = 'UPDATE'
  AND metadata->>'protectedFieldViolation' = 'true'
  AND "createdAt" > NOW() - INTERVAL '24 hours';
```

### C. Performance Benchmarks

From Phase 2 integration testing:
- **Single update**: <100ms (P95)
- **Batch 10 updates**: <500ms (P95)
- **Batch 100 updates**: <2s (P95)
- **Concurrent 1000 updates**: 3.4s (P95) ✅

---

**Document Owner**: IPODhan Development Team
**Created**: 2025-11-09
**Status**: ✅ Ready for Deployment
**Next Review**: After shadow mode completion (Day 1 EOD)
