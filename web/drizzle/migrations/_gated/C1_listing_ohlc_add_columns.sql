-- C1: Listing-day OHLC columns on listing_performance
-- Branch: feat/listing-ohlc-and-bid-tiers
--
-- ADDITIVE / NON-DESTRUCTIVE: nullable ADD COLUMN only. No data change, no type change,
-- no drop. Safe to apply; parked here only because db:generate is blocked by the
-- pre-existing journal drift (see README) — hand-authored, owner-applied.
--
-- numeric(10,2) (not integer) preserves paise, per the financial-column-precision rule.

ALTER TABLE listing_performance
  ADD COLUMN IF NOT EXISTS listing_open_price  numeric(10,2),
  ADD COLUMN IF NOT EXISTS listing_high_price  numeric(10,2),
  ADD COLUMN IF NOT EXISTS listing_low_price   numeric(10,2),
  ADD COLUMN IF NOT EXISTS listing_close_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS last_traded_price   numeric(10,2);
