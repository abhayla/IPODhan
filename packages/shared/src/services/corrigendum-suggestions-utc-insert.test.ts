/**
 * #1033 (ist-timezone.md): `acceptCorrigendumSuggestion`'s `field_sources` write set
 * `updatedAt`/`createdAt` explicitly ONLY on its `onConflictDoUpdate` `set` branch (used when a
 * row already exists for this ipo/table/rowKey/field). The initial `.values()` (the INSERT
 * branch, which fires the FIRST time this field gets an ADMIN write) left both columns unset,
 * falling through to the column's `defaultNow()` -- Postgres's own server-side `now()`, which
 * writes the SESSION's timezone-dependent wall clock rather than a value this code controls
 * (`packages/shared/src/db/timezone-config.ts`'s own documented class: "Postgres `now()` /
 * `defaultNow()` write IST wall-clock" when the session isn't guaranteed UTC). The
 * `onConflictDoUpdate` branch's explicit `new Date()` is timezone-safe (drizzle's
 * `PgTimestamp.mapToDriverValue` always converts a Date via `.toISOString()`), so binding the
 * SAME explicit Date on the INSERT branch closes the asymmetry.
 *
 * Stub-db unit test: drive the real `acceptCorrigendumSuggestion` and assert the fieldSources
 * `.values()` call includes explicit `updatedAt`/`createdAt` Date objects. RED before the fix
 * (the insert `.values()` object has no `updatedAt`/`createdAt` keys at all), GREEN after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('acceptCorrigendumSuggestion — field_sources INSERT branch binds UTC-safe timestamps (#1033)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeSpy.mockClear();
  });

  it('the fieldSources .values() insert carries explicit updatedAt/createdAt Date objects, not defaultNow()', async () => {
    const openRow = {
      id: 'conflict-1',
      ipoId: '00000000-0000-4000-8000-000000000001',
      fieldName: 'closeDate',
      value1: '2026-10-01',
      value2: '2026-10-05',
      documentId: 'doc-1',
      evidence: { storedSource: 'NSE' },
    };
    const { db, fieldSourcesValues } = makeStubDb(openRow);

    const decision = await acceptCorrigendumSuggestion(db, 'conflict-1', 'tester@ipodhan.com', 'note', '-|-');
    expect(decision.ok).toBe(true);
    // The accept is an admin PICK through the ONE admin write, carrying the editor's token.
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][1]).toMatchObject({
      ipoId: openRow.ipoId,
      tableName: 'ipos',
      fieldName: 'closeDate',
      value: '2026-10-05',
      mode: { kind: 'pick', sourceLabel: 'DOC' },
      expectedVersion: '-|-',
      entryPoint: 'corrigendum-accept',
      detail: { documentId: 'doc-1', conflictId: 'conflict-1' },
    });

    expect(fieldSourcesValues).toHaveBeenCalledTimes(1);
    const inserted = fieldSourcesValues.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.updatedAt).toBeInstanceOf(Date);
    expect(inserted.createdAt).toBeInstanceOf(Date);
  });
});
