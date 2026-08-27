/**
 * T-339 item 1 — consolidation is MANDATORY and there is ONE write path.
 *
 * Before this task the write path had three independent ways to publish a
 * HIGH_VALUE field (`priceRangeMin`/`priceRangeMax`/`openDate`/`closeDate`)
 * with NO consolidation decision behind it:
 *
 *   1. `FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION` false -> plain `upsertIPO`
 *      (BaseScraperOrchestrator.ts:441 else-branch, data-persister.ts:373 if-guard)
 *   2. `CONSOLIDATION_PERCENTAGE` missing the hash gate -> `fallbackConsolidation()`
 *      accept-all (data-consolidation-service.ts:256-263)
 *   3. consolidation threw -> "LEGACY PATH" simple update (data-persister.ts:517-559)
 *
 * All three are last-writer-wins. STEP 1 of this contract measured prod +
 * staging at consolidation ON / 100%, so all three were already dead code in
 * production — this suite locks them shut so they cannot come back.
 *
 * The DoD RED case is the first test below: a HIGH_VALUE field reaching the DB
 * write with no matching consolidation `fieldResults` entry MUST throw, never
 * silently publish.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertConsolidationDecisionRecorded,
  WritePathIntegrityError,
} from '../../../src/services/write-path-guard.js';
import { HIGH_VALUE_FIELDS } from '../../../src/services/cross-source-disagreement-monitor.js';

describe('T-339 (1a) — HIGH_VALUE writes require a consolidation decision record', () => {
  const base = { ipoId: 'ipo-1', source: 'NSE' as const };

  it('RED CASE: a HIGH_VALUE field in the write with NO decision record throws', () => {
    expect(() =>
      assertConsolidationDecisionRecorded({
        ...base,
        writtenData: { openDate: new Date('2026-08-26'), companyName: 'Acme Ltd' },
        fieldResults: [{ fieldName: 'companyName' }],
      })
    ).toThrow(WritePathIntegrityError);
  });

  it('names the offending field and the ipo in the error (operators must not have to guess)', () => {
    let caught: unknown;
    try {
      assertConsolidationDecisionRecorded({
        ...base,
        writtenData: { priceRangeMax: 250 },
        fieldResults: [],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WritePathIntegrityError);
    expect((caught as Error).message).toContain('priceRangeMax');
    expect((caught as Error).message).toContain('ipo-1');
  });

  it.each([...HIGH_VALUE_FIELDS])('guards %s specifically', (field) => {
    expect(() =>
      assertConsolidationDecisionRecorded({
        ...base,
        writtenData: { [field]: 1 },
        fieldResults: [],
      })
    ).toThrow(WritePathIntegrityError);
  });

  it('GREEN: passes when every HIGH_VALUE field in the write carries a decision record', () => {
    expect(() =>
      assertConsolidationDecisionRecorded({
        ...base,
        writtenData: {
          openDate: new Date('2026-08-26'),
          closeDate: new Date('2026-08-28'),
          lotSize: 100,
        },
        fieldResults: [{ fieldName: 'openDate' }, { fieldName: 'closeDate' }],
      })
    ).not.toThrow();
  });

  it('ignores LOW_VALUE fields — they need no decision record (negative control)', () => {
    expect(() =>
      assertConsolidationDecisionRecorded({
        ...base,
        writtenData: { lotSize: 100, registrar: 'Link Intime', sector: 'Pharma' },
        fieldResults: [],
      })
    ).not.toThrow();
  });

  it('treats an absent/undefined HIGH_VALUE key as not-written (no false positive)', () => {
    expect(() =>
      assertConsolidationDecisionRecorded({
        ...base,
        writtenData: { openDate: undefined, lotSize: 100 },
        fieldResults: [],
      })
    ).not.toThrow();
  });
});

describe('T-339 (1b) — the retired rollout flags cannot silently disable consolidation', () => {
  const RETIRED = [
    'ENABLE_DATA_CONSOLIDATION',
    'ENABLE_CONFLICT_DETECTION',
    'ENABLE_SOURCE_TRACKING',
    'CONSOLIDATION_PERCENTAGE',
    'SOURCE_TRACKING_PERCENTAGE',
    'CONFLICT_DETECTION_PERCENTAGE',
  ];

  beforeEach(() => {
    vi.resetModules();
    for (const k of RETIRED) delete process.env[k];
  });

  it('FEATURE_FLAGS no longer exposes any of the six retired keys', async () => {
    const { FEATURE_FLAGS } = await import('../../../src/config/feature-flags.js');
    for (const k of RETIRED) {
      expect(FEATURE_FLAGS).not.toHaveProperty(k);
    }
  });

  it('startup validation passes when the retired vars are absent (post-cleanup steady state)', async () => {
    const { validateFeatureFlags } = await import('../../../src/config/feature-flags.js');
    expect(() => validateFeatureFlags()).not.toThrow();
  });

  it.each([
    ['ENABLE_DATA_CONSOLIDATION', 'false'],
    ['ENABLE_CONFLICT_DETECTION', 'false'],
    ['ENABLE_SOURCE_TRACKING', '0'],
    ['CONSOLIDATION_PERCENTAGE', '0'],
    ['CONSOLIDATION_PERCENTAGE', '50'],
  ])('HARD-FAILS startup when %s is still set to an OFF/partial value (%s)', async (key, value) => {
    process.env[key] = value;
    const { validateFeatureFlags } = await import('../../../src/config/feature-flags.js');
    expect(() => validateFeatureFlags()).toThrow(/consolidation/i);
    delete process.env[key];
  });

  it('tolerates a leftover fully-ON value (prod/staging today) so cleanup can lag the deploy', async () => {
    process.env.ENABLE_DATA_CONSOLIDATION = 'true';
    process.env.ENABLE_CONFLICT_DETECTION = 'true';
    process.env.ENABLE_SOURCE_TRACKING = 'true';
    process.env.CONSOLIDATION_PERCENTAGE = '100';
    const { validateFeatureFlags } = await import('../../../src/config/feature-flags.js');
    expect(() => validateFeatureFlags()).not.toThrow();
  });
});

describe('T-339 (1c) — no bypass write path survives in source', () => {
  it('data-consolidation-service.ts has no fallbackConsolidation accept-all branch', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/services/data-consolidation-service.ts', import.meta.url),
      'utf8'
    );
    expect(src).not.toMatch(/fallbackConsolidation/);
    expect(src).not.toMatch(/FEATURE_FLAGS\.ENABLE_DATA_CONSOLIDATION/);
    expect(src).not.toMatch(/shouldUseFeature\(\s*'CONSOLIDATION_PERCENTAGE'/);
  });

  it('data-persister.ts has no legacy simple-update bypass', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/services/data-persister.ts', import.meta.url),
      'utf8'
    );
    expect(src).not.toMatch(/LEGACY PATH/);
    expect(src).not.toMatch(/FEATURE_FLAGS\.ENABLE_DATA_CONSOLIDATION/);
    expect(src).not.toMatch(/FEATURE_FLAGS\.ENABLE_SOURCE_TRACKING/);
  });

  it('BaseScraperOrchestrator.ts has no non-consolidated upsert branch', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/base/BaseScraperOrchestrator.ts', import.meta.url),
      'utf8'
    );
    expect(src).not.toMatch(/FEATURE_FLAGS\.ENABLE_DATA_CONSOLIDATION/);
    // upsertIPO must no longer be reachable from the orchestrator at all —
    // consolidatedUpsertIPO is the single entry point.
    expect(src).not.toMatch(/await upsertIPO\(/);
  });
});
