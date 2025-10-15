ALTER TABLE "ipos" ADD COLUMN "symbol" varchar(20);--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "isin" varchar(12);--> statement-breakpoint
CREATE INDEX "idx_ipos_symbol" ON "ipos" USING btree ("symbol");