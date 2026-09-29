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
import * as adminFieldWrite from './admin-field-write';
import { fieldSources } from '../db/schema';

const writeSpy = vi.spyOn(adminFieldWrite, 'writeAdminFieldValue');

// Contract 2 item A2 (§9.2 item 11): the accept now writes through the ONE admin write
// (`writeAdminFieldValue`) inside its transaction. This stub drives that REAL function too, so the
// field_sources assertions below still bind to the insert the accept actually performs.
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy', 'returning', 'set']) c[m] = vi.fn(() => c);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

function makeStubDb(openRow: Record<string, unknown>) {
  let selects = 0;
  // First select is loadOpenSuggestion; the shared write's version / value reads find nothing yet.
  const select = vi.fn(() => chain(selects++ === 0 ? [openRow] : []));
  const update = vi.fn(() => chain([{ id: openRow.id }]));

  const fieldSourcesOnConflict = vi.fn().mockResolvedValue(undefined);
  const fieldSourcesValues = vi.fn().mockReturnValue({ onConflictDoUpdate: fieldSourcesOnConflict });
  const insert = vi.fn((table: unknown) => {
    if (table === fieldSources) return { values: fieldSourcesValues };
    const values = vi.fn(() => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined), then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r) }));
    return { values };
  });
  const execute = vi.fn().mockResolvedValue({ rows: [{ slug: 'stub-ipo' }] });

  const tx: Record<string, unknown> = { select, update, insert, execute };
  const transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
  tx.transaction = transaction;

  const db = { select, transaction } as unknown as never;
  return { db, fieldSourcesOnConflict, fieldSourcesValues, writeSpy };
}

describe('acceptCorrigendumSuggestion — field_sources dataLineage MERGE, never replace (#1068)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeSpy.mockClear();
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

    const decision = await acceptCorrigendumSuggestion(db, 'conflict-1', 'tester@ipodhan.com', 'note', '-|-|-', 'admin-t1');
    expect(decision.ok).toBe(true);
    // The accept is an admin PICK through the ONE admin write, carrying the editor's token.
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][1]).toMatchObject({
      ipoId: openRow.ipoId,
      tableName: 'ipos',
      fieldName: 'closeDate',
      // M1: the document value travels as a server-read storedPick, never as a client value.
      mode: { kind: 'storedPick', sourceLabel: 'DOC', value: '2026-10-05' },
      expectedVersion: '-|-|-',
      entryPoint: 'corrigendum-accept',
      detail: { documentId: 'doc-1', conflictId: 'conflict-1' },
    });

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
    // Merge over the EXISTING column: coalesce it, subtract only the previous admin write's own keys
    // (`adminKeys`), then concatenate this write's keys — source keys such as docType survive.
    expect(compiled.sql).toMatch(/COALESCE\("field_sources"\."data_lineage",\s*'\{\}'::jsonb\)[\s\S]*\|\|/i);
    expect(compiled.sql).toMatch(/adminKeys/);
  });
});
