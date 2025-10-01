-- Migration 003: Add 'ALL' to pipeline_status source constraint
-- Purpose: Allow aggregate pipeline status tracking with source='ALL'
-- Date: 2025-10-01

-- Drop existing check constraint
ALTER TABLE pipeline_status
DROP CONSTRAINT IF EXISTS pipeline_status_source_check;

-- Add new check constraint with 'ALL' included
ALTER TABLE pipeline_status
ADD CONSTRAINT pipeline_status_source_check
CHECK (source IN ('NSE', 'BSE', 'IPOWATCH', 'INVESTORGAIN', 'CHITTORGARH', 'ALL'));

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration 003 completed: Added ALL to pipeline_status source constraint';
END
$$;
