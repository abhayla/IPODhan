/**
 * W-104: the public slug is generated ONLY at row creation on this write
 * door too. `DataConsolidationOrchestrator.consolidatedUpsertIPO` calls
 * `ipoRepository.update()` for an existing row with `{...consolidatedIPOData,
 * updatedAt}` — `consolidatedIPOData` comes from `extractConsolidatedData`,
 * whose input in turn comes from `mapScrapedIPOToConsolidationInput`. Neither
 * function may ever add a `slug` key: doing so would let a companyName
 * correction from ANY source silently re-slug an existing row on this door,
 * the same live-incident class fixed at the `data-persister.ts` door (see
 * the parallel guard + tests there).
 */
import { describe, it, expect } from 'vitest';
import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';

function makeOrchestrator() {
  return new DataConsolidationOrchestrator({} as any, {} as any, {} as any, null);
}

describe('DataConsolidationOrchestrator — slug is create-only (W-104)', () => {
  it('mapScrapedIPOToConsolidationInput never includes a slug key, even when the scraped payload carries one', () => {
    const orchestrator: any = makeOrchestrator();
    const scrapedIPO = {
      companyName: 'Rays Of Belief Limited For Profit Social Enterprise',
      slug: 'a-slug-that-should-never-be-read-here',
    } as any;
    const incomingData = orchestrator.mapScrapedIPOToConsolidationInput(scrapedIPO);
    expect(incomingData).not.toHaveProperty('slug');
  });

  it('extractConsolidatedData never includes a slug key, even when consolidation somehow produced a slug field result', () => {
    const orchestrator: any = makeOrchestrator();
    const result = {
      fieldResults: [
        { fieldName: 'slug', finalValue: 'sneaky-slug', chosenSource: 'DRHP' },
        { fieldName: 'companyName', finalValue: 'Renamed Co', chosenSource: 'DRHP' },
      ],
    } as any;
    const originalScraped = { companyName: 'Renamed Co', offeringType: 'IPO', status: 'OPEN' } as any;
    const consolidated = orchestrator.extractConsolidatedData(result, originalScraped);
    expect(consolidated).not.toHaveProperty('slug');
  });

  it('wiring: the update-branch object literal never spreads a bare `slug` key (only the create branch does)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../../src/services/data-consolidation-orchestrator.ts', import.meta.url),
      'utf-8'
    );
    const [, afterIsNew = ''] = source.split('if (isNew) {');
    const [createBranch = '', updateBranch = ''] = afterIsNew.split('} else {');
    expect(createBranch).toMatch(/\bslug,/);
    expect(updateBranch).not.toMatch(/\.\.\.consolidatedIPOData,\s*\n\s*slug,/);
  });
});
