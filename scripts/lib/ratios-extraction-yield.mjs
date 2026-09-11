/**
 * Detection check `ratios_extraction_yield` (lane B, item 8).
 *
 * The contract asks for: `financial_data.current_ratio` non-null for every
 * COMPLETED `RATIOS_BASIS_ISSUE_PRICE` document.
 *
 * Written literally, that check is GREEN TODAY AND MEASURES NOTHING. Staging
 * carries 34 RATIOS documents and every one of them is PENDING — not one has
 * ever been extracted — so "every COMPLETED row has a ratio" is true of the
 * empty set. A check that cannot fail is not detection; it is a green light
 * wired to nothing, and this repository has already been bitten by that exact
 * shape more than once.
 *
 * So the empty population is reported as UNVERIFIABLE, never PASS. The audit
 * treats UNVERIFIABLE as "the audit was blind tonight", which is the honest
 * description, and it pages instead of reassuring.
 *
 * The number worth putting in front of a human is not "0 violations" — it is
 * "34 of these documents exist and none has ever been read", which is the
 * actual state of the feature.
 */

export const RATIOS_YIELD_NAME =
  'every COMPLETED Ratios/Basis-of-Issue-Price document yielded a current_ratio';

export const RATIOS_DOCUMENT_TYPE = 'RATIOS_BASIS_ISSUE_PRICE';

/**
 * @param {{completed: Array<{documentId: string, ipoId: string, companyName: string|null, currentRatio: unknown}>, pendingCount: number, totalCount: number}} input
 */
export function summariseRatiosYield({ completed, pendingCount, totalCount }) {
  if (!Array.isArray(completed)) {
    throw new TypeError('completed must be an array');
  }

  if (completed.length === 0) {
    // The distinction that makes this check worth having. "Nothing to check"
    // and "everything checked out" are different states, and reporting the
    // first as the second is how a feature that never ran acquires a clean
    // bill of health.
    const detail =
      totalCount === 0
        ? 'no Ratios/Basis-of-Issue-Price document exists at all — nothing to measure'
        : `${totalCount} Ratios/Basis-of-Issue-Price document(s) exist and NOT ONE has been extracted ` +
          `(${pendingCount} still PENDING), so this check measured nothing`;
    return { status: 'UNVERIFIABLE', offenders: [], detail };
  }

  const offenders = [];
  for (const row of completed) {
    if (row.currentRatio === null || row.currentRatio === undefined || row.currentRatio === '') {
      offenders.push(
        `"${row.companyName || row.ipoId}" — extraction COMPLETED but financial_data.current_ratio is null`
      );
    }
  }

  const detail =
    `${completed.length} COMPLETED document(s) examined, ${offenders.length} yielded no current_ratio` +
    (pendingCount ? ` (${pendingCount} more still PENDING and therefore not examined)` : '');

  return { status: offenders.length === 0 ? 'PASS' : 'FAIL', offenders, detail };
}

/**
 * Reads the population, then delegates the verdict to the pure function above.
 * `q` is the audit's query helper.
 */
export async function collectRatiosYield(q) {
  const counts = await q(
    `select
       count(*)::int as total,
       count(*) filter (where extraction_status = 'PENDING')::int as pending
     from documents where type = $1`,
    [RATIOS_DOCUMENT_TYPE]
  );

  const completed = await q(
    `select d.id as document_id, d.ipo_id, i.company_name, f.current_ratio
       from documents d
       join ipos i on i.id = d.ipo_id
       left join financial_data f on f.ipo_id = d.ipo_id
      where d.type = $1 and d.extraction_status = 'COMPLETED'`,
    [RATIOS_DOCUMENT_TYPE]
  );

  return summariseRatiosYield({
    completed: completed.map((r) => ({
      documentId: r.document_id,
      ipoId: r.ipo_id,
      companyName: r.company_name,
      currentRatio: r.current_ratio,
    })),
    pendingCount: counts[0]?.pending ?? 0,
    totalCount: counts[0]?.total ?? 0,
  });
}
