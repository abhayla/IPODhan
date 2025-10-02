import React from 'react';
import type { SearchFilters, ScoreRange } from '@/types/ipo';

export interface FiltersBarProps {
  filters: SearchFilters;
  onFilterChange: (filters: Partial<SearchFilters>) => void;
  onClearFilters: () => void;
}

/**
 * FiltersBar Component
 * Filter controls for IPO list
 */
export const FiltersBar: React.FC<FiltersBarProps> = ({
  filters,
  onFilterChange,
  onClearFilters,
}) => {
  const scoreRanges: Array<{ label: string; value: ScoreRange }> = [
    { label: '70+ (Strong Buy)', value: '70+' },
    { label: '50-70 (Consider)', value: '50-70' },
    { label: '30-50 (Risky)', value: '30-50' },
    { label: '<30 (Avoid)', value: '<30' },
  ];

  const categories = [
    { label: 'All', value: null },
    { label: 'Mainboard', value: 'MAINBOARD' },
    { label: 'SME', value: 'SME' },
  ];

  const issueSizes = [
    { label: 'All Sizes', min: undefined, max: undefined },
    { label: '<100 Cr', min: undefined, max: 1000000000 },
    { label: '100-500 Cr', min: 1000000000, max: 5000000000 },
    { label: '>500 Cr', min: 5000000000, max: undefined },
  ];

  const handleScoreRangeChange = (range: ScoreRange) => {
    let min = 0,
      max = 100;
    switch (range) {
      case '70+':
        min = 70;
        max = 100;
        break;
      case '50-70':
        min = 50;
        max = 70;
        break;
      case '30-50':
        min = 30;
        max = 50;
        break;
      case '<30':
        min = 0;
        max = 30;
        break;
    }
    onFilterChange({ scoreRange: { min, max } });
  };

  const hasActiveFilters =
    filters.scoreRange || filters.category || filters.sector || filters.issueSize;

  return (
    <div
      className="bg-white border-b border-gray-200 sticky top-0 z-10"
      role="region"
      aria-label="Filter controls"
    >
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Mobile: Horizontal scroll */}
        <div className="overflow-x-auto pb-2 -mx-4 px-4 md:overflow-visible md:pb-0 md:mx-0 md:px-0">
          <div className="flex gap-4 min-w-max md:min-w-0 md:grid md:grid-cols-4 md:gap-4">
            {/* Score Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Score Range
              </label>
              <select
                className="w-full md:w-auto px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                onChange={e => handleScoreRangeChange(e.target.value as ScoreRange)}
                aria-label="Filter by score range"
              >
                <option value="">All Scores</option>
                {scoreRanges.map(range => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select
                className="w-full md:w-auto px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                value={filters.category || ''}
                onChange={e =>
                  onFilterChange({
                    category: e.target.value ? (e.target.value as any) : null,
                  })
                }
                aria-label="Filter by category"
              >
                {categories.map(cat => (
                  <option key={cat.label} value={cat.value || ''}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Sector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sector</label>
              <input
                type="text"
                placeholder="e.g., Technology"
                className="w-full md:w-auto px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={filters.sector || ''}
                onChange={e => onFilterChange({ sector: e.target.value || undefined })}
                aria-label="Filter by sector"
              />
            </div>

            {/* Issue Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Issue Size
              </label>
              <select
                className="w-full md:w-auto px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                onChange={e => {
                  const size = issueSizes.find(s => s.label === e.target.value);
                  onFilterChange({
                    issueSize: size ? { min: size.min, max: size.max } : undefined,
                  });
                }}
                aria-label="Filter by issue size"
              >
                {issueSizes.map(size => (
                  <option key={size.label} value={size.label}>
                    {size.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
