-- Section 3.7: Time-Series Data Validation

\echo '=== Subscription Records Overview ==='
SELECT
    COUNT(*) as total_subscription_records,
    COUNT(DISTINCT ipo_id) as unique_ipos_with_subscriptions,
    MIN(timestamp) as earliest_record,
    MAX(timestamp) as latest_record
FROM subscriptions;

\echo ''
\echo '=== Duplicate Subscription Timestamps ==='
SELECT
    ipo_id,
    timestamp,
    COUNT(*) as duplicate_count,
    array_agg(id) as subscription_ids
FROM subscriptions
GROUP BY ipo_id, timestamp
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, timestamp DESC
LIMIT 20;

\echo ''
\echo '=== Future Subscription Timestamps ==='
SELECT
    s.id,
    s.ipo_id,
    i.company_name,
    s.timestamp,
    s.total_subscription
FROM subscriptions s
JOIN ipos i ON s.ipo_id = i.id
WHERE s.timestamp > CURRENT_TIMESTAMP
ORDER BY s.timestamp DESC
LIMIT 20;

\echo ''
\echo '=== Subscription Records by IPO ==='
SELECT
    i.id,
    i.slug,
    i.company_name,
    i.status,
    COUNT(s.id) as subscription_count,
    MIN(s.timestamp) as first_record,
    MAX(s.timestamp) as last_record
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.slug, i.company_name, i.status
ORDER BY subscription_count DESC
LIMIT 20;

\echo ''
\echo '=== OPEN IPOs Without Subscription Records ==='
SELECT
    i.id,
    i.slug,
    i.company_name,
    i.status,
    i.category,
    i.open_date,
    i.close_date,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.ipo_id = i.id) as subscription_count
FROM ipos i
WHERE i.status = 'OPEN'
    AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.ipo_id = i.id)
ORDER BY i.open_date DESC;

\echo ''
\echo '=== GMP Records Overview ==='
SELECT
    COUNT(*) as total_gmp_records,
    COUNT(DISTINCT ipo_id) as unique_ipos_with_gmp,
    MIN(timestamp) as earliest_record,
    MAX(timestamp) as latest_record
FROM gmp_records;

\echo ''
\echo '=== Duplicate GMP Timestamps ==='
SELECT
    ipo_id,
    timestamp,
    COUNT(*) as duplicate_count,
    array_agg(id) as gmp_record_ids,
    array_agg(gmp) as gmps
FROM gmp_records
GROUP BY ipo_id, timestamp
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, timestamp DESC
LIMIT 20;

\echo ''
\echo '=== Future GMP Timestamps ==='
SELECT
    g.id,
    g.ipo_id,
    i.company_name,
    g.timestamp,
    g.gmp
FROM gmp_records g
JOIN ipos i ON g.ipo_id = i.id
WHERE g.timestamp > CURRENT_TIMESTAMP
ORDER BY g.timestamp DESC
LIMIT 20;

\echo ''
\echo '=== GMP Records by IPO ==='
SELECT
    i.id,
    i.slug,
    i.company_name,
    i.status,
    i.gmp_price,
    COUNT(g.id) as gmp_record_count,
    MIN(g.timestamp) as first_record,
    MAX(g.timestamp) as last_record,
    MAX(g.gmp) as latest_gmp_from_records
FROM ipos i
LEFT JOIN gmp_records g ON i.id = g.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.slug, i.company_name, i.status, i.gmp_price
ORDER BY gmp_record_count DESC
LIMIT 20;

\echo ''
\echo '=== IPOs with GMP Field but No GMP Records ==='
SELECT
    i.id,
    i.slug,
    i.company_name,
    i.status,
    i.gmp_price,
    (SELECT COUNT(*) FROM gmp_records g WHERE g.ipo_id = i.id) as gmp_record_count
FROM ipos i
WHERE i.gmp_price IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM gmp_records g WHERE g.ipo_id = i.id)
ORDER BY i.status, i.gmp_price DESC
LIMIT 20;

\echo ''
\echo '=== Time-Series Data Summary ==='
SELECT
    'Subscriptions' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT ipo_id) as unique_ipos,
    COUNT(*) FILTER (WHERE timestamp > CURRENT_TIMESTAMP) as future_timestamps,
    (SELECT COUNT(*) FROM (SELECT ipo_id, timestamp FROM subscriptions GROUP BY ipo_id, timestamp HAVING COUNT(*) > 1) dup) as duplicate_timestamps
FROM subscriptions
UNION ALL
SELECT
    'GMP Records',
    COUNT(*),
    COUNT(DISTINCT ipo_id),
    COUNT(*) FILTER (WHERE timestamp > CURRENT_TIMESTAMP),
    (SELECT COUNT(*) FROM (SELECT ipo_id, timestamp FROM gmp_records GROUP BY ipo_id, timestamp HAVING COUNT(*) > 1) dup)
FROM gmp_records;
