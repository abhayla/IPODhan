-- Story 11.12: Enhanced Financial Metrics (EBITDA Multi-Period) - 10 fields
ALTER TABLE "financial_data" ADD COLUMN "ebitda_fy2022" numeric(12, 2);
ALTER TABLE "financial_data" ADD COLUMN "ebitda_fy2023" numeric(12, 2);
ALTER TABLE "financial_data" ADD COLUMN "ebitda_fy2024" numeric(12, 2);
ALTER TABLE "financial_data" ADD COLUMN "total_income_fy2022" numeric(12, 2);
ALTER TABLE "financial_data" ADD COLUMN "total_income_fy2023" numeric(12, 2);
ALTER TABLE "financial_data" ADD COLUMN "total_income_fy2024" numeric(12, 2);
ALTER TABLE "financial_data" ADD COLUMN "total_borrowings" numeric(12, 2);
ALTER TABLE "financial_data" ADD COLUMN "current_ratio" numeric(5, 2);
ALTER TABLE "financial_data" ADD COLUMN "quick_ratio" numeric(5, 2);
ALTER TABLE "financial_data" ADD COLUMN "inventory_turnover" numeric(5, 2);

-- Story 11.13: IPO Objectives Section - 1 field
ALTER TABLE "ipos" ADD COLUMN "objectives" jsonb;

-- Story 11.14: Company Contact Section - 9 fields
ALTER TABLE "ipo_details" ADD COLUMN "company_address" text;
ALTER TABLE "ipo_details" ADD COLUMN "company_phone" varchar(50);
ALTER TABLE "ipo_details" ADD COLUMN "company_email" varchar(255);
ALTER TABLE "ipo_details" ADD COLUMN "company_city" varchar(100);
ALTER TABLE "ipo_details" ADD COLUMN "company_state" varchar(100);
ALTER TABLE "ipo_details" ADD COLUMN "company_pincode" varchar(10);
ALTER TABLE "ipo_details" ADD COLUMN "compliance_officer" varchar(255);
ALTER TABLE "ipo_details" ADD COLUMN "compliance_officer_phone" varchar(50);
ALTER TABLE "ipo_details" ADD COLUMN "compliance_officer_email" varchar(255);

-- Story 11.15: Category Reservation Display - 6 fields
ALTER TABLE "ipo_details" ADD COLUMN "qib_shares_offered" bigint;
ALTER TABLE "ipo_details" ADD COLUMN "nii_shares_offered" bigint;
ALTER TABLE "ipo_details" ADD COLUMN "retail_shares_offered" bigint;
ALTER TABLE "ipo_details" ADD COLUMN "retail_max_allottees" integer;
ALTER TABLE "ipo_details" ADD COLUMN "employee_shares_offered" bigint;
ALTER TABLE "ipo_details" ADD COLUMN "anchor_shares_offered" bigint;
