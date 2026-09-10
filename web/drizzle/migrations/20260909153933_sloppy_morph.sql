ALTER TABLE "ipo_intermediaries" ADD COLUMN "normalized_name" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "peer_companies" ADD COLUMN "normalized_name" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "promoters" ADD COLUMN "normalized_name" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_ipo_intermediaries_ipo_id_normalized_name" ON "ipo_intermediaries" USING btree ("ipo_id","normalized_name");--> statement-breakpoint
CREATE INDEX "idx_peer_companies_ipo_id_normalized_name" ON "peer_companies" USING btree ("ipo_id","normalized_name");--> statement-breakpoint
CREATE INDEX "idx_promoters_ipo_id_normalized_name" ON "promoters" USING btree ("ipo_id","normalized_name");