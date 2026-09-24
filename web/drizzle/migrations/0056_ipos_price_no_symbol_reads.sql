-- Item 7 S5 (spec §2.1 "Post-listing price", §2.3.3.3 delisting, OD-29, OD-38): the post-listing
-- price job counts consecutive no-such-symbol answers per IPO and records the IST date of the
-- third one. Additive: the count defaults to 0 on every existing row (none has been read yet),
-- and delisted_on is NULL (nothing has been judged delisted).
--
-- HAND-WRITTEN for the same reason as 0051-0055 (#886: `db:generate` picks the wrong parent
-- snapshot by filename sort). meta/0056_snapshot.json is #969's 0055 snapshot plus these two
-- columns, parented on 0055's id (renumbered from 0055 after #969 merged).
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "price_no_symbol_reads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "delisted_on" date;
