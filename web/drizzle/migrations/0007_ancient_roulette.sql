-- Create new enums for IPO scoring system
DO $$ BEGIN
 CREATE TYPE "public"."confidence_level" AS ENUM('HIGH', 'MEDIUM', 'LOW');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."ipo_verdict" AS ENUM('APPLY', 'CONSIDER', 'SKIP');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Create ipo_scores table
CREATE TABLE IF NOT EXISTS "ipo_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"total_score" integer NOT NULL,
	"fundamental_score" integer NOT NULL,
	"sentiment_score" integer NOT NULL,
	"subscription_score" integer NOT NULL,
	"sector_score" integer NOT NULL,
	"verdict" "ipo_verdict" NOT NULL,
	"confidence" "confidence_level" NOT NULL,
	"reasoning" text,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	"algorithm_version" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ipo_scores_ipo_id_unique" UNIQUE("ipo_id")
);
--> statement-breakpoint

-- Add foreign key constraint
DO $$ BEGIN
 ALTER TABLE "ipo_scores" ADD CONSTRAINT "ipo_scores_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;