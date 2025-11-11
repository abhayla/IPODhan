'use client';

/**
 * Real-Time Client - Phase 3: Real-Time Experience
 *
 * Flexible real-time communication client supporting:
 * - Server-Sent Events (SSE) - Primary (Next.js friendly)
 * - WebSocket - Secondary (requires custom server)
 * - Polling - Fallback (universal compatibility)
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Connection health monitoring
 * - Event-based message handling
 * - Graceful degradation
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type LiveUpdateType =
  | 'subscription'      // Subscription data updates
  | 'gmp'              // GMP price updates
  | 'status'           // IPO status changes
  | 'listing'          // Listing performance
  | 'viewers'          // Concurrent viewer count
  | 'marketPulse';     // Overall market metrics

export interface LiveUpdateMessage<T = any> {
  type: LiveUpdateType;
  ipoId?: string;
  data: T;
  timestamp: number;
}

export interface RealtimeClientConfig {
  mode: 'sse' | 'websocket' | 'polling';
  endpoint: string;
  reconnect: boolean;
  maxReconnectAttempts: number;
  reconnectInterval: number;        // Base interval in ms
  reconnectBackoffMultiplier: number; // Exponential backoff multiplier
  heartbeatInterval: number;        // Health check interval in ms
  pollingInterval?: number;         // For polling mode only
}

export type EventHandler<T = any> = (message: LiveUpdateMessage<T>) => void;

export class RealtimeClient {
  private config: RealtimeClientConfig;
  private connection: EventSource | WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollingTimer: NodeJS.Timeout | null = null;
  private eventHandlers = new Map<LiveUpdateType, Set<EventHandler>>();
  private statusChangeHandlers = new Set<(status: ConnectionStatus) => void>();
  private lastMessageTime = 0;

  constructor(config: Partial<RealtimeClientConfig> = {}) {
    this.config = {
      mode: 'sse',
      endpoint: '/api/live-updates',
      reconnect: true,
      maxReconnectAttempts: 10,
      reconnectInterval: 1000,
      reconnectBackoffMultiplier: 1.5,
      heartbeatInterval: 30000,
      pollingInterval: 5000,
      ...config,
    };
  }

  /**
   * Connect to real-time server
   */
  public connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      console.warn('[RealtimeClient] Already connected or connecting');
      return;
    }

    this.setStatus('connecting');
    this.reconnectAttempts = 0;

    try {
      if (this.config.mode === 'sse') {
        this.connectSSE();
      } else if (this.config.mode === 'websocket') {
        this.connectWebSocket();
      } else if (this.config.mode === 'polling') {
        this.connectPolling();
      }
    } catch (error) {
      console.error('[RealtimeClient] Connection failed:', error);
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from server
   */
  public disconnect(): void {
    this.clearTimers();

    if (this.connection) {
      if (this.connection instanceof EventSource) {
        this.connection.close();
      } else if (this.connection instanceof WebSocket) {
        this.connection.close();
      }
      this.connection = null;
    }

    this.setStatus('disconnected');
  }

  /**
   * Subscribe to specific update type
   */
  public on<T = any>(type: LiveUpdateType, handler: EventHandler<T>): () => void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    this.eventHandlers.get(type)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(type);
      if (handlers) {
        handlers.delete(handler as EventHandler);
      }
    };
  }

  /**
   * Subscribe to connection status changes
   */
  public onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    this.statusChangeHandlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.statusChangeHandlers.delete(handler);
    };
  }

  /**
   * Get current connection status
   */
  public getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Check if connection is healthy
   */
  public isHealthy(): boolean {
    if (this.status !== 'connected') return false;

    const timeSinceLastMessage = Date.now() - this.lastMessageTime;
    const timeout = this.config.heartbeatInterval * 2;

    return timeSinceLastMessage < timeout;
  }

  // ==================== Private Methods ====================

  private connectSSE(): void {
    console.log('[RealtimeClient] Connecting via SSE...');

    const eventSource = new EventSource(this.config.endpoint);
    this.connection = eventSource;

    eventSource.onopen = () => {
      console.log('[RealtimeClient] SSE connected');
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    };

    eventSource.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    eventSource.onerror = (error) => {
      console.error('[RealtimeClient] SSE error:', error);
      this.setStatus('error');
      eventSource.close();
      this.connection = null;
      this.scheduleReconnect();
    };

    // Listen for custom event types
    Object.values(['subscription', 'gmp', 'status', 'listing', 'viewers', 'marketPulse']).forEach((type) => {
      eventSource.addEventListener(type, (event: Event) => {
        const messageEvent = event as MessageEvent;
        this.handleMessage(messageEvent.data);
      });
    });
  }

  private connectWebSocket(): void {
    console.log('[RealtimeClient] Connecting via WebSocket...');

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}${this.config.endpoint}`;

    const ws = new WebSocket(wsUrl);
    this.connection = ws;

    ws.onopen = () => {
      console.log('[RealtimeClient] WebSocket connected');
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    ws.onerror = (error) => {
      console.error('[RealtimeClient] WebSocket error:', error);
      this.setStatus('error');
    };

    ws.onclose = () => {
      console.log('[RealtimeClient] WebSocket closed');
      this.setStatus('disconnected');
      this.connection = null;
      this.scheduleReconnect();
    };
  }

  private connectPolling(): void {
    console.log('[RealtimeClient] Starting polling mode...');
    this.setStatus('connected');

    const poll = async () => {
      try {
        const response = await fetch(this.config.endpoint);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        // Handle array of messages or single message
        const messages = Array.isArray(data) ? data : [data];
        messages.forEach((msg) => this.handleMessage(JSON.stringify(msg)));

        this.lastMessageTime = Date.now();
      } catch (error) {
        console.error('[RealtimeClient] Polling error:', error);
        this.setStatus('error');
        this.scheduleReconnect();
      }
    };

    poll(); // Initial poll
    this.pollingTimer = setInterval(poll, this.config.pollingInterval);
  }

  private handleMessage(data: string): void {
    try {
      const message: LiveUpdateMessage = JSON.parse(data);
      this.lastMessageTime = Date.now();

      // Emit to type-specific handlers
      const handlers = this.eventHandlers.get(message.type);
      if (handlers) {
        handlers.forEach((handler) => handler(message));
      }
    } catch (error) {
      console.error('[RealtimeClient] Failed to parse message:', error, data);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      console.log(`[RealtimeClient] Status changed: ${status}`);

      this.statusChangeHandlers.forEach((handler) => handler(status));
    }
  }

  private scheduleReconnect(): void {
    if (!this.config.reconnect) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[RealtimeClient] Max reconnect attempts reached');
      this.setStatus('error');
      return;
    }

    this.reconnectAttempts++;

    // Exponential backoff
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(this.config.reconnectBackoffMultiplier, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    console.log(`[RealtimeClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.isHealthy()) {
        console.warn('[RealtimeClient] Connection unhealthy, reconnecting...');
        this.disconnect();
        this.connect();
      }
    }, this.config.heartbeatInterval);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}

/**
 * Create singleton instance for app-wide usage
 */
let clientInstance: RealtimeClient | null = null;

export function getRealtimeClient(config?: Partial<RealtimeClientConfig>): RealtimeClient {
  if (!clientInstance) {
    clientInstance = new RealtimeClient(config);
  }
  return clientInstance;
}

/**
 * Utility: Create mock data for development
 */
export function createMockLiveUpdate<T = any>(
  type: LiveUpdateType,
  data: T,
  ipoId?: string
): LiveUpdateMessage<T> {
  return {
    type,
    ipoId,
    data,
    timestamp: Date.now(),
  };
}
