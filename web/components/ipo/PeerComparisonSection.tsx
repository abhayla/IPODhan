/**
 * PeerComparisonSection Component
 * Displays peer company financial comparison for IPO detail page
 * Shows PE Ratio, EPS, RONW, NAV, and PBV Ratio metrics
 */

'use client';

import { HiExclamationCircle, HiArrowTrendingUp, HiBuildingOffice2 } from 'react-icons/hi2';
import type { PeerCompany } from '@/lib/db/types';

interface PeerComparisonSectionProps {
  peerCompanies: PeerCompany[];
  companyName?: string;
}

/**
 * Format number with commas for readability
 */
function formatNumber(num: number | string | null): string {
  if (num === null || num === undefined) return 'N/A';
  const numValue = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(numValue)) return 'N/A';
  return numValue.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * Format percentage with % suffix
 */
function formatPercent(num: number | string | null): string {
  if (num === null || num === undefined) return 'N/A';
  const numValue = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(numValue)) return 'N/A';
  return `${numValue.toFixed(2)}%`;
}

/**
 * Main Peer Comparison Section
 */
export function PeerComparisonSection({ peerCompanies, companyName }: PeerComparisonSectionProps) {
  // If no peer companies, show "No Peers Available" state
  if (!peerCompanies || peerCompanies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 p-8">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <HiExclamationCircle className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">No Peer Data Available</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Peer comparison data is not yet available for this IPO.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-lg border bg-card p-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <HiBuildingOffice2 className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-bold text-foreground">Peer Comparison</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Compare {companyName || 'this IPO'} with industry peers based on financial metrics
        </p>
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-3 px-4 text-sm font-semibold text-foreground">Company</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">PE Ratio</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">EPS (₹)</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">RONW (%)</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">NAV (₹)</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-foreground">PBV Ratio</th>
              <th className="text-center py-3 px-4 text-sm font-semibold text-foreground">Listed</th>
            </tr>
          </thead>
          <tbody>
            {peerCompanies.map((peer, index) => (
              <tr
                key={peer.id}
                className={`border-b last:border-b-0 hover:bg-muted/30 transition-colors ${
                  index % 2 === 0 ? 'bg-muted/10' : ''
                }`}
              >
                <td className="py-3 px-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">{peer.companyName}</span>
                    {peer.sector && (
                      <span className="text-xs text-muted-foreground">{peer.sector}</span>
                    )}
                  </div>
                </td>
                <td className="text-right py-3 px-4 text-sm text-muted-foreground">
                  {formatNumber(peer.peRatio)}
                </td>
                <td className="text-right py-3 px-4 text-sm text-muted-foreground">
                  ₹{formatNumber(peer.eps)}
                </td>
                <td className="text-right py-3 px-4 text-sm text-muted-foreground">
                  {formatPercent(peer.ronw)}
                </td>
                <td className="text-right py-3 px-4 text-sm text-muted-foreground">
                  ₹{formatNumber(peer.nav)}
                </td>
                <td className="text-right py-3 px-4 text-sm text-muted-foreground">
                  {formatNumber(peer.pbvRatio)}
                </td>
                <td className="text-center py-3 px-4">
                  {peer.isListed ? (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400">
                      No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-4">
        {peerCompanies.map((peer) => (
          <div key={peer.id} className="rounded-lg border bg-muted/10 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-semibold text-foreground">{peer.companyName}</h4>
                {peer.sector && (
                  <p className="text-xs text-muted-foreground mt-1">{peer.sector}</p>
                )}
              </div>
              {peer.isListed && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  Listed
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">PE Ratio</span>
                <p className="font-medium text-foreground mt-0.5">{formatNumber(peer.peRatio)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">EPS</span>
                <p className="font-medium text-foreground mt-0.5">₹{formatNumber(peer.eps)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">RONW</span>
                <p className="font-medium text-foreground mt-0.5">{formatPercent(peer.ronw)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">NAV</span>
                <p className="font-medium text-foreground mt-0.5">₹{formatNumber(peer.nav)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">PBV Ratio</span>
                <p className="font-medium text-foreground mt-0.5">{formatNumber(peer.pbvRatio)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Financial Type</span>
                <p className="font-medium text-foreground mt-0.5 text-xs">
                  {peer.financialStatementType || 'N/A'}
                </p>
              </div>
            </div>

            {peer.dataSource && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Source: {peer.dataSource}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="pt-4 border-t">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <HiArrowTrendingUp className="h-3 w-3" />
            <span><strong>PE Ratio:</strong> Price-to-Earnings Ratio</span>
          </div>
          <div>
            <strong>EPS:</strong> Earnings Per Share
          </div>
          <div>
            <strong>RONW:</strong> Return on Net Worth
          </div>
          <div>
            <strong>NAV:</strong> Net Asset Value
          </div>
          <div>
            <strong>PBV:</strong> Price-to-Book Value Ratio
          </div>
        </div>
      </div>

      {/* Data Note */}
      {peerCompanies.length > 0 && peerCompanies[0].lastUpdated && (
        <div className="pt-2 text-xs text-muted-foreground">
          Last updated: {new Date(peerCompanies[0].lastUpdated).toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })}
        </div>
      )}
    </div>
  );
}
