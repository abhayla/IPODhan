'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerRegistration - Phase 4: Mobile Excellence
 *
 * Registers the service worker for PWA capabilities:
 * - Offline support
 * - Asset caching
 * - Background sync
 * - Push notifications
 *
 * This component should be mounted in the root layout.
 */

export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Only register service worker in production and if supported
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV === 'production'
    ) {
      // Wait for page load before registering
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            console.log('[PWA] Service Worker registered:', registration);

            // Check for updates every 24 hours
            setInterval(() => {
              registration.update();
            }, 24 * 60 * 60 * 1000);

            // Listen for updates
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;

              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (
                    newWorker.state === 'installed' &&
                    navigator.serviceWorker.controller
                  ) {
                    // New service worker available
                    console.log('[PWA] New version available');

                    // Could show a toast notification here
                    // asking user to reload for update
                  }
                });
              }
            });
          })
          .catch((error) => {
            console.error('[PWA] Service Worker registration failed:', error);
          });

        // Signal that PWA is ready for E2E tests
        document.body.setAttribute('data-pwa-ready', 'true');
      });
    }

    // For development, just signal ready immediately
    if (process.env.NODE_ENV === 'development') {
      document.body.setAttribute('data-pwa-ready', 'true');
    }
  }, []);

  // This component doesn't render anything
  return null;
}
