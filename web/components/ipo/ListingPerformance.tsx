'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListingPerformanceBadge } from './ListingPerformanceBadge';
import { SectorAverageComparison } from './SectorAverageComparison';
import { formatCurrency } from '@/lib/utils';

interface ListingPerformanceData {
  issuePrice: number;
  listingPrice: number;
  listingGainPercent: number;
  currentPrice?: number | null;
  currentGainPercent?: number | null;
}

interface ListingPerformanceProps {
  data: ListingPerformanceData;
  sector: string | null;
  sectorAverage: number | null;
  className?: string;
}

/**
 * ListingPerformance Component
 *
 * Displays comprehensive listing day performance including:
 * - Issue price vs listing price
 * - Listing day gain/loss with color coding
 * - Current price and overall gain (if available)
 * - Sector average comparison
 *
 * Only shown for IPOs with listing_date available (LISTED status).
 *
 * @param data - Listing performance data from database
 * @param sector - IPO sector for comparison
 * @param sectorAverage - Sector average listing gain percentage
 * @param className - Additional CSS classes
 */
export function ListingPerformance({
  data,
  sector,
  sectorAverage,
  className,
}: ListingPerformanceProps) {
  const { issuePrice, listingPrice, listingGainPercent, currentPrice, currentGainPercent } = data;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-xl font-bold">Listing Performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Price Details Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Metric</th>
                <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="py-3 px-3 text-muted-foreground">Issue Price</td>
                <td className="py-3 px-3 text-right font-semibold">
                  {formatCurrency(issuePrice)}
                </td>
              </tr>
              <tr>
                <td className="py-3 px-3 text-muted-foreground">Listing Price</td>
                <td className="py-3 px-3 text-right font-semibold">
                  {formatCurrency(listingPrice)}
                </td>
              </tr>
              <tr className="bg-muted/30">
                <td className="py-3 px-3 font-semibold">Listing Day Return</td>
                <td className="py-3 px-3 text-right">
                  <ListingPerformanceBadge listingGainPercent={listingGainPercent} />
                </td>
              </tr>
              {currentPrice !== null && currentPrice !== undefined && (
                <>
                  <tr>
                    <td className="py-3 px-3 text-muted-foreground">Current Price</td>
                    <td className="py-3 px-3 text-right font-semibold">
                      {formatCurrency(currentPrice)}
                    </td>
                  </tr>
                  {currentGainPercent !== null && currentGainPercent !== undefined && (
                    <tr className="bg-muted/30">
                      <td className="py-3 px-3 font-semibold">Overall Return</td>
                      <td className="py-3 px-3 text-right">
                        <ListingPerformanceBadge listingGainPercent={currentGainPercent} />
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Sector Average Comparison */}
        {sector && sectorAverage !== null && (
          <div className="pt-4 border-t">
            <SectorAverageComparison
              listingGainPercent={listingGainPercent}
              sectorAverage={sectorAverage}
              sector={sector}
            />
          </div>
        )}

        {/* Additional Context */}
        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Listing performance is calculated based on the difference between the issue price and
            the listing day opening price. Returns are indicative and subject to market conditions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
