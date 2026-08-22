/**
 * T-275: invalidateRegistrarCache() in web/lib/cache/invalidate.ts was found
 * to delete a stale/wrong key ('registrars:list') that RegistrarRepository
 * never wrote to -- a silent no-op. It now shares the same
 * getRegistrarInvalidationKeys() SSOT generator as the repository's own
 * invalidateRegistrarCache(). This test locks that it purges the actual
 * registrar cache-key patterns via safeDelPattern, not the old literal key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/cache/redis-client', () => ({
  safeDel: vi.fn().mockResolvedValue(undefined),
  safeDelPattern: vi.fn().mockResolvedValue(undefined),
}));

import { invalidateRegistrarCache } from '@/lib/cache/invalidate';
import { safeDel, safeDelPattern } from '@/lib/cache/redis-client';
import { getRegistrarInvalidationKeys } from '@/lib/cache/cache-keys';

describe('invalidateRegistrarCache (lib/cache/invalidate.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('purges every pattern from getRegistrarInvalidationKeys(), not a stale literal key', async () => {
    await invalidateRegistrarCache();

    const expectedPatterns = getRegistrarInvalidationKeys();
    expect(expectedPatterns).not.toContain('registrars:list');

    for (const pattern of expectedPatterns) {
      expect(safeDelPattern).toHaveBeenCalledWith(pattern);
    }
    expect(safeDelPattern).not.toHaveBeenCalledWith('registrars:list');
    expect(safeDel).not.toHaveBeenCalledWith('registrars:list');
  });

  it('propagates errors from the underlying cache delete', async () => {
    vi.mocked(safeDelPattern).mockRejectedValueOnce(new Error('redis down'));

    await expect(invalidateRegistrarCache()).rejects.toThrow('redis down');
  });
});
