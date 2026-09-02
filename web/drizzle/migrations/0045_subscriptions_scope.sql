-- W-03 — add `scope` to `subscriptions` (BSE_ONLY | NSE_ONLY | CONSOLIDATED).
--
-- Context: subscriptions rows from BSE (own book) and NSE (consolidated
-- across exchanges) were stored under one shape with no scope label — the
-- NSE payload carries `coverage: 'CONSOLIDATED'`, BSE carries none. Spec 4.3
-- adds an explicit scope column so a consumer can tell a whole-market figure
-- from a single-exchange one.
--
-- Additive only: 1 new enum, 1 new nullable column. Nothing dropped or
-- retyped; old rows keep scope = NULL (they predate this label).
--
-- Hand-written the same way 0043/0044 were: the drizzle snapshot chain in
-- meta/ stops at 0013, so `drizzle-kit generate` cannot diff incrementally
-- here. Every statement is wrapped idempotent (duplicate_object /
-- IF NOT EXISTS) per drizzle-migration-gated-ddl.md so replaying this file
-- is a no-op where the objects already exist.
--
-- Enum-name collision check (T-403 round-2 lesson): `subscription_scope`
-- matches no existing enum name and no table name (existing or new).

DO $$ BEGIN
  CREATE TYPE "subscription_scope" AS ENUM ('BSE_ONLY', 'NSE_ONLY', 'CONSOLIDATED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "scope" "subscription_scope";
