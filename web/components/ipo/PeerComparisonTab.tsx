/**
 * PeerComparisonTab Component
 *
 * Main tab content for peer comparison feature.
 * Features:
 * - Section heading and description
 * - PeerComparisonTable with industry average
 * - Data source attribution
 * - Financial statement type disclaimer
 * - Last updated timestamp
 * - Empty state when no data
 *
 * Story 4.8: Peer Comparison Tab
 */

'use client';

import { PeerComparisonTable } from './PeerComparisonTable';
import { PeerComparisonEmptyState } from './PeerComparisonEmptyState';
import { getPeerComparison } from '@/lib/services/peer-comparison-service';
import type { IPODetailResponse } from '@/lib/db/types';
import { Info } from 'lucide-react';

// ==================== TYPES ====================

interface PeerComparisonTabProps {
  ipoData: IPODetailResponse;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Format date for display
 */
function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ==================== COMPONENT ====================

/**
 * PeerComparisonTab component
 * Main content for Peer Comparison tab
 */
export function PeerComparisonTab({ ipoData }: PeerComparisonTabProps) {
  const { ipo, financialData, peerCompanies } = ipoData;

  // Get peer comparison data using service
  const peerComparisonData = getPeerComparison(
    ipo.companyName,
    ipo.sector,
    financialData,
    peerCompanies || []
  );

  // Show empty state if no peer data
  if (!peerComparisonData) {
    return <PeerComparisonEmptyState />;
  }

  const {
    ipoRow,
    peerRows,
    industryAverageRow,
    dataSource,
    lastUpdated,
    financialStatementType,
  } = peerComparisonData;

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Peer Comparison
        </h2>
        <p className="text-sm text-muted-foreground">
          Compare {ipo.companyName} with {peerRows.length} peer companies in the {ipo.sector || 'same'} sector
          to assess relative valuation and financial performance.
        </p>
      </div>

      {/* Comparison Table */}
      <PeerComparisonTable
        ipoRow={ipoRow}
        peerRows={peerRows}
        industryAverageRow={industryAverageRow}
      />

      {/* Data Attribution Section */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
          <div className="flex-1 space-y-2">
            <div className="text-sm">
              <span className="font-medium text-gray-900">Data Source:</span>{' '}
              <span className="text-muted-foreground">{dataSource}</span>
            </div>
            <div className="text-sm">
              <span className="font-medium text-gray-900">Last Updated:</span>{' '}
              <span className="text-muted-foreground">
                {formatDate(lastUpdated)}
              </span>
            </div>
            {financialStatementType && (
              <div className="text-sm">
                <span className="font-medium text-gray-900">Financial Statement Type:</span>{' '}
                <span className="text-muted-foreground">
                  {financialStatementType}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="pt-3 border-t border-gray-200">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Disclaimer:</strong> Peer comparison data is provided for informational purposes only.
            Financial metrics are based on publicly available information and may not reflect the most recent data.
            Past performance and peer comparisons are not indicative of future results.
            Investors should conduct their own due diligence and consult with financial advisors before making investment decisions.
          </p>
        </div>
      </div>

      {/* Legend for Comparison Indicators */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Understanding Comparison Indicators
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
              <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </div>
            <div>
              <div className="font-medium text-green-600">Better than Average</div>
              <div className="text-muted-foreground text-xs">More than 10% above industry average</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
              <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
            <div>
              <div className="font-medium text-red-600">Worse than Average</div>
              <div className="text-muted-foreground text-xs">More than 10% below industry average</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
              <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </div>
            <div>
              <div className="font-medium text-gray-600">Near Average</div>
              <div className="text-muted-foreground text-xs">Within ±10% of industry average</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
