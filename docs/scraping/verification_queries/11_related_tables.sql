-- Section 3.11: Related Tables Verification

\echo '=== Subscriptions Table Coverage ==='
SELECT
    COUNT(DISTINCT i.id) as total_ipos,
    COUNT(DISTINCT s.ipo_id) as ipos_with_subscriptions,
    COUNT(s.id) as total_subscription_records,
    ROUND(100.0 * COUNT(DISTINCT s.ipo_id) / COUNT(DISTINCT i.id), 2) as ipo_coverage_percent,
    ROUND(AVG(sub_counts.record_count), 2) as avg_records_per_ipo
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipo_id
LEFT JOIN (
    SELECT ipo_id, COUNT(*) as record_count
    FROM subscriptions
    GROUP BY ipo_id
) sub_counts ON i.id = sub_counts.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED');

\echo ''
\echo '=== Subscriptions by IPO Status ==='
SELECT
    i.status,
    COUNT(DISTINCT i.id) as total_ipos,
    COUNT(DISTINCT s.ipo_id) as ipos_with_subscriptions,
    COUNT(s.id) as total_records,
    ROUND(100.0 * COUNT(DISTINCT s.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_percent
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipo_id
GROUP BY i.status
ORDER BY
    CASE i.status
        WHEN 'UPCOMING' THEN 1
        WHEN 'OPEN' THEN 2
        WHEN 'CLOSED' THEN 3
        WHEN 'LISTED' THEN 4
        ELSE 5
    END;

\echo ''
\echo '=== GMP Records Table Coverage ==='
SELECT
    COUNT(DISTINCT i.id) as total_ipos,
    COUNT(DISTINCT g.ipo_id) as ipos_with_gmp_records,
    COUNT(g.id) as total_gmp_records,
    ROUND(100.0 * COUNT(DISTINCT g.ipo_id) / COUNT(DISTINCT i.id), 2) as ipo_coverage_percent,
    ROUND(AVG(gmp_counts.record_count), 2) as avg_records_per_ipo
FROM ipos i
LEFT JOIN gmp_records g ON i.id = g.ipo_id
LEFT JOIN (
    SELECT ipo_id, COUNT(*) as record_count
    FROM gmp_records
    GROUP BY ipo_id
) gmp_counts ON i.id = gmp_counts.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED');

\echo ''
\echo '=== GMP Records by IPO Status ==='
SELECT
    i.status,
    COUNT(DISTINCT i.id) as total_ipos,
    COUNT(DISTINCT g.ipo_id) as ipos_with_gmp_records,
    COUNT(g.id) as total_records,
    ROUND(100.0 * COUNT(DISTINCT g.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_percent
FROM ipos i
LEFT JOIN gmp_records g ON i.id = g.ipo_id
GROUP BY i.status
ORDER BY
    CASE i.status
        WHEN 'UPCOMING' THEN 1
        WHEN 'OPEN' THEN 2
        WHEN 'CLOSED' THEN 3
        WHEN 'LISTED' THEN 4
        ELSE 5
    END;

\echo ''
\echo '=== Financial Data Table Coverage ==='
SELECT
    COUNT(DISTINCT i.id) as total_ipos,
    COUNT(DISTINCT f.ipo_id) as ipos_with_financial_data,
    COUNT(f.id) as total_financial_records,
    ROUND(100.0 * COUNT(DISTINCT f.ipo_id) / COUNT(DISTINCT i.id), 2) as ipo_coverage_percent
FROM ipos i
LEFT JOIN financial_data f ON i.id = f.ipo_id;

\echo ''
\echo '=== Financial Data Key Fields ==='
SELECT
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE revenue IS NOT NULL) as has_revenue,
    COUNT(*) FILTER (WHERE profit IS NOT NULL) as has_profit,
    COUNT(*) FILTER (WHERE total_assets IS NOT NULL) as has_total_assets,
    COUNT(*) FILTER (WHERE net_worth IS NOT NULL) as has_net_worth,
    COUNT(*) FILTER (WHERE eps IS NOT NULL) as has_eps,
    COUNT(*) FILTER (WHERE pe_ratio IS NOT NULL) as has_pe_ratio,
    COUNT(*) FILTER (WHERE roe IS NOT NULL) as has_roe,
    ROUND(100.0 * COUNT(*) FILTER (WHERE revenue IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as revenue_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE profit IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as profit_pct
FROM financial_data;

\echo ''
\echo '=== Documents Table Coverage ==='
SELECT
    COUNT(DISTINCT i.id) as total_ipos,
    COUNT(DISTINCT d.ipo_id) as ipos_with_documents,
    COUNT(d.id) as total_documents,
    ROUND(100.0 * COUNT(DISTINCT d.ipo_id) / COUNT(DISTINCT i.id), 2) as ipo_coverage_percent,
    ROUND(AVG(doc_counts.doc_count), 2) as avg_documents_per_ipo
FROM ipos i
LEFT JOIN documents d ON i.id = d.ipo_id
LEFT JOIN (
    SELECT ipo_id, COUNT(*) as doc_count
    FROM documents
    GROUP BY ipo_id
) doc_counts ON i.id = doc_counts.ipo_id;

\echo ''
\echo '=== Documents by Type ==='
SELECT
    document_type,
    COUNT(*) as count,
    COUNT(DISTINCT ipo_id) as unique_ipos
FROM documents
GROUP BY document_type
ORDER BY count DESC;

\echo ''
\echo '=== Listing Performance Table Coverage ==='
SELECT
    COUNT(DISTINCT i.id) as total_ipos,
    COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'LISTED') as listed_ipos,
    COUNT(DISTINCT lp.ipo_id) as ipos_with_listing_performance,
    COUNT(lp.id) as total_listing_records,
    ROUND(100.0 * COUNT(DISTINCT lp.ipo_id) / NULLIF(COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'LISTED'), 0), 2) as listed_coverage_percent
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id;

\echo ''
\echo '=== Listing Performance Key Fields ==='
SELECT
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE listing_price IS NOT NULL) as has_listing_price,
    COUNT(*) FILTER (WHERE open_price IS NOT NULL) as has_open_price,
    COUNT(*) FILTER (WHERE high_price IS NOT NULL) as has_high_price,
    COUNT(*) FILTER (WHERE low_price IS NOT NULL) as has_low_price,
    COUNT(*) FILTER (WHERE close_price IS NOT NULL) as has_close_price,
    COUNT(*) FILTER (WHERE volume IS NOT NULL) as has_volume,
    ROUND(100.0 * COUNT(*) FILTER (WHERE listing_price IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as listing_price_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE volume IS NOT NULL) / NULLIF(COUNT(*), 0), 2) as volume_pct
FROM listing_performance;

\echo ''
\echo '=== Registrars Table ==='
SELECT
    COUNT(*) as total_registrars,
    COUNT(DISTINCT i.registrar_id) as registrars_in_use,
    COUNT(DISTINCT i.id) FILTER (WHERE i.registrar_id IS NOT NULL) as ipos_with_registrar
FROM registrars r
LEFT JOIN ipos i ON r.id = i.registrar_id;

\echo ''
\echo '=== IPOs per Registrar ==='
SELECT
    r.id,
    r.name,
    COUNT(i.id) as ipo_count
FROM registrars r
LEFT JOIN ipos i ON r.id = i.registrar_id
GROUP BY r.id, r.name
ORDER BY ipo_count DESC
LIMIT 10;

\echo ''
\echo '=== Related Tables Summary ==='
SELECT
    'subscriptions' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT ipo_id) as unique_ipos,
    MIN(recorded_at) as earliest_date,
    MAX(recorded_at) as latest_date
FROM subscriptions
UNION ALL
SELECT
    'gmp_records',
    COUNT(*),
    COUNT(DISTINCT ipo_id),
    MIN(recorded_at),
    MAX(recorded_at)
FROM gmp_records
UNION ALL
SELECT
    'financial_data',
    COUNT(*),
    COUNT(DISTINCT ipo_id),
    MIN(created_at),
    MAX(updated_at)
FROM financial_data
UNION ALL
SELECT
    'documents',
    COUNT(*),
    COUNT(DISTINCT ipo_id),
    MIN(created_at),
    MAX(updated_at)
FROM documents
UNION ALL
SELECT
    'listing_performance',
    COUNT(*),
    COUNT(DISTINCT ipo_id),
    MIN(listing_date),
    MAX(updated_at)
FROM listing_performance;

\echo ''
\echo '=== Orphaned Records Check ==='
SELECT
    'subscriptions' as table_name,
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ipos WHERE id = subscriptions.ipo_id)) as orphaned_records
FROM subscriptions
UNION ALL
SELECT
    'gmp_records',
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ipos WHERE id = gmp_records.ipo_id))
FROM gmp_records
UNION ALL
SELECT
    'financial_data',
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ipos WHERE id = financial_data.ipo_id))
FROM financial_data
UNION ALL
SELECT
    'documents',
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ipos WHERE id = documents.ipo_id))
FROM documents
UNION ALL
SELECT
    'listing_performance',
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ipos WHERE id = listing_performance.ipo_id))
FROM listing_performance;
