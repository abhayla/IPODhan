-- Item 7 S5 (spec §2.1 "Post-listing price", §2.3.3.3 delisting, OD-29, OD-38): the post-listing
-- price job counts consecutive no-such-symbol answers per IPO, records the IST date of the
-- third one with status DELISTED, and caches each stock's working NSE series. Additive: the
-- count defaults to 0 on every existing row (none has been read yet), delisted_on and
-- price_nse_series are NULL, and DELISTED is appended to ipo_status (ADD VALUE, the 0046
-- pattern; no row carries it until the job sets it).
--
-- HAND-WRITTEN for the same reason as 0051-0055 (#886: `db:generate` picks the wrong parent
-- snapshot by filename sort). meta/0056_snapshot.json is #969's 0055 snapshot plus these
-- columns and the enum value, parented on 0055's id (renumbered from 0055 after #969 merged).
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "price_no_symbol_reads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "delisted_on" date;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "price_nse_series" varchar(4);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ipo_status') THEN
    ALTER TYPE "ipo_status" ADD VALUE IF NOT EXISTS 'DELISTED';
  END IF;
END
$$;
