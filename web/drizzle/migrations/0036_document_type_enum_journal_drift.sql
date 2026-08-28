-- T-403 M-2: the `document_type` enum values the journal never created.
--
-- WHY THIS IS A JOURNALED MIGRATION AND NOT A `_repair/` FILE. Round 2 put these
-- in `_repair/`, which is applied BY HAND. Nothing in the deploy runs `_repair/`
-- — `scripts/deploy-linux.sh` runs `drizzle-kit migrate` and nothing else — so
-- on any database built from the journal the scraper would hit
--
--     invalid input value for enum document_type: "RATIOS_BASIS_ISSUE_PRICE"
--
-- at PRE_OPEN, and `runIpo`'s non-fatal catch would swallow it: the IPO would
-- silently get no documents, every cycle, with nothing failing. A repair nobody
-- applies is not a repair.
--
-- These eight values are `ADD VALUE IF NOT EXISTS` — append-only, no table
-- rewrite, no data touched, idempotent — so they are non-destructive and belong
-- in the journal rather than behind the `_gated/` sign-off
-- (.claude/rules/drizzle-migration-gated-ddl.md).
--
-- They are kept OUT of 0035 deliberately: 0035 owns T-403's own three values,
-- these eight are older drift that predates this task.
--
-- ROLLBACK: none needed and none possible — Postgres cannot drop an enum value,
-- which is exactly why this only ever appends.

ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'BASIS_OF_ALLOTMENT';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'RATIOS_BASIS_ISSUE_PRICE';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'BIDDING_CENTERS';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SAMPLE_APPLICATION_FORMS';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SECURITY_PARAMS_PRE_ANCHOR';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SECURITY_PARAMS_POST_ANCHOR';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'ANCHOR_ALLOCATION_REPORT';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'ASBA_PROCESSING_CIRCULAR';
