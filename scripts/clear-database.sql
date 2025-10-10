-- Epic 7 VPS Testing - Database Cleanup Script
-- Generated: 2025-10-09
-- Purpose: Clear all IPO data before testing scrapers

-- Display counts before deletion
SELECT 'BEFORE DELETION - Counts:' AS status;
SELECT 'ipos' AS table_name, COUNT(*) AS count FROM ipos
UNION ALL
SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL
SELECT 'scraper_logs', COUNT(*) FROM scraper_logs;

-- Disable foreign key constraints temporarily (if needed)
-- SET session_replication_role = 'replica';

-- Clear all data (in correct order due to foreign keys)
TRUNCATE TABLE subscriptions CASCADE;
TRUNCATE TABLE scraper_logs CASCADE;
TRUNCATE TABLE ipos CASCADE;

-- Re-enable foreign key constraints
-- SET session_replication_role = 'origin';

-- Display counts after deletion
SELECT 'AFTER DELETION - Counts:' AS status;
SELECT 'ipos' AS table_name, COUNT(*) AS count FROM ipos
UNION ALL
SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL
SELECT 'scraper_logs', COUNT(*) FROM scraper_logs;

-- Reset sequences (optional - for clean IDs)
-- ALTER SEQUENCE ipos_id_seq RESTART WITH 1;
-- ALTER SEQUENCE subscriptions_id_seq RESTART WITH 1;

SELECT '✅ Database cleared successfully!' AS status;
