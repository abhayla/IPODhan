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

/**
 * OD-103 (F-196): what ONE ranked source answered this pass. Only SUPPLIED carries a value; the
 * others are stored so the admin view (§9.3) can show each source's answer, and are never a vote
 * (OD-60). THROWN / NO_FETCHER_REGISTERED / a dropped or losing provisional write are FAILED.
 */
export type WitnessOutcome = 'SUPPLIED' | 'NOT_PRINTED' | 'NOT_AVAILABLE_YET' | 'CHECK_FAILED' | 'FAILED';

export interface Witness {
  source: string;
  value: unknown;
  at: string;
  docType?: string;
  /** Absent on every witness written before OD-103; such a witness was always SUPPLIED. */
  outcome?: WitnessOutcome;
  /** Short cause token for a non-SUPPLIED answer (the same string the walk pushes to `failures`). */
  cause?: string;  /**
   * Item 38: 'DOCUMENT_ROWS_STORED' = the document supplied rows already stored by their own writer;
   * `value` is then null and is never a pickable value (the row count rides on `rowCount`).
   */
  credited?: 'DOCUMENT_ROWS_STORED';
  rowCount?: number;
}

/** A witness with no `outcome` (written before OD-103) is read as SUPPLIED. */
export function isSuppliedWitness(w: { outcome?: WitnessOutcome }): boolean {
  return w.outcome === undefined || w.outcome === 'SUPPLIED';
}

export interface VerdictResult {
  verdict: Verdict;
  /** Every answer this pass collected, in rank order — written verbatim to `witnesses`. */
  witnesses: Witness[];
}

/**
 * `answers` — every ranked answer `attemptOneField` collected this pass, in rank order (OD-103:
 * SUPPLIED and non-SUPPLIED alike; only SUPPLIED ones are compared), already filtered to fields whose `comparisonFamily !== 'ABSTAIN'` by the
 * caller. `capableSourceCount` — `policy.ranks.length` for THIS IPO's segment (0 for NO_WITNESS,
 * 1 for SINGLE_SOURCE, unrelated to how many of those ranks actually answered this pass — a
 * capable source that timed out or hasn't been asked yet is still a capable source, not a vote).
 */
export function computeVerdict(
  answers: Array<{
    rank: number;
    source: string;
    value: unknown;
    at: string;
    docType?: string;
    outcome?: WitnessOutcome;
    cause?: string;
  }>,
  capableSourceCount: number,
  family: ComparisonFamily
): VerdictResult {
  const witnesses: Witness[] = answers.map((a) => ({
    source: a.source,
    value: a.value,
    at: a.at,
    ...(a.docType ? { docType: a.docType } : {}),
    ...(a.outcome ? { outcome: a.outcome } : {}),
    ...(a.cause ? { cause: a.cause } : {}),
  }));
  // OD-103: every ranked answer is a witness, but only a SUPPLIED one is a vote (OD-60). An
  // abstention or failure carries value null and must never be compared as a disagreeing value.
  const real = answers.filter(isSuppliedWitness);

  if (capableSourceCount === 0) {
    return { verdict: 'NO_WITNESS', witnesses };
  }
  if (capableSourceCount === 1) {
    return { verdict: 'SINGLE_SOURCE', witnesses };
  }
  if (real.length <= 1) {
    // capableSourceCount >= 2 but this pass only ever collected 0 or 1 real answers — the other
    // ranked source(s) abstained (NOT_PRINTED / never answered this pass), which is never a
    // disagreeing vote (OD-60).
    return { verdict: 'UNCONFIRMED', witnesses };
  }

  // 2+ real answers on a 2+-capable-source field. ALL PAIRS, not every-answer-against-the-first.
  //
  // #789: a TOLERANT comparison is NOT TRANSITIVE. MONEY agrees within 0.5% of the larger value,
  // so a=1000.00, b=1004.99, c=995.01 gives a~b and a~c but NOT b~c -- the outer two differ by
  // ~1%. A pivot comparison against `first` therefore records CONFIRMED on a set whose members
  // disagree with each other, and a false CONFIRMED is worse than a DISPUTED: it asserts the
  // sources checked each other and matched.
  //
  // Measured: 17 MAINBOARD fields have 3+ ranked sources with a tolerant family (12 MONEY +
  // 5 RATIO), including price_range_min/max, lot_size and face_value -- the headline numbers.
  // Exact-match families (IDENTIFIER/DATE/SET/BOOLEAN) are transitive and unaffected, but
  // all-pairs is correct for them too, so there is no reason to branch on family here.
  //
  // Cost: N*(N-1)/2 comparisons. N is at most 3 (no field ranks more than three sources), so at
  // most 3 -- the reason a pivot might have been chosen does not exist at this size.
  //
  // A single dissenting PAIR is enough: this is agreement, not a majority vote.
  for (let i = 0; i < real.length - 1; i += 1) {
    for (let j = i + 1; j < real.length; j += 1) {
      if (!areEquivalent(real[i].value, real[j].value, { family })) {
        return { verdict: 'DISPUTED', witnesses };
      }
    }
  }
  return { verdict: 'CONFIRMED', witnesses };
}
