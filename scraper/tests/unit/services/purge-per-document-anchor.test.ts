/**
 * Item 18 slice 2b — the retention clock is each DOCUMENT's own, not the IPO's.
 *
 * The contract defines item 18 as: "text kept for life, PDF deleted seven days
 * after its LAST SUCCESSFUL EXTRACTION". Until this slice the anchor was the
 * IPO's close date, so two documents on one IPO shared a clock that belonged to
 * neither of them. A prospectus extracted yesterday was deletable because the
 * issue had closed a month ago.
 *
 * The change is deliberately a TIGHTENING, never a loosening. The IPO's
 * directory is purged only when the existing rules say so AND every document in
 * it is individually past its own window. Nothing that was protected before
 * becomes deletable now - which is the only safe direction for a change to a
 * path that deletes files irreversibly.
 */
import { describe, it, expect } from 'vitest';
import { everyDocumentPastItsOwnWindow } from '../../../src/services/document-store.js';

const NOW = new Date('2026-09-11T00:00:00Z');
const d = (iso: string) => new Date(iso);

describe('everyDocumentPastItsOwnWindow', () => {
  it('true when every document was extracted longer ago than the window', () => {
    expect(
      everyDocumentPastItsOwnWindow(
        [{ extractedAt: d('2026-08-01T00:00:00Z') }, { extractedAt: d('2026-08-20T00:00:00Z') }],
        7,
        NOW
      )
    ).toBe(true);
  });

  it('FALSE when one document was extracted inside its window', () => {
    // The case the IPO-level clock got wrong: the issue closed long ago, but
    // this prospectus was read yesterday and its own seven days have not run.
    expect(
      everyDocumentPastItsOwnWindow(
        [{ extractedAt: d('2026-08-01T00:00:00Z') }, { extractedAt: d('2026-09-10T00:00:00Z') }],
        7,
        NOW
      )
    ).toBe(false);
  });

  it('FALSE when a document has never been successfully extracted', () => {
    // null means no successful extraction, so its clock has not started. It is
    // NOT "infinitely old" - reading null as old is how an unread document gets
    // deleted before anything ever read it.
    expect(everyDocumentPastItsOwnWindow([{ extractedAt: null }], 7, NOW)).toBe(false);
  });

  it('FALSE when any one of many is unextracted, however old the rest are', () => {
    expect(
      everyDocumentPastItsOwnWindow(
        [{ extractedAt: d('2025-01-01T00:00:00Z') }, { extractedAt: null }],
        7,
        NOW
      )
    ).toBe(false);
  });

  it('true for an IPO with NO documents - there is nothing to protect', () => {
    // An empty list must not block the existing purge arms; a directory with no
    // document rows is exactly what the old cleanup was for.
    expect(everyDocumentPastItsOwnWindow([], 7, NOW)).toBe(true);
  });

  it('the boundary is exclusive - exactly at the window is NOT past it', () => {
    expect(everyDocumentPastItsOwnWindow([{ extractedAt: d('2026-09-04T00:00:00Z') }], 7, NOW)).toBe(
      false
    );
    expect(
      everyDocumentPastItsOwnWindow([{ extractedAt: d('2026-09-03T23:00:00Z') }], 7, NOW)
    ).toBe(true);
  });

  it('accepts an ISO string as well as a Date, because the SQL returns both shapes', () => {
    expect(everyDocumentPastItsOwnWindow([{ extractedAt: '2026-08-01T00:00:00Z' }], 7, NOW)).toBe(
      true
    );
  });

  it('an unparseable timestamp is treated as NOT past its window', () => {
    // Fail closed. A date we cannot read is not evidence that seven days passed.
    expect(everyDocumentPastItsOwnWindow([{ extractedAt: 'not-a-date' }], 7, NOW)).toBe(false);
  });

  it('a mutation: flipping one document from old to recent flips the answer', () => {
    const old = [{ extractedAt: d('2026-08-01T00:00:00Z') }];
    const recent = [{ extractedAt: d('2026-09-10T00:00:00Z') }];
    expect(everyDocumentPastItsOwnWindow(old, 7, NOW)).toBe(true);
    expect(everyDocumentPastItsOwnWindow(recent, 7, NOW)).toBe(false);
  });
});
