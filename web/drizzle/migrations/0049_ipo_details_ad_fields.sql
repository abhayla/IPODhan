-- W-88: four price-band-advertisement facts that had no column anywhere.
--
-- `bid_windows` is NOT folded into ipo_details.ipo_market_timings: that column
-- is varchar(50) and the NSE API scraper writes the exchange's trading-hours
-- string into it ("10:00 AM - 5:00 PM"). The per-investor-class bid submission
-- windows are a different fact and an eight-row list; storing them there would
-- both overflow the column and destroy the NSE value.
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "bid_windows" jsonb;
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "promoter_shares_held" bigint;
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "sebi_regulation_cited" varchar(32);
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "promoter_group_transactions_since_drhp" jsonb;
