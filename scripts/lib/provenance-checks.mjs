// Pure predicates backing the #188 provenance gate (C1 / C2) in
// scripts/audit-ipo-coverage.mjs. Kept DB-free so they can be unit-tested on
// fixture rows without a live database — mirrors the SQL in issue #188.
//
// C1 — a hard fact (open/close date or price band) asserted on a genuine IPO
// row with ZERO field_sources lineage rows. Declining-ceiling WARNING until
// the T-292 legacy-row drain (currently 8 rows) is confirmed complete — never
// a hard 0-gate yet (issue #188's own risk note).
//
// C2 — two different genuine IPOs holding byte-identical date/band/lot/
// issue_size (root cause #178, still unresolved). HARD — MUST be 0.

export function checkProvenanceLineage(rows, sourcedIpoIds) {
  return rows.filter(
    (r) =>
      r.offering_type === 'IPO' &&
      (r.open_date != null || r.close_date != null || r.price_range_min != null) &&
      !sourcedIpoIds.has(r.id)
  );
}

export function checkDuplicateIdentity(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.offering_type !== 'IPO' || r.issue_size == null) continue;
    const key = [r.open_date, r.close_date, r.issue_size, r.lot_size, r.price_range_min, r.price_range_max].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
