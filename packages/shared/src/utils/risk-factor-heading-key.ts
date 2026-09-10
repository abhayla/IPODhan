/**
 * Canonical risk-factor heading key — item 1 slice s6.
 *
 * ONE source of truth for turning an `ipo_risk_factors.heading` into the row's
 * identity. Lives beside `company-name-normalizer.ts` (the other row-key
 * normaliser, slices s1/s1b) and is exported once: `packages/shared` is
 * importable from BOTH `web` and `scraper` as `@ipodhan/shared/utils/...`, so
 * there is no module-layout reason for a web-side copy, and none exists. The
 * repo's byte-parallel-duplicate failure (web/lib/db/schema.ts) is exactly what
 * a second copy would reproduce.
 *
 * WHY the heading and not `seq`: `seq` is a position in the extracted array. A
 * DRHP and the later RHP commonly add, drop or reorder risk factors, so the
 * same fact lands at a different `seq` and any provenance keyed on it is
 * mis-attributed across the reorder. The heading's normalized CONTENT survives
 * reordering; a genuinely reworded heading becomes a new row, which is correct
 * (it is a different fact, not the same fact renumbered).
 */

import { createHash } from 'node:crypto';

/** Lowercase, strip punctuation/symbols, collapse whitespace, trim. */
export function normalizeHeading(heading: string | null | undefined): string {
  return (heading ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The row key: first 16 hex characters of sha256 over the normalized heading.
 *
 * Junk fallback: a heading that is non-empty but normalizes to '' (pure
 * punctuation, e.g. "---") would otherwise hash to ONE constant, making every
 * junk heading on an IPO the same row. It is hashed over the TRIMMED RAW
 * heading instead — stable across re-extractions (it depends only on the
 * heading, never on a row id or a timestamp, which a delete-then-insert write
 * path regenerates), and it cannot change any non-junk key. Mirrors the junk
 * path in `rowKeyForName`.
 *
 * Returns null when the heading carries no content at all — such a row is not a
 * risk factor and must not be written.
 */
export function headingHashForRiskFactor(heading: string | null | undefined): string | null {
  const normalized = normalizeHeading(heading);
  const source = normalized !== '' ? normalized : (heading ?? '').trim();
  if (source === '') return null;
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}
