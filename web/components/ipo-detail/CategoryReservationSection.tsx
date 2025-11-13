/**
 * Category Reservation Section
 * Story 11.15: Share Allocation by Investor Category
 *
 * Displays the category-wise reservation of shares including:
 * - QIB, NII, Retail, Employee (optional), HiAnchor (optional)
 * - Reservation percentage
 * - Shares offered
 * - Maximum allottees (for retail)
 *
 * @component
 * @param {Object} reservationData - Reservation data from ipo_details table
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, PieChart } from 'lucide-react';

interface CategoryReservationData {
  qibSharesOffered: number | null;
  niiSharesOffered: number | null;
  retailSharesOffered: number | null;
  retailMaxAllottees: number | null;
  employeeSharesOffered: number | null;
  anchorSharesOffered: number | null;
}

interface CategoryReservationSectionProps {
  reservationData: CategoryReservationData | null;
}

/**
 * Category definition for table display
 */
interface Category {
  name: string;
  sharesOffered: number;
  maxAllottees?: number;
  description: string;
}

/**
 * Format number with commas (Indian numbering system)
 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

/**
 * Calculate percentage of total
 */
function calculatePercentage(shares: number, total: number): string {
  if (total === 0) return '0.00%';
  return `${((shares / total) * 100).toFixed(2)}%`;
}

export function CategoryReservationSection({ reservationData }: CategoryReservationSectionProps) {
  // Don't render if no reservation data
  if (!reservationData) {
    return null;
  }

  // Build categories array based on available data
  const categories: Category[] = [];

  if (reservationData.qibSharesOffered !== null && reservationData.qibSharesOffered > 0) {
    categories.push({
      name: 'Qualified Institutional Buyers (QIB)',
      sharesOffered: reservationData.qibSharesOffered,
      description: 'Institutional investors like mutual funds, insurance companies, banks',
    });
  }

  if (reservationData.niiSharesOffered !== null && reservationData.niiSharesOffered > 0) {
    categories.push({
      name: 'Non-Institutional Investors (NII)',
      sharesOffered: reservationData.niiSharesOffered,
      description: 'HNI investors with application size above ₹2 lakhs',
    });
  }

  if (reservationData.retailSharesOffered !== null && reservationData.retailSharesOffered > 0) {
    categories.push({
      name: 'Retail Individual Investors (RII)',
      sharesOffered: reservationData.retailSharesOffered,
      maxAllottees: reservationData.retailMaxAllottees ?? undefined,
      description: 'Individual investors with application size up to ₹2 lakhs',
    });
  }

  if (reservationData.employeeSharesOffered !== null && reservationData.employeeSharesOffered > 0) {
    categories.push({
      name: 'Employee Reservation',
      sharesOffered: reservationData.employeeSharesOffered,
      description: 'Reserved for company employees',
    });
  }

  if (reservationData.anchorSharesOffered !== null && reservationData.anchorSharesOffered > 0) {
    categories.push({
      name: 'Anchor Investors',
      sharesOffered: reservationData.anchorSharesOffered,
      description: 'Strategic investors allotted shares before IPO opening',
    });
  }

  // Don't render if no categories to display
  if (categories.length === 0) {
    return null;
  }

  // Calculate total shares offered
  const totalSharesOffered = categories.reduce((sum, cat) => sum + cat.sharesOffered, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <PieChart className="h-5 w-5 text-primary" />
          <CardTitle>Category-wise Reservation</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Share allocation across different investor categories
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Total Shares Summary */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-muted-foreground">Total Shares Offered</p>
            </div>
            <p className="text-2xl font-bold text-primary">{formatNumber(totalSharesOffered)}</p>
          </div>

          {/* Category-wise Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="py-3 px-4 text-left font-semibold">Category</th>
                  <th className="py-3 px-4 text-right font-semibold">Reservation %</th>
                  <th className="py-3 px-4 text-right font-semibold">Shares Offered</th>
                  <th className="py-3 px-4 text-right font-semibold">Max Allottees</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium">{category.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{category.description}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-primary">
                      {calculatePercentage(category.sharesOffered, totalSharesOffered)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">
                      {formatNumber(category.sharesOffered)}
                    </td>
                    <td className="py-3 px-4 text-right text-muted-foreground">
                      {category.maxAllottees ? formatNumber(category.maxAllottees) : 'N/A'}
                    </td>
                  </tr>
                ))}

                {/* Total Row */}
                <tr className="border-t-2 bg-muted/30 font-bold">
                  <td className="py-3 px-4">Total</td>
                  <td className="py-3 px-4 text-right text-primary">100.00%</td>
                  <td className="py-3 px-4 text-right">{formatNumber(totalSharesOffered)}</td>
                  <td className="py-3 px-4"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Visual Percentage Bars */}
          <div className="space-y-2">
            <p className="text-sm font-semibold mb-3">Reservation Distribution</p>
            {categories.map((category, index) => {
              const percentage = (category.sharesOffered / totalSharesOffered) * 100;
              return (
                <div key={index}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{category.name}</span>
                    <span className="font-medium">{percentage.toFixed(2)}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary rounded-full h-2 transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Information Note */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> Category-wise reservation is as per SEBI guidelines. QIB portion includes
              anchor investor allocation. Actual allotment may vary based on subscription demand.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
