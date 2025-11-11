/**
 * Service Worker - Offline Support & Caching
 *
 * Phase 4: Mobile Excellence
 *
 * Features:
 * - Offline support with cache-first strategy
 * - Background sync for failed requests
 * - Push notifications support
 * - Static asset caching
 * - Dynamic content caching
 * - Periodic background sync
 * - Cache versioning and cleanup
 *
 * Integration:
 * - Phase 3: Syncs with live update data
 * - Works with Phase 5 personalization (cached user preferences)
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `ipodhan-${CACHE_VERSION}`;

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/offline',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// API routes to cache with network-first strategy
const API_ROUTES = [
  '/api/ipos',
  '/api/search',
  '/api/health',
];

// Cache duration for different content types (in seconds)
const CACHE_DURATION = {
  static: 86400 * 30, // 30 days
  api: 300, // 5 minutes
  images: 86400 * 7, // 7 days
};

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      // Force activation
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('ipodhan-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[Service Worker] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Determine caching strategy based on request type
  if (url.pathname.startsWith('/api/')) {
    // API routes: Network-first, fallback to cache
    event.respondWith(networkFirstStrategy(request));
  } else if (url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/)) {
    // Images: Cache-first
    event.respondWith(cacheFirstStrategy(request, CACHE_DURATION.images));
  } else if (url.pathname.startsWith('/_next/static/')) {
    // Next.js static assets: Cache-first (long duration)
    event.respondWith(cacheFirstStrategy(request, CACHE_DURATION.static));
  } else {
    // HTML pages: Network-first, fallback to offline page
    event.respondWith(networkFirstWithOfflineFallback(request));
  }
});

// Network-first strategy (for API routes)
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Network failed, serving from cache:', request.url);

    // Fallback to cache
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline response for API calls
    return new Response(
      JSON.stringify({
        error: 'Offline',
        message: 'You are currently offline. Please check your internet connection.',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Cache-first strategy (for static assets)
async function cacheFirstStrategy(request, maxAge) {
  const cached = await caches.match(request);

  if (cached) {
    // Check if cache is still fresh
    const cacheDate = new Date(cached.headers.get('date'));
    const now = new Date();
    const age = (now - cacheDate) / 1000;

    if (age < maxAge) {
      return cached;
    }
  }

  // Fetch from network and update cache
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // If network fails, return cached version even if stale
    if (cached) {
      return cached;
    }

    throw error;
  }
}

// Network-first with offline fallback (for HTML pages)
async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Network failed, trying cache:', request.url);

    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Fallback to offline page
    const offlinePage = await caches.match('/offline');
    if (offlinePage) {
      return offlinePage;
    }

    // Last resort: generic offline response
    return new Response(
      `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Offline - IPODhan</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #0f766e, #d97706);
              color: white;
              text-align: center;
              padding: 20px;
            }
            .container {
              max-width: 400px;
            }
            h1 {
              font-size: 3rem;
              margin: 0 0 1rem;
            }
            p {
              font-size: 1.125rem;
              opacity: 0.9;
            }
            button {
              margin-top: 2rem;
              padding: 0.75rem 2rem;
              font-size: 1rem;
              background: white;
              color: #0f766e;
              border: none;
              border-radius: 0.5rem;
              cursor: pointer;
              font-weight: 600;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📡</h1>
            <h2>You're Offline</h2>
            <p>Please check your internet connection and try again.</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </body>
      </html>
      `,
      {
        status: 503,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }
}

// Background sync for failed requests
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);

  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  // Retry failed requests stored in IndexedDB
  console.log('[Service Worker] Syncing data...');
  // TODO: Implement actual sync logic with IndexedDB
}

// Push notification support
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');

  const options = {
    body: event.data?.text() || 'New update from IPODhan',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
    actions: [
      {
        action: 'explore',
        title: 'View Details',
      },
      {
        action: 'close',
        title: 'Close',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification('IPODhan', options)
  );
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked:', event.action);

  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  console.log('[Service Worker] Periodic sync:', event.tag);

  if (event.tag === 'update-ipos') {
    event.waitUntil(updateIPOData());
  }
});

async function updateIPOData() {
  // Fetch latest IPO data in background
  console.log('[Service Worker] Updating IPO data in background...');

  try {
    const response = await fetch('/api/ipos?limit=10');
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put('/api/ipos?limit=10', response);
    }
  } catch (error) {
    console.error('[Service Worker] Background update failed:', error);
  }
}

// Message handling from clients
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);

  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(event.data.urls);
      })
    );
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        return caches.open(CACHE_NAME);
      })
    );
  }
});

console.log('[Service Worker] Loaded successfully');
