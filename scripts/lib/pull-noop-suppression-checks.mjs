// PULL-NOOP suppression (item 10, OD-42, design §2.5.2/§4): pure verdict logic for
// `pull_noop_suppression` -- writes this cycle / fields re-asked this cycle, distinct from
// the already-built `pull_noop` check (same ratio, different id/consumer per the registry
// entries) because it also gates on ENABLE_FIELD_PLAN_WALK, per the prerequisite the registry
// entry names: without the walk actually running, a 0-write ratio is not a healthy quiet
// cycle -- it is a cycle that never asked anything.

export const PULL_NOOP_SUPPRESSION_RECOMMENDED_CEILING = 0.05;

/**
 * @param {{reasked: number, written: number, newDocuments: number}} counts
 * @param {boolean} walkEnabled - ENABLE_FIELD_PLAN_WALK for the audited slot. `false` or
 *   `undefined` (unknown) both mean "cannot claim the walk ran" -- UNVERIFIABLE, never a pass.
 * @returns {{status: 'PASS'|'WARN'|'UNVERIFIABLE', ratio: number|null, detail: string}}
 */
export function pullNoopSuppressionVerdict(counts, walkEnabled) {
  const reasked = counts?.reasked ?? 0;
  const written = counts?.written ?? 0;
  const newDocuments = counts?.newDocuments ?? 0;

  if (!walkEnabled) {
    return {
      status: 'UNVERIFIABLE',
      ratio: null,
      detail: 'ENABLE_FIELD_PLAN_WALK is off for this slot -- nothing to measure, and a zero ratio from a walk that never ran must never read as a pass',
    };
  }
  if (!reasked) {
    return {
      status: 'UNVERIFIABLE',
      ratio: null,
      detail: 'no ipo_field_plan row was re-asked in the window -- nothing to measure (a walk that did not run is not a quiet walk)',
    };
  }

  const ratio = written / reasked;
  const pct = (ratio * 100).toFixed(1);
  const base = `${written} write(s) / ${reasked} re-ask(s) = ${pct}% (${newDocuments} new document(s) in the same window)`;

  if (ratio > PULL_NOOP_SUPPRESSION_RECOMMENDED_CEILING) {
    return {
      status: 'WARN',
      ratio,
      detail: `${base} -- above the RECOMMENDED ${(PULL_NOOP_SUPPRESSION_RECOMMENDED_CEILING * 100).toFixed(0)}% ceiling (a recommendation per OD-18, not a measured number)`,
    };
  }
  return { status: 'PASS', ratio, detail: base };
}
