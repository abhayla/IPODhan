-- C3: Widen listing_performance price + gain columns (#79)
-- Branch: feat/ipo-data-correctness-audit
--
-- TYPE-CHANGING (widening only) — owner-applied via the tunnel (localhost:15432)
-- with a read-back, per drizzle-migration-gated-ddl.md. Parked in _gated/ (OUT of
-- meta/_journal.json) so drizzle-kit migrate never auto-runs it.
--
-- WHY: the #70 stuck-listing backfill failed 36/42 listing_performance upserts:
--   1. current_gain_percent / listing_gain_percent numeric(5,2) (±999.99) overflow —
--      current_gain (price vs issue, years post-listing) is unbounded; older IPOs up
--      >1000% since listing overflow the cap. Widen to numeric(7,2) (±99999.99).
--   2. listing_price / issue_price / current_price / current_price_bse / current_price_nse
--      are integer but Chittorgarh sends decimal rupee prices (e.g. ₹145.78) →
--      "invalid input syntax for type integer". Widen to numeric(10,2)
--      (financial-column-precision.md). USING casts existing integer rows losslessly.
--
-- Widening only: no data loss, no drop. Every existing integer value fits numeric(10,2)
-- and every existing gain in ±999.99 fits ±99999.99.
--
-- After applying, re-run backfill:stuck-listing --execute (or the vps-backfill job) to
-- fill the 52 orphan LISTED IPOs, then read back listing_performance count.

ALTER TABLE listing_performance
  ALTER COLUMN listing_price        TYPE numeric(10,2) USING listing_price::numeric(10,2),
  ALTER COLUMN issue_price          TYPE numeric(10,2) USING issue_price::numeric(10,2),
  ALTER COLUMN current_price        TYPE numeric(10,2) USING current_price::numeric(10,2),
  ALTER COLUMN current_price_bse    TYPE numeric(10,2) USING current_price_bse::numeric(10,2),
  ALTER COLUMN current_price_nse    TYPE numeric(10,2) USING current_price_nse::numeric(10,2),
  ALTER COLUMN listing_gain_percent TYPE numeric(7,2)  USING listing_gain_percent::numeric(7,2),
  ALTER COLUMN current_gain_percent TYPE numeric(7,2)  USING current_gain_percent::numeric(7,2);

-- Read-back (run after applying):
--   \d listing_performance
--   SELECT count(*) FROM listing_performance;  -- expect 97 → ~149 after the orphan backfill
