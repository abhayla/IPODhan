'use client';

/**
 * Year Filter Component
 *
 * Reusable dropdown selector for filtering data by year.
 * Can be used across the app for any year-based filtering.
 */

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface YearFilterProps {
  availableYears: string[];
  selectedYear: string;
  onYearChange: (year: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function YearFilter({
  availableYears,
  selectedYear,
  onYearChange,
  label = 'Year:',
  placeholder = 'Select year',
  className = 'w-[180px]',
  id = 'year-filter'
}: YearFilterProps) {
  return (
    <div className="flex items-center gap-3">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <Select value={selectedYear} onValueChange={onYearChange}>
        <SelectTrigger id={id} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {availableYears.map((year) => (
            <SelectItem key={year} value={year}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Utility function to generate year range
export function generateYearRange(startYear: number, endYear: number): string[] {
  const years: string[] = [];
  for (let year = endYear; year >= startYear; year--) {
    years.push(String(year));
  }
  return years;
}

// Default year ranges for common use cases
export const DEFAULT_IPO_YEARS = generateYearRange(2020, 2026);
export const CURRENT_YEAR = new Date().getFullYear().toString();
