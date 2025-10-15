/**
 * Financial Year End Display Component (Story 4.10)
 *
 * Displays the financial year end date in a user-friendly format.
 */

import { Calendar } from 'lucide-react';

interface FinancialYearEndDisplayProps {
  financialYearEnd: string | null;
  className?: string;
}

export function FinancialYearEndDisplay({
  financialYearEnd,
  className = '',
}: FinancialYearEndDisplayProps) {
  if (!financialYearEnd) {
    return null;
  }

  // Parse the date string (expected format: "31-Mar-2024" or "2024-03-31")
  const formatDate = (dateStr: string): string => {
    try {
      // Handle "31-Mar-2024" format
      if (dateStr.includes('-') && dateStr.split('-').length === 3) {
        const parts = dateStr.split('-');
        if (parts[1].length === 3) {
          // Format: "31-Mar-2024"
          const months = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
          ];
          const monthIndex = months.indexOf(parts[1]);
          if (monthIndex !== -1) {
            const monthNames = [
              'January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'
            ];
            return `${monthNames[monthIndex]} ${parts[0]}, ${parts[2]}`;
          }
        }
      }

      // Fallback: try parsing as standard date
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
      }

      // If all else fails, return the original string
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  const formattedDate = formatDate(financialYearEnd);

  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground">FY ending</span>
      <span className="font-medium">{formattedDate}</span>
    </div>
  );
}
