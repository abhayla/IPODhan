-- Migration: Add audit_logs table for admin activity tracking
-- Created: 2025-01-22
-- Description: Implements immutable audit trail for all admin actions

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "timestamp" timestamp DEFAULT now() NOT NULL,
  "admin_user" varchar(255) NOT NULL,
  "action_type" varchar(100) NOT NULL,
  "ipo_id" uuid,
  "table_name" varchar(100),
  "field_name" varchar(100),
  "old_value" text,
  "new_value" text,
  "details" jsonb,
  "ip_address" varchar(45),
  "user_agent" text,
  "success" boolean DEFAULT true NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_ipo_id_ipos_id_fk"
  FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE set null ON UPDATE no action;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_audit_logs_timestamp" ON "audit_logs" USING btree ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_logs_admin_user" ON "audit_logs" USING btree ("admin_user");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_ipo_id" ON "audit_logs" USING btree ("ipo_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_action_type" ON "audit_logs" USING btree ("action_type");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_timestamp_admin" ON "audit_logs" USING btree ("timestamp" DESC, "admin_user");

-- Add comment
COMMENT ON TABLE "audit_logs" IS 'Immutable audit trail for admin actions - no UPDATE/DELETE operations allowed';
COMMENT ON COLUMN "audit_logs"."timestamp" IS 'When the action occurred';
COMMENT ON COLUMN "audit_logs"."admin_user" IS 'Admin username who performed the action';
COMMENT ON COLUMN "audit_logs"."action_type" IS 'Type of action: Field Updated, IPO Locked, Protection Enabled, etc.';
COMMENT ON COLUMN "audit_logs"."ipo_id" IS 'Related IPO (nullable for non-IPO-specific actions)';
COMMENT ON COLUMN "audit_logs"."details" IS 'Additional structured context (JSON)';
COMMENT ON COLUMN "audit_logs"."ip_address" IS 'Client IP address (anonymized after 90 days for PII compliance)';
COMMENT ON COLUMN "audit_logs"."success" IS 'Whether the action succeeded';
