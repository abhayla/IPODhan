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
  describe('Score Color Functions', () => {
    it('should return red classes for poor scores (0-25)', () => {
      expect(getScoreBgClass(0)).toContain('bg-red');
      expect(getScoreBgClass(15)).toContain('bg-red');
      expect(getScoreBgClass(25)).toContain('bg-red');
      expect(getScoreTextClass(10)).toContain('text-red');
      expect(getScoreBorderClass(20)).toContain('border-red');
    });

    it('should return orange classes for fair scores (26-50)', () => {
      expect(getScoreBgClass(26)).toContain('bg-orange');
      expect(getScoreBgClass(35)).toContain('bg-orange');
      expect(getScoreBgClass(50)).toContain('bg-orange');
      expect(getScoreTextClass(40)).toContain('text-orange');
      expect(getScoreBorderClass(45)).toContain('border-orange');
    });

    it('should return yellow classes for good scores (51-75)', () => {
      expect(getScoreBgClass(51)).toContain('bg-yellow');
      expect(getScoreBgClass(60)).toContain('bg-yellow');
      expect(getScoreBgClass(75)).toContain('bg-yellow');
      expect(getScoreTextClass(65)).toContain('text-yellow');
      expect(getScoreBorderClass(70)).toContain('border-yellow');
    });

    it('should return green classes for excellent scores (76-100)', () => {
      expect(getScoreBgClass(76)).toContain('bg-green');
      expect(getScoreBgClass(85)).toContain('bg-green');
      expect(getScoreBgClass(100)).toContain('bg-green');
      expect(getScoreTextClass(90)).toContain('text-green');
      expect(getScoreBorderClass(95)).toContain('border-green');
    });

    it('should return correct score categories', () => {
      expect(getScoreCategory(10)).toBe('Poor');
      expect(getScoreCategory(35)).toBe('Below Average');
      expect(getScoreCategory(65)).toBe('Good');
      expect(getScoreCategory(85)).toBe('Excellent');
    });

    it('should handle edge cases', () => {
      expect(getScoreCategory(-1)).toBe('Poor');
      expect(getScoreCategory(101)).toBe('Excellent');
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
    it('should format scores correctly', () => {
      expect(formatScore(85)).toBe('85/100');
      expect(formatScore(100)).toBe('100/100');
      expect(formatScore(0)).toBe('0/100');
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
