-- Section 3.5: Field-by-Source Validation

\echo '=== Core IPO Fields Population Report ==='
SELECT
    'company_name' as field_name,
    COUNT(*) FILTER (WHERE company_name IS NOT NULL) as populated,
    COUNT(*) as total,
    ROUND(100.0 * COUNT(*) FILTER (WHERE company_name IS NOT NULL) / COUNT(*), 2) as coverage_percent
FROM ipos
UNION ALL
SELECT 'slug', COUNT(*) FILTER (WHERE slug IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE slug IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'category', COUNT(*) FILTER (WHERE category IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE category IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'status', COUNT(*) FILTER (WHERE status IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE status IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'open_date', COUNT(*) FILTER (WHERE open_date IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE open_date IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'close_date', COUNT(*) FILTER (WHERE close_date IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE close_date IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'allotment_date', COUNT(*) FILTER (WHERE allotment_date IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE allotment_date IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'listing_date', COUNT(*) FILTER (WHERE listing_date IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE listing_date IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'issue_size', COUNT(*) FILTER (WHERE issue_size IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE issue_size IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'price_range_min', COUNT(*) FILTER (WHERE price_range_min IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE price_range_min IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'price_range_max', COUNT(*) FILTER (WHERE price_range_max IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE price_range_max IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'lot_size', COUNT(*) FILTER (WHERE lot_size IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE lot_size IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'face_value', COUNT(*) FILTER (WHERE face_value IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE face_value IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'listing_exchanges', COUNT(*) FILTER (WHERE listing_exchanges IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE listing_exchanges IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'sector', COUNT(*) FILTER (WHERE sector IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE sector IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'description', COUNT(*) FILTER (WHERE description IS NOT NULL AND description != ''), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE description IS NOT NULL AND description != '') / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'qib_subscription', COUNT(*) FILTER (WHERE qib_subscription IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE qib_subscription IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'nii_subscription', COUNT(*) FILTER (WHERE nii_subscription IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE nii_subscription IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'retail_subscription', COUNT(*) FILTER (WHERE retail_subscription IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE retail_subscription IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'total_subscription', COUNT(*) FILTER (WHERE total_subscription IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE total_subscription IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'latest_gmp', COUNT(*) FILTER (WHERE latest_gmp IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE latest_gmp IS NOT NULL) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'last_scraped_at', COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE last_scraped_at IS NOT NULL) / COUNT(*), 2) FROM ipos
ORDER BY coverage_percent DESC;

\echo ''
\echo '=== Historical Performance Fields Population ==='
SELECT
    'listing_gain_percent' as field_name,
    COUNT(*) FILTER (WHERE listing_gain_percent IS NOT NULL) as populated,
    COUNT(*) FILTER (WHERE status = 'LISTED') as applicable_ipos,
    ROUND(100.0 * COUNT(*) FILTER (WHERE listing_gain_percent IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) as coverage_percent
FROM ipos
UNION ALL
SELECT 'current_price', COUNT(*) FILTER (WHERE current_price IS NOT NULL), COUNT(*) FILTER (WHERE status = 'LISTED'), ROUND(100.0 * COUNT(*) FILTER (WHERE current_price IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) FROM ipos
UNION ALL
SELECT 'current_gain_percent', COUNT(*) FILTER (WHERE current_gain_percent IS NOT NULL), COUNT(*) FILTER (WHERE status = 'LISTED'), ROUND(100.0 * COUNT(*) FILTER (WHERE current_gain_percent IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) FROM ipos
UNION ALL
SELECT 'one_week_return', COUNT(*) FILTER (WHERE one_week_return IS NOT NULL), COUNT(*) FILTER (WHERE status = 'LISTED'), ROUND(100.0 * COUNT(*) FILTER (WHERE one_week_return IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) FROM ipos
UNION ALL
SELECT 'one_month_return', COUNT(*) FILTER (WHERE one_month_return IS NOT NULL), COUNT(*) FILTER (WHERE status = 'LISTED'), ROUND(100.0 * COUNT(*) FILTER (WHERE one_month_return IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) FROM ipos
UNION ALL
SELECT 'three_month_return', COUNT(*) FILTER (WHERE three_month_return IS NOT NULL), COUNT(*) FILTER (WHERE status = 'LISTED'), ROUND(100.0 * COUNT(*) FILTER (WHERE three_month_return IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) FROM ipos
UNION ALL
SELECT 'six_month_return', COUNT(*) FILTER (WHERE six_month_return IS NOT NULL), COUNT(*) FILTER (WHERE status = 'LISTED'), ROUND(100.0 * COUNT(*) FILTER (WHERE six_month_return IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) FROM ipos
UNION ALL
SELECT 'one_year_return', COUNT(*) FILTER (WHERE one_year_return IS NOT NULL), COUNT(*) FILTER (WHERE status = 'LISTED'), ROUND(100.0 * COUNT(*) FILTER (WHERE one_year_return IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status = 'LISTED'), 0), 2) FROM ipos
ORDER BY coverage_percent DESC NULLS LAST;

\echo ''
\echo '=== Field Coverage by Category ==='
SELECT
    category,
    COUNT(*) as total_ipos,
    ROUND(100.0 * COUNT(*) FILTER (WHERE issue_size IS NOT NULL) / COUNT(*), 2) as issue_size_coverage,
    ROUND(100.0 * COUNT(*) FILTER (WHERE price_range_min IS NOT NULL) / COUNT(*), 2) as price_band_coverage,
    ROUND(100.0 * COUNT(*) FILTER (WHERE sector IS NOT NULL) / COUNT(*), 2) as sector_coverage,
    ROUND(100.0 * COUNT(*) FILTER (WHERE description IS NOT NULL) / COUNT(*), 2) as description_coverage
FROM ipos
GROUP BY category
ORDER BY category;

\echo ''
\echo '=== Field Coverage by Status ==='
SELECT
    status,
    COUNT(*) as total_ipos,
    ROUND(100.0 * COUNT(*) FILTER (WHERE total_subscription IS NOT NULL) / COUNT(*), 2) as subscription_coverage,
    ROUND(100.0 * COUNT(*) FILTER (WHERE latest_gmp IS NOT NULL) / COUNT(*), 2) as gmp_coverage,
    ROUND(100.0 * COUNT(*) FILTER (WHERE listing_gain_percent IS NOT NULL) / COUNT(*), 2) as listing_gain_coverage,
    ROUND(100.0 * COUNT(*) FILTER (WHERE current_price IS NOT NULL) / COUNT(*), 2) as current_price_coverage
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
