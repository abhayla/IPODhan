-- Section 3.10: Core IPO Table Field Verification

\echo '=== Comprehensive Field Population Report ==='
WITH field_stats AS (
    SELECT
        COUNT(*) as total_ipos,
        -- Required fields
        COUNT(*) FILTER (WHERE id IS NOT NULL) as has_id,
        COUNT(*) FILTER (WHERE company_name IS NOT NULL) as has_company_name,
        COUNT(*) FILTER (WHERE slug IS NOT NULL) as has_slug,
        COUNT(*) FILTER (WHERE category IS NOT NULL) as has_category,
        COUNT(*) FILTER (WHERE status IS NOT NULL) as has_status,
        -- Date fields
        COUNT(*) FILTER (WHERE open_date IS NOT NULL) as has_open_date,
        COUNT(*) FILTER (WHERE close_date IS NOT NULL) as has_close_date,
        COUNT(*) FILTER (WHERE allotment_date IS NOT NULL) as has_allotment_date,
        COUNT(*) FILTER (WHERE listing_date IS NOT NULL) as has_listing_date,
        -- Price fields
        COUNT(*) FILTER (WHERE price_range_min IS NOT NULL) as has_price_min,
        COUNT(*) FILTER (WHERE price_range_max IS NOT NULL) as has_price_max,
        COUNT(*) FILTER (WHERE issue_price IS NOT NULL) as has_issue_price,
        COUNT(*) FILTER (WHERE listing_price IS NOT NULL) as has_listing_price,
        COUNT(*) FILTER (WHERE current_price IS NOT NULL) as has_current_price,
        -- Size and lot fields
        COUNT(*) FILTER (WHERE issue_size IS NOT NULL) as has_issue_size,
        COUNT(*) FILTER (WHERE lot_size IS NOT NULL) as has_lot_size,
        COUNT(*) FILTER (WHERE face_value IS NOT NULL) as has_face_value,
        -- Subscription fields
        COUNT(*) FILTER (WHERE qib_subscription IS NOT NULL) as has_qib,
        COUNT(*) FILTER (WHERE nii_subscription IS NOT NULL) as has_nii,
        COUNT(*) FILTER (WHERE retail_subscription IS NOT NULL) as has_retail,
        COUNT(*) FILTER (WHERE total_subscription IS NOT NULL) as has_total_sub,
        -- GMP and listing fields
        COUNT(*) FILTER (WHERE latest_gmp IS NOT NULL) as has_latest_gmp,
        COUNT(*) FILTER (WHERE listing_gain_percent IS NOT NULL) as has_listing_gain,
        COUNT(*) FILTER (WHERE current_gain_percent IS NOT NULL) as has_current_gain,
        -- Return fields
        COUNT(*) FILTER (WHERE one_week_return IS NOT NULL) as has_1w_return,
        COUNT(*) FILTER (WHERE one_month_return IS NOT NULL) as has_1m_return,
        COUNT(*) FILTER (WHERE three_month_return IS NOT NULL) as has_3m_return,
        COUNT(*) FILTER (WHERE six_month_return IS NOT NULL) as has_6m_return,
        COUNT(*) FILTER (WHERE one_year_return IS NOT NULL) as has_1y_return,
        -- Other fields
        COUNT(*) FILTER (WHERE sector IS NOT NULL) as has_sector,
        COUNT(*) FILTER (WHERE description IS NOT NULL) as has_description,
        COUNT(*) FILTER (WHERE listing_exchanges IS NOT NULL) as has_exchanges,
        COUNT(*) FILTER (WHERE registrar_id IS NOT NULL) as has_registrar,
        -- Metadata
        COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL) as has_last_scraped,
        COUNT(*) FILTER (WHERE created_at IS NOT NULL) as has_created_at,
        COUNT(*) FILTER (WHERE updated_at IS NOT NULL) as has_updated_at
    FROM ipos
)
SELECT
    'id' as field_name, has_id as populated, total_ipos as total, ROUND(100.0 * has_id / total_ipos, 2) as coverage_percent FROM field_stats
UNION ALL SELECT 'company_name', has_company_name, total_ipos, ROUND(100.0 * has_company_name / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'slug', has_slug, total_ipos, ROUND(100.0 * has_slug / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'category', has_category, total_ipos, ROUND(100.0 * has_category / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'status', has_status, total_ipos, ROUND(100.0 * has_status / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'open_date', has_open_date, total_ipos, ROUND(100.0 * has_open_date / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'close_date', has_close_date, total_ipos, ROUND(100.0 * has_close_date / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'allotment_date', has_allotment_date, total_ipos, ROUND(100.0 * has_allotment_date / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'listing_date', has_listing_date, total_ipos, ROUND(100.0 * has_listing_date / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'price_range_min', has_price_min, total_ipos, ROUND(100.0 * has_price_min / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'price_range_max', has_price_max, total_ipos, ROUND(100.0 * has_price_max / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'issue_price', has_issue_price, total_ipos, ROUND(100.0 * has_issue_price / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'listing_price', has_listing_price, total_ipos, ROUND(100.0 * has_listing_price / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'current_price', has_current_price, total_ipos, ROUND(100.0 * has_current_price / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'issue_size', has_issue_size, total_ipos, ROUND(100.0 * has_issue_size / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'lot_size', has_lot_size, total_ipos, ROUND(100.0 * has_lot_size / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'face_value', has_face_value, total_ipos, ROUND(100.0 * has_face_value / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'qib_subscription', has_qib, total_ipos, ROUND(100.0 * has_qib / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'nii_subscription', has_nii, total_ipos, ROUND(100.0 * has_nii / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'retail_subscription', has_retail, total_ipos, ROUND(100.0 * has_retail / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'total_subscription', has_total_sub, total_ipos, ROUND(100.0 * has_total_sub / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'latest_gmp', has_latest_gmp, total_ipos, ROUND(100.0 * has_latest_gmp / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'listing_gain_percent', has_listing_gain, total_ipos, ROUND(100.0 * has_listing_gain / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'current_gain_percent', has_current_gain, total_ipos, ROUND(100.0 * has_current_gain / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'one_week_return', has_1w_return, total_ipos, ROUND(100.0 * has_1w_return / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'one_month_return', has_1m_return, total_ipos, ROUND(100.0 * has_1m_return / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'three_month_return', has_3m_return, total_ipos, ROUND(100.0 * has_3m_return / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'six_month_return', has_6m_return, total_ipos, ROUND(100.0 * has_6m_return / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'one_year_return', has_1y_return, total_ipos, ROUND(100.0 * has_1y_return / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'sector', has_sector, total_ipos, ROUND(100.0 * has_sector / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'description', has_description, total_ipos, ROUND(100.0 * has_description / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'listing_exchanges', has_exchanges, total_ipos, ROUND(100.0 * has_exchanges / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'registrar_id', has_registrar, total_ipos, ROUND(100.0 * has_registrar / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'last_scraped_at', has_last_scraped, total_ipos, ROUND(100.0 * has_last_scraped / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'created_at', has_created_at, total_ipos, ROUND(100.0 * has_created_at / total_ipos, 2) FROM field_stats
UNION ALL SELECT 'updated_at', has_updated_at, total_ipos, ROUND(100.0 * has_updated_at / total_ipos, 2) FROM field_stats
ORDER BY coverage_percent DESC, field_name;

\echo ''
\echo '=== Critical Missing Fields (< 50% Coverage) ==='
WITH field_stats AS (
    SELECT
        COUNT(*) as total_ipos,
        COUNT(*) FILTER (WHERE open_date IS NOT NULL) as has_open_date,
        COUNT(*) FILTER (WHERE close_date IS NOT NULL) as has_close_date,
        COUNT(*) FILTER (WHERE issue_size IS NOT NULL) as has_issue_size,
        COUNT(*) FILTER (WHERE price_range_min IS NOT NULL) as has_price_min,
        COUNT(*) FILTER (WHERE sector IS NOT NULL) as has_sector,
        COUNT(*) FILTER (WHERE description IS NOT NULL) as has_description,
        COUNT(*) FILTER (WHERE listing_exchanges IS NOT NULL) as has_exchanges
    FROM ipos
)
SELECT
    'open_date' as field_name,
    has_open_date as populated,
    total_ipos - has_open_date as missing,
    ROUND(100.0 * has_open_date / total_ipos, 2) as coverage_percent
FROM field_stats
WHERE ROUND(100.0 * has_open_date / total_ipos, 2) < 50
UNION ALL
SELECT 'close_date', has_close_date, total_ipos - has_close_date, ROUND(100.0 * has_close_date / total_ipos, 2)
FROM field_stats WHERE ROUND(100.0 * has_close_date / total_ipos, 2) < 50
UNION ALL
SELECT 'issue_size', has_issue_size, total_ipos - has_issue_size, ROUND(100.0 * has_issue_size / total_ipos, 2)
FROM field_stats WHERE ROUND(100.0 * has_issue_size / total_ipos, 2) < 50
UNION ALL
SELECT 'price_range_min', has_price_min, total_ipos - has_price_min, ROUND(100.0 * has_price_min / total_ipos, 2)
FROM field_stats WHERE ROUND(100.0 * has_price_min / total_ipos, 2) < 50
UNION ALL
SELECT 'sector', has_sector, total_ipos - has_sector, ROUND(100.0 * has_sector / total_ipos, 2)
FROM field_stats WHERE ROUND(100.0 * has_sector / total_ipos, 2) < 50
UNION ALL
SELECT 'description', has_description, total_ipos - has_description, ROUND(100.0 * has_description / total_ipos, 2)
FROM field_stats WHERE ROUND(100.0 * has_description / total_ipos, 2) < 50
UNION ALL
SELECT 'listing_exchanges', has_exchanges, total_ipos - has_exchanges, ROUND(100.0 * has_exchanges / total_ipos, 2)
FROM field_stats WHERE ROUND(100.0 * has_exchanges / total_ipos, 2) < 50
ORDER BY coverage_percent ASC;

\echo ''
\echo '=== Field Coverage by Status (Detailed) ==='
SELECT
    status,
    COUNT(*) as total,
    ROUND(100.0 * COUNT(*) FILTER (WHERE open_date IS NOT NULL) / COUNT(*), 2) as open_date_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE close_date IS NOT NULL) / COUNT(*), 2) as close_date_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE issue_size IS NOT NULL) / COUNT(*), 2) as issue_size_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE total_subscription IS NOT NULL) / COUNT(*), 2) as subscription_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE latest_gmp IS NOT NULL) / COUNT(*), 2) as gmp_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE listing_price IS NOT NULL) / COUNT(*), 2) as listing_price_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE current_price IS NOT NULL) / COUNT(*), 2) as current_price_pct
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
