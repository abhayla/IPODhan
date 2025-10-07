CREATE TABLE "affiliate_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid,
	"broker" varchar(50) NOT NULL,
	"source" varchar(50) NOT NULL,
	"user_session" varchar(255),
	"clicked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_affiliate_clicks_broker" ON "affiliate_clicks" USING btree ("broker");--> statement-breakpoint
CREATE INDEX "idx_affiliate_clicks_clicked_at" ON "affiliate_clicks" USING btree ("clicked_at");--> statement-breakpoint
CREATE INDEX "idx_affiliate_clicks_ipo_id" ON "affiliate_clicks" USING btree ("ipo_id");