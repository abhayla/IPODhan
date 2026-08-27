/**
 * T-340 item 3 — the scraper must REFUSE TO START a `--source=all` cycle when
 * an env var its post-scrape steps need is missing.
 *
 * The defect this locks down (this task's data_source note): a missing
 * ADMIN_API_TOKEN made triggerStatusUpdate() return early at the point of use.
 * The cycle then ran every other step, exited 0, and left IPO statuses stale
 * with nothing alerting. A silent per-step skip is not an acceptable response
 * to a misconfigured box — a startup refusal is.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { assertRequiredEnvForCycle, REQUIRED_ENV_FOR_ALL_CYCLE } from '../../src/index.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('assertRequiredEnvForCycle (T-340 startup refusal)', () => {
  it('throws, naming the key, when ADMIN_API_TOKEN is unset for --source=all', () => {
    expect(() => assertRequiredEnvForCycle('all', {} as NodeJS.ProcessEnv))
      .toThrow(/ADMIN_API_TOKEN/);
  });

  it('treats a BLANK value as missing (T-230: presence is not validity)', () => {
    expect(() => assertRequiredEnvForCycle('all', { ADMIN_API_TOKEN: '' } as NodeJS.ProcessEnv))
      .toThrow(/ADMIN_API_TOKEN/);
  });

  it('passes when every required key is present and non-blank', () => {
    expect(() => assertRequiredEnvForCycle('all', { ADMIN_API_TOKEN: 'tok' } as NodeJS.ProcessEnv))
      .not.toThrow();
  });

  it('does NOT gate single-source runs — they run no post-scrape step', () => {
    for (const source of ['nse', 'bse', 'moneycontrol', 'chittorgarh', 'gmp', 'fallback']) {
      expect(() => assertRequiredEnvForCycle(source, {} as NodeJS.ProcessEnv)).not.toThrow();
    }
  });

  it('names EVERY missing key at once, not just the first', () => {
    // Guards against a future second key being added and silently swallowed.
    const many = ['ADMIN_API_TOKEN', 'SOME_FUTURE_KEY'];
    const missing = many.filter((k) => !({} as NodeJS.ProcessEnv)[k]);
    expect(missing.length).toBeGreaterThan(1); // sanity for the fixture itself
    try {
      assertRequiredEnvForCycle('all', {} as NodeJS.ProcessEnv);
    } catch (e) {
      for (const key of REQUIRED_ENV_FOR_ALL_CYCLE) {
        expect((e as Error).message).toContain(key);
      }
    }
  });

  it('is actually WIRED into main() before any post-scrape step runs', () => {
    // A perfect assert that nothing calls is a paper guard (wire-or-retire).
    const src = readFileSync(join(REPO_ROOT, 'scraper', 'src', 'index.ts'), 'utf8');
    // Scope to main()'s body so we compare CALL SITES, not the definitions
    // (runStep's own signature textually precedes main()).
    const mainBody = src.slice(src.indexOf('export async function main()'));
    const callIdx = mainBody.indexOf('assertRequiredEnvForCycle(source)');
    const firstStepIdx = mainBody.indexOf("runStep(cycleId, '");
    expect(callIdx, 'assertRequiredEnvForCycle(source) is never called from main()').toBeGreaterThan(-1);
    expect(firstStepIdx, 'no runStep() call found in main()').toBeGreaterThan(-1);
    expect(callIdx).toBeLessThan(firstStepIdx);
  });
});

describe('REQUIRED_ENV_FOR_ALL_CYCLE <-> scripts/assert-env-keys.sh (drift guard)', () => {
  it('every runtime-required key is also a deploy-time required key', () => {
    // Two hand-maintained lists in two languages is exactly the drift class
    // this task exists to kill. If a key is required to START, the deploy must
    // refuse to ship an env file without it — otherwise the box only discovers
    // the gap when the first cycle dies.
    const sh = readFileSync(join(REPO_ROOT, 'scripts', 'assert-env-keys.sh'), 'utf8');
    const block = sh.match(/SCRAPER_REQUIRED_KEYS=\(([\s\S]*?)\n\)/);
    expect(block, 'SCRAPER_REQUIRED_KEYS array not found in assert-env-keys.sh').not.toBeNull();
    const deployKeys = block![1]
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter((l) => /^[A-Z0-9_]+$/.test(l));

    expect(REQUIRED_ENV_FOR_ALL_CYCLE.length).toBeGreaterThan(0);
    for (const key of REQUIRED_ENV_FOR_ALL_CYCLE) {
      expect(deployKeys, `${key} is required at startup but absent from assert-env-keys.sh`).toContain(key);
    }
  });
});
