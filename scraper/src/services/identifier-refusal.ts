/**
 * #1376 round 2 (OD-62 / OD-99): the one recorded reason for a CIN / ISIN / symbol dropped because
 * another live row of the SAME offering already carries it (OD-68: two rows of one offering sharing an
 * identifier "should never happen"). Shared by the B5 step ledger and the field walk's validation-refusal
 * path so the two cannot word it differently.
 */
export const IDENTIFIER_HELD_RULE = 'identifier already held by another row of the same offering (OD-68, #1376)';
