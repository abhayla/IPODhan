/**
 * Google Analytics 4 (GA4) Tracking Utilities
 * Provides functions for tracking events in Google Analytics
 */

/**
 * Type definition for Google Analytics gtag function
 */
declare global {
  interface Window {
    gtag?: (
      command: string,
      eventNameOrConfig: string,
      params?: Record<string, unknown>
    ) => void;
    dataLayer?: unknown[];
  }
}

/**
 * Tracks a share event in Google Analytics
 *
 * @param platform - The platform where content is being shared ('whatsapp', 'twitter', 'copy', 'native')
 * @param companyName - Name of the IPO company being shared
 *
 * @example
 * trackShare('whatsapp', 'TechCorp')
 * // Sends GA4 event: { event: 'share', method: 'whatsapp', content_type: 'ipo', item_id: 'TechCorp' }
 */
export function trackShare(platform: string, companyName: string): void {
  // Only track if running in browser and gtag is available
  if (typeof window !== 'undefined' && window.gtag) {
    try {
      window.gtag('event', 'share', {
        method: platform, // 'whatsapp', 'twitter', 'copy', 'native'
        content_type: 'ipo',
        item_id: companyName,
      });
    } catch (error) {
      // Fail silently - don't break user experience if analytics fails
      console.error('Failed to track share event:', error);
    }
  }
}

/**
 * Tracks a page view in Google Analytics
 * Useful for manual page view tracking in single-page applications
 *
 * @param url - The URL of the page being viewed
 * @param title - The title of the page
 *
 * @example
 * trackPageView('/ipos/techcorp', 'TechCorp IPO Details')
 */
export function trackPageView(url: string, title: string): void {
  if (typeof window !== 'undefined' && window.gtag) {
    try {
      window.gtag('event', 'page_view', {
        page_path: url,
        page_title: title,
      });
    } catch (error) {
      console.error('Failed to track page view:', error);
    }
  }
}

/**
 * Tracks a custom event in Google Analytics
 *
 * @param eventName - Name of the event
 * @param params - Event parameters
 *
 * @example
 * trackEvent('ipo_filter', { filter_type: 'status', filter_value: 'upcoming' })
 */
export function trackEvent(
  eventName: string,
  params?: Record<string, unknown>
): void {
  if (typeof window !== 'undefined' && window.gtag) {
    try {
      window.gtag('event', eventName, params);
    } catch (error) {
      console.error('Failed to track event:', error);
    }
  }
}

/**
 * Initializes Google Analytics with the measurement ID
 * This should be called in the app layout or root component
 *
 * @param measurementId - GA4 Measurement ID (format: G-XXXXXXXXXX)
 * @param config - Optional configuration parameters
 */
export function initGA(
  measurementId: string,
  config?: Record<string, unknown>
): void {
  if (typeof window !== 'undefined' && window.gtag) {
    try {
      window.gtag('config', measurementId, config);
    } catch (error) {
      console.error('Failed to initialize GA:', error);
    }
  }
}
