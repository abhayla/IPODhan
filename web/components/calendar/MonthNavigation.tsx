/**
 * Month Navigation Component
 *
 * Client component for navigating between months in the calendar.
 * Features:
 * - Previous/Next month buttons
 * - Month wrapping (Dec → Jan, Jan → Dec)
 * - URL query param updates (?month=10&year=2025)
 * - Keyboard navigation support
 */

'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ==================== TYPES ====================

interface MonthNavigationProps {
  currentMonth: number; // 1-12
  currentYear: number;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate previous month/year with wrapping
 */
function getPreviousMonth(month: number, year: number): { month: number; year: number } {
  if (month === 1) {
    return { month: 12, year: year - 1 };
  }
  return { month: month - 1, year };
}

/**
 * Calculate next month/year with wrapping
 */
function getNextMonth(month: number, year: number): { month: number; year: number } {
  if (month === 12) {
    return { month: 1, year: year + 1 };
  }
  return { month: month + 1, year };
}

/**
 * Format month/year for display
 */
function formatMonthYear(month: number, year: number): string {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ==================== MAIN COMPONENT ====================

/**
 * Month Navigation Component
 *
 * Provides Previous/Next buttons to navigate between months.
 * Updates URL with ?month=X&year=Y query params.
 */
export default function MonthNavigation({
  currentMonth,
  currentYear,
}: MonthNavigationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Navigate to a different month
   */
  const navigateToMonth = (month: number, year: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', month.toString());
    params.set('year', year.toString());

    // Preserve search query if it exists
    const search = searchParams.get('search');
    if (search) {
      params.set('search', search);
    }

    router.push(`${pathname}?${params.toString()}`);
  };

  /**
   * Go to previous month
   */
  const goToPrevious = () => {
    const { month, year } = getPreviousMonth(currentMonth, currentYear);
    navigateToMonth(month, year);
  };

  /**
   * Go to next month
   */
  const goToNext = () => {
    const { month, year } = getNextMonth(currentMonth, currentYear);
    navigateToMonth(month, year);
  };

  const displayMonthYear = formatMonthYear(currentMonth, currentYear);

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      {/* Previous Month Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={goToPrevious}
        aria-label="Previous month"
        className="flex items-center gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Previous</span>
      </Button>

      {/* Current Month/Year Display */}
      <div className="text-lg font-semibold text-gray-800">
        {displayMonthYear}
      </div>

      {/* Next Month Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={goToNext}
        aria-label="Next month"
        className="flex items-center gap-1"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
