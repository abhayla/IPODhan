# Team Training Materials
## IPODhan Phase 3.4 - Data Flow Architecture

**Training Version**: 1.0
**Last Updated**: 2025-11-08
**Target Audience**: Data Team, Admin Users, QA Team
**Estimated Training Time**: 2 hours (1h session + 1h hands-on practice)

---

## 📖 TABLE OF CONTENTS

1. [Training Overview](#training-overview)
2. [Pre-Training Checklist](#pre-training-checklist)
3. [Module 1: Phase 3.4 Overview (15 min)](#module-1-phase-34-overview)
4. [Module 2: Conflict Dashboard (20 min)](#module-2-conflict-dashboard)
5. [Module 3: Source Indicators (10 min)](#module-3-source-indicators)
6. [Module 4: Monitoring Dashboard (15 min)](#module-4-monitoring-dashboard)
7. [Module 5: Common Workflows (30 min)](#module-5-common-workflows)
8. [Module 6: Hands-On Practice (30 min)](#module-6-hands-on-practice)
9. [Quick Reference Card](#quick-reference-card)
10. [FAQ](#faq)
11. [Video Script](#video-script)
12. [Assessment Quiz](#assessment-quiz)

---

## 📋 TRAINING OVERVIEW

### What's New in Phase 3.4?

Phase 3.4 introduces an intelligent data consolidation system that:

✅ **Tracks data sources** - Know which scraper provided each field value
✅ **Detects conflicts** - Automatically identify when scrapers disagree
✅ **Resolves conflicts intelligently** - Uses priority matrix (ADMIN > DRHP > NSE > BSE)
✅ **Extracts DRHP data** - Automatically extracts financial data from DRHP PDFs
✅ **Monitors pipeline health** - Real-time metrics dashboard
✅ **Prevents data loss** - Field protection for admin edits

### Why Does This Matter?

**Before Phase 3.4**:
- 🔴 No way to know which scraper provided data
- 🔴 Conflicts silently overwritten (last write wins)
- 🔴 Manual financial data entry (30 min per IPO)
- 🔴 No visibility into scraper health

**After Phase 3.4**:
- ✅ Complete data lineage (know exactly where data came from)
- ✅ Conflicts detected and logged for review
- ✅ Automated DRHP extraction (2-5 min per IPO)
- ✅ Real-time pipeline monitoring

**Impact**:
- **50+ hours/month saved** on manual data entry
- **95%+ conflict-free data** (2.1% conflict rate)
- **44.2% increase in data completeness** (84.2% vs 40%)
- **Zero duplicate IPOs** (distributed locking prevents races)

---

## ✅ PRE-TRAINING CHECKLIST

### For Trainees

- [ ] **Admin access** to IPODhan dashboard (`/admin` URL)
- [ ] **Browser** (Chrome, Firefox, or Edge recommended)
- [ ] **Notepad** for taking notes
- [ ] **15 minutes** to review this document before training

### For Trainer

- [ ] **Demo environment** set up with sample conflicts
- [ ] **Screen sharing** ready (Zoom/Teams)
- [ ] **Backup slides** (if live demo fails)
- [ ] **Sample IPO** with conflicts prepared
- [ ] **Handouts** printed (Quick Reference Card)

---

## 📘 MODULE 1: PHASE 3.4 OVERVIEW (15 min)

### Learning Objectives

By the end of this module, you will:
- Understand the 5-layer data flow architecture
- Know the data source priority matrix
- Recognize when to use Phase 3.4 features

### 1.1 Data Flow Architecture (5 Layers)

```
┌─────────────────────────────────────────────┐
│  LAYER 1: DETECTION                          │
│  When: IPOs announced (T-60 to T-0 days)     │
│  Sources: SEBI, NSE, BSE, GMP trackers       │
│  You see: New IPOs appear in system          │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  LAYER 2: EXTRACTION                         │
│  When: Data scraped hourly/daily             │
│  Sources: NSE, BSE, DRHP PDFs, Moneycontrol  │
│  You see: IPO fields populated               │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  LAYER 3: CONSOLIDATION                      │
│  When: Multiple sources provide same field   │
│  Logic: Priority matrix determines winner    │
│  You see: Conflicts logged if values differ  │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  LAYER 4: PERSISTENCE                        │
│  When: Data saved to database                │
│  Protections: Locks prevent duplicates       │
│  You see: IPO data updated                   │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  LAYER 5: MONITORING & REVIEW                │
│  When: You access admin dashboards           │
│  Tools: Conflict dashboard, Metrics, Badges  │
│  You see: Data quality insights              │
└─────────────────────────────────────────────┘
```

### 1.2 Data Source Priority Matrix

**Universal Rule**: Higher confidence sources win conflicts automatically.

| Priority | Source | Confidence | When Used | Example Fields |
|----------|--------|------------|-----------|---------------|
| **1** | ADMIN | 100 | You manually edit a field | All fields |
| **2** | DRHP | 95 | DRHP PDF extracted | revenue, profit, assets |
| **3** | NSE | 90 | NSE official API/scraper | issueSize, dates, lot size |
| **4** | BSE | 85 | BSE scraper | issueSize, dates (validation) |
| **5** | Moneycontrol | 80 | Moneycontrol scraper | Analyst ratings |

**Field-Specific Rules** (Exceptions):
- **GMP**: Chittorgarh (95) > others (specialist source)
- **Lot Size**: BSE (90) > NSE (85) (BSE more accurate historically)

**What This Means for You**:
- ✅ Your edits (ADMIN) are protected - scrapers won't overwrite
- ✅ DRHP data trusted most for financial metrics
- ✅ NSE trusted most for core IPO details
- ✅ Conflicts only logged when sources of similar confidence disagree

### 1.3 When to Use Phase 3.4 Features

**Daily Tasks**:
- ✅ Check Monitoring Dashboard (`/admin/metrics`) every morning
- ✅ Review conflicts when alert received (CRITICAL conflicts >10)

**As-Needed Tasks**:
- ⏰ Resolve conflicts (when notified or conflict count >20)
- ⏰ Verify DRHP extractions (if queued for manual review)
- ⏰ Investigate data quality issues (if completeness <80%)

**One-Time Setup**:
- 🔧 Familiarize yourself with Conflict Dashboard layout
- 🔧 Bookmark key dashboards

---

## 📊 MODULE 2: CONFLICT DASHBOARD (20 min)

### Learning Objectives

- Navigate the Conflict Dashboard
- Understand conflict severity levels
- Resolve conflicts (single, bulk, auto)

### 2.1 Accessing the Dashboard

**URL**: `https://ipodhan.com/admin/conflicts`

**Navigation**:
1. Login to admin panel
2. Click "Admin" in top navigation
3. Click "Conflicts" in sidebar

**First Impression** (What you'll see):
- Statistics cards at top (Total, CRITICAL, WARNING, INFO)
- Filter dropdowns (Severity, IPO)
- Search bar (Company name or field name)
- Conflict list table (paginated, 50 per page)

### 2.2 Understanding Conflict Severity

| Severity | Color | Meaning | Action Required | Example |
|----------|-------|---------|-----------------|---------|
| **CRITICAL** | 🔴 Red | Major discrepancy, >50% difference | **Immediate** | issueSize: NSE says ₹500Cr, BSE says ₹1000Cr |
| **WARNING** | 🟡 Yellow | Significant difference, 10-50% | **Within 24h** | revenue: DRHP says ₹800Cr, NSE says ₹750Cr |
| **INFO** | 🔵 Blue | Minor difference, <10% | **Optional** | lot_size: NSE says 100, BSE says 99 |

**Severity Assignment** (Automatic):
- System calculates % difference between values
- Numeric fields: Compare absolute difference
- Text fields: Compare similarity score

### 2.3 Conflict List Table

**Columns**:
1. **Company Name** - IPO affected
2. **Field Name** - Which field has conflict (e.g., issueSize, revenue_fy2024)
3. **Source 1 → Value 1** - First scraper's value
4. **Source 2 → Value 2** - Second scraper's value
5. **Severity** - Color-coded badge
6. **Detected** - Timestamp of conflict detection
7. **Actions** - Resolve button

**Example Row**:
```
| XYZ Corporation | issueSize | NSE → ₹500 Cr | BSE → ₹505 Cr | WARNING | 2 hours ago | [Resolve] |
```

### 2.4 Resolving Single Conflicts

**Step-by-Step**:

1. **Click "Resolve"** button on conflict row
2. **Modal opens** showing:
   - Company name
   - Field name
   - Both conflicting values with sources
   - Radio buttons to select correct source
3. **Select correct source**:
   - If unsure, check NSE/BSE official websites manually
   - DRHP always wins for financial data
   - NSE usually correct for core IPO details
4. **(Optional) Add admin note**: Explain your decision
5. **(Optional) Enable "Protect this field"**:
   - Prevents future scrapers from overwriting
   - Recommended for manually verified data
6. **Click "Resolve Conflict"**
7. **Confirmation message** appears

**Decision Guide**:
- **CRITICAL conflicts**: Always verify manually on official sites
- **WARNING conflicts**: Trust priority matrix (DRHP > NSE > BSE)
- **INFO conflicts**: Use auto-resolve if >20 INFO conflicts

### 2.5 Bulk Resolution

**When to Use**:
- Many conflicts for same field across multiple IPOs
- Same pattern (e.g., all NSE vs BSE issueSize conflicts, NSE always correct)
- >10 conflicts of same severity

**Step-by-Step**:

1. **Filter conflicts** by field name or severity
2. **Select checkboxes** for conflicts to resolve (max 100)
3. **Click "Bulk Resolve" button**
4. **Modal opens** showing:
   - Number of selected conflicts
   - Common source options (e.g., "Resolve all using NSE")
5. **Select source to apply** to all selected conflicts
6. **Review preview** (shows which conflicts will be resolved)
7. **Click "Resolve X Conflicts"**
8. **Wait for progress bar** (2-5 seconds for 100 conflicts)
9. **Confirmation message** with count of resolved conflicts

**Pro Tips**:
- ✅ Start with small batches (10-20) to ensure correct source
- ✅ Use filters to group similar conflicts
- ⚠️ Don't bulk-resolve CRITICAL conflicts without manual review

### 2.6 Auto-Resolve (Advanced)

**What It Does**:
- Automatically resolves conflicts where priority matrix is clear
- Example: ADMIN vs NSE → ADMIN always wins (no need for manual review)
- Prevents repetitive manual work

**When to Use**:
- >50 conflicts of same pattern
- All conflicts are ADMIN overrides (safe to auto-resolve)
- All conflicts are INFO severity (low risk)

**Step-by-Step**:

1. **Click "Auto-Resolve" button** (top right)
2. **Modal opens** with options:
   - **Dry Run** (preview without changes) ← **Always start here**
   - **Resolve Immediately** (applies changes)
3. **Select "Dry Run"**
4. **Review preview**:
   - Shows how many conflicts will be resolved
   - Shows which sources will be selected
   - Shows severity breakdown
5. **If preview looks good**:
   - Click "Resolve Immediately"
   - Confirm in popup
6. **Wait for completion** (5-10 seconds for 100+ conflicts)
7. **Review summary** (count of resolved conflicts)

**Safety Net**:
- Auto-resolve NEVER resolves CRITICAL conflicts
- Auto-resolve NEVER resolves conflicts where priority is unclear
- Dry run mode lets you preview before committing

---

## 🏷️ MODULE 3: SOURCE INDICATORS (10 min)

### Learning Objectives

- Understand source badges
- Interpret confidence scores
- Use badges to verify data quality

### 3.1 What Are Source Badges?

**Definition**: Small colored labels showing which scraper provided a field value.

**Where You'll See Them**:
- IPO detail pages (next to each field)
- Admin edit forms
- Conflict dashboard
- Monitoring dashboard

**Example**:
```
Issue Size: ₹500 Crore [NSE 90]
Revenue FY24: ₹800 Crore [DRHP 95]
GMP: ₹45 [Chittorgarh 95]
```

### 3.2 Badge Color Codes

| Source | Color | Badge Example | Meaning |
|--------|-------|---------------|---------|
| **ADMIN** | 🔴 Red | `[ADMIN 100]` | Manually edited by admin (you) |
| **DRHP** | 🟣 Purple | `[DRHP 95]` | Extracted from DRHP PDF |
| **NSE** | 🔵 Blue | `[NSE 90]` | NSE official scraper |
| **BSE** | 🟢 Green | `[BSE 85]` | BSE scraper |
| **Moneycontrol** | 🟡 Yellow | `[MC 80]` | Moneycontrol scraper |
| **Chittorgarh** | 🟠 Orange | `[CHT 95]` | Chittorgarh GMP scraper |

### 3.3 Confidence Scores

**What the Number Means**:
- 100 = Manual verification (admin edit)
- 95 = Authoritative source (DRHP for financials, Chittorgarh for GMP)
- 90 = Official exchange (NSE)
- 85 = Secondary exchange (BSE)
- 80 = Third-party (Moneycontrol)
- <70 = Low confidence (queued for manual review)

**How to Use Confidence Scores**:
- ✅ 95-100: Trust this data highly
- ✅ 85-94: Generally reliable
- ⚠️ 70-84: Cross-check if critical decision
- 🔴 <70: Verify manually before using

### 3.4 Practical Examples

**Example 1: Verifying Issue Size**
```
Issue Size: ₹500 Crore [NSE 90]
```
- Source: NSE (official exchange)
- Confidence: 90 (high)
- Action: Trust this value ✅

**Example 2: Checking Financial Data**
```
Revenue FY24: ₹800 Crore [DRHP 95]
Profit FY24: ₹100 Crore [NSE 85]
```
- Revenue from DRHP (authoritative, 95 confidence) ✅
- Profit from NSE (lower confidence than DRHP)
- Action: If DRHP has profit data, prefer that. If not, NSE is acceptable.

**Example 3: GMP Data**
```
GMP: ₹45 [Chittorgarh 95]
GMP: ₹40 [Moneycontrol 80]
```
- Chittorgarh specialist in GMP (95 confidence) ✅
- Moneycontrol general finance site (80 confidence)
- Action: Trust Chittorgarh value

**Example 4: Admin Override**
```
Lot Size: 100 [ADMIN 100]
```
- Manually set by admin (you or colleague)
- Highest confidence (100)
- Protected from scraper overwrites
- Action: This value is locked ✅

---

## 📈 MODULE 4: MONITORING DASHBOARD (15 min)

### Learning Objectives

- Navigate the Monitoring Dashboard
- Interpret key metrics
- Identify system health issues

### 4.1 Accessing the Dashboard

**URL**: `https://ipodhan.com/admin/metrics`

**What You'll See**:
- Quick Stats (4 cards at top)
- Detection Metrics section
- Consolidation Metrics section
- DRHP Metrics section
- Data Quality Metrics section
- Health status indicator (top right)

### 4.2 Quick Stats (Top Row)

**Card 1: IPOs Detected (Last 24h)**
- **Meaning**: How many new IPOs were discovered by scrapers
- **Expected**: 1-5 per day (varies by market activity)
- **Alert if**: 0 for >24 hours (scraper may be down)

**Card 2: Conflicts Detected**
- **Meaning**: Number of unresolved data conflicts
- **Expected**: <2% of total IPOs (e.g., 10 conflicts for 500 IPOs)
- **Alert if**: >50 conflicts (review and resolve)

**Card 3: DRHPs Extracted**
- **Meaning**: Percentage of IPOs with DRHP financial data
- **Expected**: >80%
- **Alert if**: <70% (extraction failures may need attention)

**Card 4: System Health**
- **Meaning**: Overall pipeline status
- **Colors**:
  - 🟢 HEALTHY: All systems operational
  - 🟡 DEGRADED: Minor issues, still functional
  - 🔴 CRITICAL: Major issues, needs immediate attention
- **Alert if**: Not HEALTHY (investigate below sections)

### 4.3 Detection Metrics

**IPOs Detected (Last 24h)**: Trend chart
- **Interpretation**: Stable = scraper running correctly
- **Spike**: Major IPO announcement day
- **Flat zero**: Scraper down or no new IPOs

**Average Detection Latency**: Hours from announcement to detection
- **Target**: <6 hours
- **Actual**: ~4.2 hours (per completion summary)
- **Alert if**: >12 hours (scraper delays)

**Source Breakdown**: Pie chart
- **Shows**: Which scrapers contributed detections (NSE, BSE, SEBI, Other)
- **Expected**: NSE + BSE = 80%+
- **Alert if**: One source = 0 (scraper down)

### 4.4 Consolidation Metrics

**IPOs Processed**: Total count
- **Meaning**: How many IPOs went through consolidation pipeline
- **Expected**: Equals total IPOs in database

**Conflicts Detected**: Unresolved count
- **Target**: <2% of total IPOs
- **Actual**: 2.1% (per completion summary)
- **Alert if**: >5% (investigate conflict patterns)

**Conflict Rate**: Percentage
- **Formula**: (Conflicts / Total IPOs) × 100
- **Target**: <2%
- **Alert if**: >5%

**Average Consolidation Latency**: Milliseconds (p95)
- **Target**: <500ms
- **Actual**: 142ms (per completion summary)
- **Alert if**: >1000ms (performance issue)

**Lock Timeouts**: Count
- **Meaning**: How many times distributed lock timed out (race condition prevention)
- **Expected**: 0-2 per day
- **Alert if**: >10 per day (Redis issue or high concurrency)

### 4.5 DRHP Metrics

**DRHPs Extracted**: Count
- **Meaning**: Successfully extracted DRHP financial data
- **Expected**: 80%+ of detected IPOs

**Average Extraction Confidence**: Percentage
- **Target**: >90%
- **Actual**: 94.1% (per completion summary)
- **Alert if**: <85% (extraction quality declining)

**Extraction Failures**: Count (last 24h)
- **Target**: <5 per day
- **Alert if**: >10 per day (Python script issues)

**Queued for Manual Review**: Count
- **Meaning**: DRHPs with confidence <70% awaiting manual verification
- **Expected**: <5 at any time
- **Alert if**: >10 (review queue backlog)

**Pending Extraction**: Count
- **Meaning**: DRHPs downloaded but not yet extracted
- **Expected**: <3 (extractions usually complete within 30 seconds)
- **Alert if**: >10 (extraction pipeline stuck)

### 4.6 Data Quality Metrics

**Field Completeness**: Percentage
- **Meaning**: % of IPOs with complete financial data
- **Target**: >80%
- **Actual**: 84.2% (per completion summary)
- **Alert if**: <75%

**Source Tracking Coverage**: Percentage
- **Meaning**: % of fields with source attribution
- **Target**: >95%
- **Actual**: 97.5% (per completion summary)
- **Alert if**: <90%

**Admin Overrides**: Count
- **Meaning**: Number of fields manually edited
- **Expected**: 100-200 (varies by data quality)
- **Alert if**: Sudden spike (indicates scraper issues)

**Protected Fields**: Count
- **Meaning**: Fields locked from scraper overwrites
- **Expected**: 50-100
- **Alert if**: >500 (too many manual interventions)

### 4.7 Auto-Refresh Feature

**How to Enable**:
1. Toggle "Auto-refresh" switch (top right of dashboard)
2. Metrics refresh every 5 minutes automatically
3. Green indicator shows last refresh time

**When to Use**:
- During scraper run times (to monitor real-time)
- When troubleshooting issues
- For live demos

**When to Disable**:
- Daily routine checks (refresh manually once)
- Low bandwidth situations

---

## 🔄 MODULE 5: COMMON WORKFLOWS (30 min)

### Workflow 1: Daily Morning Check (5 min)

**Goal**: Ensure system is healthy before daily operations

**Steps**:
1. **Navigate to Monitoring Dashboard** (`/admin/metrics`)
2. **Check System Health indicator** (top right)
   - 🟢 HEALTHY → Proceed to step 3
   - 🟡 DEGRADED → Investigate metrics below
   - 🔴 CRITICAL → Escalate to DevOps immediately
3. **Review Quick Stats**:
   - IPOs Detected: Should have activity if market open previous day
   - Conflicts: Should be <50
   - DRHPs Extracted: Should be >80%
4. **Check Conflict Dashboard** (`/admin/conflicts`)
   - Review any CRITICAL conflicts (resolve within 1 hour)
   - Note WARNING count (resolve if >20)
5. **Document**: Note any issues in team chat

**Time**: 5 minutes
**Frequency**: Daily, 9 AM

---

### Workflow 2: Resolving CRITICAL Conflicts (15 min)

**Trigger**: Email/Slack alert "CRITICAL conflicts >10"

**Steps**:

1. **Navigate to Conflict Dashboard** (`/admin/conflicts`)
2. **Filter by Severity = CRITICAL**
3. **For each CRITICAL conflict**:
   a. Click "Resolve"
   b. **Verify both values manually**:
      - Open NSE website: `https://www.nseindia.com/market-data/ipo-upcoming-issues`
      - Search for company name
      - Compare official value
   c. **Select correct source** based on verification
   d. **Add admin note**: "Verified against NSE official: [value]"
   e. **Enable "Protect field"** if manually verified
   f. **Click "Resolve Conflict"**
4. **Document**: Create ticket if >10 CRITICAL conflicts for same field (potential scraper bug)

**Time**: 15 minutes (for 5-10 conflicts)
**Frequency**: As needed (when alerted)

**Escalation**: If unable to verify (both sources seem wrong) → Escalate to Lead Developer

---

### Workflow 3: Bulk Resolving INFO Conflicts (10 min)

**Trigger**: Conflict count >50, mostly INFO severity

**Steps**:

1. **Navigate to Conflict Dashboard**
2. **Filter by Severity = INFO**
3. **Identify pattern**:
   - Same field across multiple IPOs? (e.g., all lot_size conflicts)
   - Same source pair? (e.g., all NSE vs BSE)
4. **If clear pattern** (e.g., NSE vs BSE lot_size, NSE always correct):
   a. **Select checkboxes** for similar conflicts (max 50 at a time)
   b. **Click "Bulk Resolve"**
   c. **Select source** (e.g., NSE)
   d. **Review preview**
   e. **Click "Resolve X Conflicts"**
5. **Repeat** for remaining conflicts in batches of 50

**Alternative** (if >100 INFO conflicts):
- Use Auto-Resolve with Dry Run first
- Review preview
- Approve if safe

**Time**: 10 minutes (for 50-100 conflicts)
**Frequency**: Weekly or when INFO conflicts >50

---

### Workflow 4: Verifying DRHP Extraction (20 min)

**Trigger**: Manual review queue has >5 DRHPs

**Steps**:

1. **Navigate to Manual Review Queue** (`/admin/manual-review` if implemented, else use query):
   ```sql
   SELECT * FROM documents
   WHERE extraction_status = 'MANUAL_REVIEW'
   ORDER BY created_at DESC;
   ```
2. **For each DRHP**:
   a. **Download PDF** (click document link)
   b. **Open PDF** and locate financial section (usually pages 5-20)
   c. **Compare extracted values** with PDF:
      - Revenue FY 2024, FY 2023, FY 2022
      - Profit FY 2024, FY 2023, FY 2022
      - Total Assets, Total Liabilities
      - Net Worth, EPS
   d. **If values correct**:
      - Mark as "Approved" in admin panel
   e. **If values incorrect**:
      - Manually edit values in admin panel
      - Add note: "Corrected from DRHP page X"
      - Submit (will be marked as ADMIN source)
3. **Document**: If >5 DRHPs fail extraction, create ticket (Python script may need improvement)

**Time**: 20 minutes (for 3-5 DRHPs)
**Frequency**: Daily if queue >5, else weekly

---

### Workflow 5: Monthly Data Quality Audit (1 hour)

**Goal**: Ensure overall data quality remains high

**Steps**:

1. **Run Data Completeness Report**:
   ```sql
   SELECT
     COUNT(*) as total_ipos,
     COUNT(CASE WHEN issue_size IS NOT NULL THEN 1 END) as has_issue_size,
     COUNT(CASE WHEN revenue_fy2024 IS NOT NULL THEN 1 END) as has_revenue,
     COUNT(CASE WHEN profit_fy2024 IS NOT NULL THEN 1 END) as has_profit,
     ROUND(100.0 * COUNT(CASE WHEN revenue_fy2024 IS NOT NULL THEN 1 END) / COUNT(*), 2) as revenue_completeness
   FROM ipos
   WHERE status IN ('OPEN', 'CLOSED', 'LISTED');
   ```
   **Target**: revenue_completeness >80%

2. **Check Source Distribution**:
   ```sql
   SELECT
     (field_sources->>'revenue_fy2024'->'source')::text as source,
     COUNT(*) as count
   FROM ipos
   WHERE field_sources ? 'revenue_fy2024'
   GROUP BY source
   ORDER BY count DESC;
   ```
   **Expected**: DRHP = 70%+, NSE = 20%, BSE = 10%

3. **Review Conflict Trends** (last 30 days):
   ```sql
   SELECT
     DATE(detected_at) as date,
     severity,
     COUNT(*) as conflicts
   FROM data_conflicts
   WHERE detected_at > NOW() - INTERVAL '30 days'
   GROUP BY date, severity
   ORDER BY date DESC, severity;
   ```
   **Target**: Conflict rate trend stable or decreasing

4. **Document Findings**: Share in team meeting

**Time**: 1 hour
**Frequency**: Monthly

---

## 🏋️ MODULE 6: HANDS-ON PRACTICE (30 min)

### Exercise 1: Navigate to Dashboards (5 min)

**Tasks**:
1. Open browser and navigate to `https://ipodhan.com/admin`
2. Find and click "Conflicts" in sidebar
3. Find and click "Metrics" in sidebar
4. Enable auto-refresh on Metrics dashboard
5. Filter conflicts by CRITICAL severity

**Validation**: Show trainer each dashboard successfully loaded

---

### Exercise 2: Resolve a Single Conflict (10 min)

**Scenario**: XYZ Corporation has a conflict on `issueSize` field.
- NSE says: ₹500 Crore
- BSE says: ₹505 Crore
- Severity: WARNING

**Tasks**:
1. Find this conflict in the Conflict Dashboard
2. Click "Resolve"
3. Verify which value is correct (check NSE official website)
4. Select NSE as correct source
5. Add admin note: "Verified against NSE official"
6. Enable "Protect this field"
7. Submit resolution
8. Verify conflict disappears from list

**Validation**: Conflict marked as resolved in database

---

### Exercise 3: Bulk Resolve Conflicts (10 min)

**Scenario**: 20 INFO conflicts for `lot_size` field, all NSE vs BSE.

**Tasks**:
1. Filter by Severity = INFO, Field = lot_size
2. Select first 10 conflicts (using checkboxes)
3. Click "Bulk Resolve"
4. Select NSE as source for all
5. Review preview
6. Submit bulk resolution
7. Verify 10 conflicts resolved

**Validation**: Conflict count decreased by 10

---

### Exercise 4: Interpret Monitoring Dashboard (5 min)

**Scenario**: Trainer shows screenshot of Monitoring Dashboard with:
- System Health: 🟡 DEGRADED
- Conflicts: 45
- DRHP Failures: 8
- Conflict Rate: 4.5%

**Tasks**:
1. Identify the issues:
   - ___________
   - ___________
   - ___________
2. Prioritize which issue to address first:
   - ___________
3. Describe your action plan:
   - ___________

**Validation**: Correct identification and prioritization

---

## 📄 QUICK REFERENCE CARD

### Phase 3.4 Cheat Sheet (Print & Laminate)

```
╔═══════════════════════════════════════════════════════════════╗
║         IPODHAN PHASE 3.4 QUICK REFERENCE CARD                ║
╠═══════════════════════════════════════════════════════════════╣
║ KEY DASHBOARDS                                                 ║
╠═══════════════════════════════════════════════════════════════╣
║ Conflicts: /admin/conflicts                                    ║
║ Metrics:   /admin/metrics                                      ║
║ Review:    /admin/manual-review                                ║
╠═══════════════════════════════════════════════════════════════╣
║ SOURCE PRIORITY MATRIX                                         ║
╠═══════════════════════════════════════════════════════════════╣
║ 1. ADMIN     [100] - Your edits (protected)                    ║
║ 2. DRHP      [95]  - PDF extraction (financials)               ║
║ 3. NSE       [90]  - Official exchange (core details)          ║
║ 4. BSE       [85]  - Secondary exchange (validation)           ║
║ 5. MC/CHT    [80]  - Third-party (ratings, GMP)                ║
╠═══════════════════════════════════════════════════════════════╣
║ CONFLICT SEVERITY                                              ║
╠═══════════════════════════════════════════════════════════════╣
║ 🔴 CRITICAL  - >50% difference → Resolve immediately            ║
║ 🟡 WARNING   - 10-50% difference → Resolve within 24h          ║
║ 🔵 INFO      - <10% difference → Optional, use auto-resolve    ║
╠═══════════════════════════════════════════════════════════════╣
║ DAILY TASKS (9 AM - 5 min)                                     ║
╠═══════════════════════════════════════════════════════════════╣
║ 1. Check /admin/metrics System Health → Should be 🟢          ║
║ 2. Review conflicts → Resolve if CRITICAL >10                  ║
║ 3. Note any issues in team chat                                ║
╠═══════════════════════════════════════════════════════════════╣
║ CONFLICT RESOLUTION GUIDE                                      ║
╠═══════════════════════════════════════════════════════════════╣
║ Single Conflict:                                               ║
║   Click "Resolve" → Select source → Add note → Submit          ║
║                                                                ║
║ Bulk Resolve (10-100 conflicts):                               ║
║   Filter → Select → "Bulk Resolve" → Choose source → Submit    ║
║                                                                ║
║ Auto-Resolve (>100 conflicts):                                 ║
║   "Auto-Resolve" → "Dry Run" → Review → Approve                ║
╠═══════════════════════════════════════════════════════════════╣
║ SOURCE BADGE COLORS                                            ║
╠═══════════════════════════════════════════════════════════════╣
║ 🔴 ADMIN (100)    🟣 DRHP (95)       🔵 NSE (90)               ║
║ 🟢 BSE (85)       🟡 MC (80)         🟠 CHT (95 for GMP)       ║
╠═══════════════════════════════════════════════════════════════╣
║ ALERTS & ESCALATION                                            ║
╠═══════════════════════════════════════════════════════════════╣
║ CRITICAL conflicts >10     → Resolve immediately               ║
║ System Health = DEGRADED   → Investigate metrics               ║
║ System Health = CRITICAL   → Escalate to DevOps                ║
║ DRHP failures >10/day      → Escalate to Lead Dev              ║
║ Conflict rate >5%          → Escalate to Lead Dev              ║
╠═══════════════════════════════════════════════════════════════╣
║ EMERGENCY CONTACTS                                             ║
╠═══════════════════════════════════════════════════════════════╣
║ Lead Developer: [Email/Phone]                                  ║
║ DevOps Lead:    [Email/Phone]                                  ║
║ Data Team Lead: [Email/Slack]                                  ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## ❓ FAQ

### Q1: What if I manually edit a field? Will scrapers overwrite it?

**A**: No. Your edits are marked as "ADMIN" source with 100 confidence. This is the highest priority, so scrapers cannot overwrite. The system will log a conflict if a scraper tries, but your value stays.

---

### Q2: How do I know if DRHP data is accurate?

**A**: Check the confidence score. DRHP extractions with >90% confidence are highly accurate (94.1% average). If confidence <70%, the DRHP is queued for manual review.

---

### Q3: Should I always trust NSE over BSE?

**A**: Generally yes, but with exceptions:
- **Lot size**: BSE is historically more accurate (priority: BSE 90 > NSE 85)
- **Issue size**: NSE is primary (priority: NSE 90 > BSE 85)
- **Financial data**: DRHP wins over both (priority: DRHP 95 > NSE/BSE)

---

### Q4: What happens if I resolve a conflict incorrectly?

**A**: You can:
1. Navigate to the IPO's edit page (`/admin/edit/<slug>`)
2. Change the field value manually
3. This creates a new "ADMIN" source entry (overwrites previous)
4. Add a note explaining the correction

There's no undo button, but your manual edits always win.

---

### Q5: How often should I check the Conflict Dashboard?

**A**:
- **Daily**: Quick check (5 min) if conflict count >20
- **When alerted**: CRITICAL conflicts >10 (immediate)
- **Weekly**: Bulk resolve INFO conflicts (10 min)

If conflict count is consistently <10, daily checks aren't necessary.

---

### Q6: What if auto-resolve makes a mistake?

**A**: Auto-resolve is conservative:
- It NEVER resolves CRITICAL conflicts
- It NEVER resolves conflicts where priority is unclear
- Dry run mode lets you preview before committing

If an incorrect resolution happens:
1. Find the affected IPO
2. Manually edit the field
3. Document the issue (may be a bug in auto-resolve logic)

---

### Q7: Can I bulk-delete conflicts instead of resolving them?

**A**: No. Conflicts must be resolved (a source selected) or the conflict persists. Deleting would lose the audit trail. If you believe a conflict is invalid (e.g., values are actually equivalent), use auto-resolve which handles equivalence checking.

---

### Q8: How do I interpret "Field Protection"?

**A**: When you enable "Protect this field" during conflict resolution:
- The field is locked for that specific IPO
- Future scraper runs cannot update this field
- Manual edits (by you or other admins) can still update it

Use this when you've manually verified a value against official sources.

---

### Q9: What if the Monitoring Dashboard shows "CRITICAL" health?

**A**: Immediate actions:
1. Check which section triggered CRITICAL (Detection, Consolidation, DRHP, Quality)
2. If DRHP failures >10: Normal operation continues, but notify Lead Developer
3. If Consolidation latency >2s: System is slow, notify DevOps
4. If System Health = CRITICAL: Escalate to DevOps immediately (potential outage)

---

### Q10: Where can I find historical conflict resolutions?

**A**: Query the database:
```sql
SELECT * FROM data_conflicts
WHERE resolved_at IS NOT NULL
ORDER BY resolved_at DESC
LIMIT 50;
```

This shows resolved conflicts with:
- Which source was selected
- Who resolved it (resolved_by)
- When it was resolved (resolved_at)
- Admin notes

---

## 🎬 VIDEO SCRIPT (15-Minute Training Video)

### Scene 1: Introduction (0:00-2:00)

**[Slide: IPODhan Phase 3.4 Title]**

**Narrator**: "Welcome to IPODhan Phase 3.4 training. In the next 15 minutes, you'll learn how to use our new intelligent data consolidation system."

**[Slide: What's New]**

"Phase 3.4 introduces three powerful features:
1. Source tracking - see which scraper provided each field
2. Conflict detection - identify when scrapers disagree
3. Automated DRHP extraction - no more manual data entry

Let's dive in."

---

### Scene 2: Data Flow Overview (2:00-4:00)

**[Screen Recording: Monitoring Dashboard]**

**Narrator**: "Our system processes IPO data through 5 layers:

Layer 1: Detection - We discover new IPOs from SEBI, NSE, and BSE.
Layer 2: Extraction - Multiple scrapers collect data hourly.
Layer 3: Consolidation - Smart logic resolves conflicts.
Layer 4: Persistence - Data is safely saved with distributed locking.
Layer 5: Monitoring - You review data quality here."

**[Highlight: Quick Stats cards]**

"The Monitoring Dashboard gives you a real-time health check. Green means all systems operational."

---

### Scene 3: Source Priority Matrix (4:00-6:00)

**[Slide: Priority Matrix Table]**

**Narrator**: "Not all data sources are equal. We use a priority matrix:

Priority 1: ADMIN - that's you. Your edits are protected.
Priority 2: DRHP - official PDF documents for financial data.
Priority 3: NSE - official exchange for core IPO details.
Priority 4: BSE - secondary exchange for validation.
Priority 5: Third-party sites like Moneycontrol.

Higher priority wins conflicts automatically."

**[Screen Recording: IPO Detail Page with Source Badges]**

"See these colored badges? They show the data source and confidence score. Red means you edited it manually. Purple means DRHP extraction. Blue is NSE."

---

### Scene 4: Conflict Dashboard Walkthrough (6:00-10:00)

**[Screen Recording: Navigate to Conflict Dashboard]**

**Narrator**: "Let's look at the Conflict Dashboard. This is where you'll spend most of your time."

**[Highlight: Statistics Cards]**

"At the top, you see total conflicts broken down by severity:
- Red is CRITICAL - resolve immediately.
- Yellow is WARNING - resolve within 24 hours.
- Blue is INFO - optional, can batch resolve."

**[Highlight: Conflict List Table]**

"Each row shows a conflict with two values. For example, NSE says issue size is ₹500 Crore, but BSE says ₹505 Crore. That's a 1% difference - marked as WARNING."

**[Demo: Resolve Single Conflict]**

"To resolve, click the Resolve button. A modal opens. Check the NSE official website to verify. If NSE is correct, select NSE, add a note, and submit. Done. The conflict is resolved and won't reappear."

**[Demo: Bulk Resolve]**

"For many similar conflicts, use bulk resolve. Filter by field name, select up to 100 conflicts, choose the correct source, and resolve all at once. Much faster than one-by-one."

**[Demo: Auto-Resolve]**

"For 100+ conflicts, use auto-resolve. Always start with Dry Run to preview. If the preview looks good, click Resolve Immediately. The system handles the rest."

---

### Scene 5: Daily Workflow (10:00-12:00)

**[Screen Recording: Daily Morning Routine]**

**Narrator**: "Your daily workflow is simple:

9 AM: Check the Monitoring Dashboard. Is System Health green? Good.

Are there CRITICAL conflicts? If yes, go to Conflict Dashboard and resolve them.

Are DRHP extractions failing? Check the manual review queue.

That's it. 5 minutes each morning keeps data quality high."

---

### Scene 6: Best Practices (12:00-14:00)

**[Slide: Best Practices Checklist]**

**Narrator**: "Key best practices:

1. Always verify CRITICAL conflicts manually. Don't guess.
2. Use bulk resolve for patterns, not CRITICAL severity.
3. Enable field protection when manually verifying against official sources.
4. Check the Monitoring Dashboard daily.
5. Escalate if conflict rate exceeds 5%.

Follow these, and you'll master the system in a week."

---

### Scene 7: Q&A Preview & Conclusion (14:00-15:00)

**[Slide: FAQ Highlights]**

**Narrator**: "Common questions:

Will scrapers overwrite my edits? No, ADMIN source is protected.
Should I trust NSE or BSE? Usually NSE, except for lot size where BSE is more accurate.
How often should I check conflicts? Daily if >20 conflicts, otherwise weekly.

Full FAQ is in the training materials document."

**[Slide: Thank You + Contact Info]**

"That's it! You're now ready to use Phase 3.4. Practice on the demo environment, then reach out with questions. Happy data quality managing!"

---

## 📝 ASSESSMENT QUIZ

### Quiz Instructions

- 10 multiple-choice questions
- Passing score: 80% (8/10 correct)
- Open book (training materials allowed)
- Take quiz after hands-on practice

---

**Q1**: What is the highest priority data source?
- A) NSE
- B) DRHP
- C) ADMIN
- D) BSE

**Answer**: C (ADMIN has priority 100)

---

**Q2**: A conflict shows issueSize: NSE = ₹500 Cr, BSE = ₹510 Cr. This is a ___% difference, severity is ___.
- A) 2%, INFO
- B) 2%, WARNING
- C) 10%, CRITICAL
- D) 1%, INFO

**Answer**: A (2% difference = INFO if <10%)

---

**Q3**: When should you use Auto-Resolve?
- A) For all conflicts to save time
- B) For >100 conflicts after dry run preview
- C) For CRITICAL conflicts
- D) Never, always resolve manually

**Answer**: B (Auto-resolve for large batches, after dry run)

---

**Q4**: Which source is most trusted for financial data like revenue and profit?
- A) NSE
- B) BSE
- C) DRHP
- D) Moneycontrol

**Answer**: C (DRHP priority 95 for financials)

---

**Q5**: System Health shows 🔴 CRITICAL. What should you do?
- A) Ignore it, probably temporary
- B) Check conflict dashboard
- C) Escalate to DevOps immediately
- D) Restart your computer

**Answer**: C (CRITICAL health = immediate escalation)

---

**Q6**: You manually edited a field and enabled "Protect this field". What happens next?
- A) Scrapers can still update it if they have higher confidence
- B) The field is locked forever, no one can edit it
- C) Only scrapers can update it
- D) Scrapers cannot overwrite, but admins can still edit

**Answer**: D (Protection prevents scraper overwrites, not admin edits)

---

**Q7**: Conflict rate is 4.5%. What should you do?
- A) Nothing, this is acceptable
- B) Resolve conflicts to bring it under 2%
- C) Escalate to Lead Developer immediately
- D) Disable scrapers

**Answer**: B (Target is <2%, 4.5% needs attention)

---

**Q8**: DRHP extraction confidence is 68%. What happens?
- A) Extraction automatically retried
- B) DRHP queued for manual review
- C) Data discarded
- D) System uses NSE data instead

**Answer**: B (Confidence <70% triggers manual review)

---

**Q9**: Which badge color represents DRHP source?
- A) 🔴 Red
- B) 🟣 Purple
- C) 🔵 Blue
- D) 🟢 Green

**Answer**: B (Purple = DRHP)

---

**Q10**: How often should you check the Monitoring Dashboard?
- A) Every hour
- B) Daily (morning routine)
- C) Weekly
- D) Only when alerted

**Answer**: B (Daily 5-minute check is recommended)

---

## 📊 TRAINING COMPLETION CHECKLIST

**Trainee Name**: ___________________
**Date**: ___________

- [ ] Completed all 6 modules
- [ ] Passed hands-on exercises (4/4)
- [ ] Passed assessment quiz (≥8/10 correct)
- [ ] Bookmarked key dashboards
- [ ] Printed Quick Reference Card
- [ ] Asked clarifying questions

**Trainer Sign-off**: ___________________
**Trainee Sign-off**: ___________________

**Next Steps**:
- [ ] Shadow experienced user for 1 week
- [ ] Solo conflict resolution (supervised)
- [ ] Weekly check-in with trainer
- [ ] Full independence after 2 weeks

---

**END OF TRAINING MATERIALS**

*For questions or to schedule training, contact: [Training Coordinator Email]*
