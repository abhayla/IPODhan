/**
 * Enhanced Related Data Navigation Component
 *
 * Displays relationship navigation with data completeness indicators
 * Part of Day 4: Admin Enhancement (2025-11-09)
 *
 * Features:
 * - Visual completeness indicators (✓ has data, ⚠ missing data)
 * - Record counts for each relationship
 * - Quick action buttons
 * - Color-coded cards based on data status
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';

export interface RelationshipStatus {
  table: string;
  hasData: boolean;
  recordCount: number;
  isRequired?: boolean; // For recommended/critical relationships
}

interface RelatedDataLinksProps {
  ipoId: string;
  ipoName?: string; // Company name for display
  currentTable?: string;
  relationshipStatuses?: RelationshipStatus[]; // Data completeness information
}

interface RelatedTable {
  name: string;
  displayName: string;
  icon: string;
  description: string;
  hasData?: boolean;
  isRequired?: boolean; // Critical relationships
}

const RELATED_TABLES: RelatedTable[] = [
  {
    name: 'financialData',
    displayName: 'Financial Data',
    icon: '💰',
    description: 'Revenue, profit, P/E ratio, etc.',
    isRequired: true, // Critical for IPO analysis
  },
  {
    name: 'subscriptions',
    displayName: 'Subscriptions',
    icon: '📊',
    description: 'QIB, NII, Retail subscription data',
    isRequired: true, // Required for OPEN/CLOSED IPOs
  },
  {
    name: 'gmpRecords',
    displayName: 'GMP Records',
    icon: '📈',
    description: 'Grey market premium history',
    isRequired: false, // Optional - not all IPOs have GMP
  },
  {
    name: 'documents',
    displayName: 'Documents',
    icon: '📄',
    description: 'DRHP, RHP, prospectus, etc.',
    isRequired: true, // Required - regulatory documents
  },
  {
    name: 'listingPerformance',
    displayName: 'Listing Performance',
    icon: '🎯',
    description: 'Listing price, gains, returns',
    isRequired: true, // Required for LISTED IPOs
  },
  {
    name: 'peerCompanies',
    displayName: 'Peer Companies',
    icon: '🏢',
    description: 'Competitor analysis',
    isRequired: false, // Optional
  },
  {
    name: 'anchorInvestors',
    displayName: 'Anchor Investors',
    icon: '⚓',
    description: 'Pre-IPO anchor investors',
    isRequired: false, // Optional - not all IPOs have anchors
  },
  {
    name: 'ipoReviews',
    displayName: 'Reviews',
    icon: '⭐',
    description: 'Analyst recommendations',
    isRequired: false, // Optional
  },
];

export function RelatedDataLinks({
  ipoId,
  ipoName,
  currentTable,
  relationshipStatuses = [],
}: RelatedDataLinksProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get status for a specific table
  const getTableStatus = (tableName: string): RelationshipStatus | undefined => {
    return relationshipStatuses.find((status) => status.table === tableName);
  };

  // Calculate overall completeness
  const totalTables = RELATED_TABLES.length;
  const tablesWithData = relationshipStatuses.filter((s) => s.hasData).length;
  const completenessPercent = totalTables > 0 ? Math.round((tablesWithData / totalTables) * 100) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      {/* Header with overall completeness */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <div className="text-left">
            <div className="text-sm font-semibold text-gray-900">Related Data</div>
            {ipoName && (
              <div className="text-xs text-gray-500 mt-0.5">{ipoName}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {relationshipStatuses.length > 0 && (
            <div className="text-xs text-gray-500">
              {tablesWithData}/{totalTables} complete ({completenessPercent}%)
            </div>
          )}
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-200">
          {/* Grid of relationship cards */}
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RELATED_TABLES.map((table) => {
              const isCurrent = currentTable === table.name;
              const status = getTableStatus(table.name);
              const hasData = status?.hasData ?? false;
              const recordCount = status?.recordCount ?? 0;
              const isRequired = table.isRequired ?? false;

              // Determine card styling based on status
              const cardBorderColor = isCurrent
                ? 'border-blue-500'
                : hasData
                ? 'border-green-200'
                : isRequired
                ? 'border-yellow-300'
                : 'border-gray-200';

              const cardBgColor = isCurrent
                ? 'bg-blue-50'
                : hasData
                ? 'bg-green-50'
                : isRequired
                ? 'bg-yellow-50'
                : 'bg-white';

              return (
                <div
                  key={table.name}
                  className={`border-2 rounded-lg p-3 transition-all ${cardBorderColor} ${cardBgColor} hover:shadow-md`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{table.icon}</span>
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {table.displayName}
                          {isCurrent && (
                            <span className="ml-1.5 text-xs text-blue-600">(current)</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {table.description}
                        </div>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {hasData ? (
                        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : isRequired ? (
                        <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Record count */}
                  {status && (
                    <div className="text-xs text-gray-600 mb-2">
                      {recordCount === 0
                        ? 'No records'
                        : `${recordCount} record${recordCount > 1 ? 's' : ''}`}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-2">
                    <Link
                      href={`/admin/dynamic/${table.name}/list?ipoId=${ipoId}`}
                      className="flex-1 px-3 py-1.5 text-xs font-medium text-center bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                    >
                      {hasData ? 'View' : 'Browse'}
                    </Link>
                    {!hasData && (
                      <Link
                        href={`/admin/dynamic/${table.name}/new?ipoId=${ipoId}`}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
                      >
                        + Add
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Back to IPO link */}
          <div className="border-t border-gray-200 p-3 bg-gray-50">
            <Link
              href={`/admin/dynamic/ipos/${ipoId}`}
              className="flex items-center justify-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to IPO Record
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
