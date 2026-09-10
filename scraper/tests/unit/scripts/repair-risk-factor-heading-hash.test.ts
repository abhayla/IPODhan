import { describe, it, expect } from 'vitest';
import {
  planHashRepair,
  planDedupe,
  dedupeExitCode,
  parseFlags,
  type DedupeRow,
} from '../../../scripts/repair-risk-factor-heading-hash.js';

/**
 * Item 1 slice s6, Tier A fix round (2026-09-10).
 *
 * `repair-risk-factor-heading-hash.ts` DELETES rows and shipped with no test
 * at all — every sibling repair tool under `scraper/scripts` has one. The
 * review that caught that also caught what the missing test would have caught:
 * the dedupe kept the LOWEST-seq row regardless of what it held, so a group
 * whose seq=1 row was empty and whose seq=2 row carried the body and the KPI
 * table deleted the row with the data.
 *
 * The rule under test has two halves:
 *   HALF ONE  — the survivor is the row with the MOST non-null content,
 *               tie-broken on lowest `seq`. NULL-versus-present is a safe
 *               automatic choice.
 *   HALF TWO  — a group whose rows carry DIFFERING non-null content is not
 *               resolved at all: nothing is deleted, the group is reported by
 *               identity with a preview of each row, and the run exits
 *               non-zero. Present-versus-different is a human decision.
 *
 * A tool that deletes rows needs a proven REFUSAL path, not only a proven
 * deletion path — that is the "conflicting group" case below.
 */

function row(over: Partial<DedupeRow> & { id: string; seq: number }): DedupeRow {
  return {
    ipoId: 'ipo-1',
    ipoSlug: 'acme-industries-ltd',
    heading: 'Customer concentration',
    headingHash: 'abcdef0123456789',
    body: null,
    kpis: null,
    ...over,
  };
}

describe('planDedupe — HALF ONE: the content-bearing row survives', () => {
  it('keeps the row with a body and kpis even though it has the HIGHER seq (the lossy group)', () => {
    // The exact group the reviewer built on ipodhan_test: under the old
    // "lowest seq wins" rule the empty seq=1 row survived and this row — the
    // only one carrying any fact — was the one deleted.
    const survivorUnderOldRule = row({ id: 'row-empty', seq: 1 });
    const carriesTheData = row({
      id: 'row-with-content',
      seq: 2,
      body: 'Top 3 customers = 78% of FY25 revenue',
      kpis: { top3_pct: 78 },
    });

    const plan = planDedupe([survivorUnderOldRule, carriesTheData]);

    expect(plan.conflicts).toEqual([]);
    expect(plan.collapsedGroups).toBe(1);
    expect(plan.deletes.map((r) => r.id)).toEqual(['row-empty']);
    expect(plan.deletes.map((r) => r.id)).not.toContain('row-with-content');
  });

  it('prefers the row carrying BOTH fields over one carrying only a body', () => {
    const bodyOnly = row({ id: 'row-body-only', seq: 1, body: 'Same body text' });
    const both = row({ id: 'row-both', seq: 2, body: 'Same body text', kpis: { top3_pct: 78 } });

    const plan = planDedupe([bodyOnly, both]);

    expect(plan.conflicts).toEqual([]);
    expect(plan.deletes.map((r) => r.id)).toEqual(['row-body-only']);
  });
});

describe('planDedupe — HALF TWO: a group whose content differs is refused, not resolved', () => {
  it('deletes NOTHING and reports both ids and both body previews when two bodies differ', () => {
    const first = row({
      id: 'row-a',
      seq: 1,
      body: 'Our top three customers accounted for 78% of FY25 revenue.',
    });
    const second = row({
      id: 'row-b',
      seq: 2,
      body: 'A prolonged monsoon could interrupt construction at our Pune site.',
    });

    const plan = planDedupe([first, second]);

    // Nothing deleted — the refusal path.
    expect(plan.deletes).toEqual([]);
    expect(plan.collapsedGroups).toBe(0);

    // Reported by identity, with BOTH row ids.
    expect(plan.conflicts).toHaveLength(1);
    const conflict = plan.conflicts[0];
    expect(conflict.ipoSlug).toBe('acme-industries-ltd');
    expect(conflict.heading).toBe('Customer concentration');
    expect(conflict.rowIds).toEqual(['row-a', 'row-b']);
    expect(conflict.reason).toMatch(/differing content/);

    // And with a preview of EACH differing body, so the human sees what differs.
    expect(conflict.previews.map((p) => p.id)).toEqual(['row-a', 'row-b']);
    expect(conflict.previews[0].body).toContain('78% of FY25 revenue');
    expect(conflict.previews[1].body).toContain('prolonged monsoon');

    // A run holding an unresolved group must not read as a clean success.
    expect(dedupeExitCode(plan)).toBe(1);
  });

  it('refuses a group whose kpis differ even though the bodies agree', () => {
    const first = row({ id: 'row-a', seq: 1, body: 'Same body', kpis: { top3_pct: 78 } });
    const second = row({ id: 'row-b', seq: 2, body: 'Same body', kpis: { top3_pct: 91 } });

    const plan = planDedupe([first, second]);

    expect(plan.deletes).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].reason).toMatch(/differing content/);
    expect(dedupeExitCode(plan)).toBe(1);
  });

  it('refuses a group where the body and the kpis live on DIFFERENT rows', () => {
    // No value differs, so this is not a differing-value conflict — but no
    // single row can survive without dropping the other row's fact.
    const bodyOnly = row({ id: 'row-body', seq: 1, body: 'Top 3 customers = 78%' });
    const kpisOnly = row({ id: 'row-kpis', seq: 2, kpis: { top3_pct: 78 } });

    const plan = planDedupe([bodyOnly, kpisOnly]);

    expect(plan.deletes).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].reason).toMatch(/different rows/);
    expect(dedupeExitCode(plan)).toBe(1);
  });

  it('processes the safe groups in the same run as an aborted one', () => {
    // One unresolvable group must not block the rest.
    const conflictA = row({ id: 'c-1', seq: 1, headingHash: 'hash-conflict', body: 'body one' });
    const conflictB = row({ id: 'c-2', seq: 2, headingHash: 'hash-conflict', body: 'body two' });
    const safeA = row({ id: 's-1', seq: 1, headingHash: 'hash-safe' });
    const safeB = row({ id: 's-2', seq: 2, headingHash: 'hash-safe' });

    const plan = planDedupe([conflictA, conflictB, safeA, safeB]);

    expect(plan.deletes.map((r) => r.id)).toEqual(['s-2']);
    expect(plan.conflicts.map((c) => c.headingHash)).toEqual(['hash-conflict']);
    expect(dedupeExitCode(plan)).toBe(1);
  });
});

describe('planDedupe — the ordinary group and idempotency', () => {
  it('keeps the LOWEST seq when every duplicate is equally empty (the 7 real groups on both slots)', () => {
    // Staging and production both hold byte-identical rows differing only in
    // `seq` (distinct_bodies=1, distinct_kpis=1, max_body_len=0). Display
    // order must stay stable, so the earliest row in the document survives.
    const rows = [row({ id: 'r-1', seq: 1 }), row({ id: 'r-2', seq: 2 }), row({ id: 'r-3', seq: 5 })];

    const plan = planDedupe(rows);

    expect(plan.conflicts).toEqual([]);
    expect(plan.collapsedGroups).toBe(1);
    expect(plan.deletes.map((r) => r.id)).toEqual(['r-2', 'r-3']);
    expect(dedupeExitCode(plan)).toBe(0);
  });

  it('is idempotent — a second pass over what survives deletes nothing', () => {
    const rows = [
      row({ id: 'r-1', seq: 1 }),
      row({ id: 'r-2', seq: 2, body: 'Top 3 customers = 78% of FY25 revenue' }),
    ];

    const firstPass = planDedupe(rows);
    const deletedIds = new Set(firstPass.deletes.map((r) => r.id));
    const survivors = rows.filter((r) => !deletedIds.has(r.id));

    const secondPass = planDedupe(survivors);

    expect(secondPass.deletes).toEqual([]);
    expect(secondPass.conflicts).toEqual([]);
    expect(secondPass.collapsedGroups).toBe(0);
    expect(dedupeExitCode(secondPass)).toBe(0);
  });

  it('leaves a single, non-duplicated row alone', () => {
    const plan = planDedupe([row({ id: 'only', seq: 1, body: 'text' })]);
    expect(plan.deletes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});

describe('parseFlags — dry run is the DEFAULT', () => {
  it('does not apply unless --apply is passed explicitly', () => {
    expect(parseFlags(['node', 'tool.ts', '--dedupe']).apply).toBe(false);
    expect(parseFlags(['node', 'tool.ts', '--backfill']).apply).toBe(false);
    expect(parseFlags(['node', 'tool.ts']).apply).toBe(false);
  });

  it('applies, and allows prod, only on the explicit flags', () => {
    const flags = parseFlags(['node', 'tool.ts', '--dedupe', '--apply', '--allow-prod']);
    expect(flags).toEqual({ apply: true, allowProd: true, backfill: false, dedupe: true });
  });

  it('never infers --allow-prod from --apply', () => {
    expect(parseFlags(['node', 'tool.ts', '--dedupe', '--apply']).allowProd).toBe(false);
  });
});

describe('planHashRepair — the backfill decision', () => {
  it('writes a recomputed hash, counts an already-correct row, and quarantines a contentless heading', () => {
    const plan = planHashRepair([
      { id: 'needs-write', heading: 'Customer concentration', currentHash: '', recomputedHash: null },
      { id: 'blank', heading: '   ', currentHash: '', recomputedHash: null },
    ]);

    expect(plan.toWrite.map((r) => r.id)).toEqual(['needs-write']);
    expect(plan.toWrite[0].headingHash).toMatch(/^[0-9a-f]{16}$/);
    expect(plan.nullKey).toEqual(['blank']);

    // Second pass over the now-correct row writes nothing.
    const again = planHashRepair([
      {
        id: 'needs-write',
        heading: 'Customer concentration',
        currentHash: plan.toWrite[0].headingHash,
        recomputedHash: null,
      },
    ]);
    expect(again.toWrite).toEqual([]);
    expect(again.alreadyCorrect).toBe(1);
  });
});
