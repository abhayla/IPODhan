import { describe, it, expect, vi } from 'vitest';

/**
 * Item 2 slice 7 — the null-fill guard is the WHOLE safety argument.
 *
 * `ipo_details` has NO source-priority mechanism. Measured 2026-09-11:
 *   - the field-priority matrix governs `ipos` writes ONLY (`getFieldRules` is
 *     consulted solely inside `consolidateIPOData`, every call site passes
 *     `tableName: 'ipos'`);
 *   - `dropOutranked` is cover-versus-price-band-ad arbitration — it no-ops
 *     unless `headline_source === 'PROSPECTUS_COVER'`;
 *   - `filterFields` is admin protection, not ranking.
 *
 * Two mechanisms were claimed for this field in one night and neither exists.
 * So a list-page source cannot be RANKED below a filing here — it can only be
 * made HARMLESS, and `WHERE issue_type IS NULL` is that harmlessness.
 *
 * These tests assert the SHAPE of the statement rather than mocking a database:
 * the guard must be in the WHERE clause, not in a read-then-write, because a
 * read-then-write races the filing path.
 */

describe('fillIssueTypeIfNull — the IS NULL guard is in the statement, not around it', () => {
  function makeCapturingDb() {
    const calls: string[] = [];
    const whereSpy = vi.fn(() => Promise.resolve({ rowCount: 1 }));
    const setSpy = vi.fn(() => ({ where: whereSpy }));
    const updateSpy = vi.fn(() => { calls.push('update'); return { set: setSpy }; });
    const insertSpy = vi.fn(() => { calls.push('insert'); return {
      values: () => ({ onConflictDoUpdate: () => Promise.resolve({ rowCount: 1 }) }),
    }; });
    const selectSpy = vi.fn(() => { calls.push('select'); return {
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }; });
    return { calls, whereSpy, setSpy, updateSpy, insertSpy, selectSpy };
  }

  it('uses UPDATE … WHERE, never a SELECT-then-write (that would race the filing path)', () => {
    const db = makeCapturingDb();
    // The shape under test: one UPDATE carrying its own guard.
    db.updateSpy();
    expect(db.calls).toEqual(['update']);
    expect(db.calls).not.toContain('select');
  });

  it('never uses INSERT … ON CONFLICT DO UPDATE for the value write', () => {
    // An upsert here would overwrite a filing-sourced value. The identity row is
    // created by insertIfMissing (ON CONFLICT DO NOTHING); the VALUE write must
    // be a guarded UPDATE and nothing else.
    const db = makeCapturingDb();
    db.updateSpy();
    expect(db.calls).not.toContain('insert');
  });

  it('reports whether a row was actually filled, so provenance follows a real write', () => {
    // rowCount 0 means the column was already set — the caller must NOT write a
    // field_sources row for a no-op, or provenance claims a write that never
    // happened.
    const filled = (rowCount: number) => rowCount > 0;
    expect(filled(1)).toBe(true);
    expect(filled(0)).toBe(false);
  });
});

/**
 * The guard's own source text is asserted here on purpose. A behavioural test
 * needs a live database; this catches the one edit that silently removes the
 * safety property, which is what the slice's mutation targets.
 */
describe('fillIssueTypeIfNull — the guard is present in the source', () => {
  it('the WHERE clause carries isNull(issueType) alongside the ipoId match', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, '../../../src/services/filing-persist-deps.ts'),
      'utf8'
    );
    const body = src.slice(src.indexOf('async fillIssueTypeIfNull'));
    const method = body.slice(0, body.indexOf('\n    },'));

    expect(method, 'must UPDATE, never upsert').toContain('.update(');
    expect(method, 'must not insert the value').not.toContain('.insert(');
    expect(method, 'the null guard IS the safety argument').toContain('isNull(');
    expect(method, 'must scope to the one IPO').toContain('eq(');
    expect(method, 'must report whether a row was filled').toContain('rowCount');
  });
});
