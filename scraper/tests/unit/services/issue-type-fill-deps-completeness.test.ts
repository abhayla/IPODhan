/**
 * #631: `IssueTypeFillDeps` has one optional member (`logger`). Its only
 * production caller is `runIssueTypeFillJob`, which builds the inline deps
 * object passed to `fillIssueTypesFromReport` — there is no separate named
 * builder function, so this test CAPTURES that object by mocking
 * `fillIssueTypesFromReport` itself, the same shape #625 used for a builder
 * function's return value.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { declaredInterfaceMembers, unexplainedUnwiredOptionals } from '../../lib/deps-completeness.js';

const { fillIssueTypesFromReportMock } = vi.hoisted(() => ({
  fillIssueTypesFromReportMock: vi.fn(async () => ({
    candidates: 0, matched: 0, filled: 0, alreadySet: 0, unmatched: 0, rowsCreated: 0,
    blockedByAdmin: 0, reportAmbiguous: 0, duplicateResolved: 0, noReportDate: 0,
    dateMismatch: 0, failed: 0,
  })),
}));

vi.mock('../../../src/services/chittorgarh-issue-type-fill.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, fillIssueTypesFromReport: fillIssueTypesFromReportMock };
});

const ALLOWLIST: Readonly<Record<string, string>> = {};

describe('runIssueTypeFillJob wires every declared IssueTypeFillDeps member (or the gap is reviewed)', () => {
  const filePath = join(__dirname, '../../../src/services/chittorgarh-issue-type-fill.ts');

  it('finds the interface and its members (positive control for the AST read)', () => {
    const members = declaredInterfaceMembers(filePath, 'IssueTypeFillDeps');
    expect(members.length).toBeGreaterThan(3);
    expect(members.map((m) => m.name)).toContain('logger');
    expect(members.find((m) => m.name === 'logger')?.optional).toBe(true);
  });

  it('leaves no member silently unwired — wired, or on the reviewed allow-list', async () => {
    const { runIssueTypeFillJob } = await import('../../../src/services/chittorgarh-issue-type-job.js');
    fillIssueTypesFromReportMock.mockClear();
    await runIssueTypeFillJob({
      fetchReport: async () => Array.from({ length: 400 }, () => ({})),
      loadCandidates: async () => [],
      isWriteAllowed: async () => true,
      ensureDetailsRow: async () => true,
      fillIssueTypeIfNull: async () => true,
      trackFieldUpdate: async () => undefined,
      logger: { info: () => undefined, warn: () => undefined },
    });

    expect(fillIssueTypesFromReportMock).toHaveBeenCalledTimes(1);
    const deps = fillIssueTypesFromReportMock.mock.calls[0]![1] as unknown as Record<string, unknown>;
    const members = declaredInterfaceMembers(filePath, 'IssueTypeFillDeps');
    const gaps = unexplainedUnwiredOptionals(deps, members, ALLOWLIST);
    expect(gaps, `runIssueTypeFillJob leaves these unwired with no reviewed reason: ${gaps.join(', ')}`).toEqual([]);
  });
});
