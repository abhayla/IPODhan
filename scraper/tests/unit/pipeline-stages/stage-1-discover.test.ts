/**
 * Stage 1 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6, issue #258): "Discover IPO - captured BSE/NSE list JSON - NSE/BSE orchestrator
 * parse only - 4 ipos rows with correct segment/offering_type/dates".
 *
 * FIXTURE IN / EXPECTED-OUTPUT-FILE OUT. Fixtures are REAL captured NSE payloads already in
 * this repo (scraper/tests/fixtures/nse/) -- never hand-typed. The golden
 * (fixtures/stage-1/expected-discover.json) is hand-derived from transformIPOData()'s own
 * documented formulas (see that file's own tests, nse-api-client.test.ts), not copied from a
 * live run of the function under test, so a regression in the function shows up here.
 *
 * This drives the REAL `transformIPOData` from src/scrapers/nse-api-client.ts -- the exact
 * function every NSE fetch path (fetchCurrentIssueList / fetchAllIPOs / scrapeNSEAPI) calls to
 * turn one raw NSE list item into an ipos-shaped row. No network, no DB.
 *
 * Coverage gap, recorded rather than invented: no real captured NSE payload with
 * series/platform=SME exists anywhere under scraper/tests/fixtures as of 2026-09-26, so the SME
 * segment branch is untested here (see `notGap` in the golden file).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformIPOData } from '../../../src/scrapers/nse-api-client.js';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'stage-1');
const NSE_FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'nse');

const GOLDEN = JSON.parse(readFileSync(join(FIXTURES_DIR, 'expected-discover.json'), 'utf8')) as {
  cases: Record<
    string,
    {
      fixture: string;
      index?: number;
      rawItemKey?: string;
      endpointCategory: 'ipo' | 'ofs' | 'rights' | 'tender' | 'ipp' | null;
      expected: Record<string, unknown>;
    }
  >;
};

function loadRawItem(caseDef: (typeof GOLDEN.cases)[string]): unknown {
  const path = caseDef.fixture.startsWith('..')
    ? join(FIXTURES_DIR, caseDef.fixture)
    : join(NSE_FIXTURES_DIR, caseDef.fixture);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (caseDef.rawItemKey) return parsed[caseDef.rawItemKey];
  if (typeof caseDef.index === 'number') return parsed[caseDef.index];
  return parsed;
}

describe('pipeline stage 1 - discover IPO (transformIPOData on real captured NSE payloads)', () => {
  for (const [name, caseDef] of Object.entries(GOLDEN.cases)) {
    it(`${name} matches the expected discover golden`, () => {
      const rawItem = loadRawItem(caseDef);
      const result = transformIPOData(rawItem, caseDef.endpointCategory ?? undefined);

      // Assert only the fields stage 1 is responsible for (segment/offering_type/dates/status
      // + the identity/price fields those depend on) -- not the full ScrapedIPO shape, which
      // also carries sourceKeys() output that belongs to the consolidation stage, not discovery.
      const actualSubset: Record<string, unknown> = {};
      for (const key of Object.keys(caseDef.expected)) {
        actualSubset[key] = (result as Record<string, unknown>)[key];
      }
      expect(actualSubset).toEqual(caseDef.expected);
    });
  }

  it('golden documents the SME coverage gap instead of inventing a fixture', () => {
    expect(typeof GOLDEN.notGap).toBe('string');
    expect(GOLDEN.notGap.length).toBeGreaterThan(20);
  });
});
