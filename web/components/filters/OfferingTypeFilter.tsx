'use client';

import { useState, useRef, useEffect } from 'react';
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
 * Native HTML implementation (replaces Radix UI to fix webpack errors)
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
      <button
        type="button"
        className="w-full lg:w-[200px] h-12 px-4 rounded-md border border-input bg-background text-sm transition-all duration-200 hover:border-primary hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 flex items-center justify-between cursor-pointer"
        aria-label="Filter IPOs by offering type"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span>{displayText}</span>
        </span>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && selectedCount < OFFERING_TYPES.length && (
            <span className="inline-flex items-center justify-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {selectedCount}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-[240px] rounded-md border border-input bg-background p-4 shadow-lg">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Offering Type</h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md hover:bg-muted transition-colors"
                  onClick={handleSelectAll}
                >
                  All
                </button>
                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md hover:bg-muted transition-colors"
                  onClick={handleClearAll}
                >
                  None
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {OFFERING_TYPES.map((type) => (
                <div key={type.value} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id={`offering-${type.value}`}
                    checked={value.includes(type.value)}
                    onChange={() => handleToggle(type.value)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer"
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
