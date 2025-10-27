-- Migration: Add review moderation fields to ipo_reviews table
-- Story: 11.16 - IPO Recommendations Summary Section
-- Date: 2025-10-27

-- Add moderation fields to ipo_reviews table
ALTER TABLE ipo_reviews
ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS moderated_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP;

-- Add index for approved reviews query performance
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_approved
ON ipo_reviews(is_approved, ipo_id);

-- Add comment for documentation
COMMENT ON COLUMN ipo_reviews.is_approved IS 'Whether the review has been approved by admin (default: false)';
COMMENT ON COLUMN ipo_reviews.moderated_by IS 'Email/username of admin who moderated the review';
COMMENT ON COLUMN ipo_reviews.moderated_at IS 'Timestamp when the review was moderated';
COMMENT ON INDEX idx_ipo_reviews_approved IS 'Index for fast retrieval of approved reviews by IPO (Story 11.16)';
