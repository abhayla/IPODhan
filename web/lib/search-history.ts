/**
 * Search History Utilities
 *
 * Manages recent search queries in localStorage.
 * Stores the last 5 unique searches for quick access.
 */

const STORAGE_KEY = 'recent-searches';
const MAX_RECENT_SEARCHES = 5;

/**
 * Save a search query to recent searches
 *
 * @param query - The search query to save
 */
export function saveSearch(query: string): void {
  // Ignore empty or very short queries
  if (!query || query.trim().length < 2) {
    return;
  }

  try {
    const recent = getRecentSearches();

    // Add new query to the beginning, removing duplicates (case-insensitive)
    const updated = [
      query,
      ...recent.filter((q) => q.toLowerCase() !== query.toLowerCase()),
    ].slice(0, MAX_RECENT_SEARCHES);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    // Silent fail for localStorage errors (quota exceeded, private browsing, etc.)
    console.error('Failed to save search history:', error);
  }
}

/**
 * Get recent search queries
 *
 * @returns Array of recent search queries (max 5)
 */
export function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, MAX_RECENT_SEARCHES);
    }

    return [];
  } catch (error) {
    console.error('Failed to load search history:', error);
    return [];
  }
}

/**
 * Clear all search history
 */
export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear search history:', error);
  }
}
