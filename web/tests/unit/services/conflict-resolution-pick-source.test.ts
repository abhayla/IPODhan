/**
 * A2 round-2 review MAJOR-1: a conflict pick must name one of the conflict row's own two sources.
 * The stored value comes from the row, but the source label reaches the reader line (OD-109), so a
 * client-chosen third label ("DRHP" on an NSE/BSE conflict) would be a false source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  save: vi.fn(async () => ({ kind: 'OK', version: 'v2' })),
  rows: [] as unknown[],
}));

vi.mock('@/lib/db', () => ({ db: {}, ipos: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: () => ({ keys: async () => [], del: async () => 0 }) }));
vi.mock('@/lib/repositories/field-protection-repository', () => ({ FieldProtectionRepository: class { upsert = vi.fn(); } }));
vi.mock('@ipodhan/shared/repositories/data-conflicts-repository', () => ({
  DataConflictsRepository: class {
    findUnresolved = async () => h.rows;
    resolveConflict = vi.fn(async () => undefined);
  },
}));
vi.mock('@ipodhan/shared/services/corrigendum-suggestions', () => ({
  acceptCorrigendumSuggestion: vi.fn(),
  dismissCorrigendumSuggestion: vi.fn(),
  isCorrigendumSuggestion: () => false,
}));
vi.mock('@/lib/admin/admin-field-save', () => ({ saveAdminFieldValue: h.save }));
vi.mock('@ipodhan/shared/services/admin-field-write', () => ({ readAdminFieldVersion: vi.fn() }));

import { ConflictResolutionService } from '@/lib/services/conflict-resolution';

const detectedAt = new Date('2026-09-25T04:30:00.000Z');
const conflict = {
  id: 'c-1',
  ipoId: 'ipo-1',
  tableName: 'ipos',
  fieldName: 'lotSize',
  rowKey: '',
  source1: 'NSE',
  value1: '100',
  source2: 'BSE',
  value2: '120',
  detectedAt,
};

const opts = (resolvedSource: string) => ({
  resolvedSource,
  resolvedBy: 'Test Admin',
  adminId: 'admin-1',
  applyToDatabase: true,
  expectedVersion: 'v1',
});

describe('conflict pick names one of the row sources (A2 MAJOR-1)', () => {
  beforeEach(() => {
    h.rows = [conflict];
    h.save.mockClear();
  });

  it('refuses a label that is neither source and writes nothing', async () => {
    const r = await new ConflictResolutionService().resolveConflict('c-1', opts('DRHP') as never);
    expect(r.success).toBe(false);
    expect(r.writeResult).toEqual({ kind: 'INVALID', reason: expect.stringContaining('neither') });
    expect(h.save).not.toHaveBeenCalled();
  });

  it('stores source2 value with source2 label and the conflict detected time as the read date', async () => {
    await new ConflictResolutionService().resolveConflict('c-1', opts('BSE') as never);
    expect(h.save).toHaveBeenCalledTimes(1);
    const arg = (h.save.mock.calls[0] as unknown[])[0] as { value: unknown; mode: Record<string, unknown> };
    expect(arg.value).toBe('120');
    expect(arg.mode).toEqual({ kind: 'storedPick', sourceLabel: 'BSE', readDate: '2026-09-25T04:30:00.000Z', value: '120' });
  });
});
