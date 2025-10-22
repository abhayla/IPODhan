'use client';

import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';

interface BlockedNotification {
  ipoId: string;
  tableName: string;
  fieldName: string;
  scraperName: string;
  attemptedValue: any;
  reason: string;
  timestamp: string;
}

interface NotificationData {
  notifications: BlockedNotification[];
  groupedByIPO: Record<string, BlockedNotification[]>;
  stats: {
    total: number;
    byReason: Record<string, number>;
    byScraper: Record<string, number>;
  };
}

export default function AdminNotificationsPage() {
  const { token } = useAdminAuth();
  const [data, setData] = useState<NotificationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    fetchNotifications();
  }, [limit]);

  const fetchNotifications = async () => {
    if (!token) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/protection/notifications?limit=${limit}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const result = await response.json();
        setData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading notifications...</p>
        </div>
      </div>
    );
  }

  const hasNotifications = data && data.notifications.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Blocked Updates</h1>
          <p className="text-gray-400 mt-1">
            Scraper updates that were blocked due to protection flags
          </p>
        </div>

        <button
          onClick={fetchNotifications}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      {hasNotifications && data.stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="text-sm text-gray-400 mb-1">Total Blocked</div>
            <div className="text-3xl font-bold text-white">{data.stats.total}</div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="text-sm text-gray-400 mb-2">By Reason</div>
            <div className="space-y-1">
              {Object.entries(data.stats.byReason).map(([reason, count]) => (
                <div key={reason} className="flex justify-between text-sm">
                  <span className="text-gray-300">{reason}:</span>
                  <span className="text-white font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="text-sm text-gray-400 mb-2">By Scraper</div>
            <div className="space-y-1">
              {Object.entries(data.stats.byScraper).map(([scraper, count]) => (
                <div key={scraper} className="flex justify-between text-sm">
                  <span className="text-gray-300">{scraper}:</span>
                  <span className="text-white font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Limit Selector */}
      <div className="flex items-center justify-end space-x-4">
        <label className="text-sm text-gray-400">Show:</label>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={20}>Last 20</option>
          <option value={50}>Last 50</option>
          <option value={100}>Last 100</option>
        </select>
      </div>

      {/* Notifications Table */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        {!hasNotifications ? (
          <div className="p-12 text-center">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-xl font-semibold text-white mb-2">No Blocked Updates</h3>
            <p className="text-gray-400">
              All scraper updates are going through successfully. This means either no protection
              flags are set, or scrapers haven't tried to update protected fields.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900 border-b border-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    IPO
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Field
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Scraper
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Attempted Value
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {data.notifications.map((notification, index) => (
                  <tr key={index} className="hover:bg-gray-750 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {new Date(notification.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        <div className="font-medium text-white truncate max-w-xs">
                          {notification.ipoId}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        <div className="text-gray-300">{notification.tableName}</div>
                        <div className="text-gray-500 text-xs">{notification.fieldName}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {notification.scraperName}
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-xs bg-gray-900 px-2 py-1 rounded text-gray-300">
                        {typeof notification.attemptedValue === 'object'
                          ? JSON.stringify(notification.attemptedValue)
                          : String(notification.attemptedValue)}
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          notification.reason === 'IPO_LOCKED'
                            ? 'bg-red-500 text-white'
                            : 'bg-yellow-500 text-white'
                        }`}
                      >
                        {notification.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
