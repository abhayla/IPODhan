/**
 * Item 7 part A. These tests exist so that no single budget number can be
 * changed on its own: each one asserts a LINK in the derivation chain
 * (`scraper/src/config/extraction-budgets.ts`), never a re-typed literal.
 *
 * The one sentence every number below comes from: "never start an extraction
 * unless the remaining extraction budget can absorb its FULL timeout".
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  EXTRACT_TIMEOUT_MS,
  DEFAULT_WAKE_BUDGET_MS,
  DEFAULT_EXTRACTION_BUDGET_MS,
  DISCOVERY_RESERVE_MS,
  PURGE_RESERVE_MS,
  LOCK_SLACK_MS,
  SIDECAR_TIMEOUT_MS,
  DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE,
  FILING_EXTRACTION_LOCK_TTL_MS,
  extractionBudgetMs,
  filingPassWorstCaseMs,
  filingExtractionLockTtlMs,
  maxAnchorSpawnsWithinLockTtl,
  budgetDerivationViolations,
  getWakeBudgetMs,
} from '../../../src/config/extraction-budgets.js';

const MIN = 60_000;

describe('the budget derivation holds end to end', () => {
  it('reports zero violations at the shipped constants', () => {
    expect(budgetDerivationViolations()).toEqual([]);
  });

  // LINK 1 — the invariant itself. This is the test that goes red if
  // EXTRACT_TIMEOUT_MS is raised without the wake budget following: an
  // extraction budget smaller than one full timeout means the never-start
  // check refuses EVERY extraction, silently, forever.
  it('LINK 1: the extraction budget can absorb at least one full EXTRACT_TIMEOUT_MS', () => {
    expect(DEFAULT_EXTRACTION_BUDGET_MS).toBeGreaterThanOrEqual(EXTRACT_TIMEOUT_MS);
    expect(budgetDerivationViolations()).not.toContainEqual(
      expect.stringContaining('cannot absorb one full EXTRACT_TIMEOUT_MS')
    );
  });

  // LINK 2 — the extraction budget is the wake minus the two reservations,
  // computed, not typed.
  it('LINK 2: the extraction budget is the wake budget minus discovery and purge reservations', () => {
    expect(DEFAULT_EXTRACTION_BUDGET_MS).toBe(
      DEFAULT_WAKE_BUDGET_MS - DISCOVERY_RESERVE_MS - PURGE_RESERVE_MS
    );
    expect(extractionBudgetMs(DEFAULT_WAKE_BUDGET_MS)).toBe(DEFAULT_EXTRACTION_BUDGET_MS);
  });

  // LINK 3 — the invariant is WHY the filing pass worst case is the budget
  // rather than spawns x timeout. Guard the old, now-broken formula
  // explicitly: 3 x 30 min = 90 min fits under no lock this file can derive.
  it('LINK 3: the filing pass worst case is the extraction budget, not spawns x timeout', () => {
    expect(filingPassWorstCaseMs(DEFAULT_WAKE_BUDGET_MS)).toBe(DEFAULT_EXTRACTION_BUDGET_MS);
    expect(3 * EXTRACT_TIMEOUT_MS).toBeGreaterThan(FILING_EXTRACTION_LOCK_TTL_MS);
  });

  // LINK 4 — the lock TTL is a FUNCTION of the wake budget, the anchor pass
  // and the slack. Hard-coding it back to any constant breaks this.
  it('LINK 4: FILING_EXTRACTION_LOCK_TTL_MS equals its derivation from the wake budget', () => {
    expect(FILING_EXTRACTION_LOCK_TTL_MS).toBe(filingExtractionLockTtlMs(DEFAULT_WAKE_BUDGET_MS));
    expect(FILING_EXTRACTION_LOCK_TTL_MS).toBeGreaterThan(
      filingPassWorstCaseMs(DEFAULT_WAKE_BUDGET_MS) +
        DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE * SIDECAR_TIMEOUT_MS +
        LOCK_SLACK_MS
    );
    // whole minutes, so a redis-cli TTL read is legible
    expect(FILING_EXTRACTION_LOCK_TTL_MS % MIN).toBe(0);
  });

  // LINK 5 — the anchor cap FALLS OUT of the arithmetic. Asserted as an
  // equality against the derivation, never alongside a literal.
  it('LINK 5: maxAnchorSpawnsWithinLockTtl is the largest n whose worst case still fits the TTL', () => {
    const n = maxAnchorSpawnsWithinLockTtl(SIDECAR_TIMEOUT_MS);
    const worst = (k: number) => filingPassWorstCaseMs() + k * SIDECAR_TIMEOUT_MS + LOCK_SLACK_MS;
    expect(worst(n)).toBeLessThan(FILING_EXTRACTION_LOCK_TTL_MS);
    expect(worst(n + 1)).toBeGreaterThanOrEqual(FILING_EXTRACTION_LOCK_TTL_MS);
    // and the shipped default must fit inside that cap
    expect(DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE).toBeLessThanOrEqual(n);
  });

  // The cycle lock (index.ts, getWakeBudgetMs() + 5 min) is what a runaway
  // cycle expires against; the filing lock must not outlive it.
  it('the filing extraction lock never outlives the whole-cycle lock', () => {
    expect(FILING_EXTRACTION_LOCK_TTL_MS).toBeLessThan(DEFAULT_WAKE_BUDGET_MS + 5 * MIN);
  });
});

describe('the derivation moves with its inputs', () => {
  const original = process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS;
  afterEach(() => {
    if (original === undefined) delete process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS;
    else process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS = original;
  });

  it('a wake budget too small for one full timeout is reported as a violation, not silently accepted', () => {
    const tooSmall = EXTRACT_TIMEOUT_MS; // leaves less than a full timeout after reservations
    const violations = budgetDerivationViolations(tooSmall);
    expect(violations.join('\n')).toContain('cannot absorb one full EXTRACT_TIMEOUT_MS');
  });

  it('the lock TTL grows with the wake budget instead of staying put', () => {
    expect(filingExtractionLockTtlMs(DEFAULT_WAKE_BUDGET_MS + 10 * MIN)).toBeGreaterThan(
      filingExtractionLockTtlMs(DEFAULT_WAKE_BUDGET_MS)
    );
  });

  it('getWakeBudgetMs honours DOCUMENT_CYCLE_WAKE_BUDGET_MS and falls back on garbage', () => {
    delete process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS;
    expect(getWakeBudgetMs()).toBe(DEFAULT_WAKE_BUDGET_MS);
    process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS = '600000';
    expect(getWakeBudgetMs()).toBe(600_000);
    for (const bad of ['not-a-number', '0', '-5']) {
      process.env.DOCUMENT_CYCLE_WAKE_BUDGET_MS = bad;
      expect(getWakeBudgetMs()).toBe(DEFAULT_WAKE_BUDGET_MS);
    }
  });
});
