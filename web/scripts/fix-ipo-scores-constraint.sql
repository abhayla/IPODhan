-- Fix ipo_scores table - Add unique constraint on ipo_id
-- This is needed for the upsert operation in seed-ipo-scores.ts

-- Check if constraint already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ipo_scores_ipo_id_unique'
    ) THEN
        -- Add unique constraint
        ALTER TABLE ipo_scores ADD CONSTRAINT ipo_scores_ipo_id_unique UNIQUE (ipo_id);
        RAISE NOTICE 'Unique constraint added successfully';
    ELSE
        RAISE NOTICE 'Unique constraint already exists';
    END IF;
END $$;
