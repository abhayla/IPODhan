'use client';

/**
 * Enhanced Generic Data Table Component
 *
 * Reusable table component with optional advanced features:
 * - Sorting (always available)
 * - Column-level search (optional)
 * - Year filter (optional)
 * - Pagination (optional)
 * - Minimize/Maximize toggle (optional)
 *
 * Can be used across the app for displaying tabular data with flexible feature configuration.
 */

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ===== TYPE DEFINITIONS =====

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  searchable?: boolean;
  className?: string;
  render?: (value: any, row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  minWidth?: string;
  /** Hide this column below md — mobile shows only priority columns instead of
      a desktop table crushed to micro-text (2026-07-02 blind review). */
  mobileHidden?: boolean;
}

interface YearFilterConfig {
  availableYears?: string[];
  selectedYear?: string;
  onYearChange?: (year: string) => void;
}

interface PaginationConfig {
  pageSize?: number;
  currentPage?: number;
  totalRecords?: number;
  onPageChange?: (page: number) => void;
}

interface ColumnSearchConfig {
  onSearch?: (searches: Record<string, string>) => void;
  currentSearches?: Record<string, string>;
}

interface DataTableProps<T> {
  // ===== BASIC PROPS (ALWAYS REQUIRED) =====
  data: T[];
  columns: ColumnDef<T>[];

  // ===== OPTIONAL CORE PROPS =====
  emptyMessage?: string;
  keyExtractor?: (row: T) => string | number;
  className?: string;
  /** Full-row click (reference-table behavior) — e.g. navigate to detail. */
  onRowClick?: (row: T) => void;

  // ===== SORTING (ALWAYS ENABLED) =====
  onSort?: (field: string, order: 'asc' | 'desc') => void;
  currentSort?: { field: string; order: 'asc' | 'desc' };

  // ===== OPTIONAL ADVANCED FEATURES =====
  enableColumnSearch?: boolean;
  enableYearFilter?: boolean;
  enablePagination?: boolean;
  enableMinimizeToggle?: boolean;

  // ===== FEATURE CONFIGURATION =====
  yearFilterConfig?: YearFilterConfig;
  paginationConfig?: PaginationConfig;
  columnSearchConfig?: ColumnSearchConfig;
}

// ===== DEFAULT YEAR RANGE =====
// T-286 (P3-5): DERIVED from the current date, not a hardcoded literal that
// silently stops covering new years (the array used to end at 2026 -- a
// "2027 time bomb": on 2027-01-01 every table using it would lose the
// ability to filter to the new year until someone remembered to bump this
// array by hand). `generateYearRange` is a function declaration (hoisted),
// so this reference above its definition below is safe.
const DEFAULT_IPO_YEARS_START_YEAR = 2020;
const DEFAULT_IPO_YEARS = generateYearRange(DEFAULT_IPO_YEARS_START_YEAR, new Date().getFullYear());

// ===== MAIN COMPONENT =====

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  onSort,
  currentSort,
  emptyMessage = 'No data found',
  keyExtractor = (row) => row.id,
  className,
  onRowClick,
  enableColumnSearch = false,
  enableYearFilter = false,
  enablePagination = false,
  enableMinimizeToggle = false,
  yearFilterConfig,
  paginationConfig,
  columnSearchConfig,
}: DataTableProps<T>) {
  // ===== STATE MANAGEMENT =====

  // Sorting state
  const [sortField, setSortField] = useState(currentSort?.field || '');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(currentSort?.order || 'desc');

  // Column search state
  const [columnSearches, setColumnSearches] = useState<Record<string, string>>(
    columnSearchConfig?.currentSearches || {}
  );

  // Minimize/Maximize state
  const [isMinimized, setIsMinimized] = useState(false);

  // Pagination state
  const pageSize = paginationConfig?.pageSize || 50;
  const currentPage = paginationConfig?.currentPage || 1;
  const totalRecords = paginationConfig?.totalRecords || data.length;

  // ===== HANDLERS =====

  const handleSort = (field: string) => {
    const newOrder = sortField === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSortField(field);
    setSortOrder(newOrder);
    onSort?.(field, newOrder);
  };

  const handleColumnSearch = (columnKey: string, value: string) => {
    const newSearches = { ...columnSearches, [columnKey]: value };
    setColumnSearches(newSearches);
    columnSearchConfig?.onSearch?.(newSearches);
  };

  const handleClearSearch = (columnKey: string) => {
    const newSearches = { ...columnSearches };
    delete newSearches[columnKey];
    setColumnSearches(newSearches);
    columnSearchConfig?.onSearch?.(newSearches);
  };

  const handleClearAllSearches = () => {
    setColumnSearches({});
    columnSearchConfig?.onSearch?.({});
  };

  // ===== PAGINATION CALCULATIONS =====

  const totalPages = enablePagination ? Math.ceil(totalRecords / pageSize) : 1;
  const startRecord = enablePagination ? (currentPage - 1) * pageSize + 1 : 1;
  const endRecord = enablePagination ? Math.min(currentPage * pageSize, totalRecords) : totalRecords;

  const displayData = useMemo(() => {
    if (!enablePagination) return data;
    const start = (currentPage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, currentPage, pageSize, enablePagination]);

  // ===== RENDER HELPERS =====

  const SortIcon = ({ field }: { field: string }) => {
    // Inactive: dim. Active: a dark caret that pops on the light Screener-style
    // header so the sorted column is unmistakable (R14 active-sort-clarity gap).
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortOrder === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-gray-800" />
    ) : (
      <ArrowDown className="h-3 w-3 text-gray-800" />
    );
  };

  // T-286 (P1-1/P2-1): the empty-state early-return used to bail out BEFORE
  // the top controls bar (including the year filter) ever rendered, so a
  // user landing on a year with zero rows had no way to change the year --
  // an unrecoverable dead end. `isEmpty` now only decides what renders in
  // place of the table body; the controls bar always renders below.
  const isEmpty = data.length === 0;

  // ===== MINIMIZED STATE =====

  if (enableMinimizeToggle && isMinimized) {
    return (
      <div className="border rounded-lg p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2"
        >
          <ChevronDown className="h-4 w-4" />
          <span>Show Table ({totalRecords} records)</span>
        </Button>
      </div>
    );
  }

  // ===== MAIN RENDER =====

  return (
    <div className={cn('space-y-4', className)}>
      {/* ===== TOP CONTROLS BAR ===== */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Year Filter */}
        {enableYearFilter && yearFilterConfig && (
          <div className="flex items-center gap-2">
            <label htmlFor="year-filter" className="text-sm font-medium">
              Year:
            </label>
            <Select
              value={yearFilterConfig.selectedYear}
              onValueChange={yearFilterConfig.onYearChange}
            >
              <SelectTrigger id="year-filter" className="w-[180px]">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {(yearFilterConfig.availableYears || DEFAULT_IPO_YEARS).map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Clear All Searches */}
        {enableColumnSearch && Object.keys(columnSearches).length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAllSearches}
            className="ml-auto"
          >
            <X className="h-4 w-4 mr-2" />
            Clear All Filters
          </Button>
        )}

        {/* Minimize Toggle */}
        {enableMinimizeToggle && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMinimized(true)}
            className="ml-auto"
          >
            <ChevronUp className="h-4 w-4 mr-2" />
            Minimize
          </Button>
        )}

        {/* Total Records Count */}
        {enablePagination && totalRecords > 0 && (
          <div className="text-sm text-gray-600 ml-auto">
            Showing {startRecord}-{endRecord} of {totalRecords} records
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">{emptyMessage}</p>
        </div>
      ) : (
        <>
      {/* ===== TABLE ===== */}
      <div className="relative border rounded-lg overflow-hidden">
        {/* Right-edge shadow — a DARK gradient (not white-on-white, which was
            invisible) reads as depth = 'more columns →' on mobile scroll (R29 #1). */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-30 w-8 bg-gradient-to-l from-black/25 via-black/[0.06] to-transparent md:hidden" />
        <div className="overflow-x-auto">
          {/* Compact "data terminal" rhythm — tighter than the default h-10/p-2 */}
          <Table className="[&_td]:py-1.5 [&_th]:h-9">

            <TableHeader>
              {/* Header Row — quiet Screener/Levels surface: light bg, hairline
                  bottom rule, uppercase tracked gray labels (R16 #1, the ceiling lever) */}
              <TableRow className="border-0 bg-gray-50 hover:bg-gray-50">
                {columns.map((column, colIndex) => (
                  <TableHead
                    key={column.key}
                    style={column.minWidth ? { minWidth: column.minWidth } : undefined}
                    className={cn(
                      'whitespace-nowrap border-b border-border text-[11px] font-medium uppercase tracking-wider text-gray-500',
                      column.className,
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.mobileHidden && 'hidden md:table-cell',
                      // first column stays visible while the table scrolls horizontally
                      colIndex === 0 && 'sticky left-0 z-20 bg-inherit border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]'
                    )}
                  >
                    {column.sortable !== false ? (
                      <button
                        onClick={() => handleSort(column.key)}
                        className={cn(
                          'flex items-center gap-1.5 uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-800',
                          column.align === 'right' && 'ml-auto',
                          column.align === 'center' && 'mx-auto'
                        )}
                      >
                        {column.header} <SortIcon field={column.key} />
                      </button>
                    ) : (
                      <span className="uppercase tracking-wider text-gray-500">{column.header}</span>
                    )}
                  </TableHead>
                ))}
              </TableRow>

              {/* Column Search Row */}
              {enableColumnSearch && (
                <TableRow className="bg-gray-50">
                  {columns.map((column) => (
                    <TableHead
                      key={`search-${column.key}`}
                      className={cn('py-2', column.mobileHidden && 'hidden md:table-cell')}
                    >
                      {column.searchable !== false ? (
                        <div className="flex items-center gap-1">
                          <Input
                            type="text"
                            placeholder={`Search ${column.header}...`}
                            value={columnSearches[column.key] || ''}
                            onChange={(e) => handleColumnSearch(column.key, e.target.value)}
                            className="h-8 text-xs"
                          />
                          {columnSearches[column.key] && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleClearSearch(column.key)}
                              className="h-8 w-8 p-0"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="h-8" /> // Spacer for non-searchable columns
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              )}
            </TableHeader>

            <TableBody>
              {displayData.map((row, rowIndex) => (
                <TableRow
                  key={keyExtractor(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'hover:bg-primary/5',
                    onRowClick && 'cursor-pointer',
                    rowIndex % 2 === 1 && 'bg-[#FAFBFC]'
                  )}
                >
                  {columns.map((column, colIndex) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        'whitespace-nowrap',
                        column.className,
                        // Right-aligned columns are numeric → monospaced figures so
                        // decimals/₹ align down the column (R18 #5, Levels-grade).
                        column.align === 'right' && 'text-right tabular-nums',
                        column.align === 'center' && 'text-center',
                        column.mobileHidden && 'hidden md:table-cell',
                        colIndex === 0 &&
                          'sticky left-0 z-10 bg-inherit border-r shadow-[3px_0_5px_-2px_rgba(0,0,0,0.12)] max-w-[144px] overflow-hidden text-ellipsis whitespace-nowrap sm:max-w-[240px] md:max-w-[320px]'
                      )}
                    >
                      {column.render ? column.render(row[column.key], row) : row[column.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ===== PAGINATION ===== */}
      {enablePagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => paginationConfig?.onPageChange?.(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            {/* Page Numbers — hidden on mobile (Prev/Next + 'Page X of Y' suffice;
                5 numbered buttons overflow a 390px row) — R27 #6 */}
            <div className="hidden items-center gap-1 sm:flex">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => paginationConfig?.onPageChange?.(pageNum)}
                    className="w-9"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => paginationConfig?.onPageChange?.(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

// ===== COMMON RENDER FUNCTIONS =====

export const renderFunctions = {
  // Format date
  date: (date: string | null, format = 'MMM dd, yyyy') => {
    if (!date) return '-';
    try {
      const { format: formatDate } = require('date-fns');
      return formatDate(new Date(date), format);
    } catch {
      return '-';
    }
  },

  // Format number with Indian locale
  number: (num: number | null) => {
    if (num === null || num === undefined) return '-';
    return new Intl.NumberFormat('en-IN').format(num);
  },

  // Format currency
  currency: (num: number | null, symbol = '₹') => {
    if (num === null || num === undefined) return '-';
    return `${symbol}${new Intl.NumberFormat('en-IN').format(num)}`;
  },

  // Format percentage with color
  percentWithColor: (percent: number | null) => {
    if (percent === null || percent === undefined) return '-';
    const isPositive = percent >= 0;
    return (
      <span className={isPositive ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
        {isPositive ? '+' : ''}
        {percent.toFixed(2)}%
      </span>
    );
  },

  // Format subscription multiplier
  subscription: (value: number | null) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}x`;
  },

  // Render link
  link: (text: string, href: string, className?: string) => {
    return (
      <Link href={href} className={cn('text-primary hover:underline', className)}>
        {text}
      </Link>
    );
  },
};

// ===== UTILITY: Generate Year Range =====
export function generateYearRange(startYear: number, endYear: number): string[] {
  const years: string[] = [];
  for (let year = startYear; year <= endYear; year++) {
    years.push(year.toString());
  }
  return years;
}

/**
 * T-286 (P1-1/P2-1): derive the year filter's DEFAULT selection from the
 * data itself -- the latest year that actually HAS rows -- instead of a
 * hardcoded literal (`useState('2025')`) that silently hides every later
 * year's rows (7 NCDs, 6 rights issues, 14 OFS entries were invisible on
 * first paint because 2026 rows existed but the default filter was '2025').
 * Falls back to the current calendar year when `data` is empty or every row
 * has a null/unparseable date -- the only sane default with no rows to learn
 * a year from.
 */
export function getLatestYearWithData<T>(
  data: T[],
  dateExtractor: (item: T) => string | null | undefined
): string {
  let latestYear: number | null = null;

  for (const item of data) {
    const date = dateExtractor(item);
    if (!date) continue;
    const year = new Date(date).getFullYear();
    if (!Number.isFinite(year)) continue;
    if (latestYear === null || year > latestYear) {
      latestYear = year;
    }
  }

  return (latestYear ?? new Date().getFullYear()).toString();
}

// ===== CONSTANTS =====
export const DEFAULT_IPO_YEARS_EXPORT = DEFAULT_IPO_YEARS;
export const CURRENT_YEAR = new Date().getFullYear().toString();
