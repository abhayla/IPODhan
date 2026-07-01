# GATED migrations — DO NOT auto-apply

These SQL files are **authored but intentionally UNAPPLIED** (GMP coverage revival,
Stage B / §GATE). They are **destructive or type-changing** prod DDL that requires
Abhay's explicit approval before running.

They live in this `_gated/` subdirectory **on purpose** so `drizzle-kit migrate`
(which applies files tracked in the journal `meta/_journal.json`) will NOT pick them
up. Apply them manually, in order, only after sign-off:

1. `B3_gmp_drop_orphans.sql` — drop orphan `gmp_history`, `gmp_tracking`, matview `gmp_current`.
2. `B4_gmp_unique_dedup.sql` — dedup then add `UNIQUE(ipo_id, timestamp, source)`.
3. `B2_gmp_int_to_numeric.sql` — widen `gmp`/`expected_listing_price`/`subject_rate`/`kostak_rate` int → numeric(10,2).

Additive (non-destructive) DDL, parked here only because db:generate is blocked:

4. `C1_listing_ohlc_add_columns.sql` — **ADDITIVE / SAFE**: add nullable
   `listing_open_price` / `listing_high_price` / `listing_low_price` /
   `listing_close_price` / `last_traded_price` (numeric(10,2)) to `listing_performance`.
   No data/type change. Independent of B2–B4. Owner sign-off for prod apply.
5. `C2_ipos_add_bse_scrip_code.sql` — **ADDITIVE / SAFE**: add nullable
   `bse_scrip_code` (varchar(20)) to `ipos`. Closes the SSOT drift where the deployed
   `listing-performance-update` scheduler job selects `ipos.bse_scrip_code` but prod lacks
   the column (query errors every run). **Apply before the next deploy.** Independent of B2–C1.

Apply each via the tunnel (`localhost:15432`) with a read-back after. Note: the drizzle
journal is currently out of sync (pre-existing `extraction_status` enum drift blocks a
clean `db:generate`), so these are hand-authored rather than generated — record the
forked numbering when they are eventually folded into the journal.
