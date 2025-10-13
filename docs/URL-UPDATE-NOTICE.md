# 🚨 IMPORTANT: URL Reference Update

**Date:** 2025-10-13
**Affects:** All scraper stories, PRD, and implementation code

---

## What Changed

All scraper data source URLs have been **centralized** into a single document for easier maintenance and updates.

## New URL Management System

### ✅ Single Source of Truth
**File:** [URLs-Tracker.md](./URLs-Tracker.md)

All verified, current URLs for data scraping are now maintained in this ONE file.

### 📋 What's in URLs-Tracker.md

- **Active URLs** for all data sources (NSE, BSE, Chittorgarh, InvestorGain)
- **Verification status** and last-checked dates
- **Deprecated URLs** with migration path
- **Alternative/backup sources**
- **URL update protocol**

---

## For Developers

### ❌ DON'T Do This:
```typescript
// BAD: Hardcoded URL
const NSE_URL = 'https://www.nseindia.com/market-data/public-issues';
```

### ✅ DO This Instead:
```typescript
// GOOD: Reference URLs-Tracker.md
// See: docs/URLs-Tracker.md#nse-india-exchange-source
const NSE_URL = process.env.NSE_IPO_URL || 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo';
```

### When Reading Story Files

Story files (7.1, 7.2, etc.) may contain **outdated URLs** in examples and specifications. Always:

1. Check [URLs-Tracker.md](./URLs-Tracker.md) for current URLs
2. Verify URLs before implementation
3. Update your `.env` file with correct URLs from URLs-Tracker.md

---

## Affected Story Files

Story files containing URL references (non-exhaustive list):
- `7.1.nse-scraper.story.md` - NSE scraper
- `7.2.bse-scraper.story.md` - BSE scraper
- `7.10.historical-ipo-scraper.story.md` - Historical data
- `7.9.prospectus-documents-scraper.story.md` - Document scraper
- Plus ~40+ other story files

**Note:** These story files are kept as-is for historical reference. The URLs they mention may be outdated.

---

## Why This Change?

### Before (Problems):
- URLs hardcoded in 50+ files
- When URL changed, had to update dozens of files
- No verification status
- No central record of what's working
- Difficult to track URL changes over time

### After (Benefits):
- ✅ Update URL in ONE place
- ✅ All files reference that one source
- ✅ Verification status tracked
- ✅ Deprecated URLs documented
- ✅ Easy to maintain and audit

---

## How to Update URLs

If you discover a URL has changed:

1. **Test the new URL** using Playwright MCP (headed mode)
2. **Update [URLs-Tracker.md](./URLs-Tracker.md)**
   - Add new URL to active section
   - Move old URL to deprecated section
   - Update "Last Checked" timestamp
3. **Update environment variables** (`.env`, `.env.example`)
4. **Update scraper code** if needed
5. **Test scrapers** to ensure data flows correctly
6. **Commit with descriptive message**

Example commit:
```
fix(urls): Update NSE IPO URL

- Old: /market-data/public-issues
- New: /market-data/all-upcoming-issues-ipo
- Refs: URLs-Tracker.md
- Verified: 2025-10-13
```

---

## URL Investigation Results

For details on the recent URL investigation that led to this change:

**See:** [web/URL_INVESTIGATION_RESULTS.md](../web/URL_INVESTIGATION_RESULTS.md)

Key findings:
- Most "broken" URLs actually just changed paths
- Chittorgarh restructured from `/ipo-performance-tracker/` to `/ipo/ipo_perf_tracker.asp`
- NSE consolidated multiple IPO URLs into `/market-data/all-upcoming-issues-ipo`
- BSE simplified from `/markets/PublicIssues/IPOIssueTracker.aspx` to `/publicissue.html`
- GMP data moved from Chittorgarh to InvestorGain (sister site)

---

## Quick Reference

| Document | Purpose | URL |
|----------|---------|-----|
| **URLs-Tracker.md** | Central URL registry | [Link](./URLs-Tracker.md) |
| **PRD.md** | Product requirements | [Link](./PRD.md) (now references URLs-Tracker) |
| **URL_INVESTIGATION_RESULTS.md** | Investigation report | [Link](../web/URL_INVESTIGATION_RESULTS.md) |
| **SESSION_HANDOFF.md** | Testing session details | [Link](../web/SESSION_HANDOFF.md) |

---

## Questions?

If you're unsure about which URL to use:
1. Check [URLs-Tracker.md](./URLs-Tracker.md) FIRST
2. If URL not listed, manually verify using Playwright
3. Add verified URL to URLs-Tracker.md
4. Update this notice if needed

---

**Updated:** 2025-10-13
**Maintained by:** Development Team
**Status:** ACTIVE
