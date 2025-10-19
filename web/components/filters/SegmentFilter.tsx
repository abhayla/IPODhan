'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2 } from 'lucide-react';

interface SegmentFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Segment filter dropdown: ALL, MAINBOARD, SME
 * Story 11.8: Segment represents the listing platform (Main Board vs SME)
 */
export function SegmentFilter({ value, onChange }: SegmentFilterProps) {
  return (
    <div className="w-full lg:w-auto">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="w-full lg:w-[180px] transition-all duration-200 hover:border-primary hover:bg-muted/50"
          aria-label="Filter IPOs by segment (Mainboard or SME)"
        >
          <Building2 className="mr-2 h-4 w-4 transition-colors duration-200 group-hover:text-primary" />
          <SelectValue placeholder="Filter by segment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Segments</SelectItem>
          <SelectItem value="MAINBOARD">Mainboard</SelectItem>
          <SelectItem value="SME">SME</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
