import { NextRequest } from 'next/server';

/**
 * Live Updates SSE Endpoint - Phase 3: Real-Time Experience
 *
 * Server-Sent Events endpoint for streaming real-time IPO data:
 * - Subscription updates (every 30s during market hours)
 * - GMP price changes (real-time)
 * - Viewer counts (every 10s)
 * - Market pulse metrics (every 60s)
 * - Status changes (immediate)
 *
 * Protocol: Server-Sent Events (SSE)
 * Format: JSON messages with type discrimination
 * Connection: Keep-alive with heartbeat
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SSEMessage {
  type: string;
  ipoId?: string;
  data: any;
  timestamp: number;
}

/**
 * GET /api/live-updates
 *
 * Establishes SSE connection and streams live updates
 */
export async function GET(request: NextRequest) {
  // Create SSE response with proper headers
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      console.log('[SSE] Client connected');

      // Helper to send SSE message
      const send = (message: SSEMessage) => {
        const data = `data: ${JSON.stringify(message)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      // Helper to send heartbeat
      const sendHeartbeat = () => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      };

      // Send initial connection message
      send({
        type: 'connected',
        data: { message: 'Live updates connected' },
        timestamp: Date.now(),
      });

      // Heartbeat to keep connection alive (every 15s)
      const heartbeatInterval = setInterval(() => {
        try {
          sendHeartbeat();
        } catch (error) {
          console.error('[SSE] Heartbeat failed:', error);
          cleanup();
        }
      }, 15000);

      // Simulate live subscription updates (every 30s)
      const subscriptionInterval = setInterval(() => {
        try {
          send({
            type: 'subscription',
            ipoId: 'test-ipo-1',
            data: {
              overall: Math.random() * 10,
              qib: Math.random() * 15,
              nii: Math.random() * 8,
              retail: Math.random() * 5,
              trend: Math.random() > 0.5 ? 'accelerating' : 'slowing',
            },
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('[SSE] Subscription update failed:', error);
          cleanup();
        }
      }, 30000);

      // Simulate GMP updates (every 10s)
      const gmpInterval = setInterval(() => {
        try {
          send({
            type: 'gmp',
            ipoId: 'test-ipo-1',
            data: {
              current: 150 + Math.random() * 50,
              change: (Math.random() - 0.5) * 20,
              premiumPercent: 15 + Math.random() * 10,
            },
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('[SSE] GMP update failed:', error);
          cleanup();
        }
      }, 10000);

      // Simulate viewer count updates (every 5s)
      const viewersInterval = setInterval(() => {
        try {
          send({
            type: 'viewers',
            data: {
              total: Math.floor(400 + Math.random() * 200),
              change: Math.floor((Math.random() - 0.5) * 50),
            },
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('[SSE] Viewer update failed:', error);
          cleanup();
        }
      }, 5000);

      // Simulate market pulse updates (every 60s)
      const marketPulseInterval = setInterval(() => {
        try {
          send({
            type: 'marketPulse',
            data: {
              openIPOs: Math.floor(8 + Math.random() * 4),
              comingSoon: Math.floor(5 + Math.random() * 3),
              listed: Math.floor(10 + Math.random() * 5),
              successRate: 85 + Math.random() * 10,
              avgSubscription: 5 + Math.random() * 10,
              hotSector: ['Technology', 'Finance', 'Healthcare', 'Manufacturing'][
                Math.floor(Math.random() * 4)
              ],
            },
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('[SSE] Market pulse update failed:', error);
          cleanup();
        }
      }, 60000);

      // Cleanup function
      const cleanup = () => {
        console.log('[SSE] Cleaning up connection');
        clearInterval(heartbeatInterval);
        clearInterval(subscriptionInterval);
        clearInterval(gmpInterval);
        clearInterval(viewersInterval);
        clearInterval(marketPulseInterval);
        controller.close();
      };

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        console.log('[SSE] Client disconnected');
        cleanup();
      });
    },
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
