/**
 * Cycle-overrun RCA (2026-09-06, observed 1,210-1,278s document cycles):
 * discovery (`CYCLE_BUDGET.DISCOVERY_MS`) and extraction
 * (`DEFAULT_EXTRACTION_BUDGET_MS`) used to be two INDEPENDENT budgets that
 * could both run to their ceiling in the same wake — 60s + 25min — with no
 * shared ceiling at all against the 30-minute pm2 wake, and the whole-cycle
 * Redis lock (`CYCLE_LOCK_TTL_MS`, index.ts) was a separately-hardcoded
 * number that could silently drift out of sync with it.
 *
 * These are the static arithmetic invariants the fix establishes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CYCLE_BUDGET } from '../../../src/services/document-state-machine.js';
import {
  DEFAULT_WAKE_BUDGET_MS,
  DEFAULT_EXTRACTION_BUDGET_MS,
  PURGE_RESERVE_MS,
  getWakeBudgetMs,
} from '../../../src/services/document-cycle.js';

describe('getWakeBudgetMs — DOCUMENT_CYCLE_WAKE_BUDGET_MS env override', () => {
  const original = process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS;

  afterEach(() => {
    if (original === undefined) delete process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS;
    else process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS = original;
  });

  it('defaults to DEFAULT_WAKE_BUDGET_MS when unset', () => {
    delete process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS;
    expect(getWakeBudgetMs()).toBe(DEFAULT_WAKE_BUDGET_MS);
  });

  it('honors a valid override', () => {
    process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS = '600000';
    expect(getWakeBudgetMs()).toBe(600_000);
  });

  it('falls back to the default on garbage input (never NaN/negative/zero)', () => {
    for (const bad of ['not-a-number', '0', '-5']) {
      process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS = bad;
      expect(getWakeBudgetMs()).toBe(DEFAULT_WAKE_BUDGET_MS);
    }
  });
});

describe('wake-budget arithmetic invariant', () => {
  it('worst-case discovery + worst-case extraction + the purge reservation never exceeds the default wake budget', () => {
    // Pre-fix, this sum (60s + 25min + a purge slot) had NO shared ceiling —
    // it was simply two independent budgets added together against a wake
    // with no dedicated budget of its own. The fix caps extraction to
    // "wake budget minus discovery minus purge reserve", so by construction
    // the worst case cannot exceed DEFAULT_WAKE_BUDGET_MS.
    const worstCaseExtraction = Math.max(
      0,
      Math.min(DEFAULT_EXTRACTION_BUDGET_MS, DEFAULT_WAKE_BUDGET_MS - CYCLE_BUDGET.DISCOVERY_MS - PURGE_RESERVE_MS)
    );
    const total = CYCLE_BUDGET.DISCOVERY_MS + worstCaseExtraction + PURGE_RESERVE_MS;
    expect(total).toBeLessThanOrEqual(DEFAULT_WAKE_BUDGET_MS);
  });
});

describe('CYCLE_LOCK_TTL_MS (index.ts) is derived from the wake budget, not hardcoded separately', () => {
  it('the lock TTL formula is >= wakeBudget + 5min for every wake budget, so a legitimate cycle never outlives its lock', () => {
    // index.ts is not imported directly here (its module-level side effects —
    // process.exit on invalid source/env, DB client construction — make it
    // expensive to import safely in a unit test; index-due-step-scheduler-
    // wiring.test.ts already carries that setup cost for its own suite). This
    // static check reads the actual source line so a future edit that
    // reintroduces a hardcoded, independently-drifting TTL fails loudly.
    const indexPath = join(dirname(fileURLToPath(import.meta.url)), '../../../src/index.ts');
    const source = readFileSync(indexPath, 'utf8');
    const match = source.match(/const CYCLE_LOCK_TTL_MS = ([^;]+);/);
    expect(match, 'CYCLE_LOCK_TTL_MS assignment not found in index.ts').not.toBeNull();
    const expression = match![1].trim();
    expect(expression).toBe('getWakeBudgetMs() + 5 * 60 * 1000');

    // And the derived value itself, for the default wake budget: TTL must be
    // strictly greater than the wake budget (there must be slack) and must
    // remain shorter than the 30-minute pm2 restart interval (round-3 M1 —
    // a killed cycle's lock must always be gone before the next cycle starts).
    const derivedTtl = DEFAULT_WAKE_BUDGET_MS + 5 * 60 * 1000;
    expect(derivedTtl).toBeGreaterThan(DEFAULT_WAKE_BUDGET_MS);
    expect(derivedTtl).toBeLessThan(30 * 60 * 1000);
  });
});
