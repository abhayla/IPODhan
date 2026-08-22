-- Migration: Add ipo_slug_redirects table (P3-1, T-278)
-- Created: 2026-08-22
-- Description: Permanent old-slug -> IPO redirect record, so a retired slug
-- (name-pollution cleanup, dedup merge, future admin rename) 301s to the
-- IPO's current slug instead of 404ing.

CREATE TABLE IF NOT EXISTS "ipo_slug_redirects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "old_slug" varchar(255) NOT NULL UNIQUE,
  "ipo_id" uuid NOT NULL,
  "reason" varchar(100),
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "ipo_slug_redirects" ADD CONSTRAINT "ipo_slug_redirects_ipo_id_ipos_id_fk"
  FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "idx_ipo_slug_redirects_old_slug" ON "ipo_slug_redirects" USING btree ("old_slug");
CREATE INDEX IF NOT EXISTS "idx_ipo_slug_redirects_ipo_id" ON "ipo_slug_redirects" USING btree ("ipo_id");

COMMENT ON TABLE "ipo_slug_redirects" IS 'Retired IPO slug -> current IPO redirect (P3-1, T-278)';
