-- T-300: registrar allotment-URL health tracking, written by the standing
-- daily health-check job (see scraper/src/scheduler/jobs/registrar-health-check-job.ts).
-- Purely additive/non-destructive: two nullable-default columns on `registrars`.
-- Hand-authored (not `drizzle-kit generate`) because the existing journal is
-- blocked by a pre-existing, unrelated `extraction_status` enum-rename prompt
-- (documented in .claude/rules/drizzle-migration-gated-ddl.md) that this
-- change does not touch.
ALTER TABLE "registrars" ADD COLUMN IF NOT EXISTS "allotment_url_healthy" boolean DEFAULT true NOT NULL;
ALTER TABLE "registrars" ADD COLUMN IF NOT EXISTS "allotment_url_checked_at" timestamp;
