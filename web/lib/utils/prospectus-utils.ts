/**
 * Prospectus Utility Functions
 *
 * Shared utility functions for prospectus-related operations.
 * These are safe to import in both server and client components.
 */

/**
 * Format exchange array to display string
 * @param exchanges - Array of exchanges
 * @returns Formatted string ('BSE', 'NSE', 'Both', or '-')
 */
export function formatExchanges(exchanges: ('NSE' | 'BSE')[] | null): string {
  if (!exchanges || exchanges.length === 0) return '-';
  if (exchanges.length === 2) return 'Both';
  return exchanges[0];
}
