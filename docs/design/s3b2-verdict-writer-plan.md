# S3b-2 — the comparator decides; the verdict is written. Closes OD-58, implements OD-57.

**Core:** a field with two witnesses that agree is stored CONFIRMED; two that disagree, DISPUTED.
**Proof:** ONE real field on staging — `ipos.issue_size`, witnesses DOC + CHITTORGARH — read back
with `witnesses` populated and a verdict matching what the two sources actually said.

Tier A. Flag OFF by default. Everything it depends on is MERGED as of main `ad4552a3`.

## THE PROOF FIELD MUST BE DOC + CHITTORGARH. NOT NSE.
Verified in the manifest this session: `ipos.issue_size` ranks `['DOC','CHITTORGARH']` on
MAINBOARD, and NSE is `capable:false` with the reason "NSE computes (sharesOffered/netOffer) x
price, excluding the OFS portion". An earlier plan named NSE and would have produced a fabricated
proof. Read the capability block before choosing any proof field.

## What already exists (do NOT rebuild)
- `suppliedAnswers` — S3a collects every SUPPLIED answer in `attemptOneField`
  (`field-plan-walk.ts:665`, pushed at :776, in scope where the write happens at :798).
- `field_sources.witnesses` (jsonb) and `.verdict` (varchar 16) — S2, verified present and
  nullable on a real DB.
- `comparisonFamily` on all 190 manifest fields — S3b-1.
- All 7 comparable families implemented in `areEquivalent`, plus a parity test — #786.
- `trackFieldUpdate` (`packages/shared/src/repositories/field-sources-repository.ts:169`) is the
  SINGLE writer of a `field_sources` row. That is the insertion point; do not add a second writer.

## Step 1 — the verdict
Five states, resolved PER SEGMENT at walk time, never from a static list:
  CONFIRMED     2+ real answers that agree
  DISPUTED      2+ real answers that disagree
  UNCONFIRMED   exactly 1 real answer, others abstained
  SINGLE_SOURCE the field has only 1 capable source for THIS IPO's segment
  NO_WITNESS    the field has 0 capable sources for THIS IPO's segment

VERIFIED counts (manifest, this session): SINGLE_SOURCE is 68 / 87 / 77 for MAINBOARD / SME_BSE /
SME_NSE and the SETS DIFFER — 10 fields are single-source on SME_NSE but not MAINBOARD, 1 the
other way. A MAINBOARD-derived static list mislabels 11 fields on SME_NSE alone.
NO_WITNESS is 0 / 1 / 1: `listing_performance.current_price_nse` on SME_BSE and
`current_price_bse` on SME_NSE. It is UNREACHABLE on MAINBOARD, so a MAINBOARD-only fixture never
exercises that branch and it will look covered. Test it on an SME segment.

## Step 2 — ABSTAIN is filtered BEFORE the comparator, never passed to it
14 fields carry `comparisonFamily: 'ABSTAIN'` (free prose, structured object lists). ABSTAIN is
deliberately NOT in `areEquivalent`'s type union (#786) — it is an instruction to THIS writer, not
a way to compare. Filter those fields out and write NO verdict. A test must prove `areEquivalent`
is never called for them.

## Step 3 — OD-57's tie-break, by family
  dates + status        -> the EXCHANGE wins (the document states an INTENDED schedule)
  money + counts        -> the DOCUMENT wins (the legally filed figure)
  names + identifiers   -> the DOCUMENT wins, AFTER normalisation
  live numbers          -> the EXCHANGE always (the document cannot contain them)
One sentence: the document is the authority on what was PROMISED, the exchange on what HAPPENED.

## Step 4 — the flag
OFF by default. ON writes verdicts. S7 (the nightly check) is what gates any flip; do not flip it
in this slice.

## Failing tests first
- two witnesses agreeing -> CONFIRMED; disagreeing -> DISPUTED
- one witness real + one abstaining -> UNCONFIRMED, NEVER DISPUTED (OD-60)
- a single-capable-source field on SME_NSE -> SINGLE_SOURCE using THAT SEGMENT's list
- a NO_WITNESS field on an SME segment (unreachable on MAINBOARD — see above)
- an ABSTAIN field -> no verdict, and `areEquivalent` not called
- flag OFF -> no verdict written and behaviour byte-identical to S3a

## Mutation tests (each must be VERIFIED APPLIED before being judged: re-read the file and assert
## the original text is gone — a first attempt on #786 read as "survived" when the edit had never
## landed)
- treat an abstention as a disagreeing vote -> the UNCONFIRMED test goes red
- resolve SINGLE_SOURCE from MAINBOARD's list for an SME IPO -> the segment test goes red
- pass an ABSTAIN field to the comparator -> the ABSTAIN test goes red

## Real-data proof
A staging cycle: one `ipos.issue_size` row with DOC + CHITTORGARH, `witnesses` holding both
answers, verdict matching what the two sources actually said — read back BY IDENTITY, not counted.

## Known debt this slice must NOT silently inherit
- #782: three count fields use MONEY's 0.5% tolerance, which swallows an off-by-one above ~200.
  Safe today (real max 17/4/19) but fix before verdicts are written, not after.
- #785: S4's reason codes are mis-assigned (FAILED_VALIDATION used for a priority loss). Separate
  slice, but do not build anything that depends on those codes meaning what they say.
