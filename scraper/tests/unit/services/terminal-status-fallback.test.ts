/**
 * PR #972 round 3 (review MINOR 3): the legacy fallback door in data-persister (it runs when
 * consolidation throws) keeps a stored terminal ipo status — WITHDRAWN, POSTPONED — exactly
 * like the consolidation path's TERMINAL_IPO_STATUSES guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { keepTerminalIpoStatus } from '../../../src/services/data-persister';
import { TERMINAL_IPO_STATUSES } from '../../../src/services/data-consolidation-service';

describe('keepTerminalIpoStatus (the fallback door)', () => {
  for (const stored of ['WITHDRAWN', 'POSTPONED']) {
    it(`a stored ${stored} is not overwritten by a scrape's LISTED; the other fields still go through`, () => {
      const out = keepTerminalIpoStatus(stored, { status: 'LISTED', companyName: 'X Ltd' });
      expect(out).toEqual({ companyName: 'X Ltd' });
    });
  }

  it('the terminal set is the consolidation path\'s own set (one definition)', () => {
    expect([...TERMINAL_IPO_STATUSES].sort()).toEqual(['POSTPONED', 'WITHDRAWN']);
  });

  it('a non-terminal stored status moves normally', () => {
    expect(keepTerminalIpoStatus('CLOSED', { status: 'LISTED' })).toEqual({ status: 'LISTED' });
  });

  it('the same terminal value, or no status key, passes unchanged', () => {
    expect(keepTerminalIpoStatus('WITHDRAWN', { status: 'WITHDRAWN' })).toEqual({ status: 'WITHDRAWN' });
    expect(keepTerminalIpoStatus('WITHDRAWN', { companyName: 'Y' })).toEqual({ companyName: 'Y' });
  });

  it('the fallback door writes through the guard (wiring)', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'services', 'data-persister.ts'), 'utf8');
    expect(src).toMatch(/const guardedFallback = keepTerminalIpoStatus\(\(existingIPO as any\)\.status, fallbackData\);\s*await ipoRepository\.update\(existingIPO\.id, guardedFallback\);/);
  });
});
