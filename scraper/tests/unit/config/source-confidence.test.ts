/**
 * F6 (W-37) — per-source field confidence table.
 *
 * Spec: docs/specs/per-ipo-due-step-pipeline.md section 6, D-10.
 */
import { describe, it, expect } from 'vitest';
import {
  confidenceFor,
  BASE_SOURCE_CONFIDENCE,
  CONFIDENCE_FLOOR,
} from '../../../src/config/source-confidence.js';
import type { ScraperSource } from '../../../src/config/field-priority-matrix.js';

describe('confidenceFor — source tiers (D-10)', () => {
  it.each<[ScraperSource, number]>([
    ['ADMIN', 100],
    ['DRHP', 100],
    ['NSE', 90],
    ['BSE', 90],
    ['CHITTORGARH', 60],
    ['MONEYCONTROL', 60],
    ['INVESTORGAIN_GMP', 60],
    ['API_FALLBACK', 40],
  ])('%s with no conflicts and no confirmations is %i', (source, expected) => {
    expect(confidenceFor(source)).toBe(expected);
  });

  it('covers every source in the priority matrix enum', () => {
    const sources: ScraperSource[] = [
      'ADMIN',
      'DRHP',
      'NSE',
      'BSE',
      'CHITTORGARH',
      'MONEYCONTROL',
      'INVESTORGAIN_GMP',
      'API_FALLBACK',
    ];
    for (const source of sources) {
      expect(BASE_SOURCE_CONFIDENCE[source]).toBeGreaterThan(0);
    }
  });
});

describe('confidenceFor — conflict penalties', () => {
  it('subtracts 10 per CRITICAL conflict', () => {
    expect(confidenceFor('NSE', { conflicts: ['CRITICAL'] })).toBe(80);
    expect(confidenceFor('NSE', { conflicts: ['CRITICAL', 'CRITICAL'] })).toBe(70);
  });

  it('subtracts 5 per WARNING conflict', () => {
    expect(confidenceFor('BSE', { conflicts: ['WARNING'] })).toBe(85);
    expect(confidenceFor('CHITTORGARH', { conflicts: ['WARNING', 'WARNING'] })).toBe(50);
  });

  it('ignores INFO conflicts (a sub-5% wobble is not unreliability)', () => {
    expect(confidenceFor('NSE', { conflicts: ['INFO', 'INFO'] })).toBe(90);
  });

  it('mixes severities additively', () => {
    expect(confidenceFor('DRHP', { conflicts: ['CRITICAL', 'WARNING', 'INFO'] })).toBe(85);
  });

  it('floors at 20 however many conflicts pile up', () => {
    expect(confidenceFor('API_FALLBACK', { conflicts: Array(10).fill('CRITICAL') })).toBe(
      CONFIDENCE_FLOOR
    );
    expect(confidenceFor('ADMIN', { conflicts: Array(50).fill('CRITICAL') })).toBe(
      CONFIDENCE_FLOOR
    );
  });
});

describe('confidenceFor — confirmations', () => {
  it('adds 5 per confirming second source', () => {
    expect(confidenceFor('NSE', { confirmations: 1 })).toBe(95);
    expect(confidenceFor('CHITTORGARH', { confirmations: 2 })).toBe(70);
  });

  it('caps at 100', () => {
    expect(confidenceFor('NSE', { confirmations: 5 })).toBe(100);
    expect(confidenceFor('ADMIN', { confirmations: 3 })).toBe(100);
  });

  it('ignores negative or fractional confirmation counts', () => {
    expect(confidenceFor('NSE', { confirmations: -4 })).toBe(90);
    expect(confidenceFor('NSE', { confirmations: 1.9 })).toBe(95);
  });

  it('applies the conflict penalty before the confirmation bonus', () => {
    expect(confidenceFor('NSE', { conflicts: ['CRITICAL'], confirmations: 1 })).toBe(85);
  });

  it('never fabricates a high number for an unknown source', () => {
    expect(confidenceFor('SOMETHING_NEW' as ScraperSource)).toBe(40);
  });
});
