'use client';

import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import Link from 'next/link';

interface IPO {
  id: string;
  companyName: string;
  slug: string;
  status: string;
  segment: string | null;
  scraperLocked: boolean;
  lastManualEditAt: string | null;
  openDate: string | null;
  closeDate: string | null;
}

export default function AdminDashboardPage() {
  const { token } = useAdminAuth();
  const [ipos, setIpos] = useState<IPO[]>([]);
  const [filteredIpos, setFilteredIpos] = useState<IPO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [segmentFilter, setSegmentFilter] = useState('ALL');
  const [lockFilter, setLockFilter] = useState('ALL');

  useEffect(() => {
    if (token) {
      fetchIPOs();
    }
  }, [token]);

  useEffect(() => {
    applyFilters();
  }, [searchQuery, statusFilter, segmentFilter, lockFilter, ipos]);

  const fetchIPOs = async () => {
    try {
      setIsLoading(true);

      if (!token) {
        console.error('No admin token available');
        return;
      }

      const response = await fetch('/api/admin/ipos?limit=100', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (data.success) {
        setIpos(data.data);
        setFilteredIpos(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch IPOs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...ipos];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((ipo) =>
        ipo.companyName.toLowerCase().includes(query) ||
        ipo.slug.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'ALL') {
      filtered = filtered.filter((ipo) => ipo.status === statusFilter);
    }

    // Segment filter
    if (segmentFilter !== 'ALL') {
      filtered = filtered.filter((ipo) => ipo.segment === segmentFilter);
    }

    // Lock filter
    if (lockFilter === 'LOCKED') {
      filtered = filtered.filter((ipo) => ipo.scraperLocked);
    } else if (lockFilter === 'UNLOCKED') {
      filtered = filtered.filter((ipo) => !ipo.scraperLocked);
    }

    setFilteredIpos(filtered);
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      UPCOMING: 'bg-blue-500',
      OPEN: 'bg-green-500',
      CLOSED: 'bg-yellow-500',
      LISTED: 'bg-purple-500',
    };
    return colors[status as keyof typeof colors] || 'bg-gray-500';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading IPOs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Admin Interface Migration Notice */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-blue-800">
              Admin Interface Update
            </h3>
            <div className="mt-1 text-sm text-blue-700">
              <p>
                The "Edit" button now opens the new <strong>Dynamic Admin</strong> interface by default, which provides 100% field coverage (450+ fields) and advanced features like field protection and DRHP extraction. The legacy interface remains accessible via the "(Legacy)" link during the transition period.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">IPO Management</h1>
          <p className="text-gray-400 mt-1">
            Manage manual data and protection flags for {ipos.length} IPOs
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Search IPOs
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by company name or slug..."
              className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="UPCOMING">Upcoming</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
              <option value="LISTED">Listed</option>
            </select>
          </div>

          {/* Segment Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Segment
            </label>
            <select
              value={segmentFilter}
              onChange={(e) => setSegmentFilter(e.target.value)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Segments</option>
              <option value="MAINBOARD">Mainboard</option>
              <option value="SME">SME</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
          <div className="text-sm text-gray-400">
            Showing {filteredIpos.length} of {ipos.length} IPOs
          </div>

          <div className="flex space-x-2">
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
                setSegmentFilter('ALL');
                setLockFilter('ALL');
              }}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* IPO Table */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900 border-b border-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Company
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Segment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Dates
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Protection
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredIpos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                    No IPOs found matching your filters
                  </td>
                </tr>
              ) : (
                filteredIpos.map((ipo) => (
                  <tr key={ipo.id} className="hover:bg-gray-750 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium text-white">{ipo.companyName}</div>
                        <div className="text-sm text-gray-400">{ipo.slug}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${getStatusBadge(
                          ipo.status
                        )}`}
                      >
                        {ipo.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-300">{ipo.segment || 'N/A'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-300">
                        {ipo.openDate && (
                          <div>Open: {new Date(ipo.openDate).toLocaleDateString()}</div>
                        )}
                        {ipo.closeDate && (
                          <div>Close: {new Date(ipo.closeDate).toLocaleDateString()}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {ipo.scraperLocked ? (
                        <span className="inline-flex items-center space-x-1 text-red-400">
                          <span>🔒</span>
                          <span className="text-sm">Locked</span>
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">Unlocked</span>
                      )}
                      {ipo.lastManualEditAt && (
                        <div className="text-xs text-gray-500 mt-1">
                          Edited: {new Date(ipo.lastManualEditAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end space-x-3">
                        {/* Primary: Dynamic Admin */}
                        <Link
                          href={`/admin/dynamic/ipos/${ipo.id}`}
                          className="inline-flex items-center px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
                        >
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
