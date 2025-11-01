'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HiTag } from 'react-icons/hi2';

interface CategoryFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Category filter dropdown with 6 options:
 * ALL, MAINBOARD, SME, RIGHTS, NCD, FPO
 */
export function CategoryFilter({ value, onChange }: CategoryFilterProps) {
  return (
    <div className="w-full lg:w-auto">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="w-full lg:w-[180px] transition-all duration-200 hover:border-primary hover:bg-muted/50"
          aria-label="Filter IPOs by category (Mainboard, SME, Rights, NCD, FPO)"
        >
          <HiTag className="mr-2 h-4 w-4 transition-colors duration-200 group-hover:text-primary" />
          <SelectValue placeholder="Filter by category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Categories</SelectItem>
          <SelectItem value="MAINBOARD">Mainboard</SelectItem>
          <SelectItem value="SME">SME</SelectItem>
          <SelectItem value="RIGHTS">Rights</SelectItem>
          <SelectItem value="NCD">NCD</SelectItem>
          <SelectItem value="FPO">FPO</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
