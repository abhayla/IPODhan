/**
 * Dynamic Tables Dashboard Component
 *
 * Displays all available tables with quick access to the self-extending admin system.
 * Shows record counts and provides direct links to manage each table.
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getAllTables } from '@/lib/admin/schema-introspector';
import { adminGet } from '@/lib/admin/admin-api-client';

interface TableInfo {
  name: string;
  displayName: string;
  columnCount: number;
  recordCount?: number;
  description: string;
  category: 'core' | 'financial' | 'tracking' | 'system' | 'extraction';
}

const tableDescriptions: Record<string, { description: string; category: TableInfo['category'] }> = {
  ipos: { description: 'Core IPO data with 450+ fields', category: 'core' },
  subscriptions: { description: 'Real-time subscription tracking', category: 'core' },
  gmpRecords: { description: 'Grey Market Premium history', category: 'financial' },
  financialData: { description: 'Financial metrics and ratios', category: 'financial' },
  documents: { description: 'IPO documents (DRHP, RHP, etc.)', category: 'core' },
  listingPerformance: { description: 'Post-listing performance data', category: 'financial' },
  marketHolidays: { description: 'Trading holiday calendar', category: 'system' },
  registrars: { description: 'Registrar information', category: 'core' },
  peerCompanies: { description: 'Peer comparison data', category: 'financial' },
  brokerAffiliates: { description: 'Broker affiliate links', category: 'system' },
  affiliateClicks: { description: 'Affiliate click tracking', category: 'tracking' },
  scraperLogs: { description: 'Data scraper execution logs', category: 'tracking' },
  ipoReviews: { description: 'Expert IPO reviews and ratings', category: 'core' },
  fieldProtectionMetadata: { description: 'Field protection configuration', category: 'system' },
  protectedFields: { description: 'Protected field records', category: 'system' },
  auditLogs: { description: 'System audit trail', category: 'tracking' },
  extractionLogs: { description: 'DRHP extraction history', category: 'extraction' }
};

const categoryColors = {
  core: 'bg-blue-100 text-blue-800',
  financial: 'bg-green-100 text-green-800',
  tracking: 'bg-yellow-100 text-yellow-800',
  system: 'bg-gray-100 text-gray-800',
  extraction: 'bg-purple-100 text-purple-800'
};

const categoryIcons = {
  core: '📊',
  financial: '💰',
  tracking: '📈',
  system: '⚙️',
  extraction: '📄'
};

export function DynamicTablesDashboard() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    const loadTables = async () => {
      try {
        setIsLoading(true);

        // Get all tables from schema
        const allTables = getAllTables();

        const tableInfos: TableInfo[] = [];

        for (const [name, metadata] of Object.entries(allTables)) {
          const info = tableDescriptions[name] || {
            description: 'Database table',
            category: 'system' as const
          };

          tableInfos.push({
            name,
            displayName: name.replace(/([A-Z])/g, ' $1').trim(),
            columnCount: metadata.columns.length,
            description: info.description,
            category: info.category,
            recordCount: undefined // Will be loaded async
          });
        }

        setTables(tableInfos);

        // Load record counts asynchronously
        loadRecordCounts(tableInfos);
      } catch (error) {
        console.error('Failed to load tables:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTables();
  }, []);

  const loadRecordCounts = async (tableInfos: TableInfo[]) => {
    // Load counts for each table (don't await all, update as they come in)
    for (const table of tableInfos) {
      try {
        const response = await adminGet(`/api/admin/dynamic/${table.name}/list?limit=1`);
        if (response.success && response.data) {
          setTables(prev => prev.map(t =>
            t.name === table.name
              ? { ...t, recordCount: response.data.total }
              : t
          ));
        }
      } catch (error) {
        console.warn(`Failed to load count for ${table.name}:`, error);
      }
    }
  };

  const filteredTables = selectedCategory === 'all'
    ? tables
    : tables.filter(t => t.category === selectedCategory);

  const categories = ['all', ...Object.keys(categoryColors)];

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-300 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            Self-Extending Admin System
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage all database tables with auto-generated forms • {tables.length} tables available
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/dynamic/ipos/list"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Quick: Manage IPOs
          </Link>
          <Link
            href="/admin/dynamic/extractionLogs/list"
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            View Extractions
          </Link>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        {categories.map(category => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedCategory === category
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
          >
            {category === 'all' ? 'All Tables' : (
              <>
                {categoryIcons[category as keyof typeof categoryIcons]} {category.charAt(0).toUpperCase() + category.slice(1)}
              </>
            )}
          </button>
        ))}
      </div>

      {/* Tables Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTables.map(table => (
          <div
            key={table.name}
            className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-5"
          >
            {/* Table Header */}
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {table.displayName}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {table.description}
                </p>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${categoryColors[table.category]}`}>
                {table.category}
              </span>
            </div>

            {/* Table Stats */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div>
                <span className="text-gray-500">Columns:</span>
                <span className="ml-2 font-medium text-gray-900">{table.columnCount}</span>
              </div>
              <div>
                <span className="text-gray-500">Records:</span>
                <span className="ml-2 font-medium text-gray-900">
                  {table.recordCount !== undefined ? table.recordCount.toLocaleString() : '...'}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Link
                href={`/admin/dynamic/${table.name}/list`}
                className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 text-center"
              >
                View Records
              </Link>
              <Link
                href={`/admin/dynamic/${table.name}/new`}
                className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 text-center"
              >
                Add New
              </Link>
            </div>

            {/* Special Actions for Specific Tables */}
            {table.name === 'extractionLogs' && (
              <Link
                href="/admin/drhp-extraction"
                className="mt-2 block w-full px-3 py-2 bg-purple-100 text-purple-700 text-sm font-medium rounded-md hover:bg-purple-200 text-center"
              >
                DRHP Extraction UI →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Features Info */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">
          ✨ Self-Extending Features
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
          <div className="flex items-start">
            <span className="mr-2">🔄</span>
            <div>
              <strong>Auto-Generated Forms:</strong> Forms are created dynamically from database schema
            </div>
          </div>
          <div className="flex items-start">
            <span className="mr-2">📝</span>
            <div>
              <strong>Type-Aware Inputs:</strong> Appropriate input types for each field (date, number, select, etc.)
            </div>
          </div>
          <div className="flex items-start">
            <span className="mr-2">✅</span>
            <div>
              <strong>Built-in Validation:</strong> Automatic validation based on database constraints
            </div>
          </div>
          <div className="flex items-start">
            <span className="mr-2">🔍</span>
            <div>
              <strong>Search & Sort:</strong> Full-text search and column sorting on all tables
            </div>
          </div>
          <div className="flex items-start">
            <span className="mr-2">📊</span>
            <div>
              <strong>450+ Fields:</strong> Access all database fields including the 360 missing ones
            </div>
          </div>
          <div className="flex items-start">
            <span className="mr-2">🚀</span>
            <div>
              <strong>Zero Maintenance:</strong> Automatically adapts to schema changes
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 bg-white/50 rounded-md">
          <p className="text-xs text-blue-700">
            <strong>Note:</strong> This system provides access to all {tables.reduce((sum, t) => sum + t.columnCount, 0)} fields
            across {tables.length} tables. The traditional admin tabs only covered ~90 fields.
            Now you have complete control over all data.
          </p>
        </div>
      </div>
    </div>
  );
}