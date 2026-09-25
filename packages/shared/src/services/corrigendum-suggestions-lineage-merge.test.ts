/**
 * #1068 (same class as #755, fixed for `packages/shared`'s field-sources-repository.ts by #753
 * and web's copy by #1065): `acceptCorrigendumSuggestion`'s `field_sources` `onConflictDoUpdate`
 * sets `dataLineage` to a plain object (`{ method: 'ADMIN_CORRIGENDUM_ACCEPT', ... }`), which
 * REPLACES the whole jsonb column on conflict — destroying whatever `docType`/other keys an
 * earlier write on the SAME (ipo, table, row, field) had set. An admin ACCEPT on a field that
 * already carries a field_sources row loses that provenance permanently.
 *
 * Same technique as field-sources-data-lineage-merge.test.ts (#753) and
 * corrigendum-suggestions-utc-insert.test.ts (#1033): drive the REAL
 * `acceptCorrigendumSuggestion` with a stub db/tx and assert what it passes as the
 * onConflictDoUpdate `set` clause.
 *
 * RED before the fix: `set.dataLineage` is the caller's raw
 * `{ method: 'ADMIN_CORRIGENDUM_ACCEPT', ... }` object, with no reference to the existing row's
 * dataLineage at all.
 *
 * MAJOR 1 (Tier A round 2 on #1072): the "not a plain object" check alone is a mutation hole
 * (M3) -- a REPLACE written as raw SQL with no `COALESCE(...) ||` merge (e.g.
 * `sql\`${JSON.stringify(...)}::jsonb\`` with no reference to the existing column) is also "not a
 * plain object" and would pass. Compile the actual SQL via drizzle's own `PgDialect` and assert it
 * contains the coalesce-merge over the EXISTING `field_sources.data_lineage` column.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

vi.mock('../admin/field-protection-checker', () => ({
  createFieldProtectionService: () => ({
    markFieldAsManuallyEdited: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../repositories/ipo-repository', () => ({
  IPORepository: {
    applyAdminCorrigendumValue: vi.fn().mockResolvedValue(undefined),
  },
}));

import { acceptCorrigendumSuggestion } from './corrigendum-suggestions';

function makeStubDb(openRow: Record<string, unknown>) {
  const selectWhere = { limit: vi.fn().mockResolvedValue([openRow]) };
  const selectFrom = { where: vi.fn().mockReturnValue(selectWhere) };
  const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(selectFrom) });

  const dataConflictsUpdateReturning = vi.fn().mockResolvedValue([{ id: openRow.id }]);
  const dataConflictsUpdateWhere = vi.fn().mockReturnValue({ returning: dataConflictsUpdateReturning });
  const dataConflictsUpdateSet = vi.fn().mockReturnValue({ where: dataConflictsUpdateWhere });

  const fieldSourcesOnConflict = vi.fn().mockResolvedValue(undefined);
  const fieldSourcesValues = vi.fn().mockReturnValue({ onConflictDoUpdate: fieldSourcesOnConflict });

  const update = vi.fn().mockReturnValue({ set: dataConflictsUpdateSet });
  const insert = vi.fn().mockReturnValue({ values: fieldSourcesValues });

  const tx = { select, update, insert };
  const transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => cb(tx));

  const db = { select, transaction } as unknown as never;
  return { db, fieldSourcesOnConflict };
}

describe('acceptCorrigendumSuggestion — field_sources dataLineage MERGE, never replace (#1068)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the onConflictDoUpdate set.dataLineage is not a plain replacing object — it merges via SQL, preserving prior keys', async () => {
    const openRow = {
      id: 'conflict-1',
      ipoId: '00000000-0000-4000-8000-000000000001',
      fieldName: 'closeDate',
      value1: '2026-10-01',
      value2: '2026-10-05',
      documentId: 'doc-1',
      evidence: { storedSource: 'NSE' },
    };
    const { db, fieldSourcesOnConflict } = makeStubDb(openRow);

    await acceptCorrigendumSuggestion(db, 'conflict-1', 'tester@ipodhan.com', 'note');

    expect(fieldSourcesOnConflict).toHaveBeenCalledTimes(1);
    const setClause = fieldSourcesOnConflict.mock.calls[0][0].set as Record<string, unknown>;

    const isPlainReplacingObject =
      setClause.dataLineage !== null &&
      typeof setClause.dataLineage === 'object' &&
      !('queryChunks' in (setClause.dataLineage as object)) && // drizzle SQL objects carry queryChunks
      !('sql' in (setClause.dataLineage as object));
    expect(isPlainReplacingObject).toBe(false);

    // MAJOR 1: "not a plain object" is not enough (M3) -- assert the compiled SQL actually
    // merges over the EXISTING column rather than just wrapping the replacement in `sql`.
    const compiled = new PgDialect().sqlToQuery(setClause.dataLineage as SQL);
    expect(compiled.sql).toMatch(/COALESCE\("field_sources"\."data_lineage",\s*'\{\}'::jsonb\)\s*\|\|/i);
  });
});
