'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { FileText, ChevronDown } from 'lucide-react';

interface OfferingTypeFilterProps {
  value: string[]; // Array of selected offering types
  onChange: (value: string[]) => void;
}

const OFFERING_TYPES = [
  { value: 'IPO', label: 'IPO' },
  { value: 'FPO', label: 'FPO' },
  { value: 'RIGHTS', label: 'Rights' },
  { value: 'OFS', label: 'OFS' },
  { value: 'TENDER', label: 'Tender' },
  { value: 'BUYBACK', label: 'Buyback' },
  { value: 'DELISTING', label: 'Delisting' },
  { value: 'NCD', label: 'NCD' },
  { value: 'BONDS', label: 'Bonds' },
];

/**
 * Offering Type multi-select filter with checkboxes
 * Story 11.8: Allows filtering by multiple offering types (IPO, FPO, RIGHTS, etc.)
 * Defaults to ['IPO', 'FPO'] to hide TENDER offers
 */
export function OfferingTypeFilter({ value, onChange }: OfferingTypeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = (offeringType: string) => {
    if (value.includes(offeringType)) {
      // Remove if already selected
      onChange(value.filter(t => t !== offeringType));
    } else {
      // Add if not selected
      onChange([...value, offeringType]);
    }
  };

  const handleSelectAll = () => {
    onChange(OFFERING_TYPES.map(t => t.value));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const selectedCount = value.length;
  const displayText = selectedCount === 0
    ? 'All Offerings'
    : selectedCount === OFFERING_TYPES.length
    ? 'All Offerings'
    : `${selectedCount} selected`;

  return (
    <div className="w-full lg:w-auto relative" ref={dropdownRef}>
      <Button
        variant="outline"
        className="w-full lg:w-[200px] justify-between transition-all duration-200 hover:border-primary hover:bg-muted/50"
        aria-label="Filter IPOs by offering type"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {displayText}
        </span>
        {selectedCount > 0 && selectedCount < OFFERING_TYPES.length && (
          <Badge variant="secondary" className="ml-2">
            {selectedCount}
          </Badge>
        )}
        <ChevronDown className={`ml-2 h-4 w-4 opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </Button>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-[240px] rounded-md border bg-popover p-4 shadow-md">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Offering Type</h4>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleSelectAll}
                >
                  All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleClearAll}
                >
                  None
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {OFFERING_TYPES.map((type) => (
                <div key={type.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`offering-${type.value}`}
                    checked={value.includes(type.value)}
                    onCheckedChange={() => handleToggle(type.value)}
                  />
                  <label
                    htmlFor={`offering-${type.value}`}
                    className="text-sm cursor-pointer flex-1 select-none"
                  >
                    {type.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
