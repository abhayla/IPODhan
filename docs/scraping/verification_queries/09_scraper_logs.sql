-- Section 3.9: Scraper Error Log Analysis

\echo '=== Recent Scraper Runs (Last 24 Hours) ==='
SELECT
    id,
    source,
    status,
    created_at,
    duration_ms,
    ROUND(duration_ms / 1000.0, 2) as duration_seconds,
    records_processed,
    records_failed,
    error_message
FROM scraper_logs
WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
ORDER BY created_at DESC;

\echo ''
\echo '=== Failed Scraper Runs ==='
SELECT
    id,
    source,
    status,
    created_at,
    duration_ms,
    records_processed,
    records_failed,
    error_message,
    error_stack
FROM scraper_logs
WHERE status = 'FAILURE'
ORDER BY created_at DESC
LIMIT 20;

\echo ''
\echo '=== Scraper Error Summary ==='
SELECT
    source,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_runs,
    COUNT(*) FILTER (WHERE status = 'FAILURE') as failed_runs,
    COUNT(*) FILTER (WHERE status = 'PARTIAL') as partial_runs,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'SUCCESS') / COUNT(*), 2) as success_rate,
    SUM(records_processed) as total_records_processed,
    SUM(records_failed) as total_records_failed,
    ROUND(AVG(duration_ms / 1000.0), 2) as avg_duration_seconds
FROM scraper_logs
GROUP BY source
ORDER BY source;

\echo ''
\echo '=== Error Message Patterns ==='
SELECT
    source,
    error_message,
    COUNT(*) as occurrence_count,
    MIN(created_at) as first_occurrence,
    MAX(created_at) as last_occurrence
FROM scraper_logs
WHERE error_message IS NOT NULL
GROUP BY source, error_message
ORDER BY occurrence_count DESC, last_occurrence DESC
LIMIT 20;

\echo ''
\echo '=== Scraper Performance Metrics ==='
SELECT
    source,
    COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_runs,
    ROUND(AVG(duration_ms / 1000.0), 2) as avg_duration_seconds,
    ROUND(MIN(duration_ms / 1000.0), 2) as min_duration_seconds,
    ROUND(MAX(duration_ms / 1000.0), 2) as max_duration_seconds,
    ROUND(AVG(records_processed), 2) as avg_records_processed,
    ROUND(AVG(records_failed), 2) as avg_records_failed
FROM scraper_logs
WHERE status = 'SUCCESS'
GROUP BY source
ORDER BY source;

\echo ''
\echo '=== Last Run by Scraper ==='
SELECT DISTINCT ON (source)
    source,
    status,
    created_at,
    duration_ms,
    records_processed,
    records_failed,
    error_message
FROM scraper_logs
ORDER BY source, created_at DESC;

\echo ''
\echo '=== Scrapers with High Failure Rate ==='
SELECT
    source,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE status = 'FAILURE') as failed_runs,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'FAILURE') / COUNT(*), 2) as failure_rate
FROM scraper_logs
GROUP BY source
HAVING COUNT(*) >= 3 AND COUNT(*) FILTER (WHERE status = 'FAILURE') > 0
ORDER BY failure_rate DESC;

\echo ''
\echo '=== Scraper Logs Table Statistics ==='
SELECT
    COUNT(*) as total_log_entries,
    COUNT(DISTINCT source) as unique_scrapers,
    MIN(created_at) as earliest_run,
    MAX(created_at) as latest_run,
    COUNT(*) FILTER (WHERE status = 'SUCCESS') as total_successes,
    COUNT(*) FILTER (WHERE status = 'FAILURE') as total_failures,
    COUNT(*) FILTER (WHERE status = 'PARTIAL') as total_partial
FROM scraper_logs;
