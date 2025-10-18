-- Section 3.8: Cache Invalidation Validation

\echo '=== Last Scraped Timestamp Analysis ==='
SELECT
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL) as has_scraped_timestamp,
    COUNT(*) FILTER (WHERE last_scraped_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') as scraped_last_hour,
    COUNT(*) FILTER (WHERE last_scraped_at > CURRENT_TIMESTAMP - INTERVAL '24 hours') as scraped_last_24h,
    COUNT(*) FILTER (WHERE last_scraped_at > CURRENT_TIMESTAMP - INTERVAL '7 days') as scraped_last_week,
    ROUND(100.0 * COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL) / COUNT(*), 2) as scraped_percent,
    ROUND(100.0 * COUNT(*) FILTER (WHERE last_scraped_at > CURRENT_TIMESTAMP - INTERVAL '1 hour') / NULLIF(COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL), 0), 2) as recent_scrape_percent
FROM ipos;

\echo ''
\echo '=== Recently Scraped IPOs (Last Hour) ==='
SELECT
    id,
    slug,
    company_name,
    status,
    category,
    last_scraped_at,
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_scraped_at)) / 60 as minutes_ago
FROM ipos
WHERE last_scraped_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
ORDER BY last_scraped_at DESC
LIMIT 30;

\echo ''
\echo '=== IPOs Never Scraped ==='
SELECT
    COUNT(*) as never_scraped,
    COUNT(*) FILTER (WHERE status = 'UPCOMING') as upcoming_never_scraped,
    COUNT(*) FILTER (WHERE status = 'OPEN') as open_never_scraped,
    COUNT(*) FILTER (WHERE status = 'CLOSED') as closed_never_scraped,
    COUNT(*) FILTER (WHERE status = 'LISTED') as listed_never_scraped
FROM ipos
WHERE last_scraped_at IS NULL;

\echo ''
\echo '=== Sample IPOs Never Scraped ==='
SELECT
    id,
    slug,
    company_name,
    status,
    category,
    created_at,
    last_scraped_at
FROM ipos
WHERE last_scraped_at IS NULL
ORDER BY status, created_at DESC
LIMIT 20;

\echo ''
\echo '=== Stale IPOs (Not Scraped in Last 7 Days) ==='
SELECT
    COUNT(*) as stale_ipos,
    COUNT(*) FILTER (WHERE status = 'UPCOMING') as stale_upcoming,
    COUNT(*) FILTER (WHERE status = 'OPEN') as stale_open,
    COUNT(*) FILTER (WHERE status = 'CLOSED') as stale_closed,
    COUNT(*) FILTER (WHERE status = 'LISTED') as stale_listed
FROM ipos
WHERE last_scraped_at IS NOT NULL
    AND last_scraped_at < CURRENT_TIMESTAMP - INTERVAL '7 days';

\echo ''
\echo '=== Last Scraped by Status ==='
SELECT
    status,
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL) as has_scraped_timestamp,
    MIN(last_scraped_at) as oldest_scrape,
    MAX(last_scraped_at) as newest_scrape,
    AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_scraped_at)) / 3600)::numeric(10,2) as avg_hours_since_scrape
FROM ipos
GROUP BY status
ORDER BY
    CASE status
        WHEN 'UPCOMING' THEN 1
        WHEN 'OPEN' THEN 2
        WHEN 'CLOSED' THEN 3
        WHEN 'LISTED' THEN 4
        ELSE 5
    END;

\echo ''
\echo '=== Updated vs Scraped Timestamps ==='
SELECT
    id,
    slug,
    company_name,
    status,
    updated_at,
    last_scraped_at,
    EXTRACT(EPOCH FROM (last_scraped_at - updated_at)) / 60 as scrape_update_diff_minutes
FROM ipos
WHERE last_scraped_at IS NOT NULL
    AND updated_at IS NOT NULL
    AND last_scraped_at > updated_at
ORDER BY last_scraped_at DESC
LIMIT 20;
