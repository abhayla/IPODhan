/**
 * Dynamic Admin List Page - View All Records
 *
 * This page displays all records from any table in a paginated table view.
 * Part of the self-extending admin system.
 *
 * Route: /admin/dynamic/[table]/list
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import { getTableMetadata } from '@/lib/admin/schema-introspector';
import type { TableMetadata, ColumnMetadata } from '@/lib/admin/schema-introspector';
import { adminGet } from '@/lib/admin/admin-api-client';

interface ListPageData {
  records: any[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export default function DynamicListPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAdminAuth();

  const tableName = params.table as string;
  const ipoId = searchParams.get('ipoId');

  const [tableMetadata, setTableMetadata] = useState<TableMetadata | null>(null);
  const [data, setData] = useState<ListPageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [ipoContext, setIpoContext] = useState<{ id: string; companyName: string; slug: string } | null>(null);

  // Load table metadata
  useEffect(() => {
    const metadata = getTableMetadata(tableName);
    if (metadata) {
      setTableMetadata(metadata);
      // Set default sort to primary key or first column
      setSortBy(metadata.primaryKey || metadata.columns[0]?.name || '');
    } else {
      setError(`Table "${tableName}" not found in schema`);
    }
  }, [tableName]);

  // Load IPO context if ipoId is provided
  useEffect(() => {
    const loadIpoContext = async () => {
      if (!ipoId) {
        setIpoContext(null);
        return;
      }

      try {
        // Fetch IPO data by ID
        const response = await adminGet(`/api/admin/ipos/${ipoId}`);
        if (response.success && response.data) {
          setIpoContext({
            id: response.data.id,
            companyName: response.data.companyName,
            slug: response.data.slug,
          });
        }
      } catch (err) {
        console.error('Failed to load IPO context:', err);
        // Don't set error - context is optional
      }
    };

    loadIpoContext();
  }, [ipoId]);

  // Load records
  useEffect(() => {
    const loadRecords = async () => {
      if (!tableMetadata) return;

      try {
        setIsLoading(true);

        const queryParams = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
          ...(searchQuery && { search: searchQuery }),
          ...(sortBy && { sortBy }),
          sortOrder,
        });

        const response = await adminGet(`/api/admin/dynamic/${tableName}/list?${queryParams}`);

        if (response.success && response.data) {
          setData({
            records: response.data.records || [],
            total: response.data.total || 0,
            page: response.data.page || page,
            limit: response.data.limit || limit,
            hasNext: response.data.hasNext || false,
            hasPrev: response.data.hasPrev || false,
          });
        } else {
          throw new Error(response.error || 'Failed to load records');
        }
      } catch (err) {
        console.error('Failed to load records:', err);
        setError(err instanceof Error ? err.message : 'Failed to load records');
      } finally {
        setIsLoading(false);
      }
    };

    loadRecords();
  }, [tableName, tableMetadata, page, limit, searchQuery, sortBy, sortOrder]);

  // Get display columns (exclude system fields from display)
  const getDisplayColumns = (): ColumnMetadata[] => {
    if (!tableMetadata) return [];

    return tableMetadata.columns.filter(col => {
      // Show primary key and important fields
      if (col.isPrimary) return true;
      if (col.name === 'createdAt' || col.name === 'updatedAt') return false;
      if (col.fieldType === 'json' || col.fieldType === 'textarea') return false;
      return true;
    }).slice(0, 7); // Limit to 7 columns for readability
  };

  // Format cell value for display
  const formatCellValue = (value: any, column: ColumnMetadata): string => {
    if (value === null || value === undefined) return '-';

    switch (column.fieldType) {
      case 'date':
        return new Date(value).toLocaleDateString();
      case 'datetime':
        return new Date(value).toLocaleString();
      case 'boolean':
        return value ? '✓' : '✗';
      case 'decimal':
      case 'number':
        return typeof value === 'number' ? value.toLocaleString() : value;
      default:
        const str = String(value);
        return str.length > 50 ? str.substring(0, 50) + '...' : str;
    }
  };

  // Handle column sort
  const handleSort = (columnName: string) => {
    if (sortBy === columnName) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(columnName);
      setSortOrder('asc');
    }
    setPage(1);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Authentication Required</h1>
          <p className="mt-2 text-gray-600">Please log in to access the admin panel.</p>
          <Link href="/admin" className="mt-4 inline-block text-blue-600 hover:underline">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-900">Error</h2>
            <p className="text-red-700 mt-1">{error}</p>
            <Link href="/admin" className="mt-4 inline-block text-red-600 hover:underline">
              Back to Admin Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const displayColumns = getDisplayColumns();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* IPO Context Banner */}
      {ipoContext && (
        <div className="bg-blue-600 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-lg">🔗</span>
                <div>
                  <p className="text-sm font-medium">Editing data related to:</p>
                  <p className="text-lg font-bold">{ipoContext.companyName}</p>
                </div>
              </div>
              <Link
                href={`/admin/edit/${ipoContext.slug}`}
                className="flex items-center space-x-2 px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 font-medium transition-colors"
              >
                <span>←</span>
                <span>Back to IPO</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {tableName.replace(/([A-Z])/g, ' $1').trim()} Records
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Viewing all records from {tableName} table
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href={`/admin/dynamic/${tableName}/new`}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                + New Record
              </Link>
              <Link
                href="/admin"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Back to Admin
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex justify-between items-center">
            <div className="flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search records..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="ml-4 text-sm text-gray-600">
              {data && (
                <>
                  Showing {((page - 1) * limit) + 1}-{Math.min(page * limit, data.total)} of {data.total} records
                </>
              )}
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-300 rounded w-1/3 mx-auto mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-gray-300 rounded"></div>
                  <div className="h-4 bg-gray-300 rounded"></div>
                  <div className="h-4 bg-gray-300 rounded"></div>
                </div>
              </div>
            </div>
          ) : data && data.records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                    {displayColumns.map(column => (
                      <th
                        key={column.name}
                        onClick={() => handleSort(column.name)}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center">
                          {column.name.replace(/_/g, ' ')}
                          {sortBy === column.name && (
                            <span className="ml-1">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.records.map((record, idx) => (
                    <tr key={record[tableMetadata?.primaryKey || 'id'] || idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          <Link
                            href={`/admin/dynamic/${tableName}/${record[tableMetadata?.primaryKey || 'id']}`}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Edit
                          </Link>
                          <Link
                            href={`/admin/dynamic/${tableName}/${record[tableMetadata?.primaryKey || 'id']}`}
                            className="text-gray-600 hover:text-gray-900"
                          >
                            View
                          </Link>
                        </div>
                      </td>
                      {displayColumns.map(column => (
                        <td key={column.name} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatCellValue(record[column.name], column)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-gray-500">No records found</p>
              <Link
                href={`/admin/dynamic/${tableName}/new`}
                className="mt-4 inline-block text-blue-600 hover:underline"
              >
                Create your first record
              </Link>
            </div>
          )}

          {/* Pagination */}
          {data && data.total > limit && (
            <div className="bg-gray-50 px-6 py-3 flex justify-between items-center">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={!data.hasPrev}
                className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-700">
                Page {page} of {Math.ceil(data.total / limit)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!data.hasNext}
                className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900">Dynamic Table View</h3>
          <p className="text-sm text-blue-700 mt-2">
            This view is automatically generated from the {tableName} table schema.
            Click on column headers to sort, use the search box to filter records.
          </p>
        </div>
      </div>
    </div>
  );
}