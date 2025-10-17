-- BSE Detail Page Implementation Verification
-- Issue #2 Results

-- Total IPO counts
SELECT
  'Total IPOs' as metric,
  COUNT(*) as count
FROM ipos
UNION ALL
SELECT
  'BSE IPOs',
  COUNT(*)
FROM ipos
WHERE listing_exchange = 'BSE'
UNION ALL
SELECT
  'NSE IPOs',
  COUNT(*)
FROM ipos
WHERE listing_exchange = 'NSE';

-- BSE Data Completeness
SELECT
  'BSE: Issue Size > 0' as metric,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ipos WHERE listing_exchange = 'BSE'), 1) as percentage
FROM ipos
WHERE listing_exchange = 'BSE' AND issue_size > 0
UNION ALL
SELECT
  'BSE: Lot Size > 0',
  COUNT(*),
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ipos WHERE listing_exchange = 'BSE'), 1)
FROM ipos
WHERE listing_exchange = 'BSE' AND lot_size > 0
UNION ALL
SELECT
  'BSE: Registrar Populated',
  COUNT(*),
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ipos WHERE listing_exchange = 'BSE'), 1)
FROM ipos
WHERE listing_exchange = 'BSE' AND registrar IS NOT NULL AND registrar != '';

-- Sample enriched IPOs
SELECT
  company_name,
  ROUND(issue_size / 10000000.0, 2) as issue_size_cr,
  lot_size,
  face_value,
  COALESCE(registrar, 'N/A') as registrar,
  COALESCE(symbol, 'N/A') as symbol
FROM ipos
WHERE listing_exchange = 'BSE'
  AND issue_size > 0
  AND lot_size > 0
  AND registrar IS NOT NULL
LIMIT 5;
