# IPODhan Admin Interface User Guide

**Version**: 2.0 (Post-Consolidation)
**Last Updated**: 2025-11-07
**Audience**: Admin users, data entry team, IPO analysts

---

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Dashboard Overview](#dashboard-overview)
4. [Editing IPO Data](#editing-ipo-data)
5. [Related Data Management](#related-data-management)
6. [Field Protection System](#field-protection-system)
7. [DRHP Extraction Tool](#drhp-extraction-tool)
8. [IPO Objectives Editor](#ipo-objectives-editor)
9. [Data Validation Rules](#data-validation-rules)
10. [Common Tasks](#common-tasks)
11. [Troubleshooting](#troubleshooting)
12. [Best Practices](#best-practices)

---

## Introduction

### What is the Dynamic Admin?

The Dynamic Admin is IPODhan's unified administrative interface for managing all IPO-related data. It provides **100% field coverage** across all 17 database tables, replacing the previous Traditional Admin interface.

### Key Features

✅ **Self-Extending** - Automatically reflects all database fields
✅ **100% Field Coverage** - Access to all 450+ fields across 17 tables
✅ **Field Protection** - Protect fields from scraper overwrites
✅ **DRHP Extraction** - One-click copy from financial PDF extractions
✅ **Real-time Validation** - Instant feedback on data quality
✅ **Contextual Navigation** - Easy access to related data

### Admin Consolidation (November 2025)

As of November 2025, the Traditional Admin interface has been retired. All admin operations now use the Dynamic Admin system. This consolidation:
- Eliminated 90+ duplicate field definitions
- Reduced admin code by 50%
- Provides consistent user experience
- Maintains zero functionality loss

---

## Getting Started

### Accessing the Admin Interface

1. **Navigate to Admin Dashboard**
   ```
   https://ipodhan.com/admin
   ```

2. **Authentication**
   - Login with your admin credentials
   - Contact support if you need access

3. **Dashboard View**
   - Recent IPOs list
   - Quick action buttons
   - Status indicators

### Interface Overview

The admin interface consists of:
- **Dashboard** (`/admin`) - Central hub with IPO list
- **Edit Pages** (`/admin/dynamic/{table}/{id}`) - Field editing
- **Specialized Editors** - Objectives, DRHP extraction

---

## Dashboard Overview

### IPO List Table

The dashboard displays recent IPOs with key information:

| Column | Description |
|--------|-------------|
| **Company Name** | IPO company name |
| **Status** | UPCOMING, OPEN, CLOSED, LISTED |
| **Segment** | MAINBOARD or SME |
| **Dates** | Open and close dates |
| **Price Range** | Min-Max IPO price |
| **Actions** | Edit button |

### Quick Actions

- **Edit Button** - Opens Dynamic Admin for that IPO
- **Status Filter** - Filter by IPO status
- **Search** - Find IPOs by company name

### Navigation Breadcrumbs

```
Admin > IPOs > {Company Name} > {Table}
```

Click any breadcrumb to navigate back.

---

## Editing IPO Data

### Opening an IPO for Editing

1. From dashboard, click **Edit** button next to IPO
2. You'll be taken to: `/admin/dynamic/ipos/{id}`
3. You'll see the IPO Context Banner at the top

### IPO Context Banner

The blue banner shows:
- Company name
- IPO status (badge)
- Quick navigation links
- Related data dropdown

### Editing Fields

#### Field Types

The Dynamic Admin supports these field types:

| Field Type | UI Component | Example |
|-----------|--------------|---------|
| **Text** | Text input | Company name |
| **Number** | Number input | Lot size, price |
| **Decimal** | Decimal input | P/E ratio, ROE |
| **Date** | Date picker | Open date, close date |
| **Datetime** | Datetime picker | Created timestamp |
| **Textarea** | Multiline text | Description, objectives |
| **Select** | Dropdown | Status, segment |
| **Boolean** | Checkbox | is_listed, is_active |

#### Editing a Field

1. **Click** on the field you want to edit
2. **Modify** the value
3. **Validation** runs automatically (red border = error)
4. **Save** button appears at bottom
5. **Click Save** to persist changes

#### Field States

- **Editable** - White background, can modify
- **Protected** - Yellow background with 🔒 lock icon
- **Read-only** - Gray background, cannot modify
- **Required** - Red asterisk (*) next to label

### Field Categories

Fields are organized into logical groups:

- **Core Info** - Company name, status, segment
- **Pricing** - Price range, lot size, issue size
- **Dates** - Open, close, listing dates
- **URLs** - Website, prospectus links
- **Identifiers** - ISIN, stock symbols
- **Metadata** - Created, updated timestamps

---

## Related Data Management

### Related Data Dropdown

In the IPO Context Banner, click **Related Data** dropdown to access:

1. **Financial Data** - Revenue, profit, ratios
2. **Subscriptions** - QIB, NII, Retail subscription data
3. **GMP Records** - Grey market premium history
4. **Documents** - Prospectus, forms, presentations
5. **Listing Performance** - Post-listing price performance
6. **Anchor Investors** - Pre-IPO anchor investment details
7. **Reviews** - Analyst reviews and ratings
8. **Peer Companies** - Competitive peer data

### Editing Related Data

1. **Select table** from Related Data dropdown
2. **Navigate** to that table's edit page
3. **Edit fields** as needed
4. **Return** to IPO main page via breadcrumbs

### Creating New Related Records

To add new related records (e.g., new GMP entry):

1. Navigate to the table (e.g., GMP Records)
2. Look for **"Add New"** button (if available)
3. Fill in required fields
4. Link to IPO using `ipoId` field
5. Save the record

---

## Field Protection System

### What is Field Protection?

Field protection prevents the scraper from overwriting manually corrected data. When you manually fix a field (e.g., correct wrong lot size), you can "protect" it so future scraper runs don't overwrite your correction.

### How to Protect a Field

1. **Edit the field** with correct value
2. **Click the lock icon** (🔒) next to the field
3. **Field turns yellow** indicating protection
4. **Save changes**

### Protected Field Behavior

- **Yellow background** - Visual indicator
- **Lock icon** (🔒) - Shows field is protected
- **Scraper skip** - Automated scrapers will not overwrite
- **Manual edits** - Admins can still edit protected fields

### When to Use Protection

✅ **Correct wrong scraper data** - Protect after manual correction
✅ **Unique values** - Company-specific data not in scrapers
✅ **Strategic data** - GMP estimates, custom ratings
❌ **Don't over-protect** - Let scrapers update dates, subscription data

### Viewing Protected Fields

Protected fields list is available in:
- Admin dashboard (field protection tab)
- Per-IPO protection status
- Audit logs

---

## DRHP Extraction Tool

### What is DRHP Extraction?

DRHP (Draft Red Herring Prospectus) extraction is an AI-powered tool that extracts financial data from IPO prospectus PDFs. It provides a faster way to populate financial fields.

### Using DRHP Extraction

1. **Navigate** to Financial Data edit page
2. **Look for** "DRHP Extraction Results" section (right side)
3. **View extracted data** in structured format
4. **Copy individual fields** (click copy icon)
5. **Or copy all fields** (click "Copy All" button)

### Extraction Data Structure

The extraction tool provides:
- **Revenue** (FY2022, FY2023, FY2024)
- **Profit** (FY2022, FY2023, FY2024)
- **EBITDA** (FY2022, FY2023, FY2024)
- **EPS** (Earnings per share)
- **Net Worth** (Total net worth)
- **Debt-to-Equity** ratio
- **ROE** (Return on equity)
- **P/E Ratio** (Price-to-earnings)

### DRHP Extraction Workflow

```
1. Upload PDF → 2. AI Extracts Data → 3. Review Results → 4. Copy to Fields → 5. Verify & Save
```

### Accuracy & Verification

- **Accuracy Rate**: ~94% (based on testing)
- **Always verify** extracted values before saving
- **Cross-check** with prospectus if values seem unusual
- **Report errors** to improve extraction model

---

## IPO Objectives Editor

### What are IPO Objectives?

IPO objectives describe how the company plans to use the funds raised from the IPO. Examples:
- Debt repayment
- Working capital
- Expansion/CAPEX
- Marketing
- R&D investment

### Accessing Objectives Editor

From IPO edit page:
1. Click **Related Data** dropdown
2. Select **Edit Objectives** (or navigate to `/admin/dynamic/ipos/{id}/objectives`)

### Editing Objectives

The objectives editor provides:
- **Rich text editor** - Format text with bold, italic, lists
- **Bullet points** - Structured list of objectives
- **Character limit** - 2000 characters max
- **Auto-save** - Changes saved automatically

### Objectives Best Practices

✅ **Be concise** - Use bullet points
✅ **Use company language** - Quote from prospectus
✅ **Prioritize** - Most important objectives first
✅ **Include amounts** - Specify fund allocation (e.g., ₹500 crores for expansion)

---

## Data Validation Rules

### Validation System

The Dynamic Admin enforces data quality rules to prevent errors. Validation happens **in real-time** as you type.

### Validation States

- **Valid** - Green checkmark, can save
- **Invalid** - Red border + error message, cannot save
- **Warning** - Orange indicator, can save but review recommended

### Common Validation Rules

#### IPO Fields

| Field | Validation Rule |
|-------|----------------|
| **Lot Size** | Must be positive integer, ≥ 1 share |
| **Price Range Min** | Must be > ₹0, ≤ price max |
| **Price Range Max** | Must be > ₹0, ≥ price min |
| **Issue Size** | Must be > ₹0 crores |
| **Open Date** | Must be before close date |
| **Close Date** | Must be after open date |

#### Financial Fields

| Field | Validation Rule |
|-------|----------------|
| **P/E Ratio** | 0 - 1000 range |
| **ROE** | -100% to 100% range |
| **Debt-to-Equity** | Must be non-negative |
| **Revenue** | Must be non-negative |
| **Profit** | Can be negative (loss) |
| **Net Worth** | Must be positive |

#### Subscription Fields

| Field | Validation Rule |
|-------|----------------|
| **All Subscription Values** | Must be ≥ 0 |

#### GMP Fields

| Field | Validation Rule |
|-------|----------------|
| **GMP Price** | Must be ≥ ₹0 |
| **GMP Percentage** | -100% to 1000% range |
| **Estimated Listing Price** | Must be > ₹0 |

### Handling Validation Errors

1. **Read error message** - Tells you what's wrong
2. **Fix the value** - Adjust to meet validation rule
3. **Re-validate** - Error disappears when fixed
4. **Save** - Save button enables when all errors resolved

---

## Common Tasks

### Task 1: Add a New IPO

1. Navigate to `/admin/dynamic/ipos`
2. Click **Add New IPO** button
3. Fill required fields:
   - Company name
   - Status
   - Segment (MAINBOARD or SME)
4. Fill optional fields as available
5. Click **Save**
6. IPO is created with unique ID

### Task 2: Update Subscription Data

1. From dashboard, click **Edit** on IPO
2. Click **Related Data** → **Subscriptions**
3. Update subscription values:
   - QIB, NII, Retail subscriptions
   - Total applications
   - Total shares bid
4. Validate values (must be ≥ 0)
5. Click **Save**

### Task 3: Add GMP Record

1. Navigate to IPO's GMP Records page
2. Click **Add New GMP Record**
3. Fill fields:
   - GMP Price
   - GMP Percentage
   - Estimated Listing Price
   - Source (e.g., "Chittorgarh")
4. Set `recordedAt` date
5. Save record

### Task 4: Correct Scraper Error

1. Identify incorrect field (e.g., wrong lot size)
2. Edit field with correct value
3. Click **lock icon** (🔒) to protect field
4. Save changes
5. Field is now protected from scraper overwrites

### Task 5: Bulk Update Financial Data

1. Navigate to Financial Data page
2. If DRHP extraction available, use **Copy All**
3. Otherwise, manually update fields:
   - Revenue (FY2022, 2023, 2024)
   - Profit (FY2022, 2023, 2024)
   - Ratios (P/E, ROE, Debt-to-Equity)
4. Validate all fields
5. Save changes

---

## Troubleshooting

### Problem: "Save" Button is Disabled

**Cause**: Validation errors present

**Solution**:
1. Scroll through all fields
2. Look for red borders (errors)
3. Read error messages
4. Fix invalid values
5. Save button will enable

### Problem: Field is Read-Only (Gray)

**Cause**: Field is protected or auto-generated

**Solution**:
- **If protected**: Unprotect field first (click lock icon)
- **If auto-generated**: Cannot edit (e.g., `id`, `createdAt`)

### Problem: Changes Not Saving

**Possible Causes**:
1. **Network error** - Check internet connection
2. **Validation errors** - Check for red borders
3. **Session timeout** - Refresh and login again

**Solution**:
1. Check browser console for errors (F12)
2. Refresh page and try again
3. Contact support if persists

### Problem: DRHP Extraction Not Showing

**Cause**: PDF not yet processed

**Solution**:
1. Check if PDF was uploaded
2. Wait for processing (can take 2-5 minutes)
3. Refresh page to see results
4. Contact support if extraction fails

### Problem: Protected Field Still Overwritten

**Cause**: Protection not saved or scraper bug

**Solution**:
1. Verify protection toggle is on (yellow background)
2. Check field protection list in admin dashboard
3. Re-protect field and save again
4. Report to support if issue continues

---

## Best Practices

### Data Entry

✅ **Double-check values** - Verify against official sources
✅ **Use DRHP extraction** - Faster than manual entry
✅ **Protect corrections** - Always protect manually fixed fields
✅ **Follow naming conventions** - Use official company names
✅ **Add sources** - Note data sources in comments/notes

### Data Quality

✅ **Verify dates** - Cross-check open/close dates with exchange
✅ **Check calculations** - Ensure P/E, ROE match financials
✅ **Update regularly** - Keep subscription data current during IPO
✅ **Review warnings** - Don't ignore orange warnings
✅ **Audit trail** - Document major changes in notes

### Workflow Efficiency

✅ **Use Related Data links** - Navigate quickly between tables
✅ **Batch similar tasks** - Update all financials at once
✅ **Learn keyboard shortcuts** - Tab through fields
✅ **Save frequently** - Don't lose work
✅ **Use breadcrumbs** - Navigate back efficiently

### Field Protection Strategy

✅ **Protect strategically** - Only protect corrected fields
✅ **Document reasons** - Add note why field was protected
✅ **Periodic review** - Unprotect fields when scraper improves
❌ **Don't over-protect** - Let scrapers do their job where possible

### Communication

✅ **Report bugs** - Help improve the system
✅ **Suggest features** - Share workflow pain points
✅ **Document issues** - Note patterns in data quality
✅ **Share learnings** - Help train other admins

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Move to next field |
| `Shift + Tab` | Move to previous field |
| `Ctrl + S` | Save changes (if enabled) |
| `Escape` | Cancel edit |

---

## Support & Resources

### Getting Help

- **Technical Issues**: Open GitHub issue with `admin` label
- **Urgent Problems**: Tag @winston (architect) in Slack
- **Data Questions**: Contact data team lead
- **Training**: Request 1-on-1 session

### Additional Documentation

- **Backend Architecture**: `docs/02-architecture/backend-architecture.md`
- **Database Schema**: `docs/16-database/SCHEMA_MANAGEMENT.md`
- **Field Mapping**: `docs/16-database/screen-table-database-field-mapping.md`
- **API Documentation**: `docs/02-architecture/api-specification.md`

### Admin Dashboard Links

- **Production**: `https://ipodhan.com/admin`
- **Staging**: `https://staging.ipodhan.com/admin` (if available)

---

## Appendix: Field Reference

### IPO Core Fields

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| `companyName` | text | Company name | ✅ |
| `slug` | text | URL-friendly identifier | ✅ |
| `status` | enum | UPCOMING, OPEN, CLOSED, LISTED | ✅ |
| `segment` | enum | MAINBOARD or SME | ✅ |
| `category` | enum | IPO, RIGHTS, NCD, etc. | ✅ |
| `lotSize` | integer | Minimum lot size | ❌ |
| `priceRangeMin` | decimal | Minimum IPO price | ❌ |
| `priceRangeMax` | decimal | Maximum IPO price | ❌ |
| `issueSize` | decimal | Issue size (crores) | ❌ |
| `openDate` | date | IPO open date | ❌ |
| `closeDate` | date | IPO close date | ❌ |

### Financial Data Fields

| Field | Type | Description |
|-------|------|-------------|
| `revenueFy2024` | decimal | Revenue FY2024 (crores) |
| `revenueFy2023` | decimal | Revenue FY2023 (crores) |
| `revenueFy2022` | decimal | Revenue FY2022 (crores) |
| `profitFy2024` | decimal | PAT FY2024 (crores) |
| `profitFy2023` | decimal | PAT FY2023 (crores) |
| `profitFy2022` | decimal | PAT FY2022 (crores) |
| `peRatio` | decimal | Price-to-Earnings ratio |
| `roe` | decimal | Return on Equity (%) |
| `debtToEquity` | decimal | Debt-to-Equity ratio |
| `eps` | decimal | Earnings per share |
| `netWorth` | decimal | Net worth (crores) |

### Subscription Fields

| Field | Type | Description |
|-------|------|-------------|
| `totalSubscription` | decimal | Overall subscription (times) |
| `qibSubscription` | decimal | QIB subscription (times) |
| `niiSubscription` | decimal | NII subscription (times) |
| `retailSubscription` | decimal | Retail subscription (times) |
| `employeeSubscription` | decimal | Employee subscription (times) |
| `totalApplications` | bigint | Total applications received |
| `totalSharesBid` | bigint | Total shares bid for |
| `sharesOffered` | bigint | Total shares offered |

---

## Changelog

### Version 2.0 (2025-11-07)
- Complete admin consolidation
- Traditional Admin retired
- 100% field coverage in Dynamic Admin
- Added custom validation rules
- Enhanced DRHP extraction integration
- Improved field protection UI

### Version 1.5 (2025-10-25)
- Added objectives editor
- Enhanced context navigation
- Added migration notices

### Version 1.0 (2025-10-01)
- Initial Dynamic Admin release
- Field protection system
- DRHP extraction viewer

---

## Phase 3.4 Features (November 2025)

### New Admin Tools

Phase 3.4 introduced powerful new tools for data quality management:

1. **Conflict Dashboard** - Resolve data conflicts across sources
2. **Manual Review Queue** - Review low-confidence DRHP extractions
3. **Monitoring Dashboard** - Real-time pipeline health metrics
4. **Source Indicators** - Visual badges showing data sources
5. **Auto-Resolve** - Automatically resolve ADMIN conflicts

---

## Conflict Dashboard

**Location**: `/admin/conflicts`

### What are Data Conflicts?

When multiple scrapers provide different values for the same field, the system detects and logs conflicts for admin review.

**Example**: NSE says `issue_size = ₹500 Cr`, BSE says `₹520 Cr` → WARNING conflict

### Conflict Severity Levels

- **🔴 CRITICAL**: >20% difference, date/status mismatches (requires immediate review)
- **🟡 WARNING**: 5-20% difference, important field mismatches
- **🔵 INFO**: <5% difference, minor formatting differences

### Resolving Conflicts

**Single Conflict**:
1. Click **[Resolve]** on conflict row
2. Choose winning source (NSE or BSE)
3. Enter resolution reason
4. Check "Apply to Database" and/or "Protect Field"
5. Click **[Resolve Conflict]**

**Bulk Resolution** (max 100 conflicts):
1. Select checkboxes for conflicts
2. Click **[Resolve Selected]**
3. Choose resolution strategy
4. Enter reason and save

**Auto-Resolve** (ADMIN conflicts only):
1. Click **[Auto-Resolve All]**
2. Enable dry-run mode to preview
3. Set max conflicts (optional)
4. System resolves all ADMIN (100) vs scraper conflicts automatically

---

## Manual Review Queue

**Location**: `/admin/manual-review`

### DRHP Manual Review

When DRHP extraction confidence < 70%, the system queues for manual verification.

**Review Process**:
1. Click **[Review Data]** on queued item
2. Split-screen shows: DRHP PDF (left) | Extracted Data (right)
3. Verify each field against PDF
4. Check boxes for verified fields
5. Manually correct low-confidence fields
6. Click **[Approve & Apply]** or **[Reject & Re-Extract]**

**Verification Checklist**:
- ✅ Revenue matches DRHP financial highlights
- ✅ Profit matches P&L statement
- ✅ Margins calculated correctly
- ✅ ROE/ROCE match balance sheet
- ✅ Issue size matches offer document

---

## Monitoring Dashboard

**Location**: `/admin/metrics`

### Dashboard Overview

Real-time monitoring of complete data pipeline health.

**Quick Stats** (Last 24 Hours):
- IPOs Detected
- DRHPs Extracted
- Conflicts Resolved
- Data Quality %

**Metrics Sections**:

1. **Detection Metrics**: IPO detection latency, sources breakdown
2. **Consolidation Metrics**: Conflicts, processing time
3. **DRHP Metrics**: Extraction success rate, avg confidence, failures
4. **Data Quality Metrics**: Field completeness, source tracking coverage

**Health Status**:
- 🟢 **HEALTHY**: All systems operational
- 🟡 **DEGRADED**: Some issues detected
- 🔴 **CRITICAL**: Immediate attention required

**Auto-Refresh**: Toggle on/off (5-minute intervals)

---

## Source Indicators (Badges)

### What are Source Badges?

Visual indicators showing which scraper/source provided each field value.

**Color-Coded Badges**:
- 🔴 **ADMIN** (100) - Manual admin overrides
- 🟣 **DRHP** (95) - Official regulatory documents
- 🔵 **NSE** (90) - Primary exchange
- 🟢 **BSE** (85) - Secondary exchange
- 🟡 **MC** (75) - Moneycontrol
- 🟠 **CHIT** (70) - Chittorgarh (GMP)

**Confidence Indicators**:
- 🟢 Green dot: 90-100% confidence
- 🟡 Yellow dot: 75-89% confidence
- 🟠 Orange dot: 50-74% confidence
- 🔴 Red dot: <50% confidence

**Tooltip on Hover**:
```
Source: DRHP
Confidence: 94%
Updated: 2025-11-08 10:30 AM
Previous: ₹480 Cr (NSE, 90%)
```

---

## Common Phase 3.4 Workflows

### Workflow 1: Daily Data Quality Check (5-10 min)

1. **Check Monitoring Dashboard** (`/admin/metrics`)
   - Verify 🟢 HEALTHY status
   - Note any CRITICAL conflicts

2. **Review Conflicts** (`/admin/conflicts`)
   - Filter by CRITICAL severity
   - Resolve critical conflicts
   - Use auto-resolve for ADMIN conflicts

3. **Process Manual Reviews** (`/admin/manual-review`)
   - Review pending DRHP extractions
   - Verify high-priority IPOs (opening <7 days)

4. **Scan Recent IPOs** (`/admin/ipos`)
   - Filter: Created in last 24h
   - Verify data completeness
   - Check financial data is from DRHP (purple badge)

### Workflow 2: Resolving Scraper Conflict

**Example**: NSE and BSE report different lot sizes

1. **Verify Against DRHP**:
   - Open IPO detail page
   - Click **[View DRHP]**
   - Find lot size in "Terms of the Issue" section

2. **Resolve Conflict**:
   - Go to Conflict dashboard
   - Click **[Resolve]** on lot_size conflict
   - Select correct source (based on DRHP verification)
   - Enter reason: "Verified against DRHP - NSE correct"
   - Check "Apply to Database" + "Protect Field"
   - Click **[Resolve Conflict]**

3. **Verify Fix**:
   - IPO detail page shows: "Lot Size: 75 shares [ADMIN] 🔒"
   - Source changed to ADMIN (100% confidence)
   - Field protected from future overwrites

### Workflow 3: DRHP Manual Review

**Example**: Extraction confidence 65% (below 70% threshold)

1. **Open Review Queue** → Click queued IPO
2. **Initial Assessment**: Check field breakdown
   - Revenue/Profit: 94% ✅
   - ROE/ROCE: <50% ❌ (failed extraction)
3. **View DRHP Side-by-Side**: Click **[View DRHP]**
4. **Verify High-Confidence Fields**: Revenue/Profit match DRHP ✅
5. **Correct Low-Confidence Fields**: Manually enter ROE/ROCE from DRHP
6. **Approve & Apply**: All fields verified, click **[Approve & Apply]**
7. **Result**: Field sources created (DRHP 95% for auto-extracted, ADMIN 100% for manual)

---

## Troubleshooting Phase 3.4 Features

### Conflict Dashboard Not Loading
- Hard refresh: Ctrl+Shift+R
- Check `/admin/health` endpoint
- Verify Redis connection

### DRHP Not Downloading
- Verify DRHP URL is publicly accessible
- Check disk space on server
- Manual trigger: `npm run drhp:extract -- --ipo-id=<id>`

### Field Protection Not Working
- Verify protection applied (🔒 icon)
- Check field_sources table for ADMIN entry
- Re-apply protection if missing

### Auto-Resolve Fails
- Use dry-run mode first to preview
- Check if conflicts qualify (ADMIN vs scraper)
- Try smaller batch (max conflicts = 10)

### Metrics Dashboard Stale
- Click **[Refresh Now]**
- Check scraper execution logs
- Verify data in database directly

---

## Phase 3.4 Best Practices

### Conflict Resolution
✅ Always verify CRITICAL conflicts against DRHP
✅ Use bulk resolve for repetitive patterns
✅ Document resolution reasons
✅ Protect fields after manual correction

### DRHP Review
✅ Review within 24 hours of queuing
✅ Prioritize IPOs opening soon
✅ Cross-check all low-confidence fields
✅ Report extraction failures for model improvement

### Monitoring
✅ Check dashboard daily (morning routine)
✅ Set up alerts for CRITICAL status
✅ Track conflict resolution rate
✅ Monitor DRHP extraction accuracy trends

---

## Phase 3.4 Performance Metrics

**System Performance**:
- Consolidation: <200ms per IPO (p95: 142ms) ✅
- DRHP Extraction: 15-18s average ✅
- Conflict Resolution: <50ms per conflict ✅
- Cache Invalidation: 25-35ms ✅

**Data Quality**:
- DRHP Accuracy: 94.1% ✅
- Conflict Rate: <5% (target: 2.1% actual) ✅
- Source Tracking Coverage: 97.5% ✅
- Field Completeness: 84.2% ✅

**Load Testing Results**:
- 10 concurrent DRHP extractions: <5 min ✅
- 200+ concurrent DB queries: 100% success ✅
- 50 concurrent IPO creates: 1 success, 49 blocked (no duplicates) ✅

---

**End of Admin User Guide**

For questions or feedback, contact the admin team or open a GitHub issue.
