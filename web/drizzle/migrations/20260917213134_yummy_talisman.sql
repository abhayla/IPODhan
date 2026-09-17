CREATE TABLE "field_source_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" varchar(64) NOT NULL,
	"field_name" varchar(64) NOT NULL,
	"ipo_id" uuid,
	"rank1_source" varchar(32) NOT NULL,
	"rank2_source" varchar(32),
	"rank3_source" varchar(32),
	"reason" text NOT NULL,
	"set_by" varchar(64) NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"expired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "field_source_overrides" ADD CONSTRAINT "field_source_overrides_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fso_active" ON "field_source_overrides" USING btree ("table_name","field_name","ipo_id","expires_at");