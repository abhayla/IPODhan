// One definition of the two same-name separators, shared by the identity resolver and the
// repository's ambiguous-name hold (#1235: one concept, one definition).

/**
 * True when exactly one side of the match is OFS — an OFS record identifies
 * a DIFFERENT calendar entry than the company's IPO row and must never
 * resolve to it (or vice versa). Deliberately narrower than "any offering
 * type mismatch": IPO<->FPO reclassification (a real, existing use of this
 * resolver — see `guardSmeOfferingTypeAgainstFpo`) must keep resolving to
 * the same row. Either side unset means "no information", never a conflict.
 */
export function ofsIdentityConflict(
  identityOfferingType: string | null | undefined,
  candidateOfferingType: string | null | undefined
): boolean {
  if (!identityOfferingType || !candidateOfferingType) {
    return false;
  }
  return (identityOfferingType === 'OFS') !== (candidateOfferingType === 'OFS');
}

/**
 * True when `identitySegment` and `candidateSegment` are both set and
 * disagree — the segment guard (T-403 item 3). Either side unset means "no
 * information", which is never treated as a mismatch.
 */
export function segmentsConflict(
  identitySegment: 'MAINBOARD' | 'SME' | null | undefined,
  candidateSegment: string | null | undefined
): boolean {
  return identitySegment != null && candidateSegment != null && identitySegment !== candidateSegment;
}
