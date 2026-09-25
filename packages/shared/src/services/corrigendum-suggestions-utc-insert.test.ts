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
  return { db, fieldSourcesValues };
}

describe('acceptCorrigendumSuggestion — field_sources INSERT branch binds UTC-safe timestamps (#1033)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    await acceptCorrigendumSuggestion(db, 'conflict-1', 'tester@ipodhan.com', 'note');

    expect(fieldSourcesValues).toHaveBeenCalledTimes(1);
    const inserted = fieldSourcesValues.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.updatedAt).toBeInstanceOf(Date);
    expect(inserted.createdAt).toBeInstanceOf(Date);
  });
});
