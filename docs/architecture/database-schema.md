# Database Schema

The following PostgreSQL schema implements the data models defined earlier.

## Key Tables

- **ipos** - Core IPO entity with company information, issue details, timeline
- **subscriptions** - Category-wise subscription data snapshots
- **gmp_records** - Grey Market Premium historical tracking
- **financial_data** - Company financial metrics (one-to-one with ipos)
- **documents** - DRHP, RHP, prospectus documents
- **listing_performance** - Post-listing performance metrics
- **email_subscribers** - Email alert subscriptions (Phase 2)

## Important Indexes

- `idx_ipos_status` - Filter by IPO status
- `idx_ipos_slug` - Lookup by slug (unique)
- `idx_ipos_company_name_trgm` - Full-text fuzzy search
- `idx_subscriptions_ipo_timestamp` - Latest subscription queries
- `idx_gmp_records_ipo_timestamp` - GMP history queries

## Full Schema

See complete SQL DDL in the Database Schema section above (includes CREATE TABLE statements, indexes, constraints, triggers, and extensions).

---
