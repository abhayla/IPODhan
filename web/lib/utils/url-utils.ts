/**
 * URL Utility Functions
 * Handles URL manipulation for social sharing and tracking
 */

/**
 * Adds UTM parameters to a URL for tracking purposes
 * Preserves existing query parameters and hash fragments
 *
 * @param url - The base URL to add parameters to
 * @param source - UTM source (e.g., 'whatsapp', 'twitter', 'copy')
 * @param medium - UTM medium (e.g., 'social')
 * @param campaign - UTM campaign (e.g., 'ipo_share')
 * @returns URL with UTM parameters added
 *
 * @example
 * addUTMParams('https://ipodhan.com/ipos/techcorp', 'whatsapp', 'social', 'ipo_share')
 * // Returns: 'https://ipodhan.com/ipos/techcorp?utm_source=whatsapp&utm_medium=social&utm_campaign=ipo_share'
 *
 * @example
 * addUTMParams('https://ipodhan.com/ipos/techcorp?tab=financials', 'twitter', 'social', 'ipo_share')
 * // Returns: 'https://ipodhan.com/ipos/techcorp?tab=financials&utm_source=twitter&utm_medium=social&utm_campaign=ipo_share'
 */
export function addUTMParams(
  url: string,
  source: string,
  medium: string,
  campaign: string
): string {
  try {
    // Parse the URL
    const urlObj = new URL(url);

    // Add UTM parameters to search params
    urlObj.searchParams.set('utm_source', source);
    urlObj.searchParams.set('utm_medium', medium);
    urlObj.searchParams.set('utm_campaign', campaign);

    // Return the complete URL with UTM parameters
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, return original URL
    console.error('Failed to add UTM parameters:', error);
    return url;
  }
}

/**
 * Generates a share URL with UTM parameters for a specific platform
 *
 * @param baseUrl - The base URL to share
 * @param platform - The sharing platform ('whatsapp', 'twitter', 'copy', 'native')
 * @returns URL with appropriate UTM parameters
 *
 * @example
 * generateShareUrl('https://ipodhan.com/ipos/techcorp', 'whatsapp')
 * // Returns: 'https://ipodhan.com/ipos/techcorp?utm_source=whatsapp&utm_medium=social&utm_campaign=ipo_share'
 */
export function generateShareUrl(baseUrl: string, platform: string): string {
  return addUTMParams(baseUrl, platform, 'social', 'ipo_share');
}

/**
 * Creates formatted share text with company name and key metrics
 * Ensures text is concise (<280 chars for Twitter compatibility)
 *
 * @param companyName - IPO company name
 * @param rating - IPO rating (optional)
 * @param subscription - Total subscription (optional)
 * @param gmp - Grey market premium (optional)
 * @param issueSize - Issue size in crores (optional)
 * @returns Formatted share text
 *
 * @example
 * createShareText('TechCorp', 4.0, 25, 120, 500)
 * // Returns: "Check out TechCorp IPO (Rating: 4.0/5, Subscription: 25x, GMP: ₹120) on IPODhan"
 */
export function createShareText(
  companyName: string,
  rating?: number | null,
  subscription?: number | null,
  gmp?: number | null,
  issueSize?: number | null
): string {
  let text = `Check out ${companyName} IPO`;

  // Build metrics array
  const metrics: string[] = [];

  if (rating !== null && rating !== undefined) {
    metrics.push(`Rating: ${rating.toFixed(1)}/5`);
  }

  if (subscription !== null && subscription !== undefined) {
    metrics.push(`Subscription: ${subscription}x`);
  }

  if (gmp !== null && gmp !== undefined) {
    metrics.push(`GMP: ₹${gmp}`);
  }

  if (issueSize !== null && issueSize !== undefined) {
    metrics.push(`Issue: ₹${issueSize} Cr`);
  }

  // Add metrics if available
  if (metrics.length > 0) {
    text += ` (${metrics.join(', ')})`;
  }

  text += ' on IPODhan';

  // Ensure text is under 200 chars to leave room for URL in tweets
  if (text.length > 200) {
    // Truncate metrics if too long
    const truncatedMetrics = metrics.slice(0, 2); // Keep only first 2 metrics
    text = `Check out ${companyName} IPO (${truncatedMetrics.join(', ')}) on IPODhan`;
  }

  return text;
}
