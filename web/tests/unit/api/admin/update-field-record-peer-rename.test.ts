// implements: R-158
/**
 * Admin field-edit route — peer_companies rename recomputes the row key.
 *
 * RCA (item 01 slice s1b): PATCH /api/admin/update-field-record sets
 * `[fieldName]: value` on peer_companies with no awareness of
 * `normalized_name`. An admin correcting "Acme Ltd" to "Beta Industries
 * Ltd" left the row keyed `acme` — provenance names the wrong company, and
 * slice s2's `UNIQUE (ipo_id, normalized_name)` constraint guards nothing
 * for a renamed row. This pins: (1) editing `companyName` recomputes
 * `normalizedName` via the SAME shared `rowKeyForName` function in the same
 * update; (2) a rename to a name with no identity (blank/whitespace) is
 * REJECTED — the edit never reaches the database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';

vi.mock('@/lib/middleware/admin-auth', () => ({
  withAdminAuth: (handler: any) => (request: any, ...args: any[]) =>
    handler(request, { adminId: 'admin-1', adminName: 'Admin', isAuthenticated: true }, ...args),
}));

vi.mock('@/lib/services/audit-log-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  AuditActionTypes: { FIELD_UPDATED: 'FIELD_UPDATED' },
  getClientIP: vi.fn().mockReturnValue('127.0.0.1'),
  getUserAgent: vi.fn().mockReturnValue('vitest'),
}));

vi.mock('@ipodhan/shared/admin/field-protection-checker', () => ({
  createFieldProtectionService: vi.fn(() => ({
    invalidateProtectionCache: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockRedis = {
  del: vi.fn().mockResolvedValue(undefined),
  keys: vi.fn().mockResolvedValue([]),
};
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => mockRedis),
}));

// Chainable query-builder mock. `select().from().where().limit()` resolves
// the "existing row" lookup; `update().set().where().returning()` resolves
// the update; `insert().values().onConflictDoUpdate()` resolves the
// field-protection-metadata upsert.
const existingRow = {
  id: 'peer-1',
  ipoId: 'ipo-1',
  companyName: 'Acme Ltd',
  normalizedName: 'acme',
};

let lastUpdateSet: Record<string, unknown> | null = null;

function buildMockDb() {
  lastUpdateSet = null;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([existingRow]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((setObj: Record<string, unknown>) => {
        lastUpdateSet = setObj;
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ ...existingRow, ...setObj }]),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  };
}

let mockDb = buildMockDb();
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
}));

describe('PATCH /api/admin/update-field-record — peer_companies rename', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb = buildMockDb();
    const dbModule: any = await import('@/lib/db');
    dbModule.getDb.mockImplementation(() => Promise.resolve(mockDb));
  });

  it('recomputes normalizedName via rowKeyForName when companyName is renamed', async () => {
    const { PATCH } = await import('@/app/api/admin/update-field-record/route');

    const request = new NextRequest('http://localhost/api/admin/update-field-record', {
      method: 'PATCH',
      body: JSON.stringify({
        recordId: 'peer-1',
        ipoId: 'ipo-1',
        tableName: 'peer_companies',
        fieldName: 'companyName',
        value: 'Beta Industries Ltd',
      }),
    });

    const response = await PATCH(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(lastUpdateSet).not.toBeNull();
    expect(lastUpdateSet!.companyName).toBe('Beta Industries Ltd');
    expect(lastUpdateSet!.normalizedName).toBe(rowKeyForName('Beta Industries Ltd'));
    expect(lastUpdateSet!.normalizedName).not.toBe('acme');
    expect(json.success).toBe(true);
  });

  it('rejects a rename that yields no identity (whitespace-only name)', async () => {
    const { PATCH } = await import('@/app/api/admin/update-field-record/route');

    const request = new NextRequest('http://localhost/api/admin/update-field-record', {
      method: 'PATCH',
      body: JSON.stringify({
        recordId: 'peer-1',
        ipoId: 'ipo-1',
        tableName: 'peer_companies',
        fieldName: 'companyName',
        value: '   ',
      }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(400);
    expect(lastUpdateSet).toBeNull();
  });

  it('leaves normalizedName untouched when a different field is edited', async () => {
    const { PATCH } = await import('@/app/api/admin/update-field-record/route');

    const request = new NextRequest('http://localhost/api/admin/update-field-record', {
      method: 'PATCH',
      body: JSON.stringify({
        recordId: 'peer-1',
        ipoId: 'ipo-1',
        tableName: 'peer_companies',
        fieldName: 'peRatio',
        value: '42.5',
      }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(lastUpdateSet).not.toBeNull();
    expect(lastUpdateSet!.peRatio).toBe('42.5');
    expect('normalizedName' in lastUpdateSet!).toBe(false);
  });
});
