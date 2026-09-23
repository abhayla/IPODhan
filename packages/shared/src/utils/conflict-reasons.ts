/**
 * OD-75 (owner, 2026-09-23): the named `data_conflicts.resolution_reason` for a source changing a
 * value IT set earlier, where it has no right to refresh it. The page keeps the old value (OD-73);
 * the admin conflicts list shows the change under this reason; it is never alerted (the
 * cross-source disagreement monitor reads only `source1 <> source2`). One definition: the writer
 * (scraper data-consolidation-service.ts) sets it, the repository's W-79 same-source guard admits
 * only it.
 */
export const SOURCE_CHANGED_OWN_VALUE = 'SOURCE_CHANGED_OWN_VALUE';
