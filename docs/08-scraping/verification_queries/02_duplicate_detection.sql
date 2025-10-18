-- Section 3.2: Duplicate Detection

\echo '=== Duplicate Company Names ==='
SELECT company_name, COUNT(*) as count, array_agg(id) as ipo_ids, array_agg(slug) as slugs
FROM ipos
GROUP BY company_name
HAVING COUNT(*) > 1
ORDER BY count DESC;

\echo ''
\echo '=== Duplicate Slugs ==='
SELECT slug, COUNT(*) as count, array_agg(id) as ipo_ids, array_agg(company_name) as companies
FROM ipos
GROUP BY slug
HAVING COUNT(*) > 1
ORDER BY count DESC;

\echo ''
\echo '=== Fuzzy Duplicate Detection (Similarity > 0.85) ==='
-- Using trigram similarity
SELECT
    a.id as id1,
    b.id as id2,
    a.company_name as name1,
    b.company_name as name2,
    similarity(a.company_name, b.company_name) as similarity_score
FROM ipos a
CROSS JOIN ipos b
WHERE a.id < b.id
    AND similarity(a.company_name, b.company_name) > 0.85
ORDER BY similarity_score DESC
LIMIT 20;

\echo ''
\echo '=== Total Unique Companies vs Total IPOs ==='
SELECT
    COUNT(*) as total_ipos,
    COUNT(DISTINCT company_name) as unique_companies,
    COUNT(*) - COUNT(DISTINCT company_name) as potential_duplicates
FROM ipos;
