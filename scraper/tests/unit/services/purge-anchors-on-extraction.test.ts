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
import { PURGE_CANDIDATES_SQL, buildPurgeCandidatesSql } from '../../../src/services/document-cycle.js';

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
    //
    // Pinned as a substring rather than a loose word-match: a mutation that
    // deletes the whole `OR EXISTS (...)` arm must fail this test, not just a
    // mutation that rewords its comment.
    expect(PURGE_CANDIDATES_SQL).toContain('OR EXISTS (');
    expect(PURGE_CANDIDATES_SQL).toMatch(
      /OR EXISTS \(\s*SELECT 1 FROM documents d2\s*WHERE d2\.ipo_id = i\.id\s*AND d2\.extracted_at IS NOT NULL\s*AND d2\.extracted_at\s*<\s*now\(\)\s*-\s*make_interval\(days => \{\{RETENTION_DAYS\}\}\)/
    );
    expect(PURGE_CANDIDATES_SQL).not.toMatch(/close_date\s+IS\s+NOT\s+NULL\s*\n\s*AND\s*\(/i);
  });

  it('has exactly two {{RETENTION_DAYS}} placeholders — pinning the shape the round-2 CRITICAL bit us on', () => {
    // #933 round 2 (Tier A review of PR #1131): the query has TWO
    // `{{RETENTION_DAYS}}` occurrences (the close-date arm and the
    // extraction-age EXISTS arm). If this count ever drops to one, a
    // first-match-only substitution bug becomes invisible again; if it rises,
    // `buildPurgeCandidatesSql` must still leave zero unsubstituted (below).
    const occurrences = PURGE_CANDIDATES_SQL.match(/\{\{RETENTION_DAYS\}\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('CRITICAL (#933 round 2): buildPurgeCandidatesSql substitutes EVERY placeholder, not just the first', () => {
    // This is the exact defect the Tier A review found: runDocumentPurge used
    // to call `PURGE_CANDIDATES_SQL.replace('{{RETENTION_DAYS}}', ...)` —
    // String.prototype.replace(string, ...) replaces only the FIRST match —
    // so the second ({{RETENTION_DAYS}}) arm reached Postgres as literal text,
    // which is invalid SQL, caught as non-fatal, so nothing was ever purged.
    // This test calls the ACTUAL function `runDocumentPurge` uses (not a
    // duplicated .replace() call), so a regression in that function — not
    // just in this test file — is what turns this red.
    const substituted = buildPurgeCandidatesSql(7);
    expect(substituted).not.toMatch(/\{\{/);
    expect(substituted).not.toContain('RETENTION_DAYS');
    // And the substituted value is correct, not just "no braces left".
    const daysMatches = substituted.match(/make_interval\(days => (\d+)\)/g) ?? [];
    expect(daysMatches.length).toBeGreaterThanOrEqual(2);
    for (const m of daysMatches) {
      expect(m).toBe('make_interval(days => 7)');
    }
  });
});
