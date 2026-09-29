ALTER TABLE "ipos" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "hidden_by" varchar(100);--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "hidden_by_admin_id" uuid;