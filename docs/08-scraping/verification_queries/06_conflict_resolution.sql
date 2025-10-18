-- Section 3.6: Conflict Resolution Priority (NSE > BSE)

\echo '=== Dual-Listed IPOs (Both NSE and BSE) ==='
SELECT
    id,
    slug,
    company_name,
    category,
    listing_exchanges,
    issue_size,
    price_range_min,
    price_range_max,
    total_subscription
FROM ipos
WHERE listing_exchanges::text LIKE '%NSE%'
    AND listing_exchanges::text LIKE '%BSE%'
ORDER BY created_at DESC
LIMIT 20;

\echo ''
\echo '=== Count of Dual-Listed IPOs ==='
SELECT
    COUNT(*) as dual_listed_ipos
FROM ipos
WHERE listing_exchanges::text LIKE '%NSE%'
    AND listing_exchanges::text LIKE '%BSE%';

\echo ''
\echo '=== IPOs by Exchange ==='
SELECT
    COUNT(*) FILTER (WHERE listing_exchanges::text LIKE '%NSE%') as nse_listed,
    COUNT(*) FILTER (WHERE listing_exchanges::text LIKE '%BSE%') as bse_listed,
    COUNT(*) FILTER (WHERE listing_exchanges::text LIKE '%NSE%' AND listing_exchanges::text LIKE '%BSE%') as both_exchanges,
    COUNT(*) FILTER (WHERE listing_exchanges IS NULL OR listing_exchanges::text = '[]') as no_exchange
FROM ipos;

\echo ''
\echo '=== Dual-Listed IPOs Data Completeness ==='
SELECT
    COUNT(*) as total_dual_listed,
    COUNT(*) FILTER (WHERE issue_size IS NOT NULL) as has_issue_size,
    COUNT(*) FILTER (WHERE price_range_min IS NOT NULL AND price_range_max IS NOT NULL) as has_price_bands,
    COUNT(*) FILTER (WHERE total_subscription IS NOT NULL) as has_subscription,
    COUNT(*) FILTER (WHERE sector IS NOT NULL) as has_sector,
    ROUND(100.0 * COUNT(*) FILTER (WHERE issue_size IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as issue_size_percent,
    ROUND(100.0 * COUNT(*) FILTER (WHERE price_range_min IS NOT NULL AND price_range_max IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as price_bands_percent,
    ROUND(100.0 * COUNT(*) FILTER (WHERE total_subscription IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as subscription_percent
FROM ipos
WHERE listing_exchanges::text LIKE '%NSE%'
    AND listing_exchanges::text LIKE '%BSE%';
