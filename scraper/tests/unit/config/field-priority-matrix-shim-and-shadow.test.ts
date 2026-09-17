/**
 * Item 3 slice S1d: `getSourcePriority` / `isTimeBased` / `allowsSameSourceRefresh` widen S1b's
 * flip-only delegation gate ("has a row AND is flipped") to "has a row" for the LOG (shadow),
 * while `flipped` still controls which groups' WRITE decisions actually change. A field with no
 * manifest row falls back to the matrix `sources` order through a logged shim, once per process
 * per field.
 *
 * Fixtures against the REAL manifest + real switchover.json (no mocked manifest — defect-fix-
 * contract.md: a fixture manifest can never catch a divergence between this file's reading of
 * the schema and the real 190-row manifest):
 * - `ipos.lot_size` (fieldName `lotSize`): in the FLIPPED `issue-size` group AND has a manifest
 *   row (MAINBOARD ranks [DOC, BSE, NSE] per the policy-same-source-refresh test) -> delegates.
 * - `ipos.open_date` (fieldName `openDate`): has a manifest row but its group is NOT flipped
 *   (`switchover.json`'s only flipped group is `issue-size`, which does not list `ipos.open_date`)
 *   -> policy-shadow: matrix answer still returned, but both orders are logged.
 * - `ipos.market_cap` (fieldName `marketCap`): NOT in the 190-row manifest at all (measured
 *   2026-09-18: `ipo_financials`-only fields like marketCap/netWorth/eps have no manifest row)
 *   -> policy-shim: matrix `sources` order used, logged once per process.
 *
 * RED on origin/main (20df246e): `hasManifestRow` does not exist, `getSourcePriority` et al. gate
 * only on `policyGoverns` (flip-only), and no shim/shadow log lines are ever emitted.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: {
    ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()).FEATURE_FLAGS,
    ENABLE_POLICY_WRITER: true,
  },
}));

const infoSpy = vi.fn();
vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: (...args: unknown[]) => infoSpy(...args), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: (...args: unknown[]) => infoSpy(...args), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  infoSpy.mockClear();
  // The shim/shadow dedup Sets are module-level singletons ("once per process per field") —
  // a dynamic import() within one test file returns the SAME cached module instance across
  // tests, so a log already emitted by an earlier test would otherwise silently suppress a
  // later test's log and make that test look broken. resetModules() forces a fresh module
  // instance (fresh Sets) per test, matching "once per process" semantics within each test's
  // own process-lifetime assertion rather than leaking across unrelated test cases.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('item 3 S1d: hasManifestRow', () => {
  it('ipos.lot_size (fieldName lotSize) has a manifest row', async () => {
    const { hasManifestRow } = await import('../../../src/config/field-priority-matrix.js');
    expect(hasManifestRow('lotSize', 'ipos')).toBe(true);
  });

  it('ipos.open_date (fieldName openDate) has a manifest row', async () => {
    const { hasManifestRow } = await import('../../../src/config/field-priority-matrix.js');
    expect(hasManifestRow('openDate', 'ipos')).toBe(true);
  });

  it('ipos.market_cap (fieldName marketCap) has NO manifest row', async () => {
    const { hasManifestRow } = await import('../../../src/config/field-priority-matrix.js');
    expect(hasManifestRow('marketCap', 'ipos')).toBe(false);
  });

  it('no tableName -> false (never throws)', async () => {
    const { hasManifestRow } = await import('../../../src/config/field-priority-matrix.js');
    expect(hasManifestRow('marketCap')).toBe(false);
  });
});

describe('item 3 S1d: a field WITH a row in a FLIPPED group delegates to the resolver (widened from S1b)', () => {
  it('getSourcePriority(lotSize, BSE, ipos) matches the resolver rank (BSE ranked at index 1 in [DOC,BSE,NSE])', async () => {
    const { getSourcePriority } = await import('../../../src/config/field-priority-matrix.js');
    // ADMIN is prepended by policyRanksAsWriterSources -> ['ADMIN','DRHP'(DOC),'BSE','NSE']
    expect(getSourcePriority('lotSize', 'BSE', 'ipos')).toBe(2);
  });

  it('delegating to the resolver never logs policy-shim or policy-shadow (it has a row AND is flipped)', async () => {
    const { getSourcePriority } = await import('../../../src/config/field-priority-matrix.js');
    getSourcePriority('lotSize', 'BSE', 'ipos');
    const shimCalls = infoSpy.mock.calls.filter((c) => c[1] === 'policy-shim');
    const shadowCalls = infoSpy.mock.calls.filter((c) => c[1] === 'policy-shadow');
    expect(shimCalls).toEqual([]);
    expect(shadowCalls).toEqual([]);
  });
});

describe('item 3 S1d: a field WITH a row whose group is NOT flipped logs policy-shadow and keeps the matrix answer', () => {
  it('getSourcePriority(openDate, NSE, ipos) returns the LEGACY matrix answer, not the resolver answer', async () => {
    const { getSourcePriority, getFieldRules } = await import('../../../src/config/field-priority-matrix.js');
    const legacyRules = getFieldRules('openDate');
    const expectedIndex = legacyRules.sources.indexOf('NSE');
    expect(getSourcePriority('openDate', 'NSE', 'ipos')).toBe(expectedIndex);
  });

  it('logs policy-shadow once, naming the field and both orders', async () => {
    const { getSourcePriority } = await import('../../../src/config/field-priority-matrix.js');
    getSourcePriority('openDate', 'NSE', 'ipos');
    const shadowCalls = infoSpy.mock.calls.filter((c) => c[1] === 'policy-shadow');
    expect(shadowCalls.length).toBe(1);
    const payload = shadowCalls[0][0] as { field: string; matrixOrder: unknown; policyOrder: unknown };
    expect(payload.field).toBe('ipos.open_date');
    expect(payload.matrixOrder).toBeDefined();
    expect(payload.policyOrder).toBeDefined();
  });

  it('logs policy-shadow only ONCE per process even across repeated calls', async () => {
    const { getSourcePriority } = await import('../../../src/config/field-priority-matrix.js');
    getSourcePriority('openDate', 'NSE', 'ipos');
    getSourcePriority('openDate', 'BSE', 'ipos');
    getSourcePriority('openDate', 'DRHP', 'ipos');
    const shadowCalls = infoSpy.mock.calls.filter((c) => c[1] === 'policy-shadow');
    expect(shadowCalls.length).toBe(1);
  });
});

describe('item 3 S1d: a field with NO manifest row falls back to the matrix through the logged shim', () => {
  it('getSourcePriority(marketCap, DRHP, ipos) returns the matrix answer (no resolver call possible)', async () => {
    const { getSourcePriority, getFieldRules } = await import('../../../src/config/field-priority-matrix.js');
    const legacyRules = getFieldRules('marketCap');
    const expectedIndex = legacyRules.sources.indexOf('DRHP');
    expect(getSourcePriority('marketCap', 'DRHP', 'ipos')).toBe(expectedIndex);
  });

  it('logs policy-shim once, naming the field and "no manifest row"', async () => {
    const { getSourcePriority } = await import('../../../src/config/field-priority-matrix.js');
    getSourcePriority('marketCap', 'DRHP', 'ipos');
    const shimCalls = infoSpy.mock.calls.filter((c) => c[1] === 'policy-shim');
    expect(shimCalls.length).toBe(1);
    const payload = shimCalls[0][0] as { field: string; reason: string };
    expect(payload.field).toBe('ipos.market_cap');
    expect(payload.reason).toBe('no manifest row');
  });

  it('logs policy-shim only ONCE per process even across repeated calls', async () => {
    const { getSourcePriority } = await import('../../../src/config/field-priority-matrix.js');
    getSourcePriority('marketCap', 'DRHP', 'ipos');
    getSourcePriority('marketCap', 'NSE', 'ipos');
    getSourcePriority('marketCap', 'BSE', 'ipos');
    const shimCalls = infoSpy.mock.calls.filter((c) => c[1] === 'policy-shim');
    expect(shimCalls.length).toBe(1);
  });

  it('allowsSameSourceRefresh(marketCap, ..., ipos) also uses the shim path without throwing', async () => {
    const { allowsSameSourceRefresh } = await import('../../../src/config/field-priority-matrix.js');
    expect(() => allowsSameSourceRefresh('marketCap', 'DRHP', 'ipos')).not.toThrow();
  });
});

describe('item 3 S1d: no tableName (legacy one-arg call shape) never logs and never delegates', () => {
  it('getSourcePriority(marketCap, DRHP) with no tableName: no shim/shadow log', async () => {
    const { getSourcePriority } = await import('../../../src/config/field-priority-matrix.js');
    getSourcePriority('marketCap', 'DRHP');
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
