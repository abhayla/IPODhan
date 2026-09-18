DROP INDEX "idx_ipo_field_plan_verify_due";--> statement-breakpoint
ALTER TABLE "field_sources" ADD COLUMN "witnesses" jsonb;--> statement-breakpoint
ALTER TABLE "field_sources" ADD COLUMN "verdict" varchar(16);--> statement-breakpoint
ALTER TABLE "ipo_field_plan" DROP COLUMN "verify_due_at";--> statement-breakpoint
ALTER TABLE "ipo_field_plan" DROP COLUMN "verify_state";--> statement-breakpoint
ALTER TABLE "ipo_field_plan" DROP COLUMN "verify_source";--> statement-breakpoint
ALTER TABLE "ipo_field_plan" DROP COLUMN "verify_value";--> statement-breakpoint
ALTER TABLE "ipo_field_plan" DROP COLUMN "disagreement_count";