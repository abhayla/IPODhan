-- Migration: Make segment field nullable to support RIGHTS/InvITs/REITs offerings
-- Issue: ISS-007 - Schema validation too strict
-- Date: 2025-01-20

ALTER TABLE "ipos" ALTER COLUMN "segment" DROP NOT NULL;
