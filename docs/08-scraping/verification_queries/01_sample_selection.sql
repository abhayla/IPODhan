-- Section 3.1: Sample IPO Selection
-- Select 5 IPOs from each status for testing

\echo '=== UPCOMING IPOs (Sample 5) ==='
SELECT id, slug, company_name, status, open_date, close_date
FROM ipos
WHERE status = 'UPCOMING'
ORDER BY open_date ASC NULLS LAST
LIMIT 5;

\echo ''
\echo '=== OPEN IPOs (Sample 5) ==='
SELECT id, slug, company_name, status, open_date, close_date
FROM ipos
WHERE status = 'OPEN'
ORDER BY open_date DESC
LIMIT 5;

\echo ''
\echo '=== CLOSED IPOs (Sample 5) ==='
SELECT id, slug, company_name, status, close_date, allotment_date
FROM ipos
WHERE status = 'CLOSED'
ORDER BY close_date DESC
LIMIT 5;

\echo ''
\echo '=== LISTED IPOs (Sample 5) ==='
SELECT id, slug, company_name, status, listing_date
FROM ipos
WHERE status = 'LISTED'
ORDER BY listing_date DESC NULLS LAST
LIMIT 5;

\echo ''
\echo '=== Total IPO Count by Status ==='
SELECT status, COUNT(*) as count
FROM ipos
GROUP BY status
ORDER BY status;
