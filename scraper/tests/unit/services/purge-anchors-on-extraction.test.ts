/**
 * #933 / OD-32 (`docs/design/data-sourcing-pull-model.md` §0.5.1): "The PDF
 * file itself | seven days after its LAST SUCCESSFUL extraction". The soft
 * window's anchor is the document's own extraction clock, not the IPO's
 * close date.
 *
 * RCA (measured on staging 2026-09-23): `decidePurge` computed `elapsed` from
 * `closeDate` only, so a document extracted 2026-09-11 (due 2026-09-18) stayed
 * on disk until close_date + 7 (2026-09-28) — ten days late — and an IPO with
 * a NULL close_date (never closes on schedule) had no purge trigger at all
 * regardless of how old its extraction was. `PURGE_CANDIDATES_SQL` compounded
 * this: it never even selected such an IPO as a purge candidate.
 *
 * This is a TIGHTENING plus a new firing condition, never a loosening: every
 * existing close-date-anchored arm (withdrawn, no_close_date, hard_cap,
 * unread_within_hard_cap, the textless veto) keeps its exact behaviour when
 * nothing has ever been extracted (`lastExtractedAt` absent/null) — see
 * `document-purge-policy.test.ts` and `purge-requires-stored-text.test.ts`,
 * both still green. This file adds the NEW extraction-anchored arm.
 */
import { describe, it, expect } from 'vitest';
import { decidePurge } from '../../../src/services/document-store.js';
import { PURGE_CANDIDATES_SQL } from '../../../src/services/document-cycle.js';

const day = (n: number) => new Date(Date.parse('2026-09-11T00:00:00Z') + n * 86_400_000);

describe('decidePurge — anchored on last successful extraction (#933, OD-32)', () => {
  it('PURGES a document extracted 8 days ago even though close_date is tomorrow', () => {
    expect(
      decidePurge({
        closeDate: day(9), // "tomorrow" relative to `now`
        lastExtractedAt: day(0),
        allDocumentsRead: true,
        now: day(8),
      })
    ).toEqual({ purge: true, reason: 'read_and_expired' });
  });

  it('PURGES a document extracted 8 days ago on an IPO with a NULL close_date', () => {
    expect(
      decidePurge({
        closeDate: null,
        lastExtractedAt: day(0),
        allDocumentsRead: true,
        now: day(8),
      })
    ).toEqual({ purge: true, reason: 'read_and_expired' });
  });

  it('HOLDS a document extracted only 6 days ago, whatever the close date says', () => {
    expect(
      decidePurge({
        closeDate: new Date('2020-01-01T00:00:00Z'), // closed years ago
        lastExtractedAt: day(0),
        allDocumentsRead: true,
        now: day(6),
      })
    ).toEqual({ purge: false, reason: 'not_due' });
  });

  it('the textless veto still outranks the extraction anchor', () => {
    expect(
      decidePurge({
        closeDate: null,
        lastExtractedAt: day(0),
        allDocumentsRead: true,
        textlessCount: 1,
        now: day(30),
      }).purge
    ).toBe(false);
  });

  it('withdrawal still purges immediately regardless of the extraction clock', () => {
    expect(
      decidePurge({
        closeDate: null,
        lastExtractedAt: day(5), // inside its own 7-day window
        withdrawn: true,
        allDocumentsRead: false,
        now: day(6),
      })
    ).toEqual({ purge: true, reason: 'withdrawn' });
  });

  it('an unextracted/failed document is held even when close_date is old', () => {
    // Nothing has ever been extracted (lastExtractedAt null) — falls back to
    // the close-date clock, which is still inside the hard cap here.
    expect(
      decidePurge({
        closeDate: day(-1),
        lastExtractedAt: null,
        allDocumentsRead: false,
        now: day(8),
      })
    ).toEqual({ purge: false, reason: 'unread_within_hard_cap' });
  });

  it('the extraction anchor still respects the hard cap for disk safety', () => {
    expect(
      decidePurge({
        closeDate: null,
        lastExtractedAt: day(0),
        allDocumentsRead: true,
        maxRetentionDays: 3,
        now: day(4),
      })
    ).toEqual({ purge: true, reason: 'hard_cap' });
  });

  it('a mutation: flipping lastExtractedAt from 6 to 8 days old flips the answer', () => {
    const base = { closeDate: null, allDocumentsRead: true, now: day(8) as Date };
    expect(decidePurge({ ...base, lastExtractedAt: day(2) }).purge).toBe(false); // 6 days
    expect(decidePurge({ ...base, lastExtractedAt: day(0) }).purge).toBe(true); // 8 days
  });
});

describe('PURGE_CANDIDATES_SQL — candidates are not gated on close_date alone (#933)', () => {
  it('selects an IPO purely because one of its documents was extracted long ago', () => {
    // The RCA: the old WHERE clause required `close_date IS NOT NULL AND
    // close_date < now() - RETENTION_DAYS` (or withdrawn) before the
    // per-document extracted_at hold ever ran, so a NULL or not-yet-due
    // close_date meant the IPO was never even considered. The fix must add an
    // independent extraction-age condition to the WHERE clause.
    expect(PURGE_CANDIDATES_SQL).toMatch(/extracted_at\s*<\s*now\(\)\s*-\s*make_interval/);
    expect(PURGE_CANDIDATES_SQL).not.toMatch(/close_date\s+IS\s+NOT\s+NULL\s*\n\s*AND\s*\(/i);
  });
});
