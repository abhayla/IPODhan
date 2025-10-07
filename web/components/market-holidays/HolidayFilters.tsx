'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';

export interface HolidayFilterState {
  year: number;
  exchange: 'ALL' | 'NSE' | 'BSE';
  upcoming: boolean;
}

interface HolidayFiltersProps {
  filters: HolidayFilterState;
  onFilterChange: (filters: HolidayFilterState) => void;
}

/**
 * HolidayFilters component
 *
 * Provides filtering options for market holidays.
 * Story 5.4: Market Holidays Calendar
 *
 * Features:
 * - Year dropdown: 2024, 2025, 2026 (default: current year)
 * - Exchange filter: All, NSE Only, BSE Only
 * - Upcoming/All toggle switch
 * - Mobile-responsive layout (stacked on mobile, horizontal on desktop)
 */
export function HolidayFilters({ filters, onFilterChange }: HolidayFiltersProps) {
  // Available years (2024-2026)
  const years = [2024, 2025, 2026];

  // Handle year change
  const handleYearChange = (value: string) => {
    onFilterChange({
      ...filters,
      year: parseInt(value),
    });
  };

  // Handle exchange change
  const handleExchangeChange = (value: string) => {
    onFilterChange({
      ...filters,
      exchange: value as 'ALL' | 'NSE' | 'BSE',
    });
  };

  // Handle upcoming toggle
  const handleUpcomingToggle = (checked: boolean) => {
    onFilterChange({
      ...filters,
      upcoming: checked,
    });
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          {/* Year Filter */}
          <div className="flex-1 space-y-2">
            <Label htmlFor="year-filter">Year</Label>
            <Select
              value={filters.year.toString()}
              onValueChange={handleYearChange}
            >
              <SelectTrigger id="year-filter" className="w-full">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Exchange Filter */}
          <div className="flex-1 space-y-2">
            <Label htmlFor="exchange-filter">Exchange</Label>
            <Select
              value={filters.exchange}
              onValueChange={handleExchangeChange}
            >
              <SelectTrigger id="exchange-filter" className="w-full">
                <SelectValue placeholder="Select exchange" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Exchanges</SelectItem>
                <SelectItem value="NSE">NSE Only</SelectItem>
                <SelectItem value="BSE">BSE Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Upcoming Toggle */}
          <div className="flex items-center space-x-2 md:pb-2">
            <Switch
              id="upcoming-toggle"
              checked={filters.upcoming}
              onCheckedChange={handleUpcomingToggle}
            />
            <Label htmlFor="upcoming-toggle" className="cursor-pointer">
              Upcoming only
            </Label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
