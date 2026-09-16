/**
 * Tier A review round 2 on #672: dropping `&& Boolean(opts.issueSizeNote)` from
 * `mergeDuplicateInto`'s `issueSizeCorrectionAcknowledged` computation
 * (`packages/shared/src/repositories/ipo-repository.ts`) SURVIVED mutation —
 * no test required the note. A bare `--set-issue-size` with no
 * `--issue-size-note` must NOT silently bypass the issue_size disagreement
 * check (it is not source-backed evidence, just a number).
 *
 * This test exercises the REAL `IPORepository.mergeDuplicateInto` method
 * against a minimal fake `db` — `checkMergeEligibility` runs immediately
 * after the `select().from(ipos)` read, before any transaction/FK discovery
 * (see `ipo-repository.ts` around the `checkMergeEligibility(...)` call), so
 * the fake only needs to answer that one `select`.
 */
import { describe, it, expect } from 'vitest';
import { IPORepository } from './ipo-repository';

const KEEP_ID = '11111111-1111-1111-1111-111111111111';
const DROP_ID = '22222222-2222-2222-2222-222222222222';

/**
 * A fake `db` that answers exactly the one read `mergeDuplicateInto` makes
 * before `checkMergeEligibility` — the keep/drop `ipos` rows, same open_date
 * and company name (so ONLY the issue_size check can refuse), differing
 * issue_size (Rs 10,000cr vs Rs 20,000cr — a real two-sided disagreement,
 * >1% apart). Nothing else in the repository is exercised; the eligibility
 * refusal throws before any transaction is opened.
 */
function buildFakeDb() {
  const keepRow = {
    id: KEEP_ID,
    companyName: 'Real Merge Co Ltd',
    slug: 'real-merge-co-ltd',
    openDate: '2026-09-09',
    issueSize: '100000000000', // Rs 10,000 cr
  };
  const dropRow = {
    id: DROP_ID,
    companyName: 'Real Merge Co. Ltd',
    slug: 'real-merge-co-ltd-o',
    openDate: '2026-09-09',
    issueSize: '200000000000', // Rs 20,000 cr — >1% apart from keep
  };

  return {
    select: (_cols?: unknown) => ({
      from: () => ({
        where: async () => [keepRow, dropRow],
      }),
    }),
  };
}

describe('mergeDuplicateInto — issue_size correction acknowledgement requires BOTH flags (Tier A round 2 on #672)', () => {
  it('setIssueSize given, NO issueSizeNote: issueSizeCorrectionAcknowledged is false, the issue_size disagreement still refuses', async () => {
    const db = buildFakeDb();
    const repo = new IPORepository(db as never, { del: async () => undefined } as never);

    await expect(
      repo.mergeDuplicateInto(KEEP_ID, DROP_ID, {
        apply: false,
        setIssueSize: '150000000000', // present...
        // ...but issueSizeNote deliberately omitted
      })
    ).rejects.toThrow(/issue_size disagrees/);

    // MUTATION CHECK: dropping `&& Boolean(opts.issueSizeNote)` from the
    // acknowledgement expression at ipo-repository.ts makes a bare
    // --set-issue-size (with no note) silently acknowledge the disagreement,
    // so mergeDuplicateInto resolves instead of throwing and this assertion
    // goes red (`promise resolved instead of rejecting`).
  });

  it('positive control: BOTH setIssueSize AND issueSizeNote given: acknowledged, eligibility passes the issue_size check', async () => {
    const db = buildFakeDb();
    const repo = new IPORepository(db as never, { del: async () => undefined } as never);

    // With eligibility satisfied, mergeDuplicateInto proceeds past the
    // eligibility check into FK discovery, which this minimal fake db does
    // not implement — so the call still throws, but with a DIFFERENT error
    // (not the issue_size refusal), which is exactly what distinguishes
    // "acknowledged, eligibility passed" from "refused on issue_size".
    await expect(
      repo.mergeDuplicateInto(KEEP_ID, DROP_ID, {
        apply: false,
        setIssueSize: '150000000000',
        issueSizeNote: 'corrected from NSE prospectus, evidence attached',
      })
    ).rejects.not.toThrow(/issue_size disagrees/);
  });
});
