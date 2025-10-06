'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tag } from 'lucide-react';

interface CategoryFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Category filter dropdown with 5 options:
 * ALL, MAINBOARD, SME, RIGHTS, NCD
 */
export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  return (
    <div className="w-full lg:w-auto">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="w-full lg:w-[180px]"
          aria-label="Filter by category"
        >
          <Tag className="mr-2 h-4 w-4" />
          <SelectValue placeholder="Filter by category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Categories</SelectItem>
          <SelectItem value="MAINBOARD">Mainboard</SelectItem>
          <SelectItem value="SME">SME</SelectItem>
          <SelectItem value="RIGHTS">Rights</SelectItem>
          <SelectItem value="NCD">NCD</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
