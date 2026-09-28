/**
 * m8: a row table's conflict (peer_companies) names its row; the queue row's version token must be
 * read FOR THAT ROW, or every save of a peer conflict is refused ("name the row") / CONFLICT.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ readVersion: vi.fn(async () => ({ version: 'tok-row', currentValue: null, setBy: null, setAt: null, rowKey: 'acme' })) }));

vi.mock('@/lib/db', () => ({ db: {}, ipos: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: () => ({ keys: async () => [], del: async () => 0 }) }));
vi.mock('@/lib/repositories/field-protection-repository', () => ({ FieldProtectionRepository: class { upsert = vi.fn(); } }));
vi.mock('@ipodhan/shared/repositories/data-conflicts-repository', () => ({ DataConflictsRepository: class {} }));
vi.mock('@ipodhan/shared/services/corrigendum-suggestions', () => ({
  acceptCorrigendumSuggestion: vi.fn(),
  dismissCorrigendumSuggestion: vi.fn(),
  isCorrigendumSuggestion: () => false,
}));
vi.mock('@/lib/admin/admin-field-save', () => ({ saveAdminFieldValue: vi.fn() }));
vi.mock('@ipodhan/shared/services/admin-field-write', () => ({ readAdminFieldVersion: h.readVersion }));

import { ConflictResolutionService } from '@/lib/services/conflict-resolution';

describe('ConflictResolutionService.versionOf (m8)', () => {
  it('passes the conflict rowKey so a row table token is read for that row', async () => {
    const svc = new ConflictResolutionService();
    const v = await svc.versionOf({ ipoId: 'ipo-1', tableName: 'peer_companies', fieldName: 'peRatio', rowKey: 'acme' });
    expect(v).toBe('tok-row');
    expect(h.readVersion).toHaveBeenLastCalledWith(expect.anything(), 'ipo-1', 'peer_companies', 'peRatio', { rowKey: 'acme' });
  });

  it('passes no row for a one-row table (rowKey empty)', async () => {
    const svc = new ConflictResolutionService();
    await svc.versionOf({ ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'registrar', rowKey: '' });
    expect(h.readVersion).toHaveBeenLastCalledWith(expect.anything(), 'ipo-1', 'ipos', 'registrar', undefined);
  });
});
