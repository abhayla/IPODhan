import React from 'react';
import type { SortOption } from '@/types/ipo';

export interface SortSelectorProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
}

/**
 * SortSelector Component
 * Dropdown for sorting IPO list
 */
export const SortSelector: React.FC<SortSelectorProps> = ({ sortBy, onSortChange }) => {
  const sortOptions: Array<{ label: string; value: SortOption }> = [
    { label: 'Highest Score', value: 'score' },
    { label: 'Closing Soon', value: 'closingDate' },
    { label: 'Highest GMP', value: 'gmp' },
    { label: 'Issue Size', value: 'size' },
  ];

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort-select" className="text-sm font-medium text-gray-700">
        Sort by:
      </label>
      <select
        id="sort-select"
        value={sortBy}
        onChange={e => onSortChange(e.target.value as SortOption)}
        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white text-sm"
        aria-label="Sort IPOs"
      >
        {sortOptions.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};
