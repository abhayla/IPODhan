/**
 * Detection check `not_applicable_documents_named` (lane B, NOT_APPLICABLE
 * reporting slice, 2026-09-16).
 *
 * `ratios_extraction_yield` (docs/reviews/detection-checks/ratios_extraction_yield.json,
 * retired by this change — see `notCoveredByThisManifest`) counted
 * RATIOS_BASIS_ISSUE_PRICE documents extracted-with-no-ratio, on a type
 * `scripts/extract_filing.py` never handles by design
 * (`scraper/src/services/filing-auto-persist.ts` EXTRACTABLE_DOC_TYPES /
 * AUTO_PERSIST_DOC_TYPES — RHP, DRHP, PROSPECTUS, PRICE_BAND_AD, plus the
 * anchor report via its own extractor). Every one of those 34 documents was
 * PENDING and could never move, so the check reported UNVERIFIABLE every
 * night with a P1 notify, and on 2026-09-15 that read as "38 documents stuck"
 * and cost an hour of investigation into a queue that was never a queue.
 *
 * The real ratio-population check is `issuer_ratio_yield` (#670), which reads
 * financial_data rows produced from RHP/DRHP/PROSPECTUS — a type the pipeline
 * actually extracts.
 *
 * This module replaces the ratio-specific measurement with an honest report:
 * for every document type PENDING that has NO extractor at all, name the type
 * and the count, and say plainly that this is not a queue. It always PASSES
 * (there is nothing here that can fail — the type having no extractor is a
 * design fact, not a defect) unless the query itself cannot be read, which is
 * UNVERIFIABLE. Its purpose is not to catch a regression; it is to put the
 * number in front of a human with the words that stop it from being misread
 * as backlog.
 */

/**
 * Mirror of `AUTO_PERSIST_DOC_TYPES` in
 * `scraper/src/services/filing-auto-persist.ts` (via `isExtractableDocType`).
 * Mirrored, not imported — this audit runs as plain Node with no TypeScript
 * toolchain, same convention as `scripts/lib/document-state-checks.mjs`'s
 * other mirrored constants. Keep this list and the scraper's
 * `AUTO_PERSIST_DOC_TYPES` in sync by hand; a drift here under- or
 * over-reports which PENDING documents are "not applicable".
 */
export const EXTRACTABLE_DOC_TYPES_MIRROR = [
  'PRICE_BAND_AD',
  'RHP',
  'DRHP',
  'PROSPECTUS',
  'ANCHOR_ALLOCATION_REPORT',
];

export const NOT_APPLICABLE_CHECK_NAME =
  'PENDING documents of a type with no extractor are named, not counted as stuck';

/**
 * @param {{byType: Array<{type: string, pending: number}>}} input
 */
export function summariseNotApplicableDocuments({ byType }) {
  if (!Array.isArray(byType)) {
    throw new TypeError('byType must be an array');
  }

  const nonZero = byType.filter((row) => row.pending > 0);

  if (nonZero.length === 0) {
    return {
      status: 'PASS',
      detail: 'no PENDING document of a never-extracted type — nothing to name',
    };
  }

  const total = nonZero.reduce((sum, row) => sum + row.pending, 0);
  const named = nonZero.map((row) => `${row.type} ${row.pending}`).join(', ');

  return {
    status: 'PASS',
    detail:
      `${total} document(s) of never-extracted types sit PENDING by design (${named}); ` +
      'no extractor exists for them; this is not a queue',
  };
}

/**
 * Reads the population, then delegates the verdict to the pure function above.
 * `q` is the audit's query helper.
 */
export async function collectNotApplicableDocuments(q) {
  const placeholders = EXTRACTABLE_DOC_TYPES_MIRROR.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await q(
    `select type, count(*)::int as pending
       from documents
      where extraction_status = 'PENDING'
        and type not in (${placeholders})
      group by type
      order by type`,
    EXTRACTABLE_DOC_TYPES_MIRROR
  );

  return summariseNotApplicableDocuments({
    byType: rows.map((r) => ({ type: r.type, pending: r.pending })),
  });
}
