/**
 * PromoterHoldingSection Component (Story 11.9)
 * Displays promoter shareholding percentages before and after IPO
 * with equity dilution calculation and visual indicators
 */

'use client';

import { AlertCircle, TrendingDown, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PromoterHoldingSectionProps {
  promoterHoldingPreIssue: number | null;
  promoterHoldingPostIssue: number | null;
}

/**
 * Get color class for dilution percentage
 * Green: < 10% (low dilution)
 * Yellow: 10-20% (moderate dilution)
 * Red: > 20% (high dilution)
 */
function getDilutionColorClass(dilution: number): string {
  if (dilution < 10) {
    return 'text-green-600 dark:text-green-400';
  } else if (dilution <= 20) {
    return 'text-yellow-600 dark:text-yellow-400';
  } else {
    return 'text-red-600 dark:text-red-400';
  }
}

/**
 * Get background color class for dilution percentage
 */
function getDilutionBgClass(dilution: number): string {
  if (dilution < 10) {
    return 'bg-green-50 dark:bg-green-950/20';
  } else if (dilution <= 20) {
    return 'bg-yellow-50 dark:bg-yellow-950/20';
  } else {
    return 'bg-red-50 dark:bg-red-950/20';
  }
}

/**
 * Main Promoter Holding Section Component
 */
export function PromoterHoldingSection({
  promoterHoldingPreIssue,
  promoterHoldingPostIssue,
}: PromoterHoldingSectionProps) {
  // Case 1: Both fields are null - show "not available"
  if (
    promoterHoldingPreIssue === null &&
    promoterHoldingPostIssue === null
  ) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center gap-3 text-center py-6">
            <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Promoter Holding Data Not Available
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Promoter shareholding information is not yet available for this IPO.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate dilution if both values available
  const dilution =
    promoterHoldingPreIssue !== null && promoterHoldingPostIssue !== null
      ? Number((promoterHoldingPreIssue - promoterHoldingPostIssue).toFixed(2))
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle>Promoter Holding Pattern</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Pre-Issue and Post-Issue Holdings */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Pre-Issue Holding */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <p className="text-sm font-medium text-muted-foreground">
                Promoter Holding Pre Issue
              </p>
              {promoterHoldingPreIssue !== null ? (
                <p className="text-2xl font-bold text-foreground">
                  {promoterHoldingPreIssue.toFixed(2)}%
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Pre-IPO data not available
                </p>
              )}
            </div>

            {/* Post-Issue Holding */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <p className="text-sm font-medium text-muted-foreground">
                Promoter Holding Post Issue
              </p>
              {promoterHoldingPostIssue !== null ? (
                <p className="text-2xl font-bold text-foreground">
                  {promoterHoldingPostIssue.toFixed(2)}%
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Post-IPO data not available yet
                </p>
              )}
            </div>
          </div>

          {/* Equity Dilution Section (only if both values available) */}
          {dilution !== null && (
            <div
              className={`p-4 rounded-lg border ${getDilutionBgClass(dilution)}`}
            >
              <div className="flex items-start gap-3">
                <TrendingDown 
                  className={`h-5 w-5 mt-0.5 ${getDilutionColorClass(dilution)}`}
                />
                <div className="flex-1 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium text-foreground">
                      Equity Dilution
                    </p>
                    <p
                      className={`text-2xl font-bold ${getDilutionColorClass(dilution)}`}
                    >
                      {dilution.toFixed(2)}%
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Equity dilution represents the reduction in promoter shareholding
                    due to the IPO. Lower dilution indicates stronger promoter
                    commitment.
                    {dilution < 10 && (
                      <span className="font-medium text-green-700 dark:text-green-300">
                        {' '}
                        Low dilution suggests high promoter confidence.
                      </span>
                    )}
                    {dilution >= 10 && dilution <= 20 && (
                      <span className="font-medium text-yellow-700 dark:text-yellow-300">
                        {' '}
                        Moderate dilution is common in IPOs.
                      </span>
                    )}
                    {dilution > 20 && (
                      <span className="font-medium text-red-700 dark:text-red-300">
                        {' '}
                        High dilution may indicate significant fundraising needs.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Helper Text */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> Promoter holding data is sourced from the
              company&apos;s DRHP/RHP documents. Post-issue percentages reflect the
              shareholding after dilution from the public offering.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
