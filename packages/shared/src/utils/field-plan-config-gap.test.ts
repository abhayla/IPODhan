import { describe, it, expect } from 'vitest';
import { fieldPlanGapCodeOf, fieldPlanGapToken } from './field-plan-config-gap';

// Round 3 (independent-review finding, #923 round 3, MINOR): the token
// regex used to be unanchored (`/\[gap:([A-Z_]+)\]/`), so a remote error
// message that happens to CONTAIN a `[gap:CODE]`-shaped substring earlier in
// the string would be misread as a structured gap the walk itself never
// declared. `fieldPlanGapToken` always appends the token as the failure
// string's own SUFFIX — nothing is ever appended after it — so the regex is
// now anchored with `$`.
describe('fieldPlanGapCodeOf ($-anchored, round 3 MINOR)', () => {
  it('reads the real, walk-appended token at the end of the string', () => {
    const failure = `rank1:BSE:NO_FETCHER_REGISTERED ${fieldPlanGapToken('NO_FETCHER')}`;
    expect(fieldPlanGapCodeOf(failure)).toBe('NO_FETCHER');
  });

  it('a genuine failure with no token reads as null (not a gap)', () => {
    expect(fieldPlanGapCodeOf('connection reset by peer')).toBeNull();
  });

  // THE regression this closes: a remote error message containing a
  // gap-token-shaped substring that is NOT the walk's own trailing token
  // must never be read as a structured gap code.
  it('a fake token embedded mid-string (not the trailing token) is NOT read as a gap', () => {
    const spoofed = `upstream said: "[gap:NO_FETCHER] field missing" — treated as CHECK_FAILED`;
    expect(fieldPlanGapCodeOf(spoofed)).toBeNull();
  });

  it('a real token followed by trailing text (walk never does this, but proves the anchor) is NOT read as a gap', () => {
    expect(fieldPlanGapCodeOf('[gap:NO_MAPPING] trailing text')).toBeNull();
  });
});
