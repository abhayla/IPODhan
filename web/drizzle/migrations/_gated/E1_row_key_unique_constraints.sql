-- ============================================================================
-- GATED / UNAPPLIED — Item 1 slice s2 (pull-model implementation loop):
-- row-key uniqueness on promoters, peer_companies and ipo_intermediaries.
-- DO NOT run without Abhay's approval (§GATE) and DO NOT add this file to
-- meta/_journal.json — see this directory's README for why.
--
-- APPLY ORDER (per slot, never skip a step):
--   1. The `normalized_name` column already exists on all three tables
--      (journaled migration 20260909153933_sloppy_morph, item 1 slice s1),
--      NOT NULL DEFAULT '' — so applying it never fails, but every
--      pre-existing row gets '' until backfilled.
--   2. Run `scraper/scripts/backfill-normalized-name.ts` against the slot
--      (dry-run first, then --apply) until it reports 0 rows still at ''.
--      Verify with:
--        SELECT count(*) FROM promoters          WHERE normalized_name = '';
--        SELECT count(*) FROM peer_companies      WHERE normalized_name = '';
--        SELECT count(*) FROM ipo_intermediaries  WHERE normalized_name = '';
--      All three MUST read 0 before step 3.
--   3. Apply this file.
--
-- Applying this file BEFORE step 2 completes on a given slot fails immediately:
-- every pre-existing row on that table shares '' as normalized_name (27 on
-- promoters, 326 on peer_companies, 178 on ipo_intermediaries in prod today),
-- so the very first UNIQUE ADD CONSTRAINT hits a duplicate-key violation on
-- row two and the migration — and the deploy — dies mid-flight. This is the
-- exact hazard the column-then-backfill-then-constraint order exists to avoid.
--
-- WHY THREE DIFFERENT KEYS, NOT ONE (measured on staging after the s1
-- backfill, 528 rows populated, 0 empty):
--   - promoters:          UNIQUE (ipo_id, normalized_name)              -- 0 collisions
--   - peer_companies:     UNIQUE (ipo_id, normalized_name)              -- 0 collisions
--   - ipo_intermediaries: UNIQUE (ipo_id, role, normalized_name)        -- 5 collisions
--     on the 2-column (ipo_id, normalized_name) key, 0 on this 3-column key.
--     All 5 are the SAME legal entity correctly holding TWO ROLES for one
--     IPO (ICICI Bank as SPONSOR_BANK + PUBLIC_ISSUE_BANK; Kotak Mahindra
--     Bank as SPONSOR_BANK + ESCROW_BANK; Axis Bank as SPONSOR_BANK +
--     PUBLIC_ISSUE_BANK; Centrum Broking as BRLM + SYNDICATE). A 2-column
--     key on this table would reject correct data and a "merge" repair
--     would delete the fact that one intermediary holds two roles.
--
-- WHY DROP DEFAULT IS BUNDLED HERE, NOT IN THE JOURNAL:
-- The `''` default is what makes `normalizedName` OPTIONAL in Drizzle's
-- Insert type — a caller can omit it and silently write a blank identity
-- key. Dropping it closes that gap. It is NOT gated because it depends on
-- the backfill (it does not touch existing rows; it only changes the
-- contract for FUTURE inserts) — it is gated because, unlike the UNIQUE
-- constraint (which only fires on a genuine duplicate — rare), dropping
-- the default fires on the FIRST write from any insert path that still
-- omits normalized_name, unconditionally. Today's write paths already cover
-- this: packages/shared/src/repositories/promoters-repository.ts and
-- ipo-intermediaries-repository.ts require it as a mandatory field in their
-- narrowed insert types; web/lib/repositories/peer-company-repository.ts
-- takes a different route to the same guarantee — its `PeerCompanyInsert`
-- does NOT include normalizedName at all, and `create()` computes it from
-- `companyName` via `rowKeyForName`, throwing `InvalidDataError` when the
-- name has no identity, so a caller can never reach the insert without one.
-- So the DB dropping its own fallback should be a no-op in practice — but
-- a silent journal entry running unattended
-- on every deploy is the wrong place to find out an uncovered call site
-- exists. Applied together with the constraint, under the same manual
-- sign-off, so both classes of failure (duplicate key, missing key) surface
-- at one reviewed moment instead of on an ordinary unattended deploy.
-- ============================================================================

ALTER TABLE "ipo_intermediaries" ADD CONSTRAINT "unique_ipo_intermediaries_ipo_id_role_normalized_name" UNIQUE("ipo_id","role","normalized_name");
ALTER TABLE "peer_companies" ADD CONSTRAINT "unique_peer_companies_ipo_id_normalized_name" UNIQUE("ipo_id","normalized_name");
ALTER TABLE "promoters" ADD CONSTRAINT "unique_promoters_ipo_id_normalized_name" UNIQUE("ipo_id","normalized_name");

ALTER TABLE "ipo_intermediaries" ALTER COLUMN "normalized_name" DROP DEFAULT;
ALTER TABLE "peer_companies" ALTER COLUMN "normalized_name" DROP DEFAULT;
ALTER TABLE "promoters" ALTER COLUMN "normalized_name" DROP DEFAULT;
