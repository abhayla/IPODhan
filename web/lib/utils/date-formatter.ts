/**
 * Date Formatting Utilities
 *
 * Standardized date formatting functions for consistent display across the application.
 * Uses Indian timezone (IST) for all date displays.
 *
 * Features:
 * - Consistent date format (DD MMM YYYY)
 * - Accessibility support with full month names in aria-labels
 * - Timezone support (IST)
 * - Null/undefined handling
 */

/**
 * Format IPO date in standard format (DD MMM YYYY)
 * @param date - Date string or Date object or null
 * @param options - Formatting options
 * @returns Formatted date string or fallback
 *
 * @example
 * formatIPODate('2025-10-09') // '09 Oct 2025'
 * formatIPODate(null) // 'TBA'
 * formatIPODate('2025-10-09', { includeTimezone: true }) // '09 Oct 2025 (IST)'
 */
export function formatIPODate(
  date: string | Date | null | undefined,
  options?: {
    includeTimezone?: boolean;
    fallback?: string;
  }
): string {
  if (!date) {
    return options?.fallback || 'TBA';
  }

  try {
    const formatted = new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(date));

    return options?.includeTimezone ? `${formatted} (IST)` : formatted;
  } catch (error) {
    console.error('Error formatting date:', error);
    return options?.fallback || 'Invalid Date';
  }
}

/**
 * Get full date for accessibility (screen readers)
 * @param date - Date string or Date object or null
 * @returns Full date string with complete month name
 *
 * @example
 * getAccessibleDate('2025-10-09') // '9 October 2025'
 */
export function getAccessibleDate(
  date: string | Date | null | undefined
): string {
  if (!date) {
    return 'Date to be announced';
  }

  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(date));
  } catch (error) {
    console.error('Error formatting accessible date:', error);
    return 'Invalid date';
  }
}

/**
 * Get ISO date string for datetime attribute
 * @param date - Date string or Date object or null
 * @returns ISO date string (YYYY-MM-DD) or null
 *
 * @example
 * getISODate('2025-10-09') // '2025-10-09'
 */
export function getISODate(
  date: string | Date | null | undefined
): string | null {
  if (!date) {
    return null;
  }

  try {
    const dateObj = new Date(date);
    return dateObj.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error formatting ISO date:', error);
    return null;
  }
}

/**
 * Format date with full month name for headers/titles
 * @param date - Date string or Date object or null
 * @returns Full date string (DD Month YYYY)
 *
 * @example
 * formatFullDate('2025-10-09') // '09 October 2025'
 */
export function formatFullDate(
  date: string | Date | null | undefined,
  options?: { fallback?: string }
): string {
  if (!date) {
    return options?.fallback || 'TBA';
  }

  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(date));
  } catch (error) {
    console.error('Error formatting full date:', error);
    return options?.fallback || 'Invalid Date';
  }
}

/**
 * Calculate days until a date
 * @param date - Target date
 * @returns Number of days until the date (negative if past)
 *
 * @example
 * getDaysUntil('2025-10-15') // 5 (if today is Oct 10)
 */
export function getDaysUntil(date: string | Date | null | undefined): number | null {
  if (!date) {
    return null;
  }

  try {
    const targetDate = new Date(date);
    const today = new Date();
    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  } catch (error) {
    console.error('Error calculating days until:', error);
    return null;
  }
}

/**
 * Format relative date (e.g., "2 days ago", "in 3 days")
 * @param date - Date to format
 * @returns Relative date string
 *
 * @example
 * formatRelativeDate('2025-10-08') // '2 days ago' (if today is Oct 10)
 */
export function formatRelativeDate(date: string | Date | null | undefined): string {
  if (!date) {
    return 'Unknown';
  }

  try {
    const days = getDaysUntil(date);
    if (days === null) return 'Unknown';

    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 0) return `In ${days} days`;
    return `${Math.abs(days)} days ago`;
  } catch (error) {
    console.error('Error formatting relative date:', error);
    return 'Unknown';
  }
}
