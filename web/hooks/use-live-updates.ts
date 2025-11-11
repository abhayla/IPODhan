'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getRealtimeClient,
  type ConnectionStatus,
  type LiveUpdateType,
  type LiveUpdateMessage,
} from '@/lib/websocket/client';

/**
 * use-live-updates Hook - Phase 3: Real-Time Experience
 *
 * React hook for consuming live IPO data updates.
 * Manages connection lifecycle, state updates, and cleanup.
 *
 * Features:
 * - Automatic connection management
 * - Type-safe subscriptions
 * - React state integration
 * - Cleanup on unmount
 * - Connection status monitoring
 */

export interface UseLiveUpdatesOptions<T = any> {
  type: LiveUpdateType;
  ipoId?: string;           // Optional: filter by specific IPO
  enabled?: boolean;        // Enable/disable subscription
  onUpdate?: (data: T) => void; // Callback on each update
}

export interface UseLiveUpdatesReturn<T = any> {
  data: T | null;
  status: ConnectionStatus;
  isConnected: boolean;
  lastUpdate: number | null;
  error: Error | null;
}

/**
 * Subscribe to live updates for a specific type
 *
 * @example
 * ```tsx
 * const { data, isConnected } = useLiveUpdates({
 *   type: 'subscription',
 *   ipoId: 'xyz-ipo',
 * });
 * ```
 */
export function useLiveUpdates<T = any>(
  options: UseLiveUpdatesOptions<T>
): UseLiveUpdatesReturn<T> {
  const { type, ipoId, enabled = true, onUpdate } = options;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const clientRef = useRef(getRealtimeClient());
  const isConnected = status === 'connected';

  useEffect(() => {
    if (!enabled) return;

    const client = clientRef.current;

    // Subscribe to connection status
    const unsubscribeStatus = client.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'error') {
        setError(new Error('Connection error'));
      }
    });

    // Subscribe to data updates
    const unsubscribeData = client.on<T>(type, (message: LiveUpdateMessage<T>) => {
      // Filter by IPO ID if specified
      if (ipoId && message.ipoId !== ipoId) {
        return;
      }

      setData(message.data);
      setLastUpdate(message.timestamp);
      setError(null);

      // Call optional callback
      if (onUpdate) {
        onUpdate(message.data);
      }
    });

    // Connect if not already connected
    if (client.getStatus() === 'disconnected') {
      client.connect();
    }

    // Update initial status
    setStatus(client.getStatus());

    // Cleanup on unmount
    return () => {
      unsubscribeStatus();
      unsubscribeData();
    };
  }, [type, ipoId, enabled, onUpdate]);

  return {
    data,
    status,
    isConnected,
    lastUpdate,
    error,
  };
}

/**
 * Subscribe to multiple update types at once
 *
 * @example
 * ```tsx
 * const updates = useMultipleLiveUpdates([
 *   { type: 'subscription', ipoId: 'xyz' },
 *   { type: 'gmp', ipoId: 'xyz' },
 * ]);
 * ```
 */
export function useMultipleLiveUpdates<T = any>(
  subscriptions: Array<Omit<UseLiveUpdatesOptions<T>, 'onUpdate'>>
): Array<UseLiveUpdatesReturn<T>> {
  const results = subscriptions.map((sub) => useLiveUpdates(sub));
  return results;
}

/**
 * Hook for connection status only (no data subscription)
 *
 * @example
 * ```tsx
 * const { status, isConnected } = useConnectionStatus();
 * ```
 */
export function useConnectionStatus(): {
  status: ConnectionStatus;
  isConnected: boolean;
  reconnect: () => void;
  disconnect: () => void;
} {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const clientRef = useRef(getRealtimeClient());

  const reconnect = useCallback(() => {
    clientRef.current.disconnect();
    clientRef.current.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current.disconnect();
  }, []);

  useEffect(() => {
    const client = clientRef.current;

    const unsubscribe = client.onStatusChange(setStatus);

    // Connect if not already connected
    if (client.getStatus() === 'disconnected') {
      client.connect();
    }

    // Set initial status
    setStatus(client.getStatus());

    return unsubscribe;
  }, []);

  return {
    status,
    isConnected: status === 'connected',
    reconnect,
    disconnect,
  };
}

/**
 * Hook for subscription data specifically
 */
export interface SubscriptionData {
  overall: number;
  qib: number;
  nii: number;
  retail: number;
  trend: 'accelerating' | 'slowing';
}

export function useSubscriptionUpdates(ipoId?: string) {
  return useLiveUpdates<SubscriptionData>({
    type: 'subscription',
    ipoId,
  });
}

/**
 * Hook for GMP data specifically
 */
export interface GMPData {
  current: number;
  change: number;
  premiumPercent: number;
}

export function useGMPUpdates(ipoId?: string) {
  return useLiveUpdates<GMPData>({
    type: 'gmp',
    ipoId,
  });
}

/**
 * Hook for viewer count specifically
 */
export interface ViewerData {
  total: number;
  change: number;
}

export function useViewerCount() {
  return useLiveUpdates<ViewerData>({
    type: 'viewers',
  });
}

/**
 * Hook for market pulse metrics
 */
export interface MarketPulseData {
  openIPOs: number;
  comingSoon: number;
  listed: number;
  successRate: number;
  avgSubscription: number;
  hotSector: string;
}

export function useMarketPulse() {
  return useLiveUpdates<MarketPulseData>({
    type: 'marketPulse',
  });
}
