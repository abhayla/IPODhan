/**
 * Item 4 flag observability (stage 1 round 2 Task B) — `validateValidationRulesAtStartup`
 * in scraper/src/index.ts silently returned when `ENABLE_FIELD_EXTRACTION_VALIDATION` was
 * off, and silently loaded rules when it was on: no log line either way. Per signal-ownership.md
 * R1/R3, a flag with no observable state is not a signal anyone can diff — this test pins that
 * startup now always emits one structured `field-extraction validation flag state` line, on both
 * the off and on paths, naming the flag, whether it is enabled, and (when on) the loaded rule count.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'path';

import { validateValidationRulesAtStartup } from '../../src/index.js';
import logger from '../../src/utils/logger.js';

const REAL_RULES_PATH = join(__dirname, '..', '..', 'config', 'validation-rules.json');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateValidationRulesAtStartup — item 4 flag state logging', () => {
  it('flag OFF: logs enabled=false, rulesLoaded=null, and does not load rules', () => {
    const infoSpy = vi.spyOn(logger, 'info');

    validateValidationRulesAtStartup(REAL_RULES_PATH, false);

    expect(infoSpy).toHaveBeenCalledWith(
      { flag: 'ENABLE_FIELD_EXTRACTION_VALIDATION', enabled: false, rulesLoaded: null },
      'field-extraction validation flag state'
    );
  });

  it('flag ON (real checked-in rules file): logs enabled=true with the real loaded rule count', () => {
    const infoSpy = vi.spyOn(logger, 'info');

    validateValidationRulesAtStartup(REAL_RULES_PATH, true);

    expect(infoSpy).toHaveBeenCalledWith(
      { flag: 'ENABLE_FIELD_EXTRACTION_VALIDATION', enabled: true, rulesLoaded: 4 },
      'field-extraction validation flag state'
    );
  });
});
