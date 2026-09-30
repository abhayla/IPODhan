'use client';

import { useState, useEffect } from 'react';
import { adminGet, adminPost, adminFetch } from '@/lib/admin/admin-api-client';

interface CacheStats {
  totalKeys: number;
  memoryUsage: string;
  breakdown: {
    protection: number;
    ipo: number;
    subscription: number;
    gmp: number;
    other: number;
  };
}

interface NotificationConfig {
  email: {
    enabled: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    fromEmail: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
  triggers: {
    ipoLocked: boolean;
    ipoUnlocked: boolean;
    fieldProtectionEnabled: boolean;
    fieldProtectionDisabled: boolean;
    scraperUpdateBlocked: boolean;
    bulkOperationCompleted: boolean;
  };
}

export default function AdminSettingsPage() {
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    pattern?: string;
    clearAll?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
  });

  // Notification settings state
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig | null>(null);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [isTesting, setIsTesting] = useState<'email' | 'telegram' | null>(null);

  useEffect(() => {
    fetchCacheStats();
    fetchNotificationSettings();
  }, []);

  const fetchCacheStats = async () => {
    try {
      setIsLoadingStats(true);
      const data = await adminGet('/api/admin/cache/clear');

      if (data.success) {
        setCacheStats(data.data);
      } else {
        showNotification('error', 'Failed to load cache statistics');
      }
    } catch (error) {
      console.error('Failed to fetch cache stats:', error);
      showNotification('error', error instanceof Error ? error.message : 'Failed to load cache statistics');
    } finally {
      setIsLoadingStats(false);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const openConfirmDialog = (title: string, message: string, pattern?: string, clearAll?: boolean) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      pattern,
      clearAll,
    });
  };

  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
    });
  };

  const handleClearCache = async () => {
    try {
      setIsClearing(true);
      const data = await adminPost('/api/admin/cache/clear', {
        pattern: confirmDialog.pattern,
        clearAll: confirmDialog.clearAll,
      });

      if (data.success) {
        showNotification('success', data.message || 'Cache cleared successfully');
        await fetchCacheStats(); // Refresh stats
      } else {
        showNotification('error', data.error || 'Failed to clear cache');
      }
    } catch (error) {
      console.error('Failed to clear cache:', error);
      showNotification('error', error instanceof Error ? error.message : 'Failed to clear cache');
    } finally {
      setIsClearing(false);
      closeConfirmDialog();
    }
  };

  // Fetch notification settings
  const fetchNotificationSettings = async () => {
    try {
      setIsLoadingNotifications(true);
      const data = await adminGet('/api/admin/settings/notifications');

      if (data.success) {
        setNotificationConfig(data.data);
      } else {
        showNotification('error', 'Failed to load notification settings');
      }
    } catch (error) {
      console.error('Failed to fetch notification settings:', error);
      showNotification('error', error instanceof Error ? error.message : 'Failed to load notification settings');
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  // Save notification settings
  const handleSaveNotifications = async () => {
    if (!notificationConfig) return;

    try {
      setIsSavingNotifications(true);
      const data = await adminPost('/api/admin/settings/notifications', notificationConfig);

      if (data.success) {
        showNotification('success', 'Notification settings saved successfully');
      } else {
        showNotification('error', data.error || 'Failed to save notification settings');
      }
    } catch (error) {
      console.error('Failed to save notification settings:', error);
      showNotification('error', error instanceof Error ? error.message : 'Failed to save notification settings');
    } finally {
      setIsSavingNotifications(false);
    }
  };

  // Test notification
  const handleTestNotification = async (type: 'email' | 'telegram') => {
    if (type === 'email' && !testEmail) {
      showNotification('error', 'Please enter an email address');
      return;
    }

    try {
      setIsTesting(type);
      const data = await adminPost('/api/admin/notifications/test', { type, email: testEmail });

      if (data.success) {
        showNotification('success', `Test ${type} notification sent successfully`);
      } else {
        showNotification('error', data.results?.[type]?.error || 'Failed to send test notification');
      }
    } catch (error) {
      console.error('Failed to send test notification:', error);
      showNotification('error', error instanceof Error ? error.message : 'Failed to send test notification');
    } finally {
      setIsTesting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Admin Settings</h1>
        <p className="text-gray-400 mt-1">Configure admin panel preferences and security</p>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-lg shadow-lg ${
            notification.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          } animate-slide-in-right`}
        >
          <div className="flex items-center space-x-3">
            <span className="text-xl">
              {notification.type === 'success' ? '✓' : '✗'}
            </span>
            <span className="font-medium">{notification.message}</span>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-white mb-2">
              {confirmDialog.title}
            </h3>
            <p className="text-gray-400 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={closeConfirmDialog}
                disabled={isClearing}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearCache}
                disabled={isClearing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50 flex items-center space-x-2"
              >
                {isClearing && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                )}
                <span>{isClearing ? 'Clearing...' : 'Clear Cache'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Sections */}
      <div className="space-y-6">
        {/* Authentication Settings */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">Authentication</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Admin Token
              </label>
              <div className="bg-gray-900 px-4 py-3 rounded-lg border border-gray-600">
                <code className="text-sm text-gray-300">••••••••••••••••••••</code>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Token is stored in environment variable: <code>ADMIN_AUTH_TOKEN</code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Admin Panel Status
              </label>
              <div className="flex items-center space-x-2">
                <span className="inline-flex items-center px-3 py-1 bg-green-500/10 text-green-500 rounded-full text-sm font-medium">
                  ✓ Enabled
                </span>
                <span className="text-sm text-gray-400">
                  (via <code>ADMIN_PANEL_ENABLED=true</code>)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Notification Settings</h2>
            <button
              onClick={handleSaveNotifications}
              disabled={isSavingNotifications || !notificationConfig}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50 flex items-center space-x-2"
            >
              {isSavingNotifications && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              )}
              <span>{isSavingNotifications ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>

          {isLoadingNotifications ? (
            <div className="text-center py-8 text-gray-400">Loading notification settings...</div>
          ) : notificationConfig ? (
            <div className="space-y-6">
              {/* Email Notifications */}
              <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Email Notifications</h3>
                    <p className="text-sm text-gray-400">Send notifications via SMTP email</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notificationConfig.email.enabled}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          email: { ...notificationConfig.email, enabled: e.target.checked },
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {notificationConfig.email.enabled && (
                  <div className="space-y-3 mt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          SMTP Host
                        </label>
                        <input
                          type="text"
                          value={notificationConfig.email.smtpHost}
                          onChange={(e) =>
                            setNotificationConfig({
                              ...notificationConfig,
                              email: { ...notificationConfig.email, smtpHost: e.target.value },
                            })
                          }
                          placeholder="smtp.gmail.com"
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          SMTP Port
                        </label>
                        <input
                          type="number"
                          value={notificationConfig.email.smtpPort}
                          onChange={(e) =>
                            setNotificationConfig({
                              ...notificationConfig,
                              email: { ...notificationConfig.email, smtpPort: parseInt(e.target.value) },
                            })
                          }
                          placeholder="587"
                          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        SMTP Username
                      </label>
                      <input
                        type="text"
                        value={notificationConfig.email.smtpUser}
                        onChange={(e) =>
                          setNotificationConfig({
                            ...notificationConfig,
                            email: { ...notificationConfig.email, smtpUser: e.target.value },
                          })
                        }
                        placeholder="your.email@gmail.com"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        SMTP Password
                      </label>
                      <input
                        type="password"
                        value={notificationConfig.email.smtpPassword}
                        onChange={(e) =>
                          setNotificationConfig({
                            ...notificationConfig,
                            email: { ...notificationConfig.email, smtpPassword: e.target.value },
                          })
                        }
                        placeholder="Enter password"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        From Email Address
                      </label>
                      <input
                        type="email"
                        value={notificationConfig.email.fromEmail}
                        onChange={(e) =>
                          setNotificationConfig({
                            ...notificationConfig,
                            email: { ...notificationConfig.email, fromEmail: e.target.value },
                          })
                        }
                        placeholder="noreply@ipodhan.com"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* Test Email */}
                    <div className="flex space-x-2 pt-2">
                      <input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="test@example.com"
                        className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => handleTestNotification('email')}
                        disabled={isTesting === 'email'}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        {isTesting === 'email' ? 'Sending...' : 'Test Email'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Telegram Notifications */}
              <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Telegram Notifications</h3>
                    <p className="text-sm text-gray-400">Send notifications via Telegram bot</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notificationConfig.telegram.enabled}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          telegram: { ...notificationConfig.telegram, enabled: e.target.checked },
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {notificationConfig.telegram.enabled && (
                  <div className="space-y-3 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        Bot Token
                      </label>
                      <input
                        type="password"
                        value={notificationConfig.telegram.botToken}
                        onChange={(e) =>
                          setNotificationConfig({
                            ...notificationConfig,
                            telegram: { ...notificationConfig.telegram, botToken: e.target.value },
                          })
                        }
                        placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        Chat ID
                      </label>
                      <input
                        type="text"
                        value={notificationConfig.telegram.chatId}
                        onChange={(e) =>
                          setNotificationConfig({
                            ...notificationConfig,
                            telegram: { ...notificationConfig.telegram, chatId: e.target.value },
                          })
                        }
                        placeholder="-1001234567890"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <button
                      onClick={() => handleTestNotification('telegram')}
                      disabled={isTesting === 'telegram'}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50"
                    >
                      {isTesting === 'telegram' ? 'Sending...' : 'Test Telegram'}
                    </button>
                  </div>
                )}
              </div>

              {/* Notification Triggers */}
              <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
                <h3 className="text-lg font-semibold text-white mb-3">Notification Triggers</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Choose which events should trigger notifications
                </p>

                <div className="space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-300">IPO Locked</span>
                    <input
                      type="checkbox"
                      checked={notificationConfig.triggers.ipoLocked}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          triggers: { ...notificationConfig.triggers, ipoLocked: e.target.checked },
                        })
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-300">IPO Unlocked</span>
                    <input
                      type="checkbox"
                      checked={notificationConfig.triggers.ipoUnlocked}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          triggers: { ...notificationConfig.triggers, ipoUnlocked: e.target.checked },
                        })
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-300">Field Protection Enabled</span>
                    <input
                      type="checkbox"
                      checked={notificationConfig.triggers.fieldProtectionEnabled}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          triggers: { ...notificationConfig.triggers, fieldProtectionEnabled: e.target.checked },
                        })
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-300">Field Protection Disabled</span>
                    <input
                      type="checkbox"
                      checked={notificationConfig.triggers.fieldProtectionDisabled}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          triggers: { ...notificationConfig.triggers, fieldProtectionDisabled: e.target.checked },
                        })
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-300">Scraper Update Blocked</span>
                    <input
                      type="checkbox"
                      checked={notificationConfig.triggers.scraperUpdateBlocked}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          triggers: { ...notificationConfig.triggers, scraperUpdateBlocked: e.target.checked },
                        })
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-gray-300">Bulk Operation Completed</span>
                    <input
                      type="checkbox"
                      checked={notificationConfig.triggers.bulkOperationCompleted}
                      onChange={(e) =>
                        setNotificationConfig({
                          ...notificationConfig,
                          triggers: { ...notificationConfig.triggers, bulkOperationCompleted: e.target.checked },
                        })
                      }
                      className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">Failed to load settings</div>
          )}
        </div>

        {/* Cache Management */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Cache Management</h2>
            <button
              onClick={fetchCacheStats}
              disabled={isLoadingStats}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors disabled:opacity-50"
            >
              {isLoadingStats ? 'Refreshing...' : 'Refresh Stats'}
            </button>
          </div>

          <p className="text-gray-400 mb-6">
            Monitor and manage Redis cache to ensure optimal performance and fresh data.
          </p>

          {/* Cache Statistics */}
          {cacheStats && (
            <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 mb-6">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Cache Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-gray-500">Total Keys</div>
                  <div className="text-2xl font-bold text-white">
                    {cacheStats.totalKeys.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Memory Usage</div>
                  <div className="text-2xl font-bold text-white">{cacheStats.memoryUsage}</div>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <div className="text-xs text-gray-500 mb-2">Key Breakdown</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Protection:</span>
                      <span className="text-white font-medium">
                        {cacheStats.breakdown.protection}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">IPO:</span>
                      <span className="text-white font-medium">{cacheStats.breakdown.ipo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Subscription:</span>
                      <span className="text-white font-medium">
                        {cacheStats.breakdown.subscription}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">GMP:</span>
                      <span className="text-white font-medium">{cacheStats.breakdown.gmp}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Other:</span>
                      <span className="text-white font-medium">{cacheStats.breakdown.other}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Cache Actions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-700">
              <div>
                <div className="font-medium text-white">Clear Protection Caches</div>
                <div className="text-sm text-gray-400">
                  Removes all protection-related cache entries (protection:*)
                </div>
              </div>
              <button
                onClick={() =>
                  openConfirmDialog(
                    'Clear Protection Caches',
                    `This will clear ${cacheStats?.breakdown.protection || 0} protection cache keys. Are you sure?`,
                    'protection:*'
                  )
                }
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors whitespace-nowrap"
              >
                Clear Protection
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-700">
              <div>
                <div className="font-medium text-white">Clear IPO Caches</div>
                <div className="text-sm text-gray-400">
                  Removes all IPO-related cache entries (ipo:*)
                </div>
              </div>
              <button
                onClick={() =>
                  openConfirmDialog(
                    'Clear IPO Caches',
                    `This will clear ${cacheStats?.breakdown.ipo || 0} IPO cache keys. Are you sure?`,
                    'ipo:*'
                  )
                }
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-md transition-colors whitespace-nowrap"
              >
                Clear IPO
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-700">
              <div>
                <div className="font-medium text-white">Clear All Caches</div>
                <div className="text-sm text-gray-400">
                  Removes all cache entries - use with caution
                </div>
              </div>
              <button
                onClick={() =>
                  openConfirmDialog(
                    'Clear All Caches',
                    `This will clear ALL ${cacheStats?.totalKeys || 0} cache keys. This action cannot be undone. Are you sure?`,
                    undefined,
                    true
                  )
                }
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors whitespace-nowrap"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
            <p className="text-xs text-blue-300">
              <strong>Note:</strong> Cache will automatically rebuild on next request. Clearing cache
              may temporarily increase database load and response times.
            </p>
          </div>
        </div>

        {/* System Info */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">System Information</h2>
          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b border-gray-700">
              <span className="text-gray-400">Version:</span>
              <span className="text-white font-medium">Phase 3 (Admin UI)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-700">
              <span className="text-gray-400">Phase 1 Status:</span>
              <span className="text-green-500 font-medium">✓ Complete</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-400">API Base URL:</span>
              <code className="text-white text-sm">/api/admin/protection/*</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
