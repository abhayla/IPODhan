'use client';

/**
 * Data Conflicts Dashboard
 * Admin interface for resolving scraper data conflicts
 *
 * Features:
 * - View unresolved conflicts with IPO context
 * - Filter by severity (INFO, WARNING, CRITICAL)
 * - Filter by specific IPO
 * - One-click resolution with source selection
 * - Bulk resolution (select multiple conflicts)
 * - Auto-resolution (ADMIN source always wins)
 * - Real-time statistics
 * - Complete audit trail
 *
 * Data Flow:
 * 1. Multiple scrapers provide conflicting data
 * 2. Conflicts logged in data_conflicts table
 * 3. Admin reviews conflicts in this dashboard
 * 4. Admin chooses winning source
 * 5. Value applied to IPO + field protected (optional)
 * 6. Conflict marked as resolved
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { adminGet, adminPost } from '@/lib/admin/admin-api-client';

interface Conflict {
  id: string;
  ipoId: string;
  ipoName: string;
  ipoSlug: string;
  ipoStatus: string;
  tableName: string;
  fieldName: string;
  source1: string;
  value1: string | null;
  source2: string;
  value2: string | null;
  conflictReason: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  detectedAt: string;
}

interface ConflictStats {
  totalUnresolved: number;
  bySeverity: {
    INFO: number;
    WARNING: number;
    CRITICAL: number;
  };
  byIPO: Array<{
    ipoId: string;
    ipoName: string;
    conflictCount: number;
  }>;
  mostProblematicFields: Array<{
    fieldName: string;
    conflictCount: number;
  }>;
}

interface Filters {
  severity: '' | 'INFO' | 'WARNING' | 'CRITICAL';
  ipoId: string;
}

export default function ConflictsPage() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [stats, setStats] = useState<ConflictStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  // Filters
  const [filters, setFilters] = useState<Filters>({
    severity: '',
    ipoId: '',
  });

  // Bulk selection
  const [selectedConflicts, setSelectedConflicts] = useState<Set<string>>(new Set());

  // Resolution modal state
  const [resolvingConflict, setResolvingConflict] = useState<Conflict | null>(null);
  const [chosenSource, setChosenSource] = useState<string>('');
  const [resolutionReason, setResolutionReason] = useState('');
  const [applyToDatabase, setApplyToDatabase] = useState(true);
  const [protectField, setProtectField] = useState(false);

  // Auto-resolve state
  const [autoResolveMode, setAutoResolveMode] = useState(false);
  const [autoResolvePreview, setAutoResolvePreview] = useState<any>(null);

  /**
   * Fetch conflicts and stats
   */
  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.severity) params.append('severity', filters.severity);
      if (filters.ipoId) params.append('ipoId', filters.ipoId);

      const [conflictsData, statsData] = await Promise.all([
        adminGet(`/api/admin/conflicts?${params.toString()}`),
        adminGet('/api/admin/conflicts/stats'),
      ]);

      setConflicts(conflictsData.conflicts);
      setStats(statsData.stats);
      setSelectedConflicts(new Set()); // Clear selection
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch conflicts');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchData();
  }, []);

  /**
   * Handle filter change
   */
  const applyFilters = () => {
    fetchData();
  };

  const resetFilters = () => {
    setFilters({ severity: '', ipoId: '' });
  };

  /**
   * Toggle conflict selection for bulk operations
   */
  const toggleConflictSelection = (conflictId: string) => {
    const newSelection = new Set(selectedConflicts);
    if (newSelection.has(conflictId)) {
      newSelection.delete(conflictId);
    } else {
      newSelection.add(conflictId);
    }
    setSelectedConflicts(newSelection);
  };

  /**
   * Select all conflicts
   */
  const selectAll = () => {
    setSelectedConflicts(new Set(conflicts.map((c) => c.id)));
  };

  /**
   * Deselect all conflicts
   */
  const deselectAll = () => {
    setSelectedConflicts(new Set());
  };

  /**
   * Open resolution modal for single conflict
   */
  const openResolutionModal = (conflict: Conflict) => {
    setResolvingConflict(conflict);
    setChosenSource(conflict.source1); // Default to source1
    setResolutionReason('');
    setApplyToDatabase(true);
    setProtectField(false);
  };

  /**
   * Close resolution modal
   */
  const closeResolutionModal = () => {
    setResolvingConflict(null);
    setChosenSource('');
    setResolutionReason('');
  };

  /**
   * Resolve a single conflict
   */
  const resolveSingleConflict = async () => {
    if (!resolvingConflict || !chosenSource || !resolutionReason.trim()) {
      alert('Please select a source and provide a reason');
      return;
    }

    setResolving(resolvingConflict.id);

    try {
      await adminPost('/api/admin/conflicts', {
        conflictId: resolvingConflict.id,
        resolvedSource: chosenSource,
        resolutionReason: resolutionReason,
        resolvedBy: 'admin', // TODO: Get from auth context
        applyToDatabase,
        protectField,
      });

      closeResolutionModal();
      fetchData(); // Refresh
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to resolve conflict');
    } finally {
      setResolving(null);
    }
  };

  /**
   * Bulk resolve conflicts
   */
  const bulkResolve = async () => {
    if (selectedConflicts.size === 0) {
      alert('Please select conflicts to resolve');
      return;
    }

    const source = prompt('Which source should win for all selected conflicts? (ADMIN, DRHP, NSE, BSE, etc.)');
    if (!source) return;

    const reason = prompt('Resolution reason:');
    if (!reason) return;

    setResolving('bulk');

    try {
      const result = await adminPost('/api/admin/conflicts/bulk-resolve', {
        conflictIds: Array.from(selectedConflicts),
        resolvedSource: source,
        resolutionReason: reason,
        resolvedBy: 'admin', // TODO: Get from auth context
        applyToDatabase: true,
        protectField: false,
      });

      alert(`Resolved ${result.successful} of ${selectedConflicts.size} conflicts`);
      fetchData(); // Refresh
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to bulk resolve conflicts');
    } finally {
      setResolving(null);
    }
  };

  /**
   * Auto-resolve conflicts (ADMIN wins)
   */
  const autoResolve = async (dryRun: boolean = false) => {
    setResolving('auto');

    try {
      const result = await adminPost('/api/admin/conflicts/auto-resolve', {
        dryRun,
      });

      if (dryRun) {
        setAutoResolvePreview(result);
        setAutoResolveMode(true);
      } else {
        alert(`Auto-resolved ${result.resolved} conflicts (${result.skipped} skipped for manual review)`);
        setAutoResolveMode(false);
        setAutoResolvePreview(null);
        fetchData(); // Refresh
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to auto-resolve conflicts');
    } finally {
      setResolving(null);
    }
  };

  /**
   * Format date
   */
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  /**
   * Get severity badge color
   */
  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-600 text-white';
      case 'WARNING':
        return 'bg-yellow-600 text-white';
      case 'INFO':
        return 'bg-blue-600 text-white';
      default:
        return 'bg-gray-600 text-white';
    }
  };

  /**
   * Get source badge color
   */
  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'ADMIN':
        return 'bg-red-500 text-white';
      case 'DRHP':
        return 'bg-purple-500 text-white';
      case 'NSE':
        return 'bg-blue-500 text-white';
      case 'BSE':
        return 'bg-green-500 text-white';
      case 'MONEYCONTROL':
        return 'bg-yellow-500 text-white';
      case 'CHITTORGARH':
        return 'bg-orange-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Data Conflicts Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Resolve conflicts between scraper data sources
          </p>
        </div>

        <button
          onClick={() => fetchData()}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="text-gray-400 text-sm font-medium">Total Conflicts</div>
            <div className="text-3xl font-bold text-white mt-2">
              {stats.totalUnresolved}
            </div>
          </div>

          <div className="bg-red-900/30 border border-red-600 rounded-lg p-6">
            <div className="text-red-300 text-sm font-medium">Critical</div>
            <div className="text-3xl font-bold text-red-400 mt-2">
              {stats.bySeverity.CRITICAL}
            </div>
          </div>

          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-6">
            <div className="text-yellow-300 text-sm font-medium">Warning</div>
            <div className="text-3xl font-bold text-yellow-400 mt-2">
              {stats.bySeverity.WARNING}
            </div>
          </div>

          <div className="bg-blue-900/30 border border-blue-600 rounded-lg p-6">
            <div className="text-blue-300 text-sm font-medium">Info</div>
            <div className="text-3xl font-bold text-blue-400 mt-2">
              {stats.bySeverity.INFO}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white mb-4">Filters</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Severity Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Severity
            </label>
            <select
              value={filters.severity}
              onChange={(e) => setFilters({ ...filters, severity: e.target.value as any })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </div>

          {/* IPO Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              IPO
            </label>
            <select
              value={filters.ipoId}
              onChange={(e) => setFilters({ ...filters, ipoId: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All IPOs</option>
              {stats?.byIPO.map((ipo) => (
                <option key={ipo.ipoId} value={ipo.ipoId}>
                  {ipo.ipoName} ({ipo.conflictCount})
                </option>
              ))}
            </select>
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

      {/* Bulk Actions */}
      {conflicts.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-gray-300">
              {selectedConflicts.size} selected
            </span>

            {selectedConflicts.size === 0 ? (
              <button
                onClick={selectAll}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
              >
                Select All
              </button>
            ) : (
              <button
                onClick={deselectAll}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
              >
                Deselect All
              </button>
            )}

            {selectedConflicts.size > 0 && (
              <button
                onClick={bulkResolve}
                disabled={resolving === 'bulk'}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50 flex items-center space-x-2"
              >
                <span>✓</span>
                <span>Bulk Resolve ({selectedConflicts.size})</span>
              </button>
            )}
          </div>

          <button
            onClick={() => autoResolve(true)}
            disabled={resolving === 'auto'}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors disabled:opacity-50 flex items-center space-x-2"
          >
            <span>⚡</span>
            <span>Auto-Resolve Preview</span>
          </button>
        </div>
      )}

      {/* Auto-Resolve Preview Modal */}
      {autoResolveMode && autoResolvePreview && (
        <div className="bg-purple-900/30 border border-purple-600 rounded-lg p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-semibold text-white">Auto-Resolve Preview</h3>
              <p className="text-gray-400 text-sm mt-1">
                These conflicts will be auto-resolved (ADMIN source always wins)
              </p>
            </div>
            <button
              onClick={() => setAutoResolveMode(false)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          <div className="bg-gray-800 rounded p-4 mb-4">
            <p className="text-white">
              <span className="font-semibold text-green-400">{autoResolvePreview.resolved}</span> conflicts will be auto-resolved
            </p>
            <p className="text-gray-400">
              <span className="font-semibold text-yellow-400">{autoResolvePreview.skipped}</span> conflicts require manual review
            </p>
          </div>

          {autoResolvePreview.details.length > 0 && (
            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {autoResolvePreview.details.map((detail: any, index: number) => (
                <div key={index} className="bg-gray-800 rounded p-3 text-sm">
                  <div className="text-white font-medium">{detail.fieldName}</div>
                  <div className="text-gray-400">
                    Source: <span className="text-purple-400">{detail.chosenSource}</span> - {detail.reason}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex space-x-4">
            <button
              onClick={() => autoResolve(false)}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-md transition-colors"
            >
              ✓ Confirm Auto-Resolve
            </button>

            <button
              onClick={() => setAutoResolveMode(false)}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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

      {/* Conflicts Table */}
      {!loading && !error && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedConflicts.size === conflicts.length && conflicts.length > 0}
                      onChange={(e) => e.target.checked ? selectAll() : deselectAll()}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Severity
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    IPO
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Field
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Source 1
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Source 2
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-200">
                    Detected At
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-200">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {conflicts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                      🎉 No unresolved conflicts! All data is in harmony.
                    </td>
                  </tr>
                ) : (
                  conflicts.map((conflict) => (
                    <tr
                      key={conflict.id}
                      className="hover:bg-gray-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedConflicts.has(conflict.id)}
                          onChange={() => toggleConflictSelection(conflict.id)}
                          className="w-4 h-4"
                        />
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded ${getSeverityBadge(
                            conflict.severity
                          )}`}
                        >
                          {conflict.severity}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-sm">
                        <Link
                          href={`/admin/dynamic/ipos/${conflict.ipoId}`}
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          {conflict.ipoName}
                        </Link>
                        <div className="text-xs text-gray-500">{conflict.ipoStatus}</div>
                      </td>

                      <td className="px-4 py-3 text-sm font-mono text-white">
                        {conflict.fieldName}
                      </td>

                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded ${getSourceBadge(
                              conflict.source1
                            )}`}
                          >
                            {conflict.source1}
                          </span>
                          <div className="text-sm text-white mt-1 font-mono">
                            {conflict.value1 || <span className="text-gray-500">null</span>}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded ${getSourceBadge(
                              conflict.source2
                            )}`}
                          >
                            {conflict.source2}
                          </span>
                          <div className="text-sm text-white mt-1 font-mono">
                            {conflict.value2 || <span className="text-gray-500">null</span>}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-sm text-gray-300">
                        {conflict.conflictReason}
                      </td>

                      <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">
                        {formatDate(conflict.detectedAt)}
                      </td>

                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => openResolutionModal(conflict)}
                          disabled={resolving === conflict.id}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors disabled:opacity-50"
                        >
                          {resolving === conflict.id ? '...' : 'Resolve'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Resolution Modal */}
      {resolvingConflict && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">Resolve Conflict</h2>
                <p className="text-gray-400 mt-1">
                  Choose the winning source for this field
                </p>
              </div>
              <button
                onClick={closeResolutionModal}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>

            {/* Conflict Details */}
            <div className="bg-gray-700 rounded p-4 mb-6 space-y-2">
              <div>
                <span className="text-gray-400">IPO:</span>{' '}
                <span className="text-white font-medium">{resolvingConflict.ipoName}</span>
              </div>
              <div>
                <span className="text-gray-400">Field:</span>{' '}
                <span className="text-white font-mono">{resolvingConflict.fieldName}</span>
              </div>
              <div>
                <span className="text-gray-400">Reason:</span>{' '}
                <span className="text-white">{resolvingConflict.conflictReason}</span>
              </div>
            </div>

            {/* Source Selection */}
            <div className="space-y-4 mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Choose Winning Source
              </label>

              <div className="space-y-3">
                {/* Source 1 Option */}
                <label className="flex items-start space-x-3 p-4 border border-gray-600 rounded cursor-pointer hover:bg-gray-700 transition-colors">
                  <input
                    type="radio"
                    name="source"
                    value={resolvingConflict.source1}
                    checked={chosenSource === resolvingConflict.source1}
                    onChange={(e) => setChosenSource(e.target.value)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded ${getSourceBadge(
                          resolvingConflict.source1
                        )}`}
                      >
                        {resolvingConflict.source1}
                      </span>
                    </div>
                    <div className="text-white font-mono mt-2">
                      {resolvingConflict.value1 || <span className="text-gray-500">null</span>}
                    </div>
                  </div>
                </label>

                {/* Source 2 Option */}
                <label className="flex items-start space-x-3 p-4 border border-gray-600 rounded cursor-pointer hover:bg-gray-700 transition-colors">
                  <input
                    type="radio"
                    name="source"
                    value={resolvingConflict.source2}
                    checked={chosenSource === resolvingConflict.source2}
                    onChange={(e) => setChosenSource(e.target.value)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded ${getSourceBadge(
                          resolvingConflict.source2
                        )}`}
                      >
                        {resolvingConflict.source2}
                      </span>
                    </div>
                    <div className="text-white font-mono mt-2">
                      {resolvingConflict.value2 || <span className="text-gray-500">null</span>}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Resolution Reason */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Resolution Reason <span className="text-red-400">*</span>
              </label>
              <textarea
                value={resolutionReason}
                onChange={(e) => setResolutionReason(e.target.value)}
                placeholder="Explain why you chose this source..."
                rows={3}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Options */}
            <div className="space-y-3 mb-6">
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={applyToDatabase}
                  onChange={(e) => setApplyToDatabase(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-gray-300">
                  Apply winning value to database (recommended)
                </span>
              </label>

              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={protectField}
                  onChange={(e) => setProtectField(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-gray-300">
                  Protect field from future scraper overwrites
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex space-x-4">
              <button
                onClick={resolveSingleConflict}
                disabled={!chosenSource || !resolutionReason.trim() || resolving === resolvingConflict.id}
                className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resolving === resolvingConflict.id ? 'Resolving...' : '✓ Resolve Conflict'}
              </button>

              <button
                onClick={closeResolutionModal}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
