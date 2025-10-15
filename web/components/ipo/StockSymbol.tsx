import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface StockSymbolProps {
  symbol: string | null | undefined;
  exchange?: 'NSE' | 'BSE' | 'BOTH';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Stock Symbol Display Component
 *
 * Displays the stock ticker symbol for an IPO.
 * Handles null symbols (upcoming IPOs may not have symbols yet).
 *
 * @param symbol - Stock ticker symbol (e.g., "RELIANCE")
 * @param exchange - Exchange where stock is listed (NSE, BSE, or BOTH)
 * @param className - Additional CSS classes
 * @param size - Badge size (sm, md, lg)
 */
export function StockSymbol({
  symbol,
  exchange = 'NSE',
  className,
  size = 'md'
}: StockSymbolProps) {
  // Handle null/undefined symbol (upcoming IPOs may not have symbols yet)
  if (!symbol) {
    return (
      <Badge
        variant="outline"
        className={cn('font-mono text-muted-foreground', className)}
      >
        TBD
      </Badge>
    );
  }

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-0.5',
    lg: 'text-base px-3 py-1',
  };

  // Display symbol with exchange
  const displayText = exchange === 'BOTH'
    ? `${symbol} (NSE/BSE)`
    : `${symbol} (${exchange})`;

  return (
    <Badge
      variant="secondary"
      className={cn(
        'font-mono',
        sizeClasses[size],
        className
      )}
    >
      {displayText}
    </Badge>
  );
}
