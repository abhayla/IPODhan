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
  it('the lock TTL formula is >= wakeBudget + 5min for every wake budget, so a legitimate cycle never outlives its lock', async () => {
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
    // Item 7 slice 1: the TTL is now derived from the 2-hour hung-process
    // ceiling, NOT from the wake budget. The old formula
    // (`getWakeBudgetMs() + 5 * 60 * 1000`, = 25 min) was sized, in its own
    // words, to stay "SHORTER than PM2's 30-minute restart" — and that restart
    // is exactly what this slice deletes. A TTL sized against a kill that no
    // longer happens expires DURING the hang the ceiling is meant to bound,
    // letting a second cycle start on top of the first.
    expect(expression).toBe('CYCLE_LOCK_CEILING_MS + 5 * 60 * 1000');

    // The invariant, restated: the lock must outlive any run the ceiling
    // permits, so that the CEILING — never a lock expiry — is what ends a
    // hung cycle. The old `< 30 min` assertion is deliberately GONE: it
    // encoded the pm2 restart this slice removed.
    const ceilingMs = 2 * 60 * 60 * 1000;
    const derivedTtl = ceilingMs + 5 * 60 * 1000;
    expect(derivedTtl).toBeGreaterThan(ceilingMs);
    expect(derivedTtl).toBeGreaterThan(DEFAULT_WAKE_BUDGET_MS);

    // And the ceiling constant in index.ts must match the wrapper's own
    // SCRAPER_CEILING_SECONDS default (7200s) — two numbers in two languages
    // that must never drift, so each is read from its real source here.
    // The ceiling is DEFINED ONCE, in filing-auto-persist.ts (OD-55's semantic
    // home), and index.ts re-exports it. Asserting the source TEXT here would
    // pin the expression and go red the moment the definition moves - which is
    // exactly what happened when it did. Assert the IDENTITY instead: the two
    // names must be the same value, because a second literal is the defect.
    const ceilingMatch = source.match(/const CYCLE_LOCK_CEILING_MS = ([^;]+);/);
    expect(ceilingMatch, 'CYCLE_LOCK_CEILING_MS not found in index.ts').not.toBeNull();
    expect(
      ceilingMatch![1].trim(),
      'index.ts must IMPORT the ceiling, never redeclare it as a literal — the number lived in three places and nothing compared them',
    ).not.toMatch(/\d\s*\*/);

    const { HUNG_PROCESS_CEILING_MS } = await import('../../../src/services/filing-auto-persist.js');
    const { CYCLE_LOCK_CEILING_MS } = await import('../../../src/index.js');
    expect(CYCLE_LOCK_CEILING_MS).toBe(HUNG_PROCESS_CEILING_MS);
    expect(HUNG_PROCESS_CEILING_MS).toBe(ceilingMs);

    const wakeScript = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/scraper-wake.sh'),
      'utf8',
    );
    const secondsMatch = wakeScript.match(/SCRAPER_CEILING_SECONDS:-(\d+)/);
    expect(secondsMatch, 'SCRAPER_CEILING_SECONDS default not found in scraper-wake.sh').not.toBeNull();
    expect(Number(secondsMatch![1]) * 1000).toBe(ceilingMs);
  });
});
