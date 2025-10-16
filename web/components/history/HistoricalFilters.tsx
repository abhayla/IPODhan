'use client';

/**
 * Historical Filters Component
 *
 * Provides filtering controls for historical IPOs
 * Desktop: Renders as left sidebar
 * Mobile: Renders as drawer/sheet triggered by button
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Filter, X } from 'lucide-react';
import { useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';
import {
  YEAR_OPTIONS,
  SECTOR_OPTIONS,
  PERFORMANCE_OPTIONS,
} from '@/lib/types/historical-filters';

export function HistoricalFilters() {
  const {
    filters,
    setYear,
    setSector,
    setPerformance,
    clearFilters,
    hasActiveFilters,
  } = useHistoricalFilters();

  const [isOpen, setIsOpen] = useState(false);

  const FilterContent = () => (
    <div className="space-y-6">
      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <div className="pb-4 border-b">
          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="w-full"
          >
            <X className="h-4 w-4 mr-2" />
            Clear All Filters
          </Button>
        </div>
      )}

      {/* Year Filter */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">Year</Label>
        <div className="space-y-2">
          {YEAR_OPTIONS.map((year) => (
            <div key={year} className="flex items-center space-x-2">
              <Checkbox
                id={`year-${year}`}
                checked={filters.year === year}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setYear(year);
                  }
                }}
              />
              <Label
                htmlFor={`year-${year}`}
                className="text-sm font-normal cursor-pointer"
              >
                {year}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Sector Filter */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">Sector</Label>
        <div className="space-y-2">
          {SECTOR_OPTIONS.map((sector) => (
            <div key={sector} className="flex items-center space-x-2">
              <Checkbox
                id={`sector-${sector}`}
                checked={filters.sector === sector}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSector(sector);
                  }
                }}
              />
              <Label
                htmlFor={`sector-${sector}`}
                className="text-sm font-normal cursor-pointer"
              >
                {sector}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Performance Filter */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">Listing Performance</Label>
        <RadioGroup
          value={filters.performance}
          onValueChange={(value) =>
            setPerformance(value as 'All' | 'Positive' | 'Negative')
          }
        >
          {PERFORMANCE_OPTIONS.map((option) => (
            <div key={option.value} className="flex items-center space-x-2">
              <RadioGroupItem value={option.value} id={`perf-${option.value}`} />
              <Label
                htmlFor={`perf-${option.value}`}
                className="text-sm font-normal cursor-pointer"
              >
                {option.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: Sheet/Drawer */}
      <div className="lg:hidden">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full sm:w-auto">
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {hasActiveFilters && (
                <span className="ml-2 bg-blue-500 text-white text-xs rounded-full px-2 py-0.5">
                  Active
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] sm:w-[400px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter Historical IPOs</SheetTitle>
              <SheetDescription>
                Refine your search by year, sector, and performance
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <FilterContent />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: Sidebar */}
      <div className="hidden lg:block w-64 border-r pr-6 shrink-0">
        <div className="sticky top-4">
          <h2 className="text-lg font-semibold mb-6">Filters</h2>
          <FilterContent />
        </div>
      </div>
    </>
  );
}
