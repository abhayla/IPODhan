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

// T-462 round 2: C1's "declining ceiling" made concrete. `baseline` is the
// committed per-slot count (config/provenance-lineage-baseline.json, keyed by
// database name). FAILs only when the CURRENT count exceeds the baseline;
// WARNs (with the delta) when it is at or below — never a silent pass, so a
// real improvement is visible without the check going quiet. The baseline
// itself is lowered only by the caller passing --rebaseline-provenance,
// never automatically by this predicate.
export function evaluateProvenanceCeiling(currentCount, baselineCount) {
  if (baselineCount == null) {
    return { status: 'FAIL', detail: `no committed baseline for this database — run with --rebaseline-provenance once to seed it` };
  }
  if (currentCount > baselineCount) {
    return { status: 'FAIL', detail: `current ${currentCount} EXCEEDS baseline ${baselineCount} (+${currentCount - baselineCount}) — a new lineage-less row was written` };
  }
  const delta = baselineCount - currentCount;
  return { status: 'WARN', detail: `current ${currentCount} <= baseline ${baselineCount}${delta > 0 ? ` (-${delta}, drain in progress)` : ' (unchanged)'}` };
}

// T-462 round 2: C2 stays HARD for any group not already named in
// config/duplicate-identity-allowlist.json. A group matches an allowlist
// entry only when its full id set is identical (never a partial/subset
// match) so a NEW member joining a known group still fails as new.
export function classifyDuplicateGroups(groups, allowlistEntries) {
  const allowed = [];
  const newFails = [];
  for (const g of groups) {
    const ids = new Set(g.map((r) => r.id));
    const entry = (allowlistEntries || []).find(
      (e) => Array.isArray(e.ids) && e.ids.length === ids.size && e.ids.every((id) => ids.has(id))
    );
    if (entry) allowed.push({ group: g, entry });
    else newFails.push(g);
  }
  return { allowed, newFails };
}
