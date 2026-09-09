// implements: R-158
/**
 * PeerCompanyRepository.create() row-key coverage (item 01 slice s1b).
 *
 * `create()` currently compiles clean with zero production callers, but a
 * future caller would silently write a `normalized_name` of '' (the schema
 * default) because the insert values never derive the key. This pins:
 * (1) a normal name derives its key via the SAME `rowKeyForName` function
 *     the scraper write paths use (never a second implementation);
 * (2) a name with no identity (empty/whitespace-only) is refused, not
 *     written with a blank key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeerCompanyRepository } from '@/lib/repositories/peer-company-repository';
import type Redis from 'ioredis';
import { InvalidDataError } from '@/lib/errors/repository-errors';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

describe('PeerCompanyRepository.create — row key', () => {
  let repository: PeerCompanyRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new PeerCompanyRepository(mockDb, mockRedis);
  });

  it('derives normalizedName from companyName via the shared rowKeyForName function', async () => {
    const values = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        { id: 'peer-1', ipoId: 'ipo-1', companyName: 'Acme Ltd.', normalizedName: 'acme' },
      ]),
    });
    mockDb.insert = vi.fn().mockReturnValue({ values });

    await repository.create({
      ipoId: 'ipo-1',
      companyName: 'Acme Ltd.',
      isListed: true,
    });

    expect(values).toHaveBeenCalledTimes(1);
    const insertedRow = values.mock.calls[0][0];
    expect(insertedRow.normalizedName).toBe(rowKeyForName('Acme Ltd.'));
    expect(insertedRow.normalizedName).toBe('acme');
  });

  it('refuses to write a row whose name has no identity (whitespace-only)', async () => {
    const values = vi.fn();
    mockDb.insert = vi.fn().mockReturnValue({ values });

    await expect(
      repository.create({
        ipoId: 'ipo-1',
        companyName: '   ',
        isListed: true,
      })
    ).rejects.toThrow(InvalidDataError);

    expect(values).not.toHaveBeenCalled();
  });
});
