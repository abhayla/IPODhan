'use client';

import { HiBuildingOffice2 } from 'react-icons/hi2';

interface SegmentFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Segment filter dropdown: ALL, MAINBOARD, SME
 * Story 11.8: Segment represents the listing platform (Main Board vs SME)
 * Native select implementation (replaces Radix UI to fix webpack errors)
 */
export function SegmentFilter({ value, onChange }: SegmentFilterProps) {
  return (
    <div className="w-full lg:w-auto">
      <div className="relative">
        <HiBuildingOffice2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full lg:w-[180px] h-12 pl-10 pr-10 rounded-md border border-input bg-background text-sm transition-all duration-200 hover:border-primary hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 appearance-none cursor-pointer"
          aria-label="Filter IPOs by segment (Mainboard or SME)"
        >
          <option value="ALL">All Segments</option>
          <option value="MAINBOARD">Mainboard</option>
          <option value="SME">SME</option>
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
