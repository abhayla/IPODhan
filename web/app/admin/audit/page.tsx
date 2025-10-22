'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AuditLog {
  id: string;
  timestamp: string;
  adminUser: string;
  actionType: string;
  companyName: string | null;
  companySlug: string | null;
  tableName: string | null;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  success: boolean;
  errorMessage: string | null;
}

interface Filters {
  startDate: string;
  endDate: string;
  adminUser: string;
  actionType: string;
  ipoSearch: string;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter options
  const [adminUsers, setAdminUsers] = useState<string[]>([]);
  const [actionTypes, setActionTypes] = useState<string[]>([]);

  // Filter state
  const [filters, setFilters] = useState<Filters>({
    startDate: '',
    endDate: '',
    adminUser: '',
    actionType: '',
    ipoSearch: '',
  });

  // Pagination
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });

  // Fetch audit logs
  const fetchAuditLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
      });

      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.adminUser) params.append('adminUser', filters.adminUser);
      if (filters.actionType) params.append('actionType', filters.actionType);

      const response = await fetch(`/api/admin/audit?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch audit logs');
      }

      setLogs(data.data);
      setPagination(data.pagination);
      setAdminUsers(data.filters.adminUsers);
      setActionTypes(data.filters.actionTypes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchAuditLogs();
  }, [page]);

  // Handle filter change
  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // Apply filters
  const applyFilters = () => {
    setPage(1); // Reset to page 1
    fetchAuditLogs();
  };

  // Reset filters
  const resetFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      adminUser: '',
      actionType: '',
      ipoSearch: '',
    });
    setPage(1);
  };

  // Export CSV
  const exportCSV = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.adminUser) params.append('adminUser', filters.adminUser);
      if (filters.actionType) params.append('actionType', filters.actionType);

      const response = await fetch(`/api/admin/audit/export?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to export audit logs');
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export');
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  // Get action type badge color
  const getActionTypeBadge = (actionType: string, success: boolean) => {
    if (!success) {
      return 'bg-red-600 text-white';
    }

    if (actionType.includes('Locked') || actionType.includes('Protected')) {
      return 'bg-yellow-600 text-white';
    }

    if (actionType.includes('Unlocked') || actionType.includes('Disabled')) {
      return 'bg-green-600 text-white';
    }

    if (actionType.includes('Updated') || actionType.includes('Added')) {
      return 'bg-blue-600 text-white';
    }

    if (actionType.includes('Cleared') || actionType.includes('Deleted')) {
      return 'bg-orange-600 text-white';
    }

    return 'bg-gray-600 text-white';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Audit Log</h1>
          <p className="text-gray-400 mt-1">
            View all admin activity and data modifications
          </p>
        </div>

        <button
          onClick={exportCSV}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors flex items-center space-x-2"
        >
          <span>📥</span>
          <span>Export CSV</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white mb-4">Filters</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Date Range */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Admin User */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Admin User
            </label>
            <select
              value={filters.adminUser}
              onChange={(e) => handleFilterChange('adminUser', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Users</option>
              {adminUsers.map((user) => (
                <option key={user} value={user}>
                  {user}
                </option>
              ))}
            </select>
          </div>

          {/* Action Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Action Type
            </label>
            <select
              value={filters.actionType}
              onChange={(e) => handleFilterChange('actionType', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Actions</option>
              {actionTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* IPO Search */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              IPO Search
            </label>
            <input
              type="text"
              value={filters.ipoSearch}
              onChange={(e) => handleFilterChange('ipoSearch', e.target.value)}
              placeholder="Search by IPO name..."
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Filter Actions */}
        <div className="flex space-x-4">
          <button
            onClick={applyFilters}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors"
          >
            Apply Filters
          </button>

          <button
            onClick={resetFilters}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-md transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Results Summary */}
      <div className="bg-gray-800 rounded-lg p-4">
        <p className="text-gray-300">
          Showing <span className="font-semibold text-white">{logs.length}</span> of{' '}
          <span className="font-semibold text-white">{pagination.total}</span> total
          logs (Page {pagination.page} of {pagination.totalPages})
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-900/50 border border-red-600 rounded-lg p-4">
          <p className="text-red-200">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {/* Audit Log Table */}
      {!loading && !error && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Admin User
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Action Type
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    IPO
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Details
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    IP Address
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-200">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      No audit logs found matching your filters
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-gray-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </td>

                      <td className="px-4 py-3 text-sm text-white font-medium">
                        {log.adminUser}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded ${getActionTypeBadge(
                            log.actionType,
                            log.success
                          )}`}
                        >
                          {log.actionType}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {log.companyName && log.companySlug ? (
                          <Link
                            href={`/admin/edit/${log.companySlug}`}
                            className="text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {log.companyName}
                          </Link>
                        ) : (
                          <span className="text-gray-500">N/A</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm text-gray-300">
                        {log.fieldName && (
                          <div className="space-y-1">
                            <div>
                              <span className="text-gray-400">Field:</span>{' '}
                              <span className="font-mono">{log.fieldName}</span>
                            </div>
                            {log.oldValue !== null && log.newValue !== null && (
                              <div className="text-xs">
                                <span className="text-red-400">{log.oldValue}</span>
                                {' → '}
                                <span className="text-green-400">{log.newValue}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {log.errorMessage && (
                          <div className="text-red-400 text-xs mt-1">
                            {log.errorMessage}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm text-gray-400 font-mono">
                        {log.ipAddress || 'N/A'}
                      </td>

                      <td className="px-4 py-3 text-center">
                        {log.success ? (
                          <span className="text-green-400 text-xl">✓</span>
                        ) : (
                          <span className="text-red-400 text-xl">✗</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="bg-gray-700 px-4 py-3 flex items-center justify-between">
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!pagination.hasPrev}
                  className={`px-4 py-2 rounded-md font-medium transition-colors ${
                    pagination.hasPrev
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Previous
                </button>

                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!pagination.hasNext}
                  className={`px-4 py-2 rounded-md font-medium transition-colors ${
                    pagination.hasNext
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Next
                </button>
              </div>

              <div className="text-gray-300 text-sm">
                Page {pagination.page} of {pagination.totalPages}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
