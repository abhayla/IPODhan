/**
 * IPO Score Utilities (Story 4.7)
 * Helper functions for score colors, ranges, and display
 */

import type { IPOVerdict, ConfidenceLevel } from '@/lib/db/types';

/**
 * Score range types for filtering
 */
export type ScoreRange = '0-25' | '26-50' | '51-75' | '76-100' | 'all';

/**
 * Score color scheme based on total score
 * 0-25: red, 26-50: orange, 51-75: yellow, 76-100: green
 */
export function getScoreColor(score: number): string {
  if (score <= 25) return 'red';
  if (score <= 50) return 'orange';
  if (score <= 75) return 'yellow';
  return 'green';
}

/**
 * Get Tailwind CSS classes for score badge background
 */
export function getScoreBgClass(score: number): string {
  if (score >= 76) return 'bg-green-100 dark:bg-green-900/20';
  if (score >= 51) return 'bg-yellow-100 dark:bg-yellow-900/20';
  if (score >= 26) return 'bg-orange-100 dark:bg-orange-900/20';
  return 'bg-red-100 dark:bg-red-900/20';
}

/**
 * Get Tailwind CSS classes for score badge text
 */
export function getScoreTextClass(score: number): string {
  if (score >= 76) return 'text-green-700 dark:text-green-300';
  if (score >= 51) return 'text-yellow-700 dark:text-yellow-300';
  if (score >= 26) return 'text-orange-700 dark:text-orange-300';
  return 'text-red-700 dark:text-red-300';
}

/**
 * Get Tailwind CSS classes for score badge border
 */
export function getScoreBorderClass(score: number): string {
  if (score >= 76) return 'border-green-300 dark:border-green-700';
  if (score >= 51) return 'border-yellow-300 dark:border-yellow-700';
  if (score >= 26) return 'border-orange-300 dark:border-orange-700';
  return 'border-red-300 dark:border-red-700';
}

/**
 * Verdict color scheme
 * APPLY: green, CONSIDER: yellow, SKIP: red
 */
export function getVerdictColor(verdict: IPOVerdict): string {
  switch (verdict) {
    case 'APPLY':
      return 'green';
    case 'CONSIDER':
      return 'yellow';
    case 'SKIP':
      return 'red';
  }
}

/**
 * Get Tailwind CSS classes for verdict badge background
 */
export function getVerdictBgClass(verdict: IPOVerdict): string {
  switch (verdict) {
    case 'APPLY':
      return 'bg-green-100 dark:bg-green-900/20';
    case 'CONSIDER':
      return 'bg-yellow-100 dark:bg-yellow-900/20';
    case 'SKIP':
      return 'bg-red-100 dark:bg-red-900/20';
  }
}

/**
 * Get Tailwind CSS classes for verdict badge text
 */
export function getVerdictTextClass(verdict: IPOVerdict): string {
  switch (verdict) {
    case 'APPLY':
      return 'text-green-700 dark:text-green-300';
    case 'CONSIDER':
      return 'text-yellow-700 dark:text-yellow-300';
    case 'SKIP':
      return 'text-red-700 dark:text-red-300';
  }
}

/**
 * Get Tailwind CSS classes for verdict badge border
 */
export function getVerdictBorderClass(verdict: IPOVerdict): string {
  switch (verdict) {
    case 'APPLY':
      return 'border-green-300 dark:border-green-700';
    case 'CONSIDER':
      return 'border-yellow-300 dark:border-yellow-700';
    case 'SKIP':
      return 'border-red-300 dark:border-red-700';
  }
}

/**
 * Get confidence level display text
 */
export function getConfidenceText(confidence: ConfidenceLevel): string {
  // Title-case for display (the badge is the only consumer). The raw enum is
  // HIGH/MEDIUM/LOW; render it as High/Medium/Low for a polished badge.
  const labels: Record<ConfidenceLevel, string> = {
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
  };
  return labels[confidence] ?? confidence;
}

/**
 * Get confidence level icon
 */
export function getConfidenceIcon(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case 'HIGH':
      return '⚡'; // Lightning bolt for high confidence
    case 'MEDIUM':
      return '○'; // Circle for medium confidence
    case 'LOW':
      return '◐'; // Half-filled circle for low confidence
  }
}

/**
 * Get confidence level Tailwind CSS classes
 */
export function getConfidenceClass(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case 'HIGH':
      return 'text-green-600 dark:text-green-400';
    case 'MEDIUM':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'LOW':
      return 'text-gray-600 dark:text-gray-400';
  }
}

/**
 * Check if score falls within a range
 */
export function isScoreInRange(score: number, range: ScoreRange): boolean {
  if (range === 'all') return true;

  const [min, max] = range.split('-').map(Number);
  return score >= min && score <= max;
}

/**
 * Get score range label for display
 */
export function getScoreRangeLabel(range: ScoreRange): string {
  if (range === 'all') return 'All Scores';
  return range;
}

/**
 * Format score for display (adds /100)
 */
export function formatScore(score: number): string {
  return `${score}/100`;
}

/**
 * Format component score for display (adds /25)
 */
export function formatComponentScore(score: number): string {
  return `${score}/25`;
}

/**
 * Calculate score percentage
 */
export function getScorePercentage(score: number, maxScore: number = 100): number {
  return Math.round((score / maxScore) * 100);
}

/**
 * Get score performance category
 */
export function getScoreCategory(score: number): string {
  if (score <= 25) return 'Poor';
  if (score <= 50) return 'Below Average';
  if (score <= 75) return 'Good';
  return 'Excellent';
}
