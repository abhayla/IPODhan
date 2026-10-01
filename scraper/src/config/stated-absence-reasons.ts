import { readFileSync } from 'node:fs';

/**
 * #1420 / F-219 / OD-158: the extractor reasons that mean the document itself
 * STATES a field does not apply or is not printed. ONE list in
 * stated-absence-reasons.json, read here and by scraper/scripts/answer_states.py
 * (which emits `state: "STATED_NOT_PRINTED"` for exactly these reasons).
 *
 * A reason not in this set is a reader miss. OD-158 clears a stored value on a
 * stated absence and keeps it on a miss, so the set fails closed: it is never
 * widened to a pattern-miss reason (`*_not_in_document`, `*_not_found`).
 */
interface StatedAbsenceConfig {
  reasons: { reason: string; emittedBy: string; printedStatement: string }[];
}

const CONFIG = JSON.parse(
  readFileSync(new URL('./stated-absence-reasons.json', import.meta.url), 'utf8')
) as StatedAbsenceConfig;

export const STATED_ABSENCE_REASONS: ReadonlySet<string> = new Set(
  CONFIG.reasons.map((entry) => entry.reason)
);

export function isStatedAbsenceReason(reason: unknown): boolean {
  return typeof reason === 'string' && STATED_ABSENCE_REASONS.has(reason);
}
