'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users as HiAnchor, TrendingUp } from 'lucide-react';
import { CategoryTooltip } from './CategoryTooltip';
import {
  calculateAnchorAllocationPercentage,
  isStrongAnchorAllocation,
  formatSubscriptionValue,
  CATEGORY_DESCRIPTIONS,
} from '@/lib/utils/subscription-utils';

interface AnchorInvestorHighlightProps {
  anchorSubscription: string | number | null;
  issueSize: string | number | null;
}

/**
 * AnchorInvestorHighlight Component
 *
 * Displays anchor investor subscription with visual emphasis.
 * Highlights strong anchor participation (>30% of issue).
 * Story 5.6: Enhanced Subscription Breakdown - AC 4
 */
export function AnchorInvestorHighlight({
  anchorSubscription,
  issueSize,
}: AnchorInvestorHighlightProps) {
  // Don't render if no anchor data
  if (!anchorSubscription || anchorSubscription === 0) {
    return null;
  }

  const allocationPercentage = calculateAnchorAllocationPercentage(
    anchorSubscription,
    issueSize
  );
  const isStrong = isStrongAnchorAllocation(allocationPercentage);

  return (
    <Card
      className={`border-2 ${
        isStrong
          ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
          : 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
      }`}
    >
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              isStrong ? 'bg-green-100 dark:bg-green-900' : 'bg-blue-100 dark:bg-blue-900'
            }`}
          >
            <HiAnchor
              className={`h-6 w-6 ${
                isStrong ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'
              }`}
            />
          </div>

          {/* Content */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold">Anchor Investors</h3>
              <CategoryTooltip
                category="Anchor Investors"
                description={CATEGORY_DESCRIPTIONS.anchor}
              />
              {isStrong && (
                <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Strong Signal
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              {/* Subscription value */}
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">
                  {formatSubscriptionValue(anchorSubscription)}x
                </span>
                <span className="text-sm text-muted-foreground">
                  subscription
                </span>
              </div>

              {/* Allocation percentage */}
              {allocationPercentage !== null && (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="text-sm text-muted-foreground">
                      Allocation: {allocationPercentage.toFixed(1)}% of issue size
                    </div>
                    {issueSize && (
                      <div className="text-xs text-muted-foreground">
                        (₹
                        {(
                          (typeof anchorSubscription === 'string'
                            ? parseFloat(anchorSubscription)
                            : anchorSubscription) || 0
                        ).toLocaleString('en-IN')}{' '}
                        Cr / ₹
                        {(
                          typeof issueSize === 'string'
                            ? parseFloat(issueSize)
                            : issueSize
                        ).toLocaleString('en-IN')}{' '}
                        Cr)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Strong signal explanation */}
              {isStrong && (
                <p className="text-sm text-green-700 dark:text-green-300 mt-2">
                  Strong anchor participation indicates high institutional
                  confidence in this IPO.
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
