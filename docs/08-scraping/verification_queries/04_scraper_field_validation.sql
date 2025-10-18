-- Section 3.4: Scraper-Specific Field Validation

\echo '=== NSE Responsibility: Subscription Data for MAINBOARD OPEN IPOs ==='
SELECT
    i.id,
    i.slug,
    i.company_name,
    i.status,
    i.category,
    i.qib_subscription,
    i.nii_subscription,
    i.retail_subscription,
    i.total_subscription,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.ipo_id = i.id) as subscription_records
FROM ipos i
WHERE i.category = 'MAINBOARD'
    AND i.status = 'OPEN'
    AND (i.qib_subscription IS NULL
        OR i.nii_subscription IS NULL
        OR i.retail_subscription IS NULL
        OR i.total_subscription IS NULL)
ORDER BY i.open_date DESC
LIMIT 20;

\echo ''
\echo '=== BSE Responsibility: Issue Size for SME IPOs ==='
SELECT id, slug, company_name, status, category, issue_size
FROM ipos
WHERE category = 'SME'
    AND issue_size IS NULL
ORDER BY COALESCE(open_date, close_date, created_at) DESC
LIMIT 20;

\echo ''
\echo '=== BSE Responsibility: Price Bands for SME IPOs ==='
SELECT id, slug, company_name, status, category, price_range_min, price_range_max
FROM ipos
WHERE category = 'SME'
    AND (price_range_min IS NULL OR price_range_max IS NULL)
ORDER BY COALESCE(open_date, close_date, created_at) DESC
LIMIT 20;

\echo ''
\echo '=== Chittorgarh Responsibility: GMP Data Coverage ==='
SELECT
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE latest_gmp IS NOT NULL) as ipos_with_gmp,
    ROUND(100.0 * COUNT(*) FILTER (WHERE latest_gmp IS NOT NULL) / COUNT(*), 2) as gmp_coverage_percent
FROM ipos
WHERE status IN ('OPEN', 'CLOSED', 'LISTED');

\echo ''
\echo '=== IPOs Without GMP Data (OPEN/CLOSED/LISTED) ==='
SELECT id, slug, company_name, status, latest_gmp, close_date, listing_date
FROM ipos
WHERE status IN ('OPEN', 'CLOSED', 'LISTED')
    AND latest_gmp IS NULL
ORDER BY COALESCE(close_date, listing_date, open_date) DESC NULLS LAST
LIMIT 30;

\echo ''
\echo '=== Moneycontrol Responsibility: Sector Data ==='
SELECT
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE sector IS NOT NULL) as ipos_with_sector,
    ROUND(100.0 * COUNT(*) FILTER (WHERE sector IS NOT NULL) / COUNT(*), 2) as sector_coverage_percent
FROM ipos;

\echo ''
\echo '=== IPOs Without Sector ==='
SELECT id, slug, company_name, status, sector
FROM ipos
WHERE sector IS NULL
ORDER BY created_at DESC
LIMIT 30;

\echo ''
\echo '=== Moneycontrol Responsibility: Description Data ==='
SELECT
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE description IS NOT NULL AND description != '') as ipos_with_description,
    ROUND(100.0 * COUNT(*) FILTER (WHERE description IS NOT NULL AND description != '') / COUNT(*), 2) as description_coverage_percent
FROM ipos;

\echo ''
\echo '=== Scraper Field Coverage Summary ==='
SELECT
    'NSE - Subscription (MAINBOARD OPEN)' as scraper_responsibility,
    COUNT(*) FILTER (WHERE category = 'MAINBOARD' AND status = 'OPEN') as applicable_ipos,
    COUNT(*) FILTER (WHERE category = 'MAINBOARD' AND status = 'OPEN' AND total_subscription IS NOT NULL) as populated_ipos,
    ROUND(100.0 * COUNT(*) FILTER (WHERE category = 'MAINBOARD' AND status = 'OPEN' AND total_subscription IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE category = 'MAINBOARD' AND status = 'OPEN'), 0), 2) as coverage_percent
FROM ipos
UNION ALL
SELECT
    'BSE - Issue Size (SME)',
    COUNT(*) FILTER (WHERE category = 'SME'),
    COUNT(*) FILTER (WHERE category = 'SME' AND issue_size IS NOT NULL),
    ROUND(100.0 * COUNT(*) FILTER (WHERE category = 'SME' AND issue_size IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE category = 'SME'), 0), 2)
FROM ipos
UNION ALL
SELECT
    'BSE - Price Bands (SME)',
    COUNT(*) FILTER (WHERE category = 'SME'),
    COUNT(*) FILTER (WHERE category = 'SME' AND price_range_min IS NOT NULL AND price_range_max IS NOT NULL),
    ROUND(100.0 * COUNT(*) FILTER (WHERE category = 'SME' AND price_range_min IS NOT NULL AND price_range_max IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE category = 'SME'), 0), 2)
FROM ipos
UNION ALL
SELECT
    'Chittorgarh - GMP (OPEN/CLOSED/LISTED)',
    COUNT(*) FILTER (WHERE status IN ('OPEN', 'CLOSED', 'LISTED')),
    COUNT(*) FILTER (WHERE status IN ('OPEN', 'CLOSED', 'LISTED') AND latest_gmp IS NOT NULL),
    ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('OPEN', 'CLOSED', 'LISTED') AND latest_gmp IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE status IN ('OPEN', 'CLOSED', 'LISTED')), 0), 2)
FROM ipos
UNION ALL
SELECT
    'Moneycontrol - Sector (All)',
    COUNT(*),
    COUNT(*) FILTER (WHERE sector IS NOT NULL),
    ROUND(100.0 * COUNT(*) FILTER (WHERE sector IS NOT NULL) / COUNT(*), 2)
FROM ipos
UNION ALL
SELECT
    'Moneycontrol - Description (All)',
    COUNT(*),
    COUNT(*) FILTER (WHERE description IS NOT NULL AND description != ''),
    ROUND(100.0 * COUNT(*) FILTER (WHERE description IS NOT NULL AND description != '') / COUNT(*), 2)
FROM ipos;
