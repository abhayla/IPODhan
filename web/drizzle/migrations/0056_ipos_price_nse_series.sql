-- Item 7 S5 (spec §2.1 "Post-listing price", OD-29): the post-listing price job caches each
-- stock's working NSE trading series (EQ/BE/SM/ST), asked first so a run costs one call per
-- stock instead of 2-4. Additive: the column is NULL on every existing row until the job first
-- reads that stock.
--
-- HAND-WRITTEN for the same reason as 0051-0055 (#886: `db:generate` picks the wrong parent
-- snapshot by filename sort). meta/0056_snapshot.json is #969's 0055 snapshot plus this column.
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "price_nse_series" varchar(4);
