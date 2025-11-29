/**
 * ColumnSearch Component
 *
 * Reusable search component for column-level filtering.
 * Supports text input with debouncing and dropdown select.
 *
 * Story 9.8a: Mainboard IPO Prospectus PDF Download Page
 * AC#4, AC#8: Column-level search with 300ms debouncing
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ==================== TYPES ====================

interface ColumnSearchProps {
  type: 'text' | 'select';
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  options?: { label: string; value: string }[];
  debounceMs?: number;
}

// ==================== COMPONENT ====================

/**
 * ColumnSearch Component
 *
 * Provides column-level search functionality with debouncing for text inputs
 * and immediate updates for select dropdowns.
 */
export function ColumnSearch({
  type,
  placeholder = '',
  value,
  onChange,
  options = [],
  debounceMs = 300,
}: ColumnSearchProps) {
  const [localValue, setLocalValue] = useState(value);

  // Store onChange in a ref to prevent dependency changes from triggering re-runs
  // This prevents infinite loops when parent doesn't memoize the callback
  const onChangeRef = useRef(onChange);

  // Keep ref updated with latest callback
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Sync local value with prop value when it changes externally
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced onChange for text inputs (AC#8: 300ms debouncing)
  // Uses ref instead of onChange in dependencies to prevent infinite loops
  useEffect(() => {
    if (type !== 'text') return;

    const timer = setTimeout(() => {
      onChangeRef.current(localValue);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [localValue, debounceMs, type]);

  // Text Input
  if (type === 'text') {
    return (
      <Input
        type="text"
        placeholder={placeholder}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        className="h-10"
      />
    );
  }

  // Select Dropdown
  if (type === 'select') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return null;
}
