/**
 * Service Worker Registration
 *
 * Phase 4: Mobile Excellence
 *
 * Handles service worker registration, updates, and lifecycle events.
 *
 * Usage:
 * import { registerServiceWorker } from '@/lib/pwa/register-sw';
 *
 * registerServiceWorker({
 *   onSuccess: () => console.log('SW registered'),
 *   onUpdate: () => console.log('SW updated'),
 * });
 */

export interface ServiceWorkerConfig {
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onError?: (error: Error) => void;
}

export async function registerServiceWorker(config: ServiceWorkerConfig = {}) {
  // Only register in production and if service workers are supported
  if (
    typeof window === 'undefined' ||
    process.env.NODE_ENV !== 'production' ||
    !('serviceWorker' in navigator)
  ) {
    console.log('[PWA] Service workers not supported or not in production');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    console.log('[PWA] Service worker registered:', registration);

    // Check for updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;

      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker available
            console.log('[PWA] New service worker available');
            config.onUpdate?.(registration);
          }
        });
      }
    });

    // Success callback
    config.onSuccess?.(registration);

    // Check for updates periodically (every hour)
    setInterval(
      () => {
        registration.update();
      },
      60 * 60 * 1000
    );
  } catch (error) {
    console.error('[PWA] Service worker registration failed:', error);
    config.onError?.(error as Error);
  }
}

/**
 * Unregister service worker (for development/debugging)
 */
export async function unregisterServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.unregister();
  console.log('[PWA] Service worker unregistered');
}

/**
 * Skip waiting and activate new service worker immediately
 */
export function skipWaiting() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
  window.location.reload();
}

/**
 * Check if app is running as PWA
 */
export function isPWA(): boolean {
  if (typeof window === 'undefined') return false;

  // Check if running in standalone mode
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  return isStandalone;
}

/**
 * Check if app can be installed (install prompt available)
 */
export function canInstallPWA(): boolean {
  if (typeof window === 'undefined') return false;

  // Will be set to true when beforeinstallprompt event fires
  return (window as any).__PWA_INSTALL_PROMPT__ !== undefined;
}

/**
 * Trigger PWA install prompt
 */
export async function installPWA(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const installPrompt = (window as any).__PWA_INSTALL_PROMPT__;

  if (!installPrompt) {
    console.warn('[PWA] Install prompt not available');
    return false;
  }

  // Show install prompt
  installPrompt.prompt();

  // Wait for user response
  const choiceResult = await installPrompt.userChoice;

  // Clear the prompt
  (window as any).__PWA_INSTALL_PROMPT__ = undefined;

  return choiceResult.outcome === 'accepted';
}

/**
 * Setup PWA install prompt listener
 *
 * Call this in your app's root component (e.g., layout.tsx)
 */
export function setupPWAInstallPrompt(
  onPromptAvailable?: () => void,
  onInstalled?: () => void
) {
  if (typeof window === 'undefined') return;

  // Listen for install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    (window as any).__PWA_INSTALL_PROMPT__ = e;
    console.log('[PWA] Install prompt available');
    onPromptAvailable?.();
  });

  // Listen for successful installation
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed successfully');
    (window as any).__PWA_INSTALL_PROMPT__ = undefined;
    onInstalled?.();
  });
}

/**
 * Request permission for push notifications
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  const permission = await Notification.requestPermission();
  return permission;
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPushNotifications(
  vapidPublicKey: string
): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidPublicKey,
    });

    console.log('[PWA] Push subscription:', subscription);
    return subscription;
  } catch (error) {
    console.error('[PWA] Push subscription failed:', error);
    return null;
  }
}

/**
 * Clear all caches (for development/debugging)
 */
export async function clearAllCaches() {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
  console.log('[PWA] All caches cleared');
}
