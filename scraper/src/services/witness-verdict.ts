/**
 * S3b-2 (docs/design/s3b2-verdict-writer-plan.md): the comparator DECIDES. S3a collects every
 * SUPPLIED answer in a walk pass (`suppliedAnswers` in field-plan-walk.ts); this module turns
 * those answers into one of the five verdict states and the `witnesses` payload S2 added columns
 * for. Nothing before this slice ever computed a verdict — S3a logged the answers and dropped
 * them.
 *
 * Five states, resolved PER SEGMENT (never a static list — SINGLE_SOURCE/NO_WITNESS differ by up
 * to 11 fields between MAINBOARD and SME_NSE, measured on the real manifest):
 *   CONFIRMED      2+ real answers that agree
 *   DISPUTED       2+ real answers that disagree
 *   UNCONFIRMED    exactly 1 real answer, the rest of this segment's ranked sources abstained
 *   SINGLE_SOURCE  the field has exactly 1 capable source for THIS IPO's segment
 *   NO_WITNESS     the field has 0 capable sources for THIS IPO's segment
 *
 * "Capable sources for this segment" is `policy.ranks.length` — `resolveFieldSourcePolicy`
 * already filters a segment's rank list to `capability.<source>.capable === true` (the loader's
 * own cross-check refuses a manifest where an incapable source appears in `rank[]`), so
 * `policy.ranks` IS the segment-scoped capable-source count. This module takes that count as
 * `capableSourceCount` rather than re-reading the manifest, so it never becomes a second config
 * read on the write path (the resolver's own doc comment, field-source-policy.ts).
 *
 * ABSTAIN fields never reach this module (field-plan-walk.ts filters them before calling in) —
 * `comparisonFamily: 'ABSTAIN'` is deliberately absent from `areEquivalent`'s `ComparisonFamily`
 * union (#786), so passing one through would be a type error at the call site, not just a bug.
 */
import { areEquivalent, type ComparisonFamily } from './normalization-engine.js';

export type Verdict = 'CONFIRMED' | 'DISPUTED' | 'UNCONFIRMED' | 'SINGLE_SOURCE' | 'NO_WITNESS';

export interface Witness {
  source: string;
  value: unknown;
  at: string;
  docType?: string;
}

export interface VerdictResult {
  verdict: Verdict;
  /** Every answer this pass collected, in rank order — written verbatim to `witnesses`. */
  witnesses: Witness[];
}

/**
 * `answers` — every SUPPLIED answer `attemptOneField` collected this pass (S3a's
 * `suppliedAnswers`), already filtered to fields whose `comparisonFamily !== 'ABSTAIN'` by the
 * caller. `capableSourceCount` — `policy.ranks.length` for THIS IPO's segment (0 for NO_WITNESS,
 * 1 for SINGLE_SOURCE, unrelated to how many of those ranks actually answered this pass — a
 * capable source that timed out or hasn't been asked yet is still a capable source, not a vote).
 */
export function computeVerdict(
  answers: Array<{ rank: number; source: string; value: unknown; at: string; docType?: string }>,
  capableSourceCount: number,
  family: ComparisonFamily
): VerdictResult {
  const witnesses: Witness[] = answers.map((a) => ({
    source: a.source,
    value: a.value,
    at: a.at,
    ...(a.docType ? { docType: a.docType } : {}),
  }));

  if (capableSourceCount === 0) {
    return { verdict: 'NO_WITNESS', witnesses };
  }
  if (capableSourceCount === 1) {
    return { verdict: 'SINGLE_SOURCE', witnesses };
  }
  if (answers.length <= 1) {
    // capableSourceCount >= 2 but this pass only ever collected 0 or 1 real answers — the other
    // ranked source(s) abstained (NOT_PRINTED / never answered this pass), which is never a
    // disagreeing vote (OD-60).
    return { verdict: 'UNCONFIRMED', witnesses };
  }

  // 2+ real answers on a 2+-capable-source field: compare every answer against the first: any
  // disagreement makes the whole set DISPUTED (a single dissenting witness is enough — this is
  // not majority vote).
  const [first, ...rest] = answers;
  const allAgree = rest.every((a) => areEquivalent(first.value, a.value, { family }));
  return { verdict: allAgree ? 'CONFIRMED' : 'DISPUTED', witnesses };
}
