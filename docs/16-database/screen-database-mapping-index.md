# Database Field Mapping Documentation - Master Index

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 0 of 7 (Master Index)

---

## 📚 Overview

This directory contains comprehensive mapping documentation between UI screens, database schema, and scraper sources for the IPODhan platform.

### Document Organization

The original monolithic mapping document has been split into **7 focused documents** for better maintainability:

1. **[Core IPO Mapping](screen-database-mapping-core-ipo.md)** - `ipos` table and basic screens
2. **[Financials & Performance](screen-database-mapping-financials.md)** - Financial data and performance tracking
3. **[Subscription & GMP](screen-database-mapping-subscription-gmp.md)** - Time-series demand data
4. **[Content & Documents](screen-database-mapping-content.md)** - Documents and reviews
5. **[Utilities & Features](screen-database-mapping-utilities.md)** - Calendars, registrars, affiliates
6. **[Extended Features](screen-database-mapping-extended.md)** - Scoring, details, anchor investors
7. **[Scraper Priority Matrix](database-schema-scraper-mapping.md)** - DB fields to scraper sources

### Legacy Documentation

The original combined document is preserved for backward compatibility:
- **[Original Combined Document](screen-table-database-field-mapping.md)** (maintained, 1,634 lines)

---

## 🎯 Quick Reference

### By Role

**Frontend Developers:**
- Start with: [Core IPO Mapping](screen-database-mapping-core-ipo.md)
- UI components: [Financials](screen-database-mapping-financials.md), [Content](screen-database-mapping-content.md)
- Tools: [Utilities](screen-database-mapping-utilities.md)

**Backend Developers:**
- Start with: [Scraper Priority Matrix](database-schema-scraper-mapping.md)
- Data flow: [Subscription & GMP](screen-database-mapping-subscription-gmp.md)
- Extended features: [Extended Features](screen-database-mapping-extended.md)

**Product Managers:**
- Feature gaps: [Extended Features](screen-database-mapping-extended.md) (Gap Analysis section)
- Data completeness: [Scraper Priority Matrix](database-schema-scraper-mapping.md)

**Data Engineers:**
- Scraper design: [Scraper Priority Matrix](database-schema-scraper-mapping.md)
- Schema reference: `packages/shared/src/db/schema.ts`

---

## 📊 Database Schema Overview

### Core Tables (9 tables - User-Facing)

| Table | Fields | Documentation | UI Coverage |
|-------|--------|---------------|-------------|
| **ipos** | 54 fields | [Core IPO](screen-database-mapping-core-ipo.md) | 52% (28/54) |
| **financialData** | 28 fields | [Financials](screen-database-mapping-financials.md) | 43% (12/28) |
| **listingPerformance** | 14 fields | [Financials](screen-database-mapping-financials.md) | 71% (10/14) |
| **peerCompanies** | 13 fields | [Financials](screen-database-mapping-financials.md) | 100% ✅ |
| **subscriptions** | 16 fields | [Subscription & GMP](screen-database-mapping-subscription-gmp.md) | 56% (9/16) |
| **gmpRecords** | 9 fields | [Subscription & GMP](screen-database-mapping-subscription-gmp.md) | 67% (6/9) |
| **documents** | 13 fields | [Content](screen-database-mapping-content.md) | 69% (9/13) |
| **ipoReviews** | 14 fields | [Content](screen-database-mapping-content.md) | 79% (11/14) |
| **marketHolidays** | 8 fields | [Utilities](screen-database-mapping-utilities.md) | 100% ✅ |
| **registrars** | 11 fields | [Utilities](screen-database-mapping-utilities.md) | 73% (8/11) |

### Extended Tables (6 tables - Partially Mapped)

| Table | Fields | Documentation | Status |
|-------|--------|---------------|--------|
| **ipoDetails** | 28 fields | [Extended](screen-database-mapping-extended.md) | 20% mapped |
| **ipoFinancials** | 14 fields | [Extended](screen-database-mapping-extended.md) | Alternative (unused) |
| **ipoScores** | 11 fields | [Extended](screen-database-mapping-extended.md) | **0% - CRITICAL GAP** |
| **anchorInvestors** | 10 fields | [Extended](screen-database-mapping-extended.md) | **0% - Important** |
| **brokerAffiliates** | 8 fields | [Utilities](screen-database-mapping-utilities.md) | Database exists, UI hardcoded |
| **scraperLogs** | 9 fields | [Scraper Matrix](database-schema-scraper-mapping.md) | Admin-only ✅ |

### Admin/Internal Tables (5 tables - Correctly Unmapped)

| Table | Fields | Documentation | Purpose |
|-------|--------|---------------|---------|
| **fieldProtectionMetadata** | 11 fields | [Extended](screen-database-mapping-extended.md) | Manual data management |
| **adminSettings** | 5 fields | [Extended](screen-database-mapping-extended.md) | Configuration |
| **auditLogs** | 15 fields | [Extended](screen-database-mapping-extended.md) | Compliance tracking |
| **affiliateClicks** | 6 fields | [Extended](screen-database-mapping-extended.md) | Analytics |

**Total:** 20 tables, 280+ fields

---

## 🔍 Most Used Fields

Cross-document field usage statistics:

| Database Field | Table | Used in Screens | Documentation |
|---------------|-------|-----------------|---------------|
| `companyName` | ipos | 16+ screens | [Core IPO](screen-database-mapping-core-ipo.md) |
| `openDate` | ipos | 12 screens | [Core IPO](screen-database-mapping-core-ipo.md) |
| `closeDate` | ipos | 12 screens | [Core IPO](screen-database-mapping-core-ipo.md) |
| `status` | ipos | 13 screens | [Core IPO](screen-database-mapping-core-ipo.md) |
| `segment` | ipos | 10 screens | [Core IPO](screen-database-mapping-core-ipo.md) |
| `priceRangeMin/Max` | ipos | 8 screens | [Core IPO](screen-database-mapping-core-ipo.md) |
| `issueSize` | ipos | 10 screens | [Core IPO](screen-database-mapping-core-ipo.md) |
| `lotSize` | ipos | 6 screens | [Core IPO](screen-database-mapping-core-ipo.md) |

---

## 🌐 Scraper Source Priority

**Standard Priority Chain:** NSE(1) → BSE(2) → Moneycontrol(3) → Chittorgarh(4) → API_Fallback(5)

### Coverage by Source

| Scraper Source | Fields Covered | Reliability | Documentation |
|---------------|----------------|-------------|---------------|
| **NSE** | ~70 fields | 95%+ | [Scraper Matrix](database-schema-scraper-mapping.md) |
| **BSE** | ~65 fields | 90%+ | [Scraper Matrix](database-schema-scraper-mapping.md) |
| **Moneycontrol** | ~40 fields | 85%+ | [Scraper Matrix](database-schema-scraper-mapping.md) |
| **Chittorgarh** | GMP only (6 fields) | 80%+ | [Scraper Matrix](database-schema-scraper-mapping.md) |
| **API Fallback** | ~20 fields | Varies | [Scraper Matrix](database-schema-scraper-mapping.md) |
| **Manual Entry** | ~35 fields | 100% | [Scraper Matrix](database-schema-scraper-mapping.md) |

**Automation Coverage:**
- Fully Automated: 39% (~70 fields)
- Manual Entry: 19% (~35 fields)
- Calculated: 14% (~25 fields)
- Admin/Internal: 28% (~50 fields)

---

## 🚨 Critical Gaps & Priorities

### High Priority (User-Facing Features)

1. **IPO Scoring System** - `ipoScores` table (11 fields) completely unmapped
   - See: [Extended Features](screen-database-mapping-extended.md#ipo-scores)
   - Impact: AI-powered IPO quality scores hidden from users

2. **Anchor Investors** - `anchorInvestors` table (10 fields) unmapped
   - See: [Extended Features](screen-database-mapping-extended.md#anchor-investors)
   - Impact: Important institutional investment signals missing

3. **Enhanced Financial Metrics** - 16 fields in `financialData` unmapped
   - See: [Financials & Performance](screen-database-mapping-financials.md#gap-analysis)
   - Impact: Advanced ratios (ROCE, Current Ratio, etc.) not displayed

### Medium Priority (Data Quality)

4. **Stock Symbol & ISIN** - Critical identifiers not shown in UI
   - See: [Core IPO](screen-database-mapping-core-ipo.md#missing-fields)

5. **Extended Timeline Dates** - Refund/credit dates in `ipoDetails`
   - See: [Extended Features](screen-database-mapping-extended.md#ipo-details)

6. **Granular Subscription Data** - 7 additional subscription categories
   - See: [Subscription & GMP](screen-database-mapping-subscription-gmp.md#missing-fields)

### Infrastructure

7. **Broker Affiliates Migration** - Move from hardcoded to database-driven
   - See: [Utilities](screen-database-mapping-utilities.md#broker-affiliates)

---

## 📝 Field Naming Updates

**⚠️ IMPORTANT:** The canonical schema uses different field names than legacy documentation.

| Legacy Name | Current Schema Name | Migration |
|-------------|---------------------|-----------|
| `price_band_low/high` | `priceRangeMin/Max` | Migration 0008 |
| `gmp` | `gmpPrice` | Story 7.10 |
| `gmp_percentage` | `gmpPercentageHistorical` | Story 7.10 |
| `category` | `segment` + `offeringType` | Migration 0015 |
| `current_price` | `currentPriceBSE/NSE` | Migration 0013 |

**Schema Source:** `packages/shared/src/db/schema.ts` (canonical)
**Re-export:** `web/lib/db/index.ts` (for application imports)

---

## 🔗 Related Documentation

### Architecture Docs
- [Database Schema Management](SCHEMA_MANAGEMENT.md) - Schema workflow
- [Backend Architecture](../02-architecture/backend-architecture.md) - Repository patterns
- [Caching Strategy](../05-caching/CACHING_STRATEGY.md) - Redis caching

### Scraper Docs
- [Scraper Architecture](../../scraper/README.md) - Implementation guide
- [Scraping Strategy](../../scraper/docs/SCRAPING_STRATEGY.md) - NSE API discovery
- [Lot Size Data Quality](../../scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md) - Phase 3 fix

### Frontend Docs
- [Slug Generation](../../packages/shared/docs/SLUG_GENERATION.md) - Canonical utilities
- [Fuzzy Matching](../../web/docs/FUZZY_MATCHING.md) - Search fallback
- [IPO Compare Validation](../../web/docs/IPO_COMPARE_VALIDATION.md) - Dropdown validation

---

## 📧 Maintenance

### Document Ownership

| Document | Owner Team | Review Frequency |
|----------|-----------|------------------|
| Core IPO | Frontend Team | Monthly |
| Financials | FinTech Team | Monthly |
| Subscription & GMP | Data Team | Bi-weekly (during IPO season) |
| Content | Content Team | Quarterly |
| Utilities | Platform Team | Quarterly |
| Extended Features | Product Team | Monthly |
| Scraper Matrix | Data Engineering | Weekly |

### Update Protocol

1. **Schema Changes:** Update relevant split doc within 48 hours of migration
2. **New Fields:** Run `scripts/sync-schema-to-docs.ts` to detect gaps
3. **Coverage Metrics:** Recalculate monthly using `scripts/calculate-doc-coverage.ts`
4. **Link Validation:** Run `scripts/validate-doc-links.ts` on pre-commit

### Version History

- **v3.0 (2025-10-30):** Split into 7 domain-focused documents, added missing tables
- **v2.1 (2025-10-14):** Added gap analysis
- **v2.0 (2025-10-10):** Added peer comparison section
- **v1.0 (2025-09-15):** Initial comprehensive mapping

---

## 🎓 Getting Started

### New Developers

1. Read this index for overview
2. Review [Core IPO Mapping](screen-database-mapping-core-ipo.md) for fundamental structure
3. Check [Scraper Priority Matrix](database-schema-scraper-mapping.md) for data flow
4. Reference relevant domain docs as needed

### Contributing Updates

1. Check document ownership table above
2. Make changes in relevant split document
3. Update "Last Updated" metadata header
4. Run link validation script
5. Create PR with documentation label

---

**Questions?** See [SCHEMA_MANAGEMENT.md](SCHEMA_MANAGEMENT.md) or contact the Data Architecture team.
