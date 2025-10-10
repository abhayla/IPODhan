'use client';

import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface ClearFiltersButtonProps {
  onClear: () => void;
  disabled: boolean;
}

/**
 * Button to reset all filters to default values
 * Disabled when filters are already at defaults
 */
export function ClearFiltersButton({ onClear, disabled }: ClearFiltersButtonProps) {
  return (
    <Button
      variant="outline"
      onClick={onClear}
      disabled={disabled}
      className="w-full lg:w-auto lg:ml-auto transition-all duration-200 hover:scale-105 hover:border-destructive hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Clear all filters"
    >
      <X className="mr-2 h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
      Clear Filters
    </Button>
  );
}
