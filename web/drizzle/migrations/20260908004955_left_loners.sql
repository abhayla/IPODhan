ALTER TABLE "anchor_investors" ALTER COLUMN "total_amount_raised" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ipo_details" ALTER COLUMN "fresh_issue" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ipo_details" ALTER COLUMN "ofs_issue" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ipo_details" ALTER COLUMN "min_investment" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ipo_details" ALTER COLUMN "max_retail_subscription" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ipo_details" ALTER COLUMN "max_employee_subscription" SET DATA TYPE numeric(18, 2);--> statement-breakpoint
ALTER TABLE "ipos" ALTER COLUMN "issue_size" SET DATA TYPE numeric(18, 2);
