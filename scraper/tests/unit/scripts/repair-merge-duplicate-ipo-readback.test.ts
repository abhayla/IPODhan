/**
 * Tier A review finding (3), 2026-09-16: `readbackFromDb`'s same-day sibling
 * query keys on `survivor.open_date` (read FRESH from the database, after
 * whatever merge already committed) rather than `plan.keep.openDate` (the
 * PRE-merge in-memory value captured back when the plan was built). That is
 * the correct behaviour — `--reverify` in particular can run long after the
 * original merge, against a ledger, with no in-memory plan at all, so
 * `plan.keep.openDate` would not even exist at that point — but nothing
 * pinned it with a test. This test does not touch a real database: it fakes
 * `db.execute` (via `vi.mock('@ipodhan/shared', ...)`, re-exporting every
 * other real symbol through `importActual` so nothing else in the module
 * breaks) and asserts the same-day sibling query's bound parameter is the
 * SURVIVOR row's `open_date` as read back from the `select * from ipos`
 * call, not any value the caller passed in independently.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const dbExecuteMock = vi.fn();

vi.mock('@ipodhan/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared')>();
  return {
    ...actual,
    db: { execute: (...args: unknown[]) => dbExecuteMock(...args) },
  };
});

// Imported AFTER the mock is declared — vitest hoists `vi.mock` above imports,
// so this binds to the mocked `db`.
import { readbackFromDb } from '../../../scripts/repair-merge-duplicate-ipo';

/** Same chunk-walker used by the merge-order fake db (packages/shared) — turns
 * a drizzle `sql\`...\`` template's `queryChunks` into readable text so the
 * fake can tell which statement is which and pull out its bound value. */
function sqlText(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
  const params: unknown[] = [];
  const text = chunks
    .map((c) => {
      // A "StringChunk" (raw SQL text fragment) carries its text in a
      // `.value` array; a `Name` (sql.identifier(...)) carries a string in
      // `.value`; a bound PARAMETER comes through as a bare primitive (not
      // wrapped in an object at all) — verified directly against drizzle-orm
      // at the terminal: `sql\`x = ${'v'}\`.queryChunks[1]` is the literal
      // string `'v'`, not `{ value: 'v' }`. Anything that is not an object
      // with an array `.value` is therefore a bound parameter.
      if (c && typeof c === 'object' && 'value' in c) {
        const v = (c as { value: unknown }).value;
        return Array.isArray(v) ? v.join('') : '';
      }
      params.push(c);
      return '';
    })
    .join(' ');
  return { text, params };
}

const KEEP_ID = '11111111-1111-1111-1111-111111111111';
const DROP_ID = '22222222-2222-2222-2222-222222222222';

afterEach(() => {
  dbExecuteMock.mockReset();
});

describe('readbackFromDb — same-day sibling query keys on the FRESH survivor.open_date', () => {
  it("binds the same-day sibling query to the survivor row's own open_date, not an externally-supplied value", async () => {
    const SURVIVOR_OPEN_DATE = '2026-09-09'; // the value only the fresh `select * from ipos` row carries
    const calls: { text: string; params: unknown[] }[] = [];

    dbExecuteMock.mockImplementation(async (query: unknown) => {
      const { text, params } = sqlText(query);
      calls.push({ text, params });
      if (/count\(\*\)::int as n/i.test(text)) {
        return { rows: [{ n: 0 }] };
      }
      if (/select \* from ipos/i.test(text)) {
        return { rows: [{ id: KEEP_ID, slug: 'keep-slug', open_date: SURVIVOR_OPEN_DATE, symbol: null }] };
      }
      if (/ipo_slug_redirects/i.test(text)) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (/select slug from ipos where open_date/i.test(text)) {
        // The query under test — assert its bound value is the survivor's
        // own open_date, matched below, not asserted here so the assertion
        // reads at the call site.
        return { rows: [] };
      }
      return { rows: [] };
    });

    await readbackFromDb({
      keepId: KEEP_ID,
      dropId: DROP_ID,
      droppedSlug: 'dropped-slug',
      patch: [],
    });

    const sameDayCall = calls.find((c) => /select slug from ipos where open_date/i.test(c.text));
    expect(sameDayCall).toBeDefined();
    expect(sameDayCall!.params).toContain(SURVIVOR_OPEN_DATE);

    // MUTATION CHECK: swapping `survivor.open_date` for any externally-passed
    // value (e.g. re-adding a `plan.keep.openDate`-style parameter) makes
    // this assertion fail unless that value happens to equal
    // SURVIVOR_OPEN_DATE — which this test deliberately keeps distinct from
    // any id/slug string used elsewhere in the fixture so a wrong-source bug
    // cannot coincidentally pass.
  });

  it('does not run the same-day sibling query at all when the survivor row is missing (guards the ternary, not just the value)', async () => {
    const calls: string[] = [];
    dbExecuteMock.mockImplementation(async (query: unknown) => {
      const { text } = sqlText(query);
      calls.push(text);
      if (/count\(\*\)::int as n/i.test(text)) return { rows: [{ n: 1 }] };
      if (/select \* from ipos/i.test(text)) return { rows: [] }; // survivor missing
      if (/ipo_slug_redirects/i.test(text)) return { rows: [] };
      return { rows: [] };
    });

    await readbackFromDb({ keepId: KEEP_ID, dropId: DROP_ID, droppedSlug: 'dropped-slug', patch: [] });

    expect(calls.some((t) => /select slug from ipos where open_date/i.test(t))).toBe(false);
  });
});
