/**
 * Related Data Quick Links Component
 *
 * Displays quick navigation links to related data tables for an IPO
 * Part of Phase 2: Navigation & UX Enhancements
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';

interface RelatedDataLinksProps {
  ipoId: string;
  currentTable?: string;
}

interface RelatedTable {
  name: string;
  displayName: string;
  icon: string;
  description: string;
  hasData?: boolean;
}

const RELATED_TABLES: RelatedTable[] = [
  {
    name: 'financialData',
    displayName: 'Financial Data',
    icon: '💰',
    description: 'Revenue, profit, P/E ratio, etc.'
  },
  {
    name: 'subscriptions',
    displayName: 'Subscriptions',
    icon: '📊',
    description: 'QIB, NII, Retail subscription data'
  },
  {
    name: 'gmpRecords',
    displayName: 'GMP Records',
    icon: '📈',
    description: 'Grey market premium history'
  },
  {
    name: 'documents',
    displayName: 'Documents',
    icon: '📄',
    description: 'DRHP, RHP, prospectus, etc.'
  },
  {
    name: 'listingPerformance',
    displayName: 'Listing Performance',
    icon: '🎯',
    description: 'Listing price, gains, returns'
  },
  {
    name: 'peerCompanies',
    displayName: 'Peer Companies',
    icon: '🏢',
    description: 'Competitor analysis'
  },
  {
    name: 'anchorInvestors',
    displayName: 'Anchor Investors',
    icon: '⚓',
    description: 'Pre-IPO anchor investors'
  },
  {
    name: 'ipoReviews',
    displayName: 'Reviews',
    icon: '⭐',
    description: 'Analyst recommendations'
  }
];

export function RelatedDataLinks({ ipoId, currentTable }: RelatedDataLinksProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center">
          <svg className="w-5 h-5 text-gray-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-sm font-semibold text-gray-900">Related Data</span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-200">
          <div className="p-2 space-y-1">
            {RELATED_TABLES.map((table) => {
              const isCurrent = currentTable === table.name;

              return (
                <Link
                  key={table.name}
                  href={`/admin/dynamic/${table.name}/list?ipoId=${ipoId}`}
                  className={`block px-3 py-2 rounded-md transition-colors ${
                    isCurrent
                      ? 'bg-blue-100 text-blue-900'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-start">
                    <span className="text-lg mr-2">{table.icon}</span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {table.displayName}
                        {isCurrent && (
                          <span className="ml-2 text-xs text-blue-600">(current)</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {table.description}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="border-t border-gray-200 p-3 bg-gray-50">
            <Link
              href={`/admin/dynamic/ipos/${ipoId}`}
              className="block text-center text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              ← Back to IPO Record
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
