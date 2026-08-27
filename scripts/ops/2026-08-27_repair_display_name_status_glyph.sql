-- T-331 P3-2 -- repair company_name rows carrying a Chittorgarh status glyph.
--
-- WHY THIS EXISTS
-- Round 7 found "ABH Healthcare Ltd. O" published to users. The stripping rules
-- in sanitizeDisplayCompanyName (packages/shared/src/utils/company-name-normalizer.ts)
-- are CORRECT and have been since #42 -- verified by mutation test: disabling
-- either rule turns the new regression suite red. The published glyphs are rows
-- written BEFORE that sanitizer was wired at the IPORepository choke point.
-- Code fix + no data fix = the bad values stay on screen forever, which is why
-- a round-7 reviewer still saw them.
--
-- SAFETY
--   * SELECT-first. The UPDATE is commented out -- the deploy wave runs it after
--     eyeballing the preview, same convention as
--     2026-08-27_resolve_data_conflicts_noise.sql (T-331 P2-6).
--   * Mirrors ONLY the two glyph rules of sanitizeDisplayCompanyName. It does
--     NOT reimplement the HTML/parenthetical/IPO-suffix rules -- those already
--     applied at write time; widening this repair risks corrupting good names.
--   * The trailing-token strip is anchored to the legal suffix, so a genuine
--     short trailing word is never touched.
--   * Idempotent: re-running matches nothing once clean.
--
-- ROLLBACK
--   The preview SELECT captures id + the pre-image. Keep its output; restoring is
--   UPDATE ipos SET company_name = <old> WHERE id = <id>.

-- 1) PREVIEW -- what would change, and what it becomes.
SELECT
  id,
  company_name                                   AS before_name,
  regexp_replace(
    regexp_replace(company_name, '(\mLtd\.?|\mLimited)[[:space:]]+[A-Za-z]{1,2}$', '\1', 'i'),
    '[[:space:]]+(O|P|LT|CT)$', '', 'i'
  )                                              AS after_name,
  segment,
  status
FROM ipos
WHERE company_name ~* '(\mLtd\.?|\mLimited)[[:space:]]+[A-Za-z]{1,2}$'
   OR company_name ~* '[[:space:]]+(O|P|LT|CT)$'
ORDER BY company_name;

-- 2) COUNT -- expected small; a large number means the write choke point is not
--    actually applying the sanitizer and THAT is the bug to fix first.
SELECT count(*) AS glyph_rows FROM ipos
WHERE company_name ~* '(\mLtd\.?|\mLimited)[[:space:]]+[A-Za-z]{1,2}$'
   OR company_name ~* '[[:space:]]+(O|P|LT|CT)$';

-- 3) APPLY -- uncomment after reviewing (1) and (2).
-- BEGIN;
-- UPDATE ipos
--    SET company_name = regexp_replace(
--          regexp_replace(company_name, '(\mLtd\.?|\mLimited)[[:space:]]+[A-Za-z]{1,2}$', '\1', 'i'),
--          '[[:space:]]+(O|P|LT|CT)$', '', 'i'
--        ),
--        updated_at = now()
--  WHERE company_name ~* '(\mLtd\.?|\mLimited)[[:space:]]+[A-Za-z]{1,2}$'
--     OR company_name ~* '[[:space:]]+(O|P|LT|CT)$';
-- -- Verify 0 rows remain BEFORE committing:
-- SELECT count(*) AS should_be_zero FROM ipos
--  WHERE company_name ~* '(\mLtd\.?|\mLimited)[[:space:]]+[A-Za-z]{1,2}$'
--     OR company_name ~* '[[:space:]]+(O|P|LT|CT)$';
-- COMMIT;
