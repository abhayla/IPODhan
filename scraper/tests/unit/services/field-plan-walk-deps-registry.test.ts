// implements: stage 2 item 6 -- buildFieldPlanWalkFetchers() registers
// exactly the sources this slice built adapters for (DOC, BSE, CHITTORGARH),
// and fieldPlanWalkHasFetchers() reads true once they are registered.
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
  it('registers exactly DOC, BSE and CHITTORGARH — no more, no fewer', () => {
    const fetchers = buildFieldPlanWalkFetchers({} as never);
    expect(Object.keys(fetchers).sort()).toEqual(['BSE', 'CHITTORGARH', 'DOC']);
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
