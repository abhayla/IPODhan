/**
 * PeerComparisonTable Component
 *
 * Displays IPO company vs peer companies financial comparison.
 * Features:
 * - Desktop: Full table with sticky first column
 * - Mobile: Card-based layout with vertical scrolling
 * - IPO row highlighted
 * - Industry average row at bottom
 * - Comparison indicators (green/red/neutral)
 * - Responsive design with horizontal scroll on tablet
 *
 * Story 4.8: Peer Comparison Tab
 */

'use client';

import { ComparisonIndicator } from './ComparisonIndicator';
import type { ComparisonRow } from '@/lib/services/peer-comparison-service';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface PeerComparisonTableProps {
  ipoRow: ComparisonRow;
  peerRows: ComparisonRow[];
  industryAverageRow: ComparisonRow;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Format numeric value with decimals
 */
function formatValue(value: number | null, decimals = 2): string {
  if (value === null) return 'N/A';
  return value.toFixed(decimals);
}

// ==================== COMPONENT ====================

/**
 * PeerComparisonTable component
 * Renders comparison table on desktop, cards on mobile
 */
export function PeerComparisonTable({
  ipoRow,
  peerRows,
  industryAverageRow,
}: PeerComparisonTableProps) {
  const allRows = [ipoRow, ...peerRows];

  return (
    <>
      {/* Desktop & Tablet View: Table */}
      <div className="hidden md:block overflow-x-auto">
        <div className="min-w-full inline-block align-middle">
          <div className="overflow-hidden border rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Company Name
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Sector
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Listed Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    P/E Ratio
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    EPS
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Diluted EPS
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    RONW (%)
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    NAV
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    P/BV Ratio
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {/* IPO + Peer Rows */}
                {allRows.map((row, index) => (
                  <tr
                    key={`${row.companyName}-${index}`}
                    className={cn(
                      row.isIPO && 'bg-blue-50 font-medium'
                    )}
                  >
                    <td className="sticky left-0 z-10 px-4 py-3 whitespace-nowrap text-sm text-gray-900 bg-inherit">
                      {row.companyName}
                      {row.isIPO && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          IPO
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {row.sector || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {row.listedStatus}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatValue(row.peRatio)}
                      {row.isIPO && (
                        <ComparisonIndicator
                          value={row.peRatio}
                          average={industryAverageRow.peRatio}
                          higherIsBetter={false}
                          className="ml-2"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatValue(row.eps)}
                      {row.isIPO && (
                        <ComparisonIndicator
                          value={row.eps}
                          average={industryAverageRow.eps}
                          className="ml-2"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatValue(row.dilutedEps)}
                      {row.isIPO && (
                        <ComparisonIndicator
                          value={row.dilutedEps}
                          average={industryAverageRow.dilutedEps}
                          className="ml-2"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatValue(row.ronw)}
                      {row.isIPO && (
                        <ComparisonIndicator
                          value={row.ronw}
                          average={industryAverageRow.ronw}
                          className="ml-2"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatValue(row.nav)}
                      {row.isIPO && (
                        <ComparisonIndicator
                          value={row.nav}
                          average={industryAverageRow.nav}
                          className="ml-2"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatValue(row.pbvRatio)}
                      {row.isIPO && (
                        <ComparisonIndicator
                          value={row.pbvRatio}
                          average={industryAverageRow.pbvRatio}
                          higherIsBetter={false}
                          className="ml-2"
                        />
                      )}
                    </td>
                  </tr>
                ))}

                {/* Industry Average Row */}
                <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                  <td className="sticky left-0 z-10 px-4 py-3 whitespace-nowrap text-sm text-gray-900 bg-gray-100">
                    {industryAverageRow.companyName}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                    {industryAverageRow.sector || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                    {industryAverageRow.listedStatus}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatValue(industryAverageRow.peRatio)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatValue(industryAverageRow.eps)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatValue(industryAverageRow.dilutedEps)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatValue(industryAverageRow.ronw)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatValue(industryAverageRow.nav)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {formatValue(industryAverageRow.pbvRatio)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mobile View: Cards */}
      <div className="md:hidden space-y-4">
        {/* IPO Card */}
        <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-lg text-gray-900">
              {ipoRow.companyName}
            </h3>
            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
              IPO
            </span>
          </div>
          <div className="space-y-2">
            <MetricRow
              label="Sector"
              value={ipoRow.sector || '-'}
            />
            <MetricRow
              label="Listed Status"
              value={ipoRow.listedStatus}
            />
            <MetricRowWithIndicator
              label="P/E Ratio"
              value={ipoRow.peRatio}
              average={industryAverageRow.peRatio}
              higherIsBetter={false}
            />
            <MetricRowWithIndicator
              label="EPS"
              value={ipoRow.eps}
              average={industryAverageRow.eps}
            />
            <MetricRowWithIndicator
              label="Diluted EPS"
              value={ipoRow.dilutedEps}
              average={industryAverageRow.dilutedEps}
            />
            <MetricRowWithIndicator
              label="RONW (%)"
              value={ipoRow.ronw}
              average={industryAverageRow.ronw}
            />
            <MetricRowWithIndicator
              label="NAV"
              value={ipoRow.nav}
              average={industryAverageRow.nav}
            />
            <MetricRowWithIndicator
              label="P/BV Ratio"
              value={ipoRow.pbvRatio}
              average={industryAverageRow.pbvRatio}
              higherIsBetter={false}
            />
          </div>
        </div>

        {/* Peer Company Cards */}
        {peerRows.map((row, index) => (
          <div key={`${row.companyName}-${index}`} className="rounded-lg border bg-white p-4">
            <h3 className="font-semibold text-lg text-gray-900 mb-3">
              {row.companyName}
            </h3>
            <div className="space-y-2">
              <MetricRow
                label="Sector"
                value={row.sector || '-'}
              />
              <MetricRow
                label="Listed Status"
                value={row.listedStatus}
              />
              <MetricRow
                label="P/E Ratio"
                value={formatValue(row.peRatio)}
              />
              <MetricRow
                label="EPS"
                value={formatValue(row.eps)}
              />
              <MetricRow
                label="Diluted EPS"
                value={formatValue(row.dilutedEps)}
              />
              <MetricRow
                label="RONW (%)"
                value={formatValue(row.ronw)}
              />
              <MetricRow
                label="NAV"
                value={formatValue(row.nav)}
              />
              <MetricRow
                label="P/BV Ratio"
                value={formatValue(row.pbvRatio)}
              />
            </div>
          </div>
        ))}

        {/* Industry Average Card */}
        <div className="rounded-lg border-2 border-gray-400 bg-gray-100 p-4">
          <h3 className="font-semibold text-lg text-gray-900 mb-3">
            {industryAverageRow.companyName}
          </h3>
          <div className="space-y-2">
            <MetricRow
              label="Sector"
              value={industryAverageRow.sector || '-'}
            />
            <MetricRow
              label="P/E Ratio"
              value={formatValue(industryAverageRow.peRatio)}
            />
            <MetricRow
              label="EPS"
              value={formatValue(industryAverageRow.eps)}
            />
            <MetricRow
              label="Diluted EPS"
              value={formatValue(industryAverageRow.dilutedEps)}
            />
            <MetricRow
              label="RONW (%)"
              value={formatValue(industryAverageRow.ronw)}
            />
            <MetricRow
              label="NAV"
              value={formatValue(industryAverageRow.nav)}
            />
            <MetricRow
              label="P/BV Ratio"
              value={formatValue(industryAverageRow.pbvRatio)}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ==================== MOBILE CARD SUB-COMPONENTS ====================

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-200 last:border-0">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}

function MetricRowWithIndicator({
  label,
  value,
  average,
  higherIsBetter = true,
}: {
  label: string;
  value: number | null;
  average: number | null;
  higherIsBetter?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-200 last:border-0">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-900">{formatValue(value)}</span>
        <ComparisonIndicator
          value={value}
          average={average}
          higherIsBetter={higherIsBetter}
        />
      </div>
    </div>
  );
}
