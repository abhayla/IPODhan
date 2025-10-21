-- Database Performance Monitoring Queries
-- Use these queries to manually inspect database performance metrics

-- ============================================
-- 1. Slow Queries (> 100ms average)
-- ============================================
SELECT
  SUBSTRING(query, 1, 100) as query_preview,
  calls,
  ROUND(mean_exec_time::numeric, 2) as mean_ms,
  ROUND(max_exec_time::numeric, 2) as max_ms,
  ROUND(stddev_exec_time::numeric, 2) as stddev_ms,
  ROUND((total_exec_time / 1000)::numeric, 2) as total_seconds
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- ============================================
-- 2. Connection Pool Statistics
-- ============================================
SELECT
  datname as database,
  numbackends as active_connections,
  xact_commit as commits,
  xact_rollback as rollbacks,
  ROUND((xact_rollback::float / NULLIF(xact_commit + xact_rollback, 0) * 100)::numeric, 2) as rollback_rate,
  blks_read as disk_reads,
  blks_hit as cache_hits,
  ROUND((blks_hit::float / NULLIF(blks_hit + blks_read, 0) * 100)::numeric, 2) as cache_hit_ratio
FROM pg_stat_database
WHERE datname = current_database();

-- ============================================
-- 3. Cache Hit Ratio (should be > 95%)
-- ============================================
SELECT
  ROUND((sum(blks_hit) / NULLIF(sum(blks_hit + blks_read), 0)::float * 100)::numeric, 2) as cache_hit_ratio_percent
FROM pg_stat_database
WHERE datname = current_database();

-- ============================================
-- 4. Table Sizes and Row Counts
-- ============================================
SELECT
  schemaname || '.' || tablename as table_name,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as indexes_size,
  n_live_tup as row_count,
  n_dead_tup as dead_rows
FROM pg_tables
JOIN pg_stat_user_tables USING (schemaname, tablename)
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================
-- 5. Index Usage Statistics
-- ============================================
SELECT
  schemaname || '.' || tablename as table_name,
  indexname as index_name,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched,
  pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan ASC
LIMIT 20;

-- ============================================
-- 6. Unused Indexes (never scanned)
-- ============================================
SELECT
  schemaname || '.' || tablename as table_name,
  indexname as index_name,
  pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as wasted_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND schemaname = 'public'
  AND indexname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(schemaname||'.'||indexname) DESC;

-- ============================================
-- 7. Table Bloat Estimate
-- ============================================
SELECT
  schemaname || '.' || tablename as table_name,
  n_live_tup as live_tuples,
  n_dead_tup as dead_tuples,
  ROUND((n_dead_tup::float / NULLIF(n_live_tup + n_dead_tup, 0) * 100)::numeric, 2) as dead_tuple_percent,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;

-- ============================================
-- 8. Long Running Queries (> 1 minute)
-- ============================================
SELECT
  pid,
  now() - query_start as duration,
  state,
  SUBSTRING(query, 1, 100) as query_preview
FROM pg_stat_activity
WHERE state != 'idle'
  AND query_start < now() - interval '1 minute'
ORDER BY query_start;

-- ============================================
-- 9. Locks and Blocking Queries
-- ============================================
SELECT
  blocked_locks.pid AS blocked_pid,
  blocked_activity.usename AS blocked_user,
  blocking_locks.pid AS blocking_pid,
  blocking_activity.usename AS blocking_user,
  SUBSTRING(blocked_activity.query, 1, 100) AS blocked_statement,
  SUBSTRING(blocking_activity.query, 1, 100) AS blocking_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
  AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
  AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
  AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
  AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
  AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
  AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
  AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- ============================================
-- 10. Database Size
-- ============================================
SELECT
  pg_database.datname as database_name,
  pg_size_pretty(pg_database_size(pg_database.datname)) as size
FROM pg_database
WHERE datname = current_database();

-- ============================================
-- 11. Most Frequently Executed Queries
-- ============================================
SELECT
  SUBSTRING(query, 1, 100) as query_preview,
  calls,
  ROUND(mean_exec_time::numeric, 2) as mean_ms,
  ROUND((total_exec_time / 1000)::numeric, 2) as total_seconds
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;

-- ============================================
-- 12. Sequential Scans on Large Tables
-- ============================================
SELECT
  schemaname || '.' || tablename as table_name,
  seq_scan as sequential_scans,
  seq_tup_read as rows_read,
  n_live_tup as total_rows,
  ROUND((seq_tup_read::float / NULLIF(seq_scan, 0))::numeric, 0) as avg_rows_per_scan
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_live_tup > 1000
  AND seq_scan > 0
ORDER BY seq_scan DESC;

-- ============================================
-- Enable pg_stat_statements if not already enabled
-- ============================================
-- Run this in psql as superuser:
-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
-- ALTER SYSTEM SET pg_stat_statements.track = 'all';
-- -- Then restart PostgreSQL

-- ============================================
-- Reset statistics (run periodically)
-- ============================================
-- SELECT pg_stat_statements_reset();
