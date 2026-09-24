/**
 * Item 9 (OD-90): the existing admin resolve action decides a corrigendum SUGGESTION as
 * accept (resolvedSource ADMIN -> ADMIN write) or dismiss (anything else -> no write), never via
 * the generic ipos-only apply path; the bulk auto-resolve never touches one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  accept: vi.fn(async () => ({ ok: true, conflictId: 's-1', fieldName: 'designatedExchange', appliedValue: 'NSE' })),
  dismiss: vi.fn(async () => ({ ok: true, conflictId: 's-1', fieldName: 'designatedExchange', appliedValue: null })),
  repoResolve: vi.fn(async () => undefined),
  dbUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { update: h.dbUpdate }, ipos: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: () => ({ keys: async () => [], del: async () => 0 }) }));
vi.mock('@/lib/repositories/field-protection-repository', () => ({ FieldProtectionRepository: class { upsert = vi.fn(); } }));
vi.mock('@ipodhan/shared/repositories/data-conflicts-repository', () => ({
  DataConflictsRepository: class {
    findUnresolved = async () => h.rows;
    resolveConflict = h.repoResolve;
  },
}));
vi.mock('@ipodhan/shared/services/corrigendum-suggestions', () => ({
  acceptCorrigendumSuggestion: h.accept,
  dismissCorrigendumSuggestion: h.dismiss,
  isCorrigendumSuggestion: (r: { documentId?: string | null }) => Boolean(r && r.documentId),
}));

import { ConflictResolutionService } from '@/lib/services/conflict-resolution';

const suggestion = {
  id: 's-1', ipoId: 'ipo-1', tableName: 'ipo_details', fieldName: 'designatedExchange',
  source1: 'DRHP', value1: 'BSE', source2: 'DRHP', value2: 'NSE', documentId: 'doc-1',
};
const opts = (resolvedSource: string) => ({
  resolvedSource: resolvedSource as never, resolutionReason: 'r', resolvedBy: 'admin', applyToDatabase: true,
});

beforeEach(() => {
  h.rows = [suggestion];
  vi.clearAllMocks();
});

describe('ConflictResolutionService — corrigendum suggestions (OD-90)', () => {
  it('ADMIN accepts: routes to the ADMIN write, not the generic apply or plain resolve', async () => {
    const r = await new ConflictResolutionService().resolveConflict('s-1', opts('ADMIN'));
    expect(h.accept).toHaveBeenCalledWith(expect.anything(), 's-1', 'admin', undefined);
    expect(h.dismiss).not.toHaveBeenCalled();
    expect(h.dbUpdate).not.toHaveBeenCalled();
    expect(h.repoResolve).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: true, appliedValue: 'NSE', fieldProtected: true });
  });

  it('any other choice dismisses: nothing is written', async () => {
    const r = await new ConflictResolutionService().resolveConflict('s-1', opts('DRHP'));
    expect(h.dismiss).toHaveBeenCalledTimes(1);
    expect(h.accept).not.toHaveBeenCalled();
    expect(h.dbUpdate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: true, appliedValue: null, fieldProtected: false });
  });

  it('auto-resolve skips a suggestion even when its stored side is ADMIN', async () => {
    h.rows = [{ ...suggestion, source1: 'ADMIN' }];
    const r = await new ConflictResolutionService().autoResolve({});
    expect(r.resolved).toBe(0);
    expect(r.skipped).toBe(1);
    expect(h.accept).not.toHaveBeenCalled();
    expect(h.repoResolve).not.toHaveBeenCalled();
  });
});
