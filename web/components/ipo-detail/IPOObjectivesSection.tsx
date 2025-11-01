/**
 * IPO Objectives Section
 * Story 11.13: IPO Fund Utilization Objectives
 *
 * Displays the breakdown of how IPO funds will be utilized by the company
 * including specific objectives with allocated amounts.
 *
 * @component
 * @param {Array} objectives - Array of objectives with sno, description, amount
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HiCursorArrowRays, HiInformationCircle } from 'react-icons/hi2';

export interface IPOObjective {
  sno: number;                  // Serial number (1, 2, 3...)
  description: string;          // Objective description
  amount: number | null;        // Amount in crores (null for unallocated)
}

interface IPOObjectivesSectionProps {
  objectives: IPOObjective[] | null;
  totalIssueSize?: number;  // For validation (optional)
}

/**
 * Format currency in ₹ Crores
 */
function formatCurrency(value: number): string {
  return `₹${value.toFixed(2)} Cr`;
}

/**
 * Format amount with null handling
 */
function formatAmount(amount: number | null): string {
  if (amount === null) {
    return '—';
  }
  return formatCurrency(amount);
}

export function IPOObjectivesSection({ objectives, totalIssueSize }: IPOObjectivesSectionProps) {
  // Empty state with message
  if (!objectives || objectives.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <HiCursorArrowRays className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Objects of the Issue</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-6 bg-muted/30 rounded-lg border border-dashed">
            <HiInformationCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                IPO objectives not available
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Fund utilization details will be available after DRHP filing
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate total allocated (exclude null amounts)
  const totalAllocated = objectives
    .filter(obj => obj.amount !== null)
    .reduce((sum, obj) => sum + (obj.amount || 0), 0);

  // Sort objectives by serial number
  const sortedObjectives = [...objectives].sort((a, b) => a.sno - b.sno);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <HiCursorArrowRays className="h-5 w-5 text-primary" />
          <CardTitle>Objects of the Issue</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Breakdown of how the IPO proceeds will be utilized
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Objectives Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="py-3 px-4 text-left font-semibold w-20">S.No</th>
                  <th className="py-3 px-4 text-left font-semibold">Description</th>
                  <th className="py-3 px-4 text-right font-semibold w-40">Amount</th>
                </tr>
              </thead>
              <tbody>
                {sortedObjectives.map((objective) => (
                  <tr key={objective.sno} className="border-b last:border-0">
                    <td className="py-3 px-4 text-center font-medium">{objective.sno}</td>
                    <td className="py-3 px-4">{objective.description}</td>
                    <td className="py-3 px-4 text-right font-semibold">
                      {formatAmount(objective.amount)}
                    </td>
                  </tr>
                ))}

                {/* Total Row */}
                <tr className="border-t-2 bg-muted/30 font-bold">
                  <td className="py-3 px-4"></td>
                  <td className="py-3 px-4">Total Allocated</td>
                  <td className="py-3 px-4 text-right text-primary">
                    {formatCurrency(totalAllocated)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Information Note */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> All amounts are in ₹ Crores. The objects of the issue represent
              the intended use of funds raised through the IPO as disclosed in the company's prospectus.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
