/**
 * IPO Test Fixture Helper
 * Story 7.10: Historical IPO Data Scraper
 *
 * Provides helper utilities for creating IPO test fixtures with historical data fields.
 */

import type { IPO } from '@/lib/db/types';
import { DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

/**
 * Creates an IPO test fixture with all historical fields set to null
 * Use this helper to create fixtures that are compatible with the schema after Story 7.10
 */
export function createIPOFixture(data: Omit<IPO, keyof typeof DEFAULT_HISTORICAL_FIELDS>): IPO {
  return {
    ...DEFAULT_HISTORICAL_FIELDS,
    ...data,
  } as IPO;
}

/**
 * Converts an array of IPO-like objects to full IPO objects with historical fields
 */
export function createIPOFixtures(data: Array<Omit<IPO, keyof typeof DEFAULT_HISTORICAL_FIELDS>>): IPO[] {
  return data.map(createIPOFixture);
}
