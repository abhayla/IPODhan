// implements: stage 2 item 6 -- buildFieldPlanWalkFetchers() registers
// exactly the sources this slice built adapters for (DOC, BSE, CHITTORGARH),
// and fieldPlanWalkHasFetchers() reads true once they are registered.
// INVESTORGAIN_GMP joined the set in this task's slice (gmp_records.gmp had
// no adapter; 87 staging rows fell through to CHITTORGARH's NO_MAPPING).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
  IPORepository: vi.fn().mockImplementation(() => ({})),
  FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
  DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
  DocumentRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn().mockImplementation(() => ({})),
}));

import { buildFieldPlanWalkFetchers, fieldPlanWalkHasFetchers } from '../../../src/services/field-plan-walk-deps.js';

describe('buildFieldPlanWalkFetchers registry', () => {
  // NSE joined the set in item 6 (#705/#759). Before that, 57 manifest fields
  // ranked NSE -- including the six E-1 fields only the exchange may state --
  // and every one of them answered NO_FETCHER_REGISTERED on every wake, 136
  // rows measured on staging. This assertion is deliberately exact: a fetcher
  // appearing or vanishing unnoticed is the thing it exists to catch.
  it('registers exactly DOC, NSE, BSE, CHITTORGARH and INVESTORGAIN_GMP — no more, no fewer', () => {
    const fetchers = buildFieldPlanWalkFetchers({} as never);
    expect(Object.keys(fetchers).sort()).toEqual(['BSE', 'CHITTORGARH', 'DOC', 'INVESTORGAIN_GMP', 'NSE']);
  });

  it('every registered value is a callable fetcher function', () => {
    const fetchers = buildFieldPlanWalkFetchers({} as never);
    for (const fetcher of Object.values(fetchers)) {
      expect(typeof fetcher).toBe('function');
    }
  });

  it('fieldPlanWalkHasFetchers reads true against the real registry', () => {
    expect(fieldPlanWalkHasFetchers(buildFieldPlanWalkFetchers({} as never))).toBe(true);
  });

  it('fieldPlanWalkHasFetchers still reads false against an empty registry (the guard is not disabled by having SOME adapters elsewhere)', () => {
    expect(fieldPlanWalkHasFetchers({})).toBe(false);
  });
});
