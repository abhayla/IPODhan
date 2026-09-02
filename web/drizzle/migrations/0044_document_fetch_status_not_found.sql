-- W-46 — add NOT_FOUND to document_fetch_status enum.
--
-- Context: commit fab553de made document-state-machine.ts produce a
-- NOT_FOUND state, but document_fetch_status lacked it, so the runner
-- persisted NOT_FOUND as WANTED (NOT_FOUND_PERSISTED_AS aliasing in
-- toPersistedState) with the true state kept only in
-- last_attempt.state_intent. This migration adds the missing enum value so
-- the runner can persist NOT_FOUND directly.
--
-- Additive only: 1 new enum value, nothing dropped or retyped. Hand-written
-- the same way 0043 was: the drizzle snapshot chain in meta/ stops at 0013,
-- so `drizzle-kit generate` cannot diff incrementally here.
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent on its own — a re-run
-- is a no-op when the value already exists.

ALTER TYPE "document_fetch_status" ADD VALUE IF NOT EXISTS 'NOT_FOUND' AFTER 'NOT_YET_FILED';
