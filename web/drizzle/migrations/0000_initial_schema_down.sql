-- Rollback migration for 0000_initial_schema
-- Drop in reverse dependency order

-- Drop indexes
DROP INDEX IF EXISTS "idx_ipos_company_name_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_subscriptions_ipo_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_market_holidays_year";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_market_holidays_date";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ipos_slug";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ipos_status";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_gmp_records_ipo_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_broker_affiliates_active_order";--> statement-breakpoint

-- Drop tables (in reverse dependency order - child tables first)
DROP TABLE IF EXISTS "subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "peer_companies" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "listing_performance" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "gmp_records" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "financial_data" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "documents" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "ipos" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "registrars" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "market_holidays" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "broker_affiliates" CASCADE;--> statement-breakpoint

-- Drop enums
DROP TYPE IF EXISTS "ipo_status";--> statement-breakpoint
DROP TYPE IF EXISTS "ipo_category";--> statement-breakpoint
DROP TYPE IF EXISTS "holiday_type";--> statement-breakpoint
DROP TYPE IF EXISTS "financial_statement_type";--> statement-breakpoint
DROP TYPE IF EXISTS "exchange";--> statement-breakpoint
DROP TYPE IF EXISTS "document_type";--> statement-breakpoint

-- Drop extensions (only if not used by other schemas)
-- Note: These are commented out by default to avoid breaking other schemas
-- Uncomment only if you're sure no other schema uses these extensions
-- DROP EXTENSION IF EXISTS "uuid-ossp";--> statement-breakpoint
-- DROP EXTENSION IF EXISTS "pg_trgm";--> statement-breakpoint
