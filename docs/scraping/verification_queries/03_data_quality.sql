-- Section 3.3: Data Quality Validation

\echo '=== Date Ordering Violations (open_date >= close_date) ==='
SELECT id, slug, company_name, status, open_date, close_date
FROM ipos
WHERE open_date IS NOT NULL
    AND close_date IS NOT NULL
    AND open_date >= close_date
ORDER BY open_date DESC
LIMIT 20;

\echo ''
\echo '=== Close Date >= Allotment Date Violations ==='
SELECT id, slug, company_name, status, close_date, allotment_date
FROM ipos
WHERE close_date IS NOT NULL
    AND allotment_date IS NOT NULL
    AND close_date >= allotment_date
ORDER BY close_date DESC
LIMIT 20;

\echo ''
\echo '=== Allotment Date >= Listing Date Violations ==='
SELECT id, slug, company_name, status, allotment_date, listing_date
FROM ipos
WHERE allotment_date IS NOT NULL
    AND listing_date IS NOT NULL
    AND allotment_date >= listing_date
ORDER BY allotment_date DESC
LIMIT 20;

\echo ''
\echo '=== Price Range Violations (min >= max) ==='
SELECT id, slug, company_name, price_range_min, price_range_max
FROM ipos
WHERE price_range_min IS NOT NULL
    AND price_range_max IS NOT NULL
    AND price_range_min >= price_range_max
LIMIT 20;

\echo ''
\echo '=== Negative or Zero Price Values ==='
SELECT id, slug, company_name, price_range_min, price_range_max
FROM ipos
WHERE (price_range_min IS NOT NULL AND price_range_min <= 0)
    OR (price_range_max IS NOT NULL AND price_range_max <= 0)
LIMIT 20;

\echo ''
\echo '=== Negative or Zero Issue Size ==='
SELECT id, slug, company_name, issue_size
FROM ipos
WHERE issue_size IS NOT NULL AND issue_size <= 0
LIMIT 20;

\echo ''
\echo '=== Negative or Zero Lot Size ==='
SELECT id, slug, company_name, lot_size
FROM ipos
WHERE lot_size IS NOT NULL AND lot_size <= 0
LIMIT 20;

\echo ''
\echo '=== Negative or Zero Face Value ==='
SELECT id, slug, company_name, face_value
FROM ipos
WHERE face_value IS NOT NULL AND face_value <= 0
LIMIT 20;

\echo ''
\echo '=== Empty Listing Exchanges Array ==='
SELECT id, slug, company_name, listing_exchanges, category
FROM ipos
WHERE listing_exchanges IS NOT NULL
    AND jsonb_array_length(listing_exchanges) = 0
LIMIT 20;

\echo ''
\echo '=== Future Dates (> 1 year from now) ==='
SELECT id, slug, company_name,
    CASE
        WHEN open_date > CURRENT_DATE + INTERVAL '1 year' THEN 'open_date: ' || open_date::text
        WHEN close_date > CURRENT_DATE + INTERVAL '1 year' THEN 'close_date: ' || close_date::text
        WHEN allotment_date > CURRENT_DATE + INTERVAL '1 year' THEN 'allotment_date: ' || allotment_date::text
        WHEN listing_date > CURRENT_DATE + INTERVAL '1 year' THEN 'listing_date: ' || listing_date::text
    END as future_date
FROM ipos
WHERE open_date > CURRENT_DATE + INTERVAL '1 year'
    OR close_date > CURRENT_DATE + INTERVAL '1 year'
    OR allotment_date > CURRENT_DATE + INTERVAL '1 year'
    OR listing_date > CURRENT_DATE + INTERVAL '1 year'
LIMIT 20;

\echo ''
\echo '=== Negative Subscription Multiples ==='
SELECT id, slug, company_name,
    qib_subscription, nii_subscription, retail_subscription, total_subscription
FROM ipos
WHERE (qib_subscription IS NOT NULL AND qib_subscription < 0)
    OR (nii_subscription IS NOT NULL AND nii_subscription < 0)
    OR (retail_subscription IS NOT NULL AND retail_subscription < 0)
    OR (total_subscription IS NOT NULL AND total_subscription < 0)
LIMIT 20;

\echo ''
\echo '=== Data Quality Summary ==='
SELECT
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE open_date IS NOT NULL AND close_date IS NOT NULL AND open_date >= close_date) as date_ordering_violations,
    COUNT(*) FILTER (WHERE price_range_min IS NOT NULL AND price_range_max IS NOT NULL AND price_range_min >= price_range_max) as price_range_violations,
    COUNT(*) FILTER (WHERE (price_range_min IS NOT NULL AND price_range_min <= 0) OR (price_range_max IS NOT NULL AND price_range_max <= 0)) as negative_prices,
    COUNT(*) FILTER (WHERE issue_size IS NOT NULL AND issue_size <= 0) as negative_issue_size,
    COUNT(*) FILTER (WHERE lot_size IS NOT NULL AND lot_size <= 0) as negative_lot_size,
    COUNT(*) FILTER (WHERE listing_exchanges IS NOT NULL AND jsonb_array_length(listing_exchanges) = 0) as empty_exchanges
FROM ipos;
