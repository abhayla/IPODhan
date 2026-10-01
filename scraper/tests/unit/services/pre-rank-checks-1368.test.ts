/**
 * #1368: `runPreRankChecks`, the ONE function both `ipos` write doors run before any ranking (the
 * consolidation door through `consolidateField`, the fallback door through the IPO_WRITE_GUARDS entry
 * `pre-rank-field-checks`). One case per check and per answer state; the door wiring is pinned by
 * tests/integration/fallback-door-prerank-checks-1368.integration.test.ts on ipodhan_test.
 */
import { describe, it, expect, vi } from 'vitest';
import { runPreRankChecks, type PreRankCheckInput, type PreRankCheckDeps } from '../../../src/services/data-consolidation-service.js';
import { IPO_WRITE_GUARDS } from '../../../src/services/data-persister.js';

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/feature-flags.js')>();
  return {
    ...actual,
    FEATURE_FLAGS: {
      ...actual.FEATURE_FLAGS,
      ENABLE_POLICY_WRITER: true,
      ENABLE_CONFLICT_DETECTION: true,
      ENABLE_FIELD_EXTRACTION_VALIDATION: false,
    },
  };
});

const policyState = vi.hoisted(() => ({ throwOnRead: false }));
vi.mock('../../../src/config/switchover.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/switchover.js')>();
  return {
    ...actual,
    isFlipped: (...args: Parameters<typeof actual.isFlipped>) => {
      if (policyState.throwOnRead) throw new Error('switchover.json unreadable (simulated)');
      return actual.isFlipped(...args);
    },
  };
});

function deps(): PreRankCheckDeps & { upsertConflict: ReturnType<typeof vi.fn> } {
  const upsertConflict = vi.fn().mockResolvedValue(undefined);
  return { dataConflictsRepository: { upsertConflict }, validationRules: () => [], upsertConflict };
}

function input(over: Partial<PreRankCheckInput>): PreRankCheckInput {
  return {
    ipoId: '00000000-0000-4000-8000-000000136810',
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'faceValue',
    incomingValue: 10,
    incomingSource: 'NSE',
    storedValue: null,
    segment: 'MAINBOARD',
    ipoType: 'MAINBOARD',
    offeringType: 'IPO',
    documentId: null,
    documentSha256: null,
    shadowMode: false,
    ...over,
  };
}

describe('#1368 runPreRankChecks: one function, every pre-rank check', () => {
  it('matrix validation bounds: faceValue 50000 (max 10000) -> REFUSED VALIDATION_FAILED, stored value returned', async () => {
    const out = await runPreRankChecks(input({ fieldName: 'faceValue', incomingValue: 50000, storedValue: 10 }), deps());
    expect(out.status).toBe('REFUSED');
    if (out.status !== 'REFUSED') return;
    expect(out.reason).toBe('VALIDATION_FAILED');
    expect(out.result.finalValue).toBe(10);
  });

  it('in bounds: faceValue 10 -> PASS', async () => {
    expect((await runPreRankChecks(input({ fieldName: 'faceValue', incomingValue: 10 }), deps())).status).toBe('PASS');
  });

  it('incapable source (section 2.3.5): BSE issueSize into an EMPTY issue_size -> REFUSED_INCAPABLE_SOURCE, conflict recorded', async () => {
    const d = deps();
    const out = await runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: 5000000000, incomingSource: 'BSE', storedValue: null }), d);
    expect(out.status).toBe('REFUSED');
    if (out.status !== 'REFUSED') return;
    expect(out.reason).toBe('REJECTED_INCAPABLE_SOURCE');
    expect(out.result.finalValue).toBeNull();
    expect(d.upsertConflict).toHaveBeenCalledWith(expect.objectContaining({ resolutionReason: 'REJECTED_INCAPABLE_SOURCE', fieldName: 'issueSize' }));
  });

  it('incapable source with a stored value: the stored value is returned untouched', async () => {
    const out = await runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: 5000000000, incomingSource: 'BSE', storedValue: '6800000000.00' }), deps());
    expect(out.status === 'REFUSED' && out.result.finalValue).toBe('6800000000.00');
  });

  it('shadow mode records no conflict row (unchanged rule)', async () => {
    const d = deps();
    await runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: 5000000000, incomingSource: 'BSE', shadowMode: true }), d);
    expect(d.upsertConflict).not.toHaveBeenCalled();
  });

  it('a capable source for the same field passes (CHITTORGARH issueSize)', async () => {
    const out = await runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: 5000000000, incomingSource: 'CHITTORGARH' }), deps());
    expect(out.status).toBe('PASS');
  });

  it('normalization: an incoming value that normalizes to nothing -> NO_INCOMING_VALUE (the caller keeps the stored value)', async () => {
    const out = await runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: '', incomingSource: 'CHITTORGARH', storedValue: '6800000000.00' }), deps());
    expect(out.status).toBe('NO_INCOMING_VALUE');
  });

  it('normalization: an unparseable number (normalizes to NaN, which passes every bound) -> REFUSED VALIDATION_FAILED', async () => {
    const out = await runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: 'not a number', incomingSource: 'CHITTORGARH', storedValue: '6800000000.00' }), deps());
    expect(out.status).toBe('REFUSED');
    expect(out.status === 'REFUSED' && out.reason).toBe('VALIDATION_FAILED');
  });

  it('normalization: a crore-suffixed value is judged after normalization and passes (written as given)', async () => {
    const out = await runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: '500 Cr', incomingSource: 'CHITTORGARH' }), deps());
    expect(out.status).toBe('PASS');
  });

  it('the policy config cannot be read -> the function throws (the fallback door then fails closed)', async () => {
    policyState.throwOnRead = true;
    try {
      await expect(
        runPreRankChecks(input({ fieldName: 'issueSize', incomingValue: 5000000000, incomingSource: 'CHITTORGARH' }), deps())
      ).rejects.toThrow(/unreadable/);
    } finally {
      policyState.throwOnRead = false;
    }
  });

  it('the fallback door runs it first in the shared guard list, and only on the fallback door', () => {
    const first = IPO_WRITE_GUARDS[0] as { name: string; consolidatorEnforced: boolean };
    expect(first.name).toBe('pre-rank-field-checks');
    expect(first.consolidatorEnforced).toBe(true);
  });
});
