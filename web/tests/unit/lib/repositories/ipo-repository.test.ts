import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type Redis from 'ioredis';

// Mock Drizzle DB
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

describe('IPORepository', () => {
  let repository: IPORepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new IPORepository(mockDb, mockRedis);
  });

  describe('findById', () => {
    const mockIPO = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'test-ipo',
      companyName: 'Test Company',
      segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
      status: 'OPEN',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScrapedAt: null,
    };

    it('should return IPO from cache if available, rehydrating Date fields', async () => {
      // Redis only ever stores the JSON.stringify'd form, so createdAt/updatedAt
      // come back as ISO strings on the wire — the repository must revive them.
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(mockIPO));

      const result = await repository.findById(mockIPO.id);

      expect(mockRedis.get).toHaveBeenCalledWith(`ipo:id:${mockIPO.id}`);
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
      expect(result!.createdAt.toISOString()).toBe(mockIPO.createdAt.toISOString());
    });

    it('should query database on cache miss and populate cache', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPO]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById(mockIPO.id);

      expect(mockRedis.get).toHaveBeenCalledWith(`ipo:id:${mockIPO.id}`);
      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toEqual(mockIPO);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `ipo:id:${mockIPO.id}`,
        900,
        JSON.stringify(mockIPO)
      );
    });

    it('should return null when IPO not found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById('non-existent-id');

      expect(result).toBeNull();
    });

    it('should handle cache errors and fallback to database', async () => {
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis error'));

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPO]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findById(mockIPO.id);

      expect(result).toEqual(mockIPO);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('findBySlug', () => {
    const mockIPO = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'test-ipo',
      companyName: 'Test Company',
      segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
      status: 'OPEN',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScrapedAt: null,
    };

    it('should return IPO with relations from database', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockIPO]),
        orderBy: vi.fn().mockReturnThis(),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findBySlug('test-ipo');

      expect(result).toBeDefined();
      expect(result?.slug).toBe('test-ipo');
    });

    it('should return null when IPO not found by slug', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.findBySlug('non-existent-slug');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    const mockIPOs = [
      {
        id: '1',
        slug: 'ipo-1',
        companyName: 'Company 1',
        segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
        status: 'OPEN',
      },
      {
        id: '2',
        slug: 'ipo-2',
        companyName: 'Company 2',
        segment: 'SME' as const,
  offeringType: 'IPO' as const,
        status: 'UPCOMING',
      },
    ];

    it('should return paginated IPO list with filters', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      // The data query returns { ipo, ipoScore } structure due to leftJoin
      const mockResultsWithJoin = mockIPOs.map(ipo => ({
        ipo,
        ipoScore: null, // No score data
      }));

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(), // Added leftJoin for ipoScores
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue(mockResultsWithJoin),
      };

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 2 }]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockSelect);

      // T-261: findAll now enriches rows with the newest gmp_records /
      // subscriptions snapshot via raw SQL. No live rows here -> the list must
      // still come back intact, with the figures simply absent.
      mockDb.execute = vi.fn().mockResolvedValue({ rows: [] });

      const result = await repository.findAll({
        status: 'OPEN',
        page: 1,
        limit: 10,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
    });

    it('fills GMP + subscription from the live time-series when the ipos columns are null (#89)', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([
          { ipo: { ...mockIPOs[0], gmpPrice: null, subscriptionTotal: null }, ipoScore: null },
          { ipo: { ...mockIPOs[1], gmpPrice: null, subscriptionTotal: null }, ipoScore: null },
        ]),
      };
      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 2 }]),
      };
      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockSelect);

      // 1st execute() = GMP lookup, 2nd = subscription lookup. Only IPO '1' has data.
      mockDb.execute = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              ipo_id: '1',
              gmp: '310.00',
              gmp_percentage: '39.34',
              // UTC-naive text, exactly as Postgres emits it for a
              // `timestamp without time zone` column (#28).
              ts_text: '2026-08-21 18:06:00',
              source: 'INVESTORGAIN_GMP',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              ipo_id: '1',
              total_subscription: '0.95',
              retail_subscription: '0.67',
              qib_subscription: '1.69',
              nii_subscription: '0.63',
              ts_text: '2026-08-21 23:44:23.4',
            },
          ],
        });

      const result = await repository.findAll({ status: 'OPEN', page: 1, limit: 10 });
      const [enriched, untouched] = result.data as unknown as Array<Record<string, unknown>>;

      expect(enriched.gmpPrice).toBe(310);
      expect(enriched.gmpPercentageHistorical).toBe(39.34);
      expect(enriched.subscriptionTotal).toBe(0.95);
      expect(enriched.subscriptionQib).toBe(1.69);
      expect(enriched.gmpSource).toBe('INVESTORGAIN_GMP');
      // The naive DB value is UTC-naive: it must surface as 18:06Z, NOT shifted
      // by the box's local offset — a freshness claim that is 5h30m off is a lie.
      expect(enriched.gmpUpdatedAt).toBe('2026-08-21T18:06:00.000Z');
      expect(enriched.subscriptionUpdatedAt).toBe('2026-08-21T23:44:23.400Z');

      // An IPO with no grey market / no bids stays honestly empty.
      expect(untouched.gmpPrice).toBeNull();
      expect(untouched.subscriptionTotal).toBeNull();
      expect(untouched.gmpSource).toBeNull();
    });

    it('still returns the list when the live-metrics lookup fails (fail-open)', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue(
          mockIPOs.map(ipo => ({ ipo: { ...ipo, gmpPrice: null }, ipoScore: null }))
        ),
      };
      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 2 }]),
      };
      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockSelect);
      mockDb.execute = vi.fn().mockRejectedValue(new Error('gmp lookup exploded'));

      const result = await repository.findAll({ status: 'OPEN', page: 1, limit: 10 });

      expect(result.data).toHaveLength(2);
      expect((result.data[0] as unknown as Record<string, unknown>).gmpPrice).toBeNull();
    });
  });

  describe('search', () => {
    const mockResults = [
      {
        id: '1',
        slug: 'reliance-ipo',
        companyName: 'Reliance Industries',
        segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
        status: 'LISTED',
      },
    ];

    it('should search IPOs using trigram similarity', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockResults),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('Reliance', 10);

      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Reliance Industries');
    });

    it('should fallback to ILIKE search if trigram fails', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn()
          .mockRejectedValueOnce(new Error('Trigram error'))
          .mockResolvedValueOnce(mockResults),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.search('Reliance', 10);

      expect(result).toBeDefined();
    });
  });

  describe('create', () => {
    const mockIPOData = {
      slug: 'new-ipo',
      companyName: 'New Company',
      segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
      status: 'UPCOMING' as const,
    };

    it('should create new IPO and invalidate cache', async () => {
      const createdIPO = { id: 'new-id', ...mockIPOData };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([createdIPO]),
      };
      mockDb.insert = vi.fn().mockReturnValue(mockInsert);
      mockRedis.keys = vi.fn().mockResolvedValue(['ipo:list:hash1', 'ipo:search:hash2']);
      mockRedis.del = vi.fn().mockResolvedValue(2);

      const result = await repository.create(mockIPOData);

      expect(result).toEqual(createdIPO);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedis.keys).toHaveBeenCalledWith('ipo:list:*');
    });
  });

  describe('update', () => {
    const mockIPO = {
      id: '123',
      slug: 'test-ipo',
      companyName: 'Test Company',
      segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
      status: 'OPEN',
    };

    it('should update IPO and invalidate cache', async () => {
      const updateData = { status: 'CLOSED' as const };
      const updatedIPO = { ...mockIPO, ...updateData };

      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedIPO]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);
      mockRedis.del = vi.fn().mockResolvedValue(2);
      mockRedis.keys = vi.fn().mockResolvedValue(['ipo:list:hash1']);

      const result = await repository.update(mockIPO.id, updateData);

      expect(result.status).toBe('CLOSED');
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw EntityNotFoundError when IPO not found', async () => {
      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);

      await expect(
        repository.update('non-existent-id', { status: 'CLOSED' as const })
      ).rejects.toThrow('IPO not found');
    });
  });

  describe('delete', () => {
    it('should delete IPO and invalidate cache', async () => {
      const mockIPO = {
        id: '123',
        slug: 'test-ipo',
        companyName: 'Test Company',
      };

      const mockDelete = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockIPO]),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);
      mockRedis.del = vi.fn().mockResolvedValue(2);
      mockRedis.keys = vi.fn().mockResolvedValue(['ipo:list:hash1']);

      await repository.delete(mockIPO.id);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw EntityNotFoundError when IPO not found', async () => {
      const mockDelete = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDb.delete = vi.fn().mockReturnValue(mockDelete);

      await expect(repository.delete('non-existent-id')).rejects.toThrow(
        'IPO not found'
      );
    });
  });

  describe('findPeers', () => {
    const mockPeerIPOs = [
      {
        id: 'peer-1',
        slug: 'peer-ipo-1',
        companyName: 'Peer Company 1',
        segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
        sector: 'Technology',
        status: 'OPEN',
      },
      {
        id: 'peer-2',
        slug: 'peer-ipo-2',
        companyName: 'Peer Company 2',
        segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
        sector: 'Technology',
        status: 'UPCOMING',
      },
    ];

    const mockFinancialData = {
      id: 'fin-1',
      ipoId: 'peer-1',
      peRatio: '25.5',
      eps: '45.2',
    };

    it('should return peer IPOs in the same sector with financial data', async () => {
      const mockIpoSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockPeerIPOs),
      };

      const mockFinancialSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockFinancialData]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockIpoSelect)
        .mockReturnValue(mockFinancialSelect);

      const result = await repository.findPeers('current-ipo-id', 'Technology', 8);

      expect(result).toHaveLength(2);
      expect(result[0].sector).toBe('Technology');
      expect(result[0].financialData).toBeDefined();
    });

    it('should exclude current IPO from peer results', async () => {
      const currentIpoId = 'current-ipo-id';
      const mockIpoSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockPeerIPOs),
      };

      const mockFinancialSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockIpoSelect)
        .mockReturnValue(mockFinancialSelect);

      const result = await repository.findPeers(currentIpoId, 'Technology', 8);

      expect(result.every((peer) => peer.id !== currentIpoId)).toBe(true);
    });

    it('should return empty array when no sector provided', async () => {
      const result = await repository.findPeers('current-ipo-id', null, 8);

      expect(result).toEqual([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should limit peer results to specified limit', async () => {
      const mockIpoSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockPeerIPOs.slice(0, 5)),
      };

      const mockFinancialSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockIpoSelect)
        .mockReturnValue(mockFinancialSelect);

      const result = await repository.findPeers('current-ipo-id', 'Technology', 5);

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should handle peers with no financial data', async () => {
      const mockIpoSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockPeerIPOs[0]]),
      };

      const mockFinancialSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockIpoSelect)
        .mockReturnValue(mockFinancialSelect);

      const result = await repository.findPeers('current-ipo-id', 'Technology', 8);

      expect(result).toHaveLength(1);
      expect(result[0].financialData).toBeNull();
    });

    it('should throw DatabaseError on query failure', async () => {
      const mockIpoSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      };

      mockDb.select = vi.fn().mockReturnValue(mockIpoSelect);

      await expect(
        repository.findPeers('current-ipo-id', 'Technology', 8)
      ).rejects.toThrow('Failed to fetch peer IPOs for sector: Technology');
    });
  });

  describe('findHistorical', () => {
    const mockHistoricalIPO = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      slug: 'test-ipo',
      companyName: 'Test Company',
      segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
      sector: 'Technology',
      status: 'LISTED' as const,
      listingDate: '2024-01-15',
      issueSize: '500',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScrapedAt: null,
    };

    const mockListingPerformance = {
      listingPrice: 150,
      issuePrice: 100,
      listingGainPercent: '50.00',
    };

    it('should return historical IPOs from cache if available', async () => {
      const cachedData = {
        data: [
          {
            ...mockHistoricalIPO,
            listingClose: 150,
            issuePrice: 100,
            listingGainPercent: 50.0,
            year: 2024,
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };

      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify(cachedData));

      const result = await repository.findHistorical({
        year: '2024',
        page: 1,
        limit: 20,
      });

      expect(mockRedis.get).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].year).toBe(2024);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should query database on cache miss with year filter', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      };

      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([
          {
            ipo: mockHistoricalIPO,
            ...mockListingPerformance,
          },
        ]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockDataSelect);

      const result = await repository.findHistorical({
        year: '2024',
        page: 1,
        limit: 20,
      });

      expect(mockDb.select).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].year).toBe(2024);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by sector', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      };

      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([
          {
            ipo: mockHistoricalIPO,
            ...mockListingPerformance,
          },
        ]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockDataSelect);

      const result = await repository.findHistorical({
        sector: 'Technology',
        page: 1,
        limit: 20,
      });

      expect(result.data[0].sector).toBe('Technology');
    });

    it('should filter by positive performance', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 2 }]),
      };

      const positiveIPO = {
        ipo: { ...mockHistoricalIPO, companyName: 'Positive IPO' },
        listingPrice: 150,
        issuePrice: 100,
        listingGainPercent: '50.00',
      };

      const negativeIPO = {
        ipo: { ...mockHistoricalIPO, companyName: 'Negative IPO' },
        listingPrice: 80,
        issuePrice: 100,
        listingGainPercent: '-20.00',
      };

      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([positiveIPO, negativeIPO]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockDataSelect);

      const result = await repository.findHistorical({
        performance: 'Positive',
        page: 1,
        limit: 20,
      });

      // Performance filter is applied after fetching
      expect(result.data.every((ipo) => ipo.listingGainPercent! > 0)).toBe(true);
    });

    it('should sort by listing_date descending by default', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      };

      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([
          {
            ipo: mockHistoricalIPO,
            ...mockListingPerformance,
          },
        ]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockDataSelect);

      await repository.findHistorical({
        sort: 'listing_date',
        sortOrder: 'desc',
        page: 1,
        limit: 20,
      });

      expect(mockDataSelect.orderBy).toHaveBeenCalled();
    });

    it('should handle pagination correctly', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 50 }]),
      };

      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([
          {
            ipo: mockHistoricalIPO,
            ...mockListingPerformance,
          },
        ]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockDataSelect);

      const result = await repository.findHistorical({
        page: 2,
        limit: 20,
      });

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(20);
      expect(result.meta.total).toBe(50);
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.hasPrev).toBe(true);
    });

    it('should compute year from listing_date', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      };

      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([
          {
            ipo: { ...mockHistoricalIPO, listingDate: '2024-06-15' },
            ...mockListingPerformance,
          },
        ]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockDataSelect);

      const result = await repository.findHistorical({
        page: 1,
        limit: 20,
      });

      expect(result.data[0].year).toBe(2024);
    });

    // T-277F checker finding #3: a row reclassified away from offering_type
    // 'IPO' (e.g. INVITS via the NON_IPO_TRUST_SHAPE guard) still has
    // status='LISTED' + a listing_date, so it stayed ranked by findHistorical
    // (the query behind the Mainboard/SME Performance Trackers) with no
    // offeringType gate. Assert the WHERE clause actually references the
    // offering_type column — every other IPO surface in this file already
    // gates on REAL_IPO_TYPE_FILTER (see offering-type.ts); this closes the
    // one method that didn't.
    it('gates the query on the offering_type column (REAL_IPO_TYPE_FILTER)', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      };

      const mockDataSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([
          { ipo: mockHistoricalIPO, ...mockListingPerformance },
        ]),
      };

      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(mockCountSelect)
        .mockReturnValueOnce(mockDataSelect);

      await repository.findHistorical({ page: 1, limit: 20 });

      // Walk the real drizzle SQL AST passed to .where() looking for a
      // reference to the `offering_type` column (bounded-depth, cycle-safe —
      // drizzle Column/Table objects are mutually circular).
      function referencesColumn(node: unknown, columnName: string, depth = 0, seen = new Set<unknown>()): boolean {
        if (node == null || typeof node !== 'object' || depth > 8 || seen.has(node)) return false;
        seen.add(node);
        const obj = node as Record<string, unknown>;
        if (obj.name === columnName) return true;
        if (Array.isArray(obj.queryChunks)) {
          return obj.queryChunks.some((c) => referencesColumn(c, columnName, depth + 1, seen));
        }
        if (Array.isArray(node)) {
          return (node as unknown[]).some((c) => referencesColumn(c, columnName, depth + 1, seen));
        }
        return false;
      }

      const countWhereArg = mockCountSelect.where.mock.calls[0][0];
      expect(referencesColumn(countWhereArg, 'offering_type')).toBe(true);
      const dataWhereArg = mockDataSelect.where.mock.calls[0][0];
      expect(referencesColumn(dataWhereArg, 'offering_type')).toBe(true);
    });

    it('should throw DatabaseError on query failure', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockCountSelect = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      };

      mockDb.select = vi.fn().mockReturnValue(mockCountSelect);

      await expect(
        repository.findHistorical({ page: 1, limit: 20 })
      ).rejects.toThrow('Failed to fetch historical IPO list');
    });
  });

  describe('findRedirectSlug', () => {
    // T-278F (checker finding #3): a currently-LIVE ipos.slug must never be
    // shadowed by a stale ipo_slug_redirects row — prod observed a cron cycle
    // re-mint a new IPO under an already-retired slug before the fix deployed.
    it('returns null WITHOUT consulting the redirect table when oldSlug is a live ipos.slug', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const liveSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'live-ipo-id' }]),
      };
      mockDb.select = vi.fn().mockReturnValue(liveSelect);

      const result = await repository.findRedirectSlug('shadowed-slug');

      expect(result).toBeNull();
      // Only the live-slug check ran — no second query against ipo_slug_redirects.
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('returns the redirect target when oldSlug is retired (not live) and a redirect row exists', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const liveSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // not live
      };
      const redirectSelect = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ currentSlug: 'clean-slug' }]),
      };
      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(liveSelect)
        .mockReturnValueOnce(redirectSelect);

      const result = await repository.findRedirectSlug('retired-slug');

      expect(result).toBe('clean-slug');
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('returns null when oldSlug is retired but was never redirected', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const liveSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      const redirectSelect = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi
        .fn()
        .mockReturnValueOnce(liveSelect)
        .mockReturnValueOnce(redirectSelect);

      const result = await repository.findRedirectSlug('never-redirected-slug');

      expect(result).toBeNull();
    });

    // T-278F2 (checker round 2 finding): a poisoned/stale `ipo:slug-redirect:*`
    // cache entry must NOT be able to shadow a currently-live slug. Round 1's
    // guard sat inside the getFromCache miss callback, so a cache HIT skipped
    // it entirely. Checker reproduced: plant the cache key -> 200 becomes 308
    // -> delete the key -> back to 200. Reproduce the exact "plant the cache
    // key" scenario here: mock a cache HIT returning a redirect target for a
    // slug that is ALSO live in ipos.slug, and assert the guard still wins.
    it('never returns a redirect target for a live slug even when the redirect cache is poisoned (plant-the-cache-key)', async () => {
      // Simulate a planted/stale cache entry claiming oldSlug redirects somewhere.
      mockRedis.get = vi.fn().mockResolvedValue(JSON.stringify('poisoned-target-slug'));

      const liveSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 'live-ipo-id' }]),
      };
      mockDb.select = vi.fn().mockReturnValue(liveSelect);

      const result = await repository.findRedirectSlug('shadowed-slug');

      expect(result).toBeNull();
      // The live-slug guard must run BEFORE the cache is ever consulted, so a
      // poisoned cache entry is never reached — redis.get must not be called.
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });
});
