/**
 * ScoreRangeFilter Component (Story 4.7)
 * Filter IPOs by score range
 */

'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`w-[200px] md:h-12 ${className}`}>
        <SelectValue placeholder="Select score range" />
      </SelectTrigger>
      <SelectContent>
        {SCORE_RANGE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
