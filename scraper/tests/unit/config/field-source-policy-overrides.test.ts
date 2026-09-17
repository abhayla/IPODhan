// implements: item 3 slice S4 -- resolver layer 2 (overrides beat the registry)
import { describe, it, expect } from 'vitest';
import {
  resolveFieldSourcePolicyAsync,
  policyOriginString,
  type OverrideReader,
  type PolicyQuery,
  type ResolvedOverride,
} from '../../../src/config/field-source-policy.js';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';

const manifest = loadFieldManifest();

function readerReturning(rows: ResolvedOverride[]): OverrideReader {
  return { resolve: async (_query: PolicyQuery) => rows };
}

describe('resolveFieldSourcePolicyAsync -- S4 layer 2', () => {
  it('no overrides dep -> identical to the sync registry-only resolver', async () => {
    const policy = await resolveFieldSourcePolicyAsync(
      { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' },
      { manifest }
    );
    expect(policy.origin).toEqual({ kind: 'registry', version: manifest.version });
    expect(policy.ranks).toEqual(['DOC', 'CHITTORGARH']);
  });

  it('overrides dep present but resolves [] -> registry answer (no active override)', async () => {
    const policy = await resolveFieldSourcePolicyAsync(
      { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' },
      { manifest, overrides: readerReturning([]) }
    );
    expect(policy.origin).toEqual({ kind: 'registry', version: manifest.version });
  });

  it('a global override (ipoScoped: false) replaces the registry ranks and origin', async () => {
    const reader = readerReturning([
      { id: 'ov-1', ranks: ['CHITTORGARH', 'DOC'], expiresAt: '2026-10-18T00:00:00.000Z', ipoScoped: false },
    ]);
    const policy = await resolveFieldSourcePolicyAsync(
      { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' },
      { manifest, overrides: reader }
    );
    expect(policy.ranks).toEqual(['CHITTORGARH', 'DOC']);
    expect(policy.origin).toEqual({ kind: 'override', id: 'ov-1', expiresAt: '2026-10-18T00:00:00.000Z' });
    expect(policyOriginString(policy.origin)).toBe('override:ov-1');
  });

  it('an ipo-scoped override beats a global override when both are active', async () => {
    const reader = readerReturning([
      { id: 'ov-global', ranks: ['CHITTORGARH'], expiresAt: '2026-10-18T00:00:00.000Z', ipoScoped: false },
      { id: 'ov-ipo', ranks: ['DOC'], expiresAt: '2026-10-18T00:00:00.000Z', ipoScoped: true },
    ]);
    const policy = await resolveFieldSourcePolicyAsync(
      { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD', ipoId: 'some-ipo-id' },
      { manifest, overrides: reader }
    );
    expect(policy.origin).toEqual({ kind: 'override', id: 'ov-ipo', expiresAt: '2026-10-18T00:00:00.000Z' });
    expect(policy.ranks).toEqual(['DOC']);
  });

  // MAJOR-5 fix (S4 review round 2): the SAME-SCOPE tie was previously undefined (two active
  // ipo-scoped rows both winning depending on nondeterministic setAt-tie ordering). The reader's
  // contract (repository, MAJOR-5) is now `desc(setAt), desc(id)` -- deterministic given the same
  // rows. The resolver's job is simply "trust the reader's order, take the first ipo-scoped row" --
  // this test pins that the resolver does NOT re-sort or pick arbitrarily; it is stable given a
  // fixed reader order, run twice.
  it('a same-scope tie (two active ipo-scoped rows) resolves to the FIRST row the reader returns, deterministically, every call', async () => {
    const reader = readerReturning([
      { id: 'ov-second-set', ranks: ['DOC'], expiresAt: '2026-10-18T00:00:00.000Z', ipoScoped: true },
      { id: 'ov-first-set', ranks: ['CHITTORGARH'], expiresAt: '2026-10-18T00:00:00.000Z', ipoScoped: true },
    ]);
    const query = { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD', ipoId: 'some-ipo-id' } as const;

    const first = await resolveFieldSourcePolicyAsync(query, { manifest, overrides: reader });
    const second = await resolveFieldSourcePolicyAsync(query, { manifest, overrides: reader });

    expect(first.origin).toEqual({ kind: 'override', id: 'ov-second-set', expiresAt: '2026-10-18T00:00:00.000Z' });
    expect(second.origin).toEqual(first.origin);
    expect(first.ranks).toEqual(['DOC']);
  });

  it('an override never changes documentType/incapable/na -- those stay manifest-sourced', async () => {
    const reader = readerReturning([
      { id: 'ov-1', ranks: ['CHITTORGARH'], expiresAt: '2026-10-18T00:00:00.000Z', ipoScoped: false },
    ]);
    const registryOnly = await resolveFieldSourcePolicyAsync(
      { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' },
      { manifest }
    );
    const overridden = await resolveFieldSourcePolicyAsync(
      { table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' },
      { manifest, overrides: reader }
    );
    expect(overridden.documentType).toEqual(registryOnly.documentType);
    expect(overridden.incapable).toEqual(registryOnly.incapable);
    expect(overridden.na).toBe(registryOnly.na);
  });

  it('a reader that throws propagates -- the resolver never swallows a REAL DB error (only "table absent" is swallowed, and that is the reader\'s job, not the resolver\'s)', async () => {
    const reader: OverrideReader = {
      resolve: async () => {
        throw new Error('connection refused');
      },
    };
    await expect(
      resolveFieldSourcePolicyAsync({ table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' }, { manifest, overrides: reader })
    ).rejects.toThrow(/connection refused/);
  });
});
