ALTER TYPE "public"."ipo_status" ADD VALUE 'DELISTED';--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "delisting_strikes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "delisting_strike_reads" jsonb;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "delisted_at" timestamp;