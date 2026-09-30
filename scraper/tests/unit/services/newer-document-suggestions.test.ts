/**
 * §9.2 item 9 fix round: `recordNewerDocumentSuggestions` must never treat a null
 * `readAdminFieldVersion` result (table/field unknown, or a row table whose row key cannot be
 * resolved) as "admin value is empty" — that made every newer document's value look like a
 * correction, even one that actually agrees with the (unreadable) admin value. It must return
 * without inserting any `data_conflicts` row, and log one line naming the table, field, row key
 * and IPO id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { warn, readAdminFieldVersion } = vi.hoisted(() => ({
  warn: vi.fn(),
  readAdminFieldVersion: vi.fn(),
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@ipodhan/shared/services/admin-field-write', () => ({
  readAdminFieldVersion: (...args: unknown[]) => readAdminFieldVersion(...args),
  protectionTableName: (tableName: string, rowKey: string) => (rowKey ? `${tableName}#${rowKey}` : tableName),
}));

vi.mock('@ipodhan/shared/services/corrigendum-suggestions', () => ({
  NEWER_DOCUMENT_ORIGIN: 'NEWER_DOCUMENT',
  newerDocumentSuggestionKey: (documentId: string, tableName: string, rowKey: string, fieldName: string) =>
    `${documentId}|${tableName}|${rowKey}|${fieldName}`,
}));

vi.mock('@ipodhan/shared/utils/duplicate-ipo-merge', () => ({
  columnToCamelCase: (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
}));

vi.mock('../../../config/plan-supersession-rule.mjs', () => ({
  normalizeReceiptValue: (v: unknown) => (v === null || v === undefined ? '' : String(v)),
}));

import { recordNewerDocumentSuggestions } from '../../../src/services/newer-document-suggestions';

const IPO_ID = '00000000-0000-4000-8000-0000000009d9';

function fakeDbWithDocs(docs: Array<Record<string, unknown>>) {
  const insert = vi.fn();
  const db = {
    execute: vi.fn(async () => ({ rows: docs })),
    insert,
  };
  return { db, insert };
}

const ONE_NEWER_DOC = [
  {
    document_id: 'doc-1',
    document_type: 'RHP',
    document_title: 'Some RHP',
    first_seen_at: '2026-09-21T00:00:00Z',
    saved_at: '2026-09-20T00:00:00Z',
    value: '300000000',
  },
];

describe('recordNewerDocumentSuggestions — unreadable admin value', () => {
  beforeEach(() => {
    warn.mockClear();
    readAdminFieldVersion.mockReset();
  });

  it('returns without inserting and logs one line naming table/field/rowKey/ipoId when the admin value cannot be read', async () => {
    readAdminFieldVersion.mockResolvedValue(null);
    const { db, insert } = fakeDbWithDocs(ONE_NEWER_DOC);

    const result = await recordNewerDocumentSuggestions(db as never, {
      ipoId: IPO_ID,
      tableName: 'peer_companies',
      rowKey: 'stale-row-key',
      fieldName: 'pe_ratio',
    });

    expect(result).toEqual({ newerDocuments: 1, equal: 0, inserted: 0, refreshed: 0, duplicates: 0, ids: [] });
    expect(insert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      ipoId: IPO_ID,
      tableName: 'peer_companies',
      fieldName: 'peRatio',
      rowKey: 'stale-row-key',
    });
    expect(String(warn.mock.calls[0][1])).toMatch(/could not read the admin current value/);
  });

  it('inserts a suggestion normally when the admin value IS readable and differs', async () => {
    readAdminFieldVersion.mockResolvedValue({ currentValue: '1230000000' });
    const { db, insert } = fakeDbWithDocs(ONE_NEWER_DOC);
    insert.mockReturnValue({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => [{ id: 'conflict-1', inserted: true }],
        }),
      }),
    });

    const result = await recordNewerDocumentSuggestions(db as never, {
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'issue_size',
    });

    expect(result.inserted).toBe(1);
    expect(result.ids).toEqual(['conflict-1']);
    expect(warn).not.toHaveBeenCalled();
  });
});
