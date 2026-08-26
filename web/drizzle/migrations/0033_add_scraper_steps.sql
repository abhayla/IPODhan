-- T-340: post-scrape step ledger. Hand-authored (not `drizzle-kit generate`)
-- because the existing journal is blocked by a pre-existing, unrelated
-- `extraction_status` enum-rename prompt (documented in
-- .claude/rules/drizzle-migration-gated-ddl.md) that this change does not
-- touch — same convention as 0032_add_registrar_url_health.sql.
--
-- Deliberately a NEW table, not a reuse of `scraper_logs`: that table's
-- `source` column names a SCRAPE SOURCE (NSE/BSE/API_FALLBACK/...) and its
-- `status` enum (SUCCESS/FAILURE/PARTIAL) has no 'skipped' state, so a
-- post-scrape step (statusUpdate, registrarReresolve, ...) that is skipped
-- for a documented reason (e.g. ADMIN_API_TOKEN unset, outside a cadence
-- window) cannot be represented there without overloading `source` with
-- non-source values and losing the reason. See the T-340 PR body.
-- T-340 checker round-1 F1: the app-level type made reason optional for
-- every status, so a reasonless 'skipped'/'failed' row type-checked and
-- passed all tests. This CHECK is the second, DB-level layer of the same
-- guarantee (belt-and-suspenders with the TS discriminated union in
-- scraper/src/index.ts's StepResult) — free to add now because this
-- migration is not yet applied anywhere, impossible to add for free later.
CREATE TABLE IF NOT EXISTS "scraper_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scraper_steps_reason_required_unless_ok" CHECK ("status" = 'ok' OR "reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scraper_steps_created_at" ON "scraper_steps" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scraper_steps_step_created_at" ON "scraper_steps" USING btree ("step","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scraper_steps_cycle_id" ON "scraper_steps" USING btree ("cycle_id");
