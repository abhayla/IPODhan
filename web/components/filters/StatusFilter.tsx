'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Filter } from 'lucide-react';

interface StatusFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Status filter dropdown with 5 options:
 * ALL, UPCOMING, OPEN, CLOSED, LISTED
 */
export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <div className="w-full lg:w-auto">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="w-full lg:w-[180px]"
          aria-label="Filter by status"
        >
          <Filter className="mr-2 h-4 w-4" />
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Statuses</SelectItem>
          <SelectItem value="UPCOMING">Upcoming</SelectItem>
          <SelectItem value="OPEN">Open</SelectItem>
          <SelectItem value="CLOSED">Closed</SelectItem>
          <SelectItem value="LISTED">Listed</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
