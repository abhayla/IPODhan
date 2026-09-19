// Build item 35: the admin queue's open count, grouped by IPO, live/upcoming first.
// Tests the pure grouping/ordering/formatting logic (groupAndOrder, formatAdminQueueBlock)
// without a database — the SQL itself was proven against a real staging tunnel read (see the
// PR body's Staging proof), which is the only honest way to prove a query's correctness; this
// file proves the shape rules the card names explicitly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAndOrder, formatAdminQueueBlock } from '../ops/admin-queue-size.mjs';

test('an OPEN IPO and a LISTED IPO with equal counts order OPEN first (live-first rule)', () => {
  const conflicts = [
    { slug: 'listed-co', status: 'LISTED', open_date: '2026-01-01', conflicts: 5 },
    { slug: 'open-co', status: 'OPEN', open_date: '2026-09-01', conflicts: 5 },
  ];
  const { byIpo } = groupAndOrder(conflicts, []);
  assert.deepEqual(byIpo.map((e) => e.slug), ['open-co', 'listed-co']);
});

test('rows are grouped by IPO — one IPO with three open fields is one line reading 3, not three lines', () => {
  // The SQL itself GROUP BYs, so this asserts groupAndOrder does not re-split an
  // already-aggregated count back into per-row entries.
  const conflicts = [{ slug: 'acme-ltd', status: 'OPEN', open_date: '2026-09-01', conflicts: 3 }];
  const { byIpo } = groupAndOrder(conflicts, []);
  assert.equal(byIpo.length, 1);
  assert.equal(byIpo[0].conflicts, 3);
});

test('the printed total equals the sum of the rows; a mismatch would mean a filter silently dropped rows', () => {
  const conflicts = [
    { slug: 'a', status: 'OPEN', open_date: '2026-09-01', conflicts: 4 },
    { slug: 'b', status: 'LISTED', open_date: '2025-01-01', conflicts: 7 },
  ];
  const absences = [
    { slug: 'a', status: 'OPEN', open_date: '2026-09-01', absences: 2 },
    { slug: 'c', status: 'UPCOMING', open_date: '2026-10-01', absences: 9 },
  ];
  const { total, byIpo } = groupAndOrder(conflicts, absences);
  const sum = byIpo.reduce((s, e) => s + e.conflicts + e.absences, 0);
  assert.equal(total, sum);
  assert.equal(total, 4 + 7 + 2 + 9);
});

test('an IPO with a zero count on both conflicts and absences does not appear at all', () => {
  // groupAndOrder only ever receives rows a GROUP BY already produced (so a zero-count IPO
  // never reaches it from the real query), but the filter is asserted directly here in case a
  // future caller passes an explicit zero row (e.g. a LEFT JOIN COALESCE(0) shape).
  const conflicts = [{ slug: 'zero-co', status: 'OPEN', open_date: '2026-09-01', conflicts: 0 }];
  const { byIpo } = groupAndOrder(conflicts, []);
  assert.equal(byIpo.length, 0);
});

test('with an empty queue the block still prints, reading "open 0 across 0 IPOs"', () => {
  const { byIpo, total } = groupAndOrder([], []);
  const block = formatAdminQueueBlock({ total, byIpo });
  assert.equal(block, 'ADMIN-QUEUE  open 0 across 0 IPOs  (live/upcoming first)');
});

test('formatAdminQueueBlock names live/upcoming IPOs individually and collapses everything else into one summary line', () => {
  const conflicts = [
    { slug: 'open-co', status: 'OPEN', open_date: '2026-09-01', conflicts: 2 },
    { slug: 'old-co-1', status: 'LISTED', open_date: '2024-01-01', conflicts: 10 },
    { slug: 'old-co-2', status: 'WITHDRAWN', open_date: '2023-06-01', conflicts: 5 },
  ];
  const data = groupAndOrder(conflicts, []);
  const block = formatAdminQueueBlock(data);
  const lines = block.split('\n');
  assert.equal(lines[0], 'ADMIN-QUEUE  open 17 across 3 IPOs  (live/upcoming first)');
  assert.ok(lines.some((l) => l.includes('open-co')), 'live IPO must be named individually');
  assert.ok(!lines.some((l) => l.includes('old-co-1') || l.includes('old-co-2')), 'closed IPOs must not be named individually');
  assert.ok(lines.some((l) => l.includes('LISTED and older: 2 IPOs, conflicts 15')), 'closed IPOs collapse into one summary line');
});
