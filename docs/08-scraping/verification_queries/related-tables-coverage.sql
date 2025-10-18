-- =============================================================================
-- RELATED TABLES COVERAGE REPORT (Section 3.11)
-- =============================================================================
-- Purpose: Verify relationship coverage between ipos table and related tables
-- Shows how many IPOs have associated data in subscriptions, gmp_records,
-- documents, listing_performance, and other related tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Subscriptions Table Coverage
-- -----------------------------------------------------------------------------
-- Description: Shows how many IPOs have subscription data
-- Expected: All OPEN and CLOSED IPOs should have subscription records
-- -----------------------------------------------------------------------------
SELECT
  i.status,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT s.ipo_id) as ipos_with_subscriptions,
  COUNT(DISTINCT i.id) - COUNT(DISTINCT s.ipo_id) as ipos_without_subscriptions,
  ROUND(100.0 * COUNT(DISTINCT s.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct,
  COUNT(s.id) as total_subscription_records,
  ROUND(AVG(CASE WHEN s.ipo_id IS NOT NULL THEN sub_count ELSE 0 END), 1) as avg_records_per_ipo
FROM ipos i
LEFT JOIN subscriptions s ON s.ipo_id = i.id
LEFT JOIN (
  SELECT ipo_id, COUNT(*) as sub_count
  FROM subscriptions
  GROUP BY ipo_id
) sub_counts ON sub_counts.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.status
ORDER BY
  CASE i.status
    WHEN 'OPEN' THEN 1
    WHEN 'CLOSED' THEN 2
    WHEN 'LISTED' THEN 3
  END;

-- -----------------------------------------------------------------------------
-- 2. IPOs Missing Subscription Data (Should Have It)
-- -----------------------------------------------------------------------------
-- Description: Lists IPOs that should have subscriptions but don't
-- Expected: Minimal results (only edge cases)
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.status,
  i.category,
  i.open_date,
  i.close_date,
  i.listing_exchanges,
  COUNT(s.id) as subscription_record_count,
  i.last_scraped_at
FROM ipos i
LEFT JOIN subscriptions s ON s.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED')
  AND i.category = 'MAINBOARD'
  AND i.listing_exchanges @> '["NSE"]'::jsonb
GROUP BY i.id, i.company_name, i.status, i.category, i.open_date, i.close_date, i.listing_exchanges, i.last_scraped_at
HAVING COUNT(s.id) = 0
ORDER BY i.status, i.open_date DESC;

-- -----------------------------------------------------------------------------
-- 3. GMP Records Coverage
-- -----------------------------------------------------------------------------
-- Description: Shows how many IPOs have GMP tracking data
-- Expected: Most OPEN/CLOSED/LISTED IPOs should have GMP records
-- -----------------------------------------------------------------------------
SELECT
  i.category,
  i.status,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT g.ipo_id) as ipos_with_gmp_data,
  COUNT(DISTINCT i.id) - COUNT(DISTINCT g.ipo_id) as ipos_without_gmp_data,
  ROUND(100.0 * COUNT(DISTINCT g.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct,
  COUNT(g.id) as total_gmp_records,
  ROUND(AVG(CASE WHEN g.ipo_id IS NOT NULL THEN gmp_count ELSE 0 END), 1) as avg_records_per_ipo
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
LEFT JOIN (
  SELECT ipo_id, COUNT(*) as gmp_count
  FROM gmp_records
  GROUP BY ipo_id
) gmp_counts ON gmp_counts.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.category, i.status
ORDER BY i.category, i.status;

-- -----------------------------------------------------------------------------
-- 4. IPOs Missing GMP Data (Should Have It)
-- -----------------------------------------------------------------------------
-- Description: Lists IPOs that should have GMP data but don't
-- Expected: Some results acceptable (not all IPOs have grey market activity)
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.status,
  i.category,
  i.open_date,
  i.close_date,
  COUNT(g.id) as gmp_record_count,
  i.gmp_price as current_gmp_in_ipos_table,
  i.last_scraped_at
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.company_name, i.status, i.category, i.open_date, i.close_date, i.gmp_price, i.last_scraped_at
HAVING COUNT(g.id) = 0
ORDER BY i.status, i.category, i.close_date DESC NULLS LAST
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 5. Documents Coverage
-- -----------------------------------------------------------------------------
-- Description: Shows how many IPOs have associated documents
-- Expected: Most IPOs should have at least DRHP or RHP documents
-- -----------------------------------------------------------------------------
SELECT
  i.category,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT d.ipo_id) as ipos_with_documents,
  COUNT(DISTINCT i.id) - COUNT(DISTINCT d.ipo_id) as ipos_without_documents,
  ROUND(100.0 * COUNT(DISTINCT d.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct,
  COUNT(d.id) as total_documents,
  ROUND(AVG(CASE WHEN d.ipo_id IS NOT NULL THEN doc_count ELSE 0 END), 1) as avg_docs_per_ipo
FROM ipos i
LEFT JOIN documents d ON d.ipo_id = i.id
LEFT JOIN (
  SELECT ipo_id, COUNT(*) as doc_count
  FROM documents
  GROUP BY ipo_id
) doc_counts ON doc_counts.ipo_id = i.id
GROUP BY i.category
ORDER BY i.category;

-- -----------------------------------------------------------------------------
-- 6. Document Type Distribution
-- -----------------------------------------------------------------------------
-- Description: Shows distribution of document types across IPOs
-- Expected: Most IPOs should have DRHP and/or RHP
-- -----------------------------------------------------------------------------
SELECT
  d.document_type,
  COUNT(DISTINCT d.ipo_id) as ipos_with_this_doc_type,
  COUNT(*) as total_documents_of_this_type,
  ROUND(100.0 * COUNT(DISTINCT d.ipo_id) / (SELECT COUNT(*) FROM ipos), 2) as ipo_coverage_pct
FROM documents d
GROUP BY d.document_type
ORDER BY total_documents_of_this_type DESC;

-- -----------------------------------------------------------------------------
-- 7. IPOs Missing Documents (Should Have Them)
-- -----------------------------------------------------------------------------
-- Description: Lists IPOs without any documents
-- Expected: UPCOMING IPOs may not have documents yet; others should
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.status,
  i.category,
  i.open_date,
  COUNT(d.id) as document_count,
  i.last_scraped_at
FROM ipos i
LEFT JOIN documents d ON d.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.company_name, i.status, i.category, i.open_date, i.last_scraped_at
HAVING COUNT(d.id) = 0
ORDER BY
  CASE i.status
    WHEN 'LISTED' THEN 1
    WHEN 'CLOSED' THEN 2
    WHEN 'OPEN' THEN 3
  END,
  i.open_date DESC NULLS LAST
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 8. Listing Performance Coverage
-- -----------------------------------------------------------------------------
-- Description: Shows how many LISTED IPOs have listing performance data
-- Expected: All LISTED IPOs should have listing performance records
-- -----------------------------------------------------------------------------
SELECT
  COUNT(DISTINCT i.id) as total_listed_ipos,
  COUNT(DISTINCT lp.ipo_id) as listed_ipos_with_performance_data,
  COUNT(DISTINCT i.id) - COUNT(DISTINCT lp.ipo_id) as listed_ipos_without_performance_data,
  ROUND(100.0 * COUNT(DISTINCT lp.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN listing_performance lp ON lp.ipo_id = i.id
WHERE i.status = 'LISTED';

-- -----------------------------------------------------------------------------
-- 9. LISTED IPOs Missing Listing Performance Data
-- -----------------------------------------------------------------------------
-- Description: Lists LISTED IPOs without listing performance records
-- Expected: 0 rows (all LISTED IPOs should have this data)
-- Severity: HIGH if any found
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.category,
  i.listing_date,
  i.listing_price_historical,
  i.listing_exchanges,
  COUNT(lp.id) as listing_performance_record_count,
  i.last_scraped_at
FROM ipos i
LEFT JOIN listing_performance lp ON lp.ipo_id = i.id
WHERE i.status = 'LISTED'
GROUP BY i.id, i.company_name, i.category, i.listing_date, i.listing_price_historical, i.listing_exchanges, i.last_scraped_at
HAVING COUNT(lp.id) = 0
ORDER BY i.listing_date DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- 10. Financial Data Coverage (Legacy Table)
-- -----------------------------------------------------------------------------
-- Description: Shows coverage of financial_data table
-- Note: This is a legacy table; ipoFinancials is the newer version
-- Expected: May have low coverage as it's being deprecated
-- -----------------------------------------------------------------------------
SELECT
  i.category,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT fd.ipo_id) as ipos_with_financial_data,
  ROUND(100.0 * COUNT(DISTINCT fd.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN financial_data fd ON fd.ipo_id = i.id
GROUP BY i.category
ORDER BY i.category;

-- -----------------------------------------------------------------------------
-- 11. IPO Financials Coverage (New Table)
-- -----------------------------------------------------------------------------
-- Description: Shows coverage of ipo_financials table (enhanced financial data)
-- Expected: Varies by IPO (not all disclose detailed financials)
-- -----------------------------------------------------------------------------
SELECT
  i.category,
  i.status,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT ipof.ipo_id) as ipos_with_enhanced_financials,
  ROUND(100.0 * COUNT(DISTINCT ipof.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN ipo_financials ipof ON ipof.ipo_id = i.id
GROUP BY i.category, i.status
ORDER BY i.category, i.status;

-- -----------------------------------------------------------------------------
-- 12. IPO Details Coverage (Extended Details Table)
-- -----------------------------------------------------------------------------
-- Description: Shows coverage of ipo_details table
-- Expected: Good coverage for key IPOs
-- -----------------------------------------------------------------------------
SELECT
  i.category,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT ipod.ipo_id) as ipos_with_extended_details,
  ROUND(100.0 * COUNT(DISTINCT ipod.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN ipo_details ipod ON ipod.ipo_id = i.id
GROUP BY i.category
ORDER BY i.category;

-- -----------------------------------------------------------------------------
-- 13. Peer Companies Coverage
-- -----------------------------------------------------------------------------
-- Description: Shows how many IPOs have peer comparison data
-- Expected: Low to medium coverage (feature may not be fully implemented)
-- -----------------------------------------------------------------------------
SELECT
  i.category,
  i.sector,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT pc.ipo_id) as ipos_with_peer_data,
  ROUND(100.0 * COUNT(DISTINCT pc.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct,
  COUNT(pc.id) as total_peer_company_records
FROM ipos i
LEFT JOIN peer_companies pc ON pc.ipo_id = i.id
WHERE i.sector IS NOT NULL
GROUP BY i.category, i.sector
ORDER BY total_peer_company_records DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 14. IPO Reviews Coverage
-- -----------------------------------------------------------------------------
-- Description: Shows how many IPOs have analyst reviews
-- Expected: Low to medium coverage (manual/editorial content)
-- -----------------------------------------------------------------------------
SELECT
  i.status,
  i.category,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT r.ipo_id) as ipos_with_reviews,
  ROUND(100.0 * COUNT(DISTINCT r.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct,
  COUNT(r.id) as total_reviews
FROM ipos i
LEFT JOIN ipo_reviews r ON r.ipo_id = i.id
GROUP BY i.status, i.category
ORDER BY i.category, i.status;

-- -----------------------------------------------------------------------------
-- 15. IPO Scores Coverage (AI Scoring System)
-- -----------------------------------------------------------------------------
-- Description: Shows how many IPOs have AI-generated scores
-- Expected: Variable coverage (feature may be in development)
-- -----------------------------------------------------------------------------
SELECT
  i.category,
  i.status,
  COUNT(DISTINCT i.id) as total_ipo_count,
  COUNT(DISTINCT scores.ipo_id) as ipos_with_scores,
  ROUND(100.0 * COUNT(DISTINCT scores.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN ipo_scores scores ON scores.ipo_id = i.id
WHERE i.status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
GROUP BY i.category, i.status
ORDER BY i.category, i.status;

-- -----------------------------------------------------------------------------
-- 16. Comprehensive Relationship Coverage Matrix
-- -----------------------------------------------------------------------------
-- Description: Single view showing all relationship coverage percentages
-- Expected: Helps identify which relationships need attention
-- -----------------------------------------------------------------------------
WITH relationship_stats AS (
  SELECT
    i.id,
    i.company_name,
    i.status,
    i.category,
    CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_subscriptions,
    CASE WHEN EXISTS (SELECT 1 FROM gmp_records WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_gmp,
    CASE WHEN EXISTS (SELECT 1 FROM documents WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_documents,
    CASE WHEN EXISTS (SELECT 1 FROM listing_performance WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_listing_perf,
    CASE WHEN EXISTS (SELECT 1 FROM ipo_financials WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_financials,
    CASE WHEN EXISTS (SELECT 1 FROM ipo_details WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_details,
    CASE WHEN EXISTS (SELECT 1 FROM peer_companies WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_peers,
    CASE WHEN EXISTS (SELECT 1 FROM ipo_reviews WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_reviews,
    CASE WHEN EXISTS (SELECT 1 FROM ipo_scores WHERE ipo_id = i.id) THEN 1 ELSE 0 END as has_scores
  FROM ipos i
)
SELECT
  status,
  COUNT(*) as total_ipos,
  ROUND(100.0 * SUM(has_subscriptions) / COUNT(*), 1) as subscriptions_pct,
  ROUND(100.0 * SUM(has_gmp) / COUNT(*), 1) as gmp_pct,
  ROUND(100.0 * SUM(has_documents) / COUNT(*), 1) as documents_pct,
  ROUND(100.0 * SUM(has_listing_perf) / COUNT(*), 1) as listing_perf_pct,
  ROUND(100.0 * SUM(has_financials) / COUNT(*), 1) as financials_pct,
  ROUND(100.0 * SUM(has_details) / COUNT(*), 1) as details_pct,
  ROUND(100.0 * SUM(has_peers) / COUNT(*), 1) as peers_pct,
  ROUND(100.0 * SUM(has_reviews) / COUNT(*), 1) as reviews_pct,
  ROUND(100.0 * SUM(has_scores) / COUNT(*), 1) as scores_pct
FROM relationship_stats
GROUP BY status
ORDER BY
  CASE status
    WHEN 'OPEN' THEN 1
    WHEN 'UPCOMING' THEN 2
    WHEN 'CLOSED' THEN 3
    WHEN 'LISTED' THEN 4
  END;

-- -----------------------------------------------------------------------------
-- 17. IPOs with Complete Related Data (Gold Standard)
-- -----------------------------------------------------------------------------
-- Description: IPOs that have data in all major related tables
-- Purpose: Examples of comprehensively scraped IPOs
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.status,
  i.category,
  CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE ipo_id = i.id) THEN '✓' ELSE '✗' END as subscriptions,
  CASE WHEN EXISTS (SELECT 1 FROM gmp_records WHERE ipo_id = i.id) THEN '✓' ELSE '✗' END as gmp,
  CASE WHEN EXISTS (SELECT 1 FROM documents WHERE ipo_id = i.id) THEN '✓' ELSE '✗' END as documents,
  CASE WHEN EXISTS (SELECT 1 FROM listing_performance WHERE ipo_id = i.id AND i.status = 'LISTED') THEN '✓'
       WHEN i.status != 'LISTED' THEN 'N/A'
       ELSE '✗' END as listing_perf,
  (
    CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE ipo_id = i.id) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (SELECT 1 FROM gmp_records WHERE ipo_id = i.id) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (SELECT 1 FROM documents WHERE ipo_id = i.id) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (SELECT 1 FROM ipo_financials WHERE ipo_id = i.id) THEN 1 ELSE 0 END
  ) as completeness_score
FROM ipos i
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
ORDER BY completeness_score DESC, i.company_name
LIMIT 15;

-- -----------------------------------------------------------------------------
-- 18. IPOs with Minimal Related Data (Needing Attention)
-- -----------------------------------------------------------------------------
-- Description: IPOs with little to no related table data
-- Purpose: Identify IPOs that need comprehensive re-scraping
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.status,
  i.category,
  i.open_date,
  CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE ipo_id = i.id) THEN '✓' ELSE '✗' END as subscriptions,
  CASE WHEN EXISTS (SELECT 1 FROM gmp_records WHERE ipo_id = i.id) THEN '✓' ELSE '✗' END as gmp,
  CASE WHEN EXISTS (SELECT 1 FROM documents WHERE ipo_id = i.id) THEN '✓' ELSE '✗' END as documents,
  (
    CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE ipo_id = i.id) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (SELECT 1 FROM gmp_records WHERE ipo_id = i.id) THEN 1 ELSE 0 END +
    CASE WHEN EXISTS (SELECT 1 FROM documents WHERE ipo_id = i.id) THEN 1 ELSE 0 END
  ) as completeness_score,
  i.last_scraped_at
FROM ipos i
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
ORDER BY completeness_score ASC, i.status, i.open_date DESC NULLS LAST
LIMIT 15;

-- -----------------------------------------------------------------------------
-- SUMMARY: Overall Related Tables Health
-- -----------------------------------------------------------------------------
SELECT
  'Subscriptions' as table_name,
  (SELECT COUNT(DISTINCT ipo_id) FROM subscriptions) as ipos_covered,
  (SELECT COUNT(*) FROM ipos WHERE status IN ('OPEN', 'CLOSED')) as total_eligible_ipos,
  ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM subscriptions) /
    NULLIF((SELECT COUNT(*) FROM ipos WHERE status IN ('OPEN', 'CLOSED')), 0), 2) as coverage_pct,
  (SELECT COUNT(*) FROM subscriptions) as total_records

UNION ALL

SELECT
  'GMP Records',
  (SELECT COUNT(DISTINCT ipo_id) FROM gmp_records),
  (SELECT COUNT(*) FROM ipos WHERE status IN ('OPEN', 'CLOSED', 'LISTED')),
  ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM gmp_records) /
    NULLIF((SELECT COUNT(*) FROM ipos WHERE status IN ('OPEN', 'CLOSED', 'LISTED')), 0), 2),
  (SELECT COUNT(*) FROM gmp_records)

UNION ALL

SELECT
  'Documents',
  (SELECT COUNT(DISTINCT ipo_id) FROM documents),
  (SELECT COUNT(*) FROM ipos),
  ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM documents) /
    NULLIF((SELECT COUNT(*) FROM ipos), 0), 2),
  (SELECT COUNT(*) FROM documents)

UNION ALL

SELECT
  'Listing Performance',
  (SELECT COUNT(DISTINCT ipo_id) FROM listing_performance),
  (SELECT COUNT(*) FROM ipos WHERE status = 'LISTED'),
  ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM listing_performance) /
    NULLIF((SELECT COUNT(*) FROM ipos WHERE status = 'LISTED'), 0), 2),
  (SELECT COUNT(*) FROM listing_performance)

UNION ALL

SELECT
  'IPO Financials',
  (SELECT COUNT(DISTINCT ipo_id) FROM ipo_financials),
  (SELECT COUNT(*) FROM ipos),
  ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM ipo_financials) /
    NULLIF((SELECT COUNT(*) FROM ipos), 0), 2),
  (SELECT COUNT(*) FROM ipo_financials)

UNION ALL

SELECT
  'IPO Details',
  (SELECT COUNT(DISTINCT ipo_id) FROM ipo_details),
  (SELECT COUNT(*) FROM ipos),
  ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM ipo_details) /
    NULLIF((SELECT COUNT(*) FROM ipos), 0), 2),
  (SELECT COUNT(*) FROM ipo_details)

ORDER BY coverage_pct DESC;

-- =============================================================================
-- END OF RELATED TABLES COVERAGE QUERIES
-- =============================================================================
