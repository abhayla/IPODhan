/**
 * Item 18 slice 2 — a PDF is never deleted while its text is missing.
 *
 * Item 18 deletes stored PDFs to reclaim disk (255 documents, ~1.05 GB on
 * staging). Slice 1b made the extractor store the text so the bytes become
 * expendable. This slice makes the purge REFUSE to act when that text is not
 * actually there.
 *
 * The case that forces it, measured tonight: NSE's ratios archives are
 * newspaper PHOTOGRAPHS. Extraction runs over them, reports COMPLETED, and
 * stores nothing. Every existing arm of `decidePurge` reads "extracted" as
 * "safe to delete" — so those PDFs would be deleted and nothing kept. The
 * bytes are the only copy and the exchange has usually taken them down.
 *
 * So the veto is ABSOLUTE. It outranks every arm including `withdrawn`, which
 * purges unconditionally today: a withdrawn issue's prospectus is still the
 * only record of what was offered.
 *
 * The two live arms the card protects (`withdrawn`, `no_close_date`) keep their
 * exact behaviour whenever text IS stored — a rewrite that drops a live arm is
 * a MAJOR finding, so each is pinned below.
 */
import { describe, it, expect } from 'vitest';
import { decidePurge, PURGE_TEXTLESS_REASON } from '../../../src/services/document-store.js';

const CLOSED_LONG_AGO = new Date('2026-01-01T00:00:00Z');
const NOW = new Date('2026-09-11T00:00:00Z');

/** Everything read, nothing textless: the ordinary safe-to-purge shape. */
const safe = {
  closeDate: CLOSED_LONG_AGO,
  allDocumentsRead: true,
  textlessCount: 0,
  now: NOW,
};

describe('the veto: no stored text, no deletion', () => {
  it('refuses to purge an expired IPO when a completed document has no stored text', () => {
    const d = decidePurge({ ...safe, textlessCount: 1 });
    expect(d.purge).toBe(false);
    expect(d.reason).toBe(PURGE_TEXTLESS_REASON);
  });

  it('outranks the WITHDRAWN arm, which purges unconditionally today', () => {
    // A withdrawn issue's prospectus is still the only record of what was
    // offered. Deleting it because the issue died loses that permanently.
    const d = decidePurge({ ...safe, withdrawn: true, textlessCount: 1 });
    expect(d.purge).toBe(false);
    expect(d.reason).toBe(PURGE_TEXTLESS_REASON);
  });

  it('outranks the HARD CAP arm, which purges regardless of read state', () => {
    const d = decidePurge({
      ...safe,
      closeDate: new Date('2025-01-01T00:00:00Z'),
      allDocumentsRead: false,
      textlessCount: 2,
    });
    expect(d.purge).toBe(false);
    expect(d.reason).toBe(PURGE_TEXTLESS_REASON);
  });

  it('a mutation: with textlessCount 0 the SAME inputs DO purge', () => {
    // Proves the veto is what changed the answer, not the fixture.
    expect(decidePurge({ ...safe, withdrawn: true, textlessCount: 0 }).purge).toBe(true);
    expect(decidePurge({ ...safe, textlessCount: 0 }).purge).toBe(true);
  });
});

describe('every live arm survives when text IS stored', () => {
  it('withdrawn still purges', () => {
    expect(decidePurge({ ...safe, withdrawn: true })).toEqual({ purge: true, reason: 'withdrawn' });
  });

  it('no close date still keeps', () => {
    expect(decidePurge({ ...safe, closeDate: null })).toEqual({
      purge: false,
      reason: 'no_close_date',
    });
  });

  it('inside the soft window still keeps', () => {
    expect(decidePurge({ ...safe, closeDate: new Date('2026-09-09T00:00:00Z') })).toEqual({
      purge: false,
      reason: 'not_due',
    });
  });

  it('past the soft window and all read still purges', () => {
    expect(decidePurge({ ...safe, closeDate: new Date('2026-08-20T00:00:00Z') })).toEqual({
      purge: true,
      reason: 'read_and_expired',
    });
  });

  it('past the soft window with something unread still keeps', () => {
    expect(
      decidePurge({ ...safe, closeDate: new Date('2026-08-20T00:00:00Z'), allDocumentsRead: false })
    ).toEqual({ purge: false, reason: 'unread_within_hard_cap' });
  });

  it('past the hard cap still purges regardless of read state', () => {
    expect(
      decidePurge({ ...safe, closeDate: new Date('2025-01-01T00:00:00Z'), allDocumentsRead: false })
    ).toEqual({ purge: true, reason: 'hard_cap' });
  });
});

describe('the parameter is optional, so an un-migrated caller cannot be made unsafe', () => {
  it('an absent textlessCount behaves exactly as before', () => {
    // Absent means "the caller did not measure it", NOT "there is none". This is
    // the one place the safe default is the OLD behaviour: making absence a veto
    // would silently stop every purge the moment this shipped, and a purge that
    // never runs is a disk that fills up - a different failure, not a safer one.
    // CLOSED_LONG_AGO is 253 days before NOW, so this lands on `hard_cap`, not
    // `read_and_expired`. My first expectation said the latter and the code was
    // right - corrected here rather than bent to match.
    expect(decidePurge({ closeDate: CLOSED_LONG_AGO, allDocumentsRead: true, now: NOW })).toEqual({
      purge: true,
      reason: 'hard_cap',
    });
  });
});
