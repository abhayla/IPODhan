CREATE TYPE "public"."review_recommendation" AS ENUM('May apply', 'Subscribe', 'Avoid', 'Not Recommended');--> statement-breakpoint
CREATE TABLE "ipo_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_title" varchar(500) NOT NULL,
	"author" varchar(255) NOT NULL,
	"recommendation" "review_recommendation" NOT NULL,
	"ipo_id" uuid NOT NULL,
	"published_date" timestamp NOT NULL,
	"year" integer NOT NULL,
	"category" "ipo_category" NOT NULL,
	"review_url" text,
	"review_content" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ipo_reviews" ADD CONSTRAINT "ipo_reviews_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_ipo_reviews_ipo_id" ON "ipo_reviews" USING btree ("ipo_id");--> statement-breakpoint
CREATE INDEX "idx_ipo_reviews_year" ON "ipo_reviews" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_ipo_reviews_category" ON "ipo_reviews" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_ipo_reviews_category_year_published" ON "ipo_reviews" USING btree ("category","year","published_date");