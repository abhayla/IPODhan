'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Filter, X } from 'lucide-react';
import { useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';

interface HistoricalFiltersProps {
  availableSectors: string[];
  availableYears: string[];
}

function FiltersContent({ availableSectors, availableYears }: HistoricalFiltersProps) {
  const { filters, setYear, setSector, setPerformance, clearFilters, updateURL } = useHistoricalFilters();
  const [localFilters, setLocalFilters] = useState({
    year: filters.year || 'All',
    sector: filters.sector || 'All',
    performance: filters.performance || 'All',
  });

  // Update local state when filters change
  useEffect(() => {
    setLocalFilters({
      year: filters.year || 'All',
      sector: filters.sector || 'All',
      performance: filters.performance || 'All',
    });
  }, [filters]);

  const handleYearChange = (value: string) => {
    setLocalFilters((prev) => ({ ...prev, year: value }));
    setYear(value === 'All' ? undefined : value);
  };

  const handleSectorChange = (value: string) => {
    setLocalFilters((prev) => ({ ...prev, sector: value }));
    setSector(value === 'All' ? undefined : value);
  };

  const handlePerformanceChange = (value: string) => {
    const perfValue = value as 'Positive' | 'Negative' | 'All';
    setLocalFilters((prev) => ({ ...prev, performance: perfValue }));
    setPerformance(perfValue === 'All' ? undefined : perfValue);
  };

  const handleClearFilters = () => {
    setLocalFilters({ year: 'All', sector: 'All', performance: 'All' });
    clearFilters();
  };

  const hasActiveFilters = localFilters.year !== 'All' || localFilters.sector !== 'All' || localFilters.performance !== 'All';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Filters</h3>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Year Filter */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Year</Label>
        <Select value={localFilters.year} onValueChange={handleYearChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Years</SelectItem>
            {availableYears.map((year) => (
              <SelectItem key={year} value={year}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sector Filter */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Sector</Label>
        <Select value={localFilters.sector} onValueChange={handleSectorChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Sectors</SelectItem>
            {availableSectors.map((sector) => (
              <SelectItem key={sector} value={sector}>
                {sector}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Listing Performance Filter */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Listing Performance</Label>
        <RadioGroup value={localFilters.performance} onValueChange={handlePerformanceChange}>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="All" id="perf-all" />
            <Label htmlFor="perf-all" className="font-normal cursor-pointer">
              All
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="Positive" id="perf-positive" />
            <Label htmlFor="perf-positive" className="font-normal cursor-pointer">
              Positive Gains
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="Negative" id="perf-negative" />
            <Label htmlFor="perf-negative" className="font-normal cursor-pointer">
              Negative Gains
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Apply button (visible on mobile only) */}
      <Button onClick={updateURL} className="w-full md:hidden">
        Apply Filters
      </Button>
    </div>
  );
}

export function HistoricalFilters({ availableSectors, availableYears }: HistoricalFiltersProps) {
  const { updateURL } = useHistoricalFilters();

  // Auto-update URL on filter changes (desktop)
  useEffect(() => {
    const timer = setTimeout(() => {
      updateURL();
    }, 300);

    return () => clearTimeout(timer);
  }, [updateURL]);

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:block w-64 flex-shrink-0">
        <div className="sticky top-6 bg-background border rounded-lg p-6">
          <FiltersContent availableSectors={availableSectors} availableYears={availableYears} />
        </div>
      </div>

      {/* Mobile Drawer */}
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] sm:w-[400px]">
            <SheetHeader>
              <SheetTitle>Filter Historical IPOs</SheetTitle>
            </SheetHeader>
            <div className="mt-6">
              <FiltersContent availableSectors={availableSectors} availableYears={availableYears} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
