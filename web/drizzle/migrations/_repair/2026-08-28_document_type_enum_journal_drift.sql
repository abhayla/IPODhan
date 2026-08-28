-- T-403 round 2: restore the `document_type` enum values the JOURNAL never creates.
--
-- FOUND BY: building a database from nothing but `drizzle-kit migrate` (the
-- exact thing `scripts/deploy-linux.sh` does) and then running the T-403
-- acceptance harness against it. The first write failed with
--
--     invalid input value for enum document_type: "RATIOS_BASIS_ISSUE_PRICE"
--
-- because eight values declared in `packages/shared/src/db/schema.ts` are in NO
-- journaled migration:
--
--     BASIS_OF_ALLOTMENT, RATIOS_BASIS_ISSUE_PRICE, BIDDING_CENTERS,
--     SAMPLE_APPLICATION_FORMS, SECURITY_PARAMS_PRE_ANCHOR,
--     SECURITY_PARAMS_POST_ANCHOR, ANCHOR_ALLOCATION_REPORT,
--     ASBA_PROCESSING_CIRCULAR
--
-- Production has them (it was built from dumps and earlier direct applies), so
-- nothing is broken today. What IS broken is the claim that the journal can
-- rebuild the schema: it cannot, and any environment built from it — a fresh
-- staging box, a CI database, a disaster recovery — would reject every NSE
-- document type the scraper writes.
--
-- This is `_repair/`, not a journaled migration, per
-- .claude/rules/drizzle-migration-gated-ddl.md Part D: idempotent,
-- non-destructive, safe to re-run, applied directly. It is deliberately NOT
-- folded into 0035 — those three values belong to T-403; these eight are older
-- drift and pre-date it.
--
-- SCOPE: this file repairs the enum only. The same measurement found wider drift
-- (about 20 `ipos` columns and 11 `documents` columns that no migration creates,
-- and an `ipos.category` column the schema replaced with
-- `segment`/`offering_type`) — recorded in evidence/T-403/journal-schema-drift.json
-- and NOT fixed here. Repairing that is a schema-ownership decision for the
-- owner, not something to slip into a document-discovery task.
--
-- SAFETY: `ADD VALUE IF NOT EXISTS` appends to the enum. No table is rewritten,
-- no row is touched, no value is removed or reordered. Re-running is a no-op.
-- ROLLBACK: none needed — nothing is destroyed. (Postgres cannot drop an enum
-- value, which is another reason this only ever appends.)

ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'BASIS_OF_ALLOTMENT';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'RATIOS_BASIS_ISSUE_PRICE';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'BIDDING_CENTERS';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SAMPLE_APPLICATION_FORMS';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SECURITY_PARAMS_PRE_ANCHOR';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SECURITY_PARAMS_POST_ANCHOR';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'ANCHOR_ALLOCATION_REPORT';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'ASBA_PROCESSING_CIRCULAR';
