-- Add isPermanent flag to field_protection_metadata table
ALTER TABLE "field_protection_metadata"
ADD COLUMN "is_permanent" boolean DEFAULT false NOT NULL;

-- Add comment to explain the purpose
COMMENT ON COLUMN "field_protection_metadata"."is_permanent" IS 'Permanent protection flag - when true, protection is never auto-removed even after successful manual edits';