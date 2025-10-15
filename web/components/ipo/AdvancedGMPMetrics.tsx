'use client';

import { useState } from 'react';
import { GMPRecord } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface AdvancedGMPMetricsProps {
  gmpRecords: GMPRecord[];
}

/**
 * AdvancedGMPMetrics component displays advanced grey market trading metrics
 * - Kostak Rate: Rate at which allotment rights are traded
 * - Subject Rate: Rate for trading assuming allotment
 * - Sauda Details: Grey market trading information
 *
 * Story 4.13: Advanced GMP Metrics
 */
export function AdvancedGMPMetrics({ gmpRecords }: AdvancedGMPMetricsProps) {
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

  if (!gmpRecords || gmpRecords.length === 0) {
    return null;
  }

  // Get the latest record with advanced metrics
  const latestRecord = gmpRecords[0];

  // Check if any advanced metrics are available
  const hasAdvancedMetrics =
    latestRecord.kostakRate !== null ||
    latestRecord.subjectRate !== null ||
    (latestRecord.saudaDetails !== null && latestRecord.saudaDetails !== '');

  // Don't render if no advanced metrics available
  if (!hasAdvancedMetrics) {
    return null;
  }

  const formatCurrency = (value: number | null) => {
    if (value === null) return null;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const hasKostakRate = latestRecord.kostakRate !== null;
  const hasSubjectRate = latestRecord.subjectRate !== null;
  const hasSaudaDetails = latestRecord.saudaDetails !== null && latestRecord.saudaDetails !== '';

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Advanced Grey Market Metrics</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-sm">
                    <strong>What is Grey Market?</strong>
                    <br />
                    An unofficial market where IPO shares are traded before listing.
                    These rates indicate market sentiment but are unregulated and unofficial.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Disclaimer */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Grey market trading is unofficial and unregulated. These metrics are for informational purposes only and should not be considered as investment advice.
          </AlertDescription>
        </Alert>

        {/* Kostak Rate */}
        {hasKostakRate && (
          <div className="flex items-start justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Kostak Rate:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">
                      Rate at which allotment rights are traded in grey market (without shares).
                      This is the price per lot for selling your application rights before allotment.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <span className="text-base font-semibold text-foreground">
              {formatCurrency(latestRecord.kostakRate)}
            </span>
          </div>
        )}

        {/* Subject Rate */}
        {hasSubjectRate && (
          <div className="flex items-start justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Subject/Safalya Rate:</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">
                      Rate for trading assuming allotment (subject to getting shares).
                      This is the premium you receive if you get the allotment and sell in grey market.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <span className="text-base font-semibold text-foreground">
              {formatCurrency(latestRecord.subjectRate)}
            </span>
          </div>
        )}

        {/* Grey Market Difference Explanation */}
        {hasKostakRate && hasSubjectRate && (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Difference:</strong> Kostak is the rate for selling application rights before allotment,
              while Subject rate is the premium after getting allotment.
              The difference reflects the allotment probability in the grey market.
            </p>
          </div>
        )}

        {/* Sauda Details - Expandable Section */}
        {hasSaudaDetails && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
              className="w-full justify-between"
            >
              <span className="text-sm font-medium">Grey Market Trading Details</span>
              {isDetailsExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>

            {isDetailsExpanded && (
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {latestRecord.saudaDetails}
                </p>
              </div>
            )}
          </div>
        )}

        {/* No Data Message */}
        {!hasKostakRate && !hasSubjectRate && !hasSaudaDetails && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">
              Advanced grey market metrics not available yet.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
