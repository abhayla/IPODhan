// #1246 (D'): `field_extraction_failures` holds two different things. `NOT_PRINTED` rows
// are recorded ABSENCES (the document does not print the section, OD-62 / #545 C); every
// other rule_id is a value a rule rejected or a section the reader could not read. Only
// the second kind is "rule(s) rejected values" and only it may count against --fail-over.
export const ABSENCE_RULE_IDS = new Set(['NOT_PRINTED']);

export function splitExtractionFailureRows(rows) {
  const absences = [];
  const rejections = [];
  for (const r of rows ?? []) (ABSENCE_RULE_IDS.has(r.rule_id) ? absences : rejections).push(r);
  return { absences, rejections };
}
