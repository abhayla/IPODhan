/**
 * ScoreRangeFilter Component (Story 4.7)
 * Filter IPOs by score range
 * Native select implementation (replaces Radix UI to fix webpack errors)
 */

'use client';

import { HiStar } from 'react-icons/hi2';

export interface ScoreRangeOption {
  label: string;
  value: string;
}

export const SCORE_RANGE_OPTIONS: ScoreRangeOption[] = [
  { label: 'All Scores', value: 'all' },
  { label: 'Excellent (76-100)', value: '76-100' },
  { label: 'Good (51-75)', value: '51-75' },
  { label: 'Fair (26-50)', value: '26-50' },
  { label: 'Poor (0-25)', value: '0-25' },
];

interface ScoreRangeFilterProps {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * ScoreRangeFilter component for filtering IPOs by score range
 */
export function ScoreRangeFilter({
  value = 'all',
  onChange,
  className = '',
}: ScoreRangeFilterProps) {
  return (
    <div className="w-full lg:w-auto">
      <div className="relative">
        <HiStar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full lg:w-[200px] h-12 pl-10 pr-10 rounded-md border border-input bg-background text-sm transition-all duration-200 hover:border-primary hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 appearance-none cursor-pointer ${className}`}
          aria-label="Filter IPOs by score range"
        >
          {SCORE_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
