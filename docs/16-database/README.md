# 16. Database Documentation

**Purpose**: Centralized documentation for all database-related architecture, schema management, and field mappings.

**Last Updated**: October 18, 2025

---

## 📚 Documentation Index

### Core Documentation

1. **[SCHEMA_MANAGEMENT.md](./SCHEMA_MANAGEMENT.md)** ⭐ **CRITICAL**
   - **Purpose**: Single source of truth workflow for database schema changes
   - **When to Read**: Before making ANY database schema changes
   - **Key Topics**:
     - Schema → Migration → Database workflow
     - Anti-patterns to avoid
     - Migration best practices
     - Schema drift incident log
     - Developer checklist

2. **[screen-table-database-field-mapping.md](./screen-table-database-field-mapping.md)** ⭐ **REFERENCE**
   - **Purpose**: Comprehensive mapping of UI screens to database tables
   - **Size**: 1,600+ lines
   - **When to Read**: When implementing new features or understanding data flow
   - **Key Topics**:
     - 32 screens mapped to database tables
     - Field-by-field mapping
     - Data source priority (NSE → BSE → Moneycontrol → API)
     - Gap analysis (120+ unmapped database fields)

3. **[database-schema.md](./database-schema.md)**
   - **Purpose**: High-level database schema architecture
   - **When to Read**: Understanding overall database structure
   - **Key Topics**:
     - 13 core tables
     - Relationships and foreign keys
     - Indexes and constraints
     - Data types and validations

### Session Reports & Incident Documentation

4. **[session-2025-10-18-schema-management-improvements.md](./session-2025-10-18-schema-management-improvements.md)**
   - **Date**: October 18, 2025
   - **Topic**: Schema drift incident and resolution
   - **Impact**: NSE scraper failure → 100% success after fix
   - **Key Learnings**:
     - Root cause: `listing_performance` table missing 6 columns
     - Resolution: Schema synchronization + workflow establishment
     - Prevention: Created SCHEMA_MANAGEMENT.md guide

5. **[NSE_API_UPDATE_SUMMARY.md](./NSE_API_UPDATE_SUMMARY.md)**
   - **Date**: October 18, 2025
   - **Topic**: NSE API endpoint validation for Stories 11.3 & 11.4
   - **Key Topics**:
     - Working endpoints vs deprecated endpoints
     - Test results (1,268 historical IPOs)
     - Authentication strategy
     - Recommendations for developers

### SQL Fixes & Migrations

6. **[fix-listing-performance-schema.sql](./fix-listing-performance-schema.sql)**
   - **Date**: October 18, 2025
   - **Purpose**: Manual schema fix for `listing_performance` table
   - **Context**: Added 6 missing columns to resolve scraper failure
   - **Note**: Now documented in migration `0013_fix_listing_performance_schema.sql`

---

## 🔍 Quick Reference

### When to Use Each Document

| Scenario | Document to Read |
|----------|------------------|
| Making schema changes | `SCHEMA_MANAGEMENT.md` |
| Implementing new UI feature | `screen-table-database-field-mapping.md` |
| Understanding database structure | `database-schema.md` |
| Debugging scraper issues | `NSE_API_UPDATE_SUMMARY.md` |
| Understanding past incidents | Session reports |

---

## 🎯 Database Architecture Summary

### Core Tables (13 total)

```
1. ipos                     - Core IPO entity (50+ fields)
2. subscriptions            - Time-series subscription data
3. gmp_records              - Grey Market Premium tracking
4. financial_data           - Financial metrics (P/E, ROE, etc.)
5. documents                - IPO documents (DRHP, RHP, etc.)
6. listing_performance      - Listing day performance
7. market_holidays          - Trading calendar
8. registrars               - Registrar information
9. peer_companies           - Peer comparison data
10. broker_affiliates       - Affiliate links
11. affiliate_clicks        - Click tracking
12. scraper_logs            - Scraper monitoring
13. ipo_reviews             - Analyst reviews
```

### Relationships

```
ipos (1) → (Many) subscriptions
ipos (1) → (Many) gmp_records
ipos (1) → (1) financial_data
ipos (1) → (Many) documents
ipos (1) → (1) listing_performance
ipos (1) → (Many) peer_companies
ipos (Many) → (1) registrars
```

---

## 🔄 Schema Management Workflow

**⚠️ CRITICAL**: Always follow this workflow when making database changes:

```bash
# 1. Edit Drizzle schema (SINGLE SOURCE OF TRUTH)
vim packages/shared/src/db/schema.ts

# 2. Rebuild shared package
cd packages/shared && npm run build

# 3. Generate migration
cd ../web && npm run db:generate

# 4. Review generated SQL
cat web/drizzle/migrations/00XX_*.sql

# 5. Apply migration
npm run db:migrate

# 6. Verify changes
npm run db:studio
```

**Read More**: See `SCHEMA_MANAGEMENT.md` for complete details.

---

## 📊 Data Flow Architecture

```
┌─────────────────────────────────────┐
│ External Data Sources               │
│ (NSE, BSE, Moneycontrol, etc.)      │
└───────────────┬─────────────────────┘
                │
                │ Scrapers
                ↓
┌─────────────────────────────────────┐
│ PostgreSQL Database                 │
│ (13 tables, 200+ fields)            │
└───────────────┬─────────────────────┘
                │
                │ Drizzle ORM
                ↓
┌─────────────────────────────────────┐
│ Repositories (with Redis caching)   │
└───────────────┬─────────────────────┘
                │
                │ Services
                ↓
┌─────────────────────────────────────┐
│ API Routes → Next.js UI             │
└─────────────────────────────────────┘
```

---

## 🚨 Important Reminders

### DO's ✅

- ✅ Always update schema through Drizzle first
- ✅ Generate migrations for all schema changes
- ✅ Review generated SQL before applying
- ✅ Test migrations on local database first
- ✅ Commit both schema AND migration files together
- ✅ Document breaking changes in migration comments

### DON'Ts ❌

- ❌ **NEVER** manually `ALTER TABLE` in database
- ❌ **NEVER** edit schema without generating migration
- ❌ **NEVER** push code without applying migrations
- ❌ **NEVER** edit production database directly
- ❌ **NEVER** skip migration review

---

## 📖 Related Documentation

### Project Root
- `CLAUDE.md` - Project instructions for AI assistants
  - References: SCHEMA_MANAGEMENT.md, screen-table-database-field-mapping.md

### Migrations
- `web/drizzle/migrations/` - All database migrations
  - Migration `0013_fix_listing_performance_schema.sql` documented here

### Stories
- `docs/04-stories/11.2.database-schema-fixes-scraper-reliability.md` - Story 11.2
- `docs/04-stories/11.3.nse-subscription-data-fix.md` - Story 11.3
- `docs/04-stories/11.4.historical-ipo-backfill.md` - Story 11.4

---

## 🔧 Database Tools

### Drizzle Kit Commands

```bash
# Generate migration from schema changes
npm run db:generate

# Apply pending migrations
npm run db:migrate

# Push schema directly (development only)
npm run db:push

# Open Drizzle Studio GUI
npm run db:studio

# Verify seed data integrity
npm run verify:seed
```

### Verification Scripts

```bash
# Check table structure
node check-db-tables.mjs

# Test direct queries
node test-direct-query.mjs

# Find database references
grep -r "database" docs/
```

---

## 📝 Maintenance Log

| Date | Action | Document Updated |
|------|--------|------------------|
| 2025-10-18 | Created 16-database folder | This README |
| 2025-10-18 | Moved 6 database docs to centralized location | All references updated |
| 2025-10-18 | Fixed schema drift incident | session-2025-10-18-schema-management-improvements.md |
| 2025-10-18 | Documented NSE API validation | NSE_API_UPDATE_SUMMARY.md |
| 2025-10-18 | Created schema management guide | SCHEMA_MANAGEMENT.md |

---

## 🎓 For New Developers

If you're new to the IPODhan database architecture, read in this order:

1. **This README** (you are here) - Overview and navigation
2. **database-schema.md** - Understand the 13 core tables
3. **screen-table-database-field-mapping.md** - See how UI maps to database
4. **SCHEMA_MANAGEMENT.md** - Learn how to make schema changes safely

---

## 💡 Quick Tips

- 📌 Bookmark this README for quick access to all database docs
- 🔍 Use Ctrl+F to search within large documents
- 📊 Drizzle Studio (`npm run db:studio`) is your friend for visual inspection
- 🚀 When in doubt, check `SCHEMA_MANAGEMENT.md` first
- 🐛 For scraper issues, check session reports for similar incidents

---

**Last Updated**: October 18, 2025
**Maintained By**: Development Team
**Questions?** Check `SCHEMA_MANAGEMENT.md` FAQ section or consult session reports for similar issues.
