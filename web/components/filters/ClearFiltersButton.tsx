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
      className="w-full lg:w-auto"
      aria-label="Clear all filters"
    >
      <X className="mr-2 h-4 w-4" />
      Clear Filters
    </Button>
  );
}
