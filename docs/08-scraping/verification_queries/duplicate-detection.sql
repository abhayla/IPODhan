-- =============================================================================
-- DUPLICATE DETECTION QUERIES (Section 3.2)
-- =============================================================================
-- Purpose: Detect duplicate and potentially duplicate IPO records
-- Expected: All queries should return 0 rows for a clean database
-- Severity: HIGH - Any duplicates found should be flagged immediately
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Check for duplicate company names
-- -----------------------------------------------------------------------------
-- Description: Finds IPOs with identical company names (exact duplicates)
-- Expected: 0 rows (no exact duplicates)
-- Action if found: Manual review required to determine if genuinely different
--                  or if merge/deletion needed
-- -----------------------------------------------------------------------------
SELECT
  company_name,
  COUNT(*) as duplicate_count,
  array_agg(id) as ipo_ids,
  array_agg(status) as statuses,
  array_agg(category) as categories,
  array_agg(listing_exchanges) as exchanges
FROM ipos
GROUP BY company_name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- -----------------------------------------------------------------------------
-- 2. Check for duplicate slugs
-- -----------------------------------------------------------------------------
-- Description: Finds IPOs with identical URL slugs
-- Expected: 0 rows (slugs MUST be unique for routing)
-- Action if found: CRITICAL - Fix immediately as this breaks URL routing
-- -----------------------------------------------------------------------------
SELECT
  slug,
  COUNT(*) as duplicate_count,
  array_agg(id) as ipo_ids,
  array_agg(company_name) as company_names
FROM ipos
GROUP BY slug
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- -----------------------------------------------------------------------------
-- 3. Check for potential fuzzy duplicates (similar names)
-- -----------------------------------------------------------------------------
-- Description: Finds IPOs with highly similar company names using pg_trgm extension
-- Expected: 0 rows or very few (legitimate similar names like "ABC Ltd" vs "ABC Limited")
-- Action if found: Manual review to determine if same company or different entities
-- Note: Requires pg_trgm extension. If extension not installed, this query will fail.
--       Install with: CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- -----------------------------------------------------------------------------

-- First, check if pg_trgm extension exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
    ) THEN
        RAISE NOTICE 'pg_trgm extension not installed. Run: CREATE EXTENSION pg_trgm;';
    END IF;
END $$;

-- Fuzzy duplicate detection (only runs if extension exists)
SELECT
  i1.id as id1,
  i1.company_name as name1,
  i2.id as id2,
  i2.company_name as name2,
  similarity(i1.company_name, i2.company_name) as similarity_score,
  i1.status as status1,
  i2.status as status2,
  i1.category as category1,
  i2.category as category2
FROM ipos i1
JOIN ipos i2 ON i1.id < i2.id
WHERE similarity(i1.company_name, i2.company_name) > 0.85
  AND i1.id != i2.id
ORDER BY similarity_score DESC;

-- Alternative fuzzy matching without pg_trgm extension (uses LIKE patterns)
-- Uncomment if pg_trgm is not available:
/*
WITH name_patterns AS (
  SELECT
    id,
    company_name,
    REGEXP_REPLACE(LOWER(company_name), '[^a-z0-9]', '', 'g') as clean_name
  FROM ipos
)
SELECT
  np1.id as id1,
  np1.company_name as name1,
  np2.id as id2,
  np2.company_name as name2,
  levenshtein(np1.clean_name, np2.clean_name) as edit_distance
FROM name_patterns np1
JOIN name_patterns np2 ON np1.id < np2.id
WHERE levenshtein(np1.clean_name, np2.clean_name) < 5
  AND np1.id != np2.id
ORDER BY edit_distance;
*/

-- -----------------------------------------------------------------------------
-- 4. Check for duplicate ISIN codes
-- -----------------------------------------------------------------------------
-- Description: Finds IPOs with identical ISIN (International Securities Identification Number)
-- Expected: 0 rows (ISIN should be unique per security)
-- Action if found: HIGH priority - indicates data quality issue or dual listing
-- -----------------------------------------------------------------------------
SELECT
  isin,
  COUNT(*) as duplicate_count,
  array_agg(id) as ipo_ids,
  array_agg(company_name) as company_names,
  array_agg(category) as categories
FROM ipos
WHERE isin IS NOT NULL AND isin != ''
GROUP BY isin
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- -----------------------------------------------------------------------------
-- 5. Check for duplicate stock symbols
-- -----------------------------------------------------------------------------
-- Description: Finds IPOs with identical stock symbols
-- Expected: 0 rows or few (same symbol on different exchanges is possible)
-- Action if found: Review to confirm different exchanges or genuine duplicates
-- -----------------------------------------------------------------------------
SELECT
  symbol,
  COUNT(*) as duplicate_count,
  array_agg(id) as ipo_ids,
  array_agg(company_name) as company_names,
  array_agg(listing_exchanges) as exchanges,
  array_agg(category) as categories
FROM ipos
WHERE symbol IS NOT NULL AND symbol != ''
GROUP BY symbol
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- -----------------------------------------------------------------------------
-- SUMMARY: Total duplicate count across all categories
-- -----------------------------------------------------------------------------
SELECT
  'Duplicate Company Names' as duplicate_type,
  COUNT(*) as affected_groups,
  SUM(duplicate_count - 1) as extra_records
FROM (
  SELECT company_name, COUNT(*) as duplicate_count
  FROM ipos
  GROUP BY company_name
  HAVING COUNT(*) > 1
) dup_names

UNION ALL

SELECT
  'Duplicate Slugs' as duplicate_type,
  COUNT(*) as affected_groups,
  SUM(duplicate_count - 1) as extra_records
FROM (
  SELECT slug, COUNT(*) as duplicate_count
  FROM ipos
  GROUP BY slug
  HAVING COUNT(*) > 1
) dup_slugs

UNION ALL

SELECT
  'Duplicate ISINs' as duplicate_type,
  COUNT(*) as affected_groups,
  SUM(duplicate_count - 1) as extra_records
FROM (
  SELECT isin, COUNT(*) as duplicate_count
  FROM ipos
  WHERE isin IS NOT NULL
  GROUP BY isin
  HAVING COUNT(*) > 1
) dup_isins

UNION ALL

SELECT
  'Duplicate Symbols' as duplicate_type,
  COUNT(*) as affected_groups,
  SUM(duplicate_count - 1) as extra_records
FROM (
  SELECT symbol, COUNT(*) as duplicate_count
  FROM ipos
  WHERE symbol IS NOT NULL
  GROUP BY symbol
  HAVING COUNT(*) > 1
) dup_symbols;

-- =============================================================================
-- END OF DUPLICATE DETECTION QUERIES
-- =============================================================================
