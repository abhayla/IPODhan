/**
 * #631: `IssueTypeJobDeps` declares zero optional members today — every
 * member is required, so `tsc` already catches a forgotten wire. This test
 * exists so that changes ONLY: the day a member is made optional (as
 * `childRowConsolidator` was on `FilingPersisterDeps`, #625), this test turns
 * red the moment `makeIssueTypeJobDeps` leaves it unwired with no reviewed
 * reason, instead of the gap going unnoticed because nothing was watching
 * this interface at all.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { declaredInterfaceMembers, unexplainedUnwiredOptionals } from '../../lib/deps-completeness.js';
import { makeIssueTypeJobDeps } from '../../../src/services/chittorgarh-issue-type-job.js';

const ALLOWLIST: Readonly<Record<string, string>> = {};

describe('makeIssueTypeJobDeps supplies every declared dependency (or the gap is reviewed)', () => {
  const filePath = join(__dirname, '../../../src/services/chittorgarh-issue-type-job.ts');

  it('finds the interface and its members (positive control for the AST read)', () => {
    const members = declaredInterfaceMembers(filePath, 'IssueTypeJobDeps');
    expect(members.length).toBeGreaterThan(3);
    expect(members.map((m) => m.name)).toContain('loadCandidates');
    expect(members.every((m) => !m.optional)).toBe(true);
  });

  it('leaves no member silently unwired — wired, or on the reviewed allow-list', () => {
    const deps = makeIssueTypeJobDeps(
      { execute: async () => ({ rows: [] }) },
      { insertIfMissing: async () => true, fillIssueTypeIfNull: async () => true },
      { trackFieldUpdate: async () => undefined },
      async () => ({ filtered: {} }),
      { info: () => undefined, warn: () => undefined }
    ) as unknown as Record<string, unknown>;
    const members = declaredInterfaceMembers(filePath, 'IssueTypeJobDeps');
    const gaps = unexplainedUnwiredOptionals(deps, members, ALLOWLIST);
    expect(gaps, `makeIssueTypeJobDeps leaves these unwired with no reviewed reason: ${gaps.join(', ')}`).toEqual([]);
  });
});
