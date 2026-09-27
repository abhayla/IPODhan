/**
 * Unit Tests: score-utils (Story 4.7)
 * Tests all utility functions for IPO scoring
 */

import { describe, it, expect } from 'vitest';
import {
  // Color functions
  getScoreBgClass,
  getScoreTextClass,
  getScoreBorderClass,
  getScoreCategory,
  getVerdictBgClass,
  getVerdictTextClass,
  getVerdictBorderClass,
  getConfidenceClass,
  getConfidenceText,
  // Format functions
  formatScore,
  // Filter functions
  isScoreInRange,
} from '@/lib/utils/score-utils';
import type { IPOVerdict, ConfidenceLevel } from '@/lib/db/types';

describe('score-utils', () => {
  // OD-125 (#167): these functions render on the 0-10 scale
  // `/api/ipos/[slug]/score` and IPOScoreSection use — a stored `ipo_scores`
  // row (0-100 raw) is converted via `adaptStoredScore(...)` before it
  // reaches them (see ipo-score-display-adapter.test.ts for that math).
  describe('Score Color Functions', () => {
    it('should return red classes for poor scores (0-2.5)', () => {
      expect(getScoreBgClass(0)).toContain('bg-red');
      expect(getScoreBgClass(1.5)).toContain('bg-red');
      expect(getScoreBgClass(2.5)).toContain('bg-red');
      expect(getScoreTextClass(1)).toContain('text-red');
      expect(getScoreBorderClass(2)).toContain('border-red');
    });

    it('should return orange classes for fair scores (2.6-5)', () => {
      expect(getScoreBgClass(2.6)).toContain('bg-orange');
      expect(getScoreBgClass(3.5)).toContain('bg-orange');
      expect(getScoreBgClass(5)).toContain('bg-orange');
      expect(getScoreTextClass(4)).toContain('text-orange');
      expect(getScoreBorderClass(4.5)).toContain('border-orange');
    });

    it('should return yellow classes for good scores (5.1-7.5)', () => {
      expect(getScoreBgClass(5.1)).toContain('bg-yellow');
      expect(getScoreBgClass(6)).toContain('bg-yellow');
      expect(getScoreBgClass(7.5)).toContain('bg-yellow');
      expect(getScoreTextClass(6.5)).toContain('text-yellow');
      expect(getScoreBorderClass(7)).toContain('border-yellow');
    });

    it('should return green classes for excellent scores (7.6-10)', () => {
      expect(getScoreBgClass(7.6)).toContain('bg-green');
      expect(getScoreBgClass(8.5)).toContain('bg-green');
      expect(getScoreBgClass(10)).toContain('bg-green');
      expect(getScoreTextClass(9)).toContain('text-green');
      expect(getScoreBorderClass(9.5)).toContain('border-green');
    });

    it('should return correct score categories', () => {
      expect(getScoreCategory(1)).toBe('Poor');
      expect(getScoreCategory(3.5)).toBe('Below Average');
      expect(getScoreCategory(6.5)).toBe('Good');
      expect(getScoreCategory(8.5)).toBe('Excellent');
    });

    it('should handle edge cases', () => {
      expect(getScoreCategory(-1)).toBe('Poor');
      expect(getScoreCategory(10.1)).toBe('Excellent');
    });
  });

  describe('Verdict Color Functions', () => {
    it('should return green classes for APPLY verdict', () => {
      const verdict: IPOVerdict = 'APPLY';
      expect(getVerdictBgClass(verdict)).toContain('bg-green');
      expect(getVerdictTextClass(verdict)).toContain('text-green');
      expect(getVerdictBorderClass(verdict)).toContain('border-green');
    });

    it('should return yellow classes for CONSIDER verdict', () => {
      const verdict: IPOVerdict = 'CONSIDER';
      expect(getVerdictBgClass(verdict)).toContain('bg-yellow');
      expect(getVerdictTextClass(verdict)).toContain('text-yellow');
      expect(getVerdictBorderClass(verdict)).toContain('border-yellow');
    });

    it('should return red classes for SKIP verdict', () => {
      const verdict: IPOVerdict = 'SKIP';
      expect(getVerdictBgClass(verdict)).toContain('bg-red');
      expect(getVerdictTextClass(verdict)).toContain('text-red');
      expect(getVerdictBorderClass(verdict)).toContain('border-red');
    });
  });

  describe('Confidence Functions', () => {
    it('should return correct class for HIGH confidence', () => {
      const confidence: ConfidenceLevel = 'HIGH';
      expect(getConfidenceClass(confidence)).toContain('text-green');
    });

    it('should return correct class for MEDIUM confidence', () => {
      const confidence: ConfidenceLevel = 'MEDIUM';
      expect(getConfidenceClass(confidence)).toContain('text-yellow');
    });

    it('should return correct class for LOW confidence', () => {
      const confidence: ConfidenceLevel = 'LOW';
      expect(getConfidenceClass(confidence)).toContain('text-gray');
    });

    it('should return confidence display text (title-case)', () => {
      // getConfidenceText is documented "display text" → title-case for the badge.
      expect(getConfidenceText('HIGH')).toBe('High');
      expect(getConfidenceText('MEDIUM')).toBe('Medium');
      expect(getConfidenceText('LOW')).toBe('Low');
    });
  });

  describe('Format Functions', () => {
    it('should format scores correctly on the 0-10 scale', () => {
      expect(formatScore(8.5)).toBe('8.5/10');
      expect(formatScore(10)).toBe('10/10');
      expect(formatScore(0)).toBe('0/10');
    });
  });

  describe('Filter Functions', () => {
    it('should correctly identify scores in range', () => {
      expect(isScoreInRange(85, '76-100')).toBe(true);
      expect(isScoreInRange(85, '51-75')).toBe(false);
      expect(isScoreInRange(65, '51-75')).toBe(true);
      expect(isScoreInRange(40, '26-50')).toBe(true);
      expect(isScoreInRange(15, '0-25')).toBe(true);
      expect(isScoreInRange(50, 'all')).toBe(true);
    });

    it('should handle edge cases in range checking', () => {
      expect(isScoreInRange(76, '76-100')).toBe(true);
      expect(isScoreInRange(75, '76-100')).toBe(false);
      expect(isScoreInRange(100, '76-100')).toBe(true);
      expect(isScoreInRange(0, '0-25')).toBe(true);
      expect(isScoreInRange(25, '0-25')).toBe(true);
      expect(isScoreInRange(26, '0-25')).toBe(false);
    });
  });
});
