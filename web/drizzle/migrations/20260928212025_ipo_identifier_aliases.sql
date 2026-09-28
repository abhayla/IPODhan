CREATE TYPE "public"."ipo_identifier_alias_kind" AS ENUM('CIN', 'ISIN', 'SYMBOL');--> statement-breakpoint
CREATE TABLE "ipo_identifier_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"kind" "ipo_identifier_alias_kind" NOT NULL,
	"value" varchar(64) NOT NULL,
	"replaced_at" timestamp DEFAULT now() NOT NULL,
	"replaced_by_admin_id" varchar(64),
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "ipo_identifier_aliases" ADD CONSTRAINT "ipo_identifier_aliases_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ipo_identifier_aliases_kind_value" ON "ipo_identifier_aliases" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "idx_ipo_identifier_aliases_ipo" ON "ipo_identifier_aliases" USING btree ("ipo_id");