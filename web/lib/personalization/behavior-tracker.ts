/**
 * Behavior Tracker - Phase 5: Personalization Engine
 *
 * Manages user behavior tracking and localStorage persistence.
 * All operations are client-side only, no server communication.
 *
 * Features:
 * - Track IPO views, comparisons, saves, searches
 * - Automatic preference learning
 * - localStorage persistence with quota management
 * - Privacy-first (no PII, no tracking IDs)
 * - Automatic cleanup of old data
 * - Performance optimized (debounced writes)
 *
 * Integration:
 * - Phase 1: Tracks AnimatedScore interactions
 * - Phase 2: Tracks chart interactions and filters
 * - Phase 3: Tracks live update engagement
 * - Phase 4: Syncs with PWA service worker
 */

import {
  UserProfile,
  UserPreferences,
  BehaviorHistory,
  UserAnalytics,
  IPOInteraction,
  ComparisonSet,
  SearchQuery,
  USER_PROFILE_STORAGE_KEY,
  getDefaultUserProfile,
  safeParseUserProfile,
  validateUserProfile,
  updateAnalyticsAfterView,
  inferRiskTolerance,
  extractFavoriteSectors,
  calculateDaysSinceFirstVisit,
} from './user-profile';

// ============================================================================
// BEHAVIOR TRACKER CLASS
// ============================================================================

export class BehaviorTracker {
  private profile: UserProfile;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_DEBOUNCE_MS = 1000; // 1 second debounce

  constructor() {
    this.profile = this.loadProfile();
  }

  // ==========================================================================
  // PROFILE MANAGEMENT
  // ==========================================================================

  /**
   * Load profile from localStorage
   */
  private loadProfile(): UserProfile {
    if (typeof window === 'undefined') {
      return getDefaultUserProfile();
    }

    try {
      const stored = localStorage.getItem(USER_PROFILE_STORAGE_KEY);
      if (!stored) {
        return getDefaultUserProfile();
      }

      const parsed = JSON.parse(stored);
      return safeParseUserProfile(parsed);
    } catch (error) {
      console.error('[BehaviorTracker] Error loading profile:', error);
      return getDefaultUserProfile();
    }
  }

  /**
   * Save profile to localStorage (debounced)
   */
  private saveProfile(): void {
    if (typeof window === 'undefined') return;

    // Clear existing timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // Debounce save to reduce localStorage writes
    this.saveDebounceTimer = setTimeout(() => {
      try {
        // Update timestamp
        this.profile.updatedAt = new Date().toISOString();

        // Validate before saving
        const validated = validateUserProfile(this.profile);

        // Save to localStorage
        localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(validated));
      } catch (error) {
        console.error('[BehaviorTracker] Error saving profile:', error);

        // Check if quota exceeded
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          this.handleQuotaExceeded();
        }
      }
    }, this.SAVE_DEBOUNCE_MS);
  }

  /**
   * Handle localStorage quota exceeded
   */
  private handleQuotaExceeded(): void {
    console.warn('[BehaviorTracker] localStorage quota exceeded, cleaning up old data');

    // Trim view history to last 50
    this.profile.history.viewedIPOs = this.profile.history.viewedIPOs.slice(-50);

    // Trim comparison history to last 10
    this.profile.history.comparedIPOs = this.profile.history.comparedIPOs.slice(-10);

    // Trim search history to last 20
    this.profile.history.searchHistory = this.profile.history.searchHistory.slice(-20);

    // Try saving again
    this.saveProfile();
  }

  /**
   * Get current profile (immutable)
   */
  public getProfile(): Readonly<UserProfile> {
    return { ...this.profile };
  }

  /**
   * Get current preferences (immutable)
   */
  public getPreferences(): Readonly<UserPreferences> {
    return { ...this.profile.preferences };
  }

  /**
   * Get current history (immutable)
   */
  public getHistory(): Readonly<BehaviorHistory> {
    return { ...this.profile.history };
  }

  /**
   * Get current analytics (immutable)
   */
  public getAnalytics(): Readonly<UserAnalytics> {
    return { ...this.profile.analytics };
  }

  /**
   * Clear all profile data (for privacy/GDPR)
   */
  public clearProfile(): void {
    this.profile = getDefaultUserProfile();
    if (typeof window !== 'undefined') {
      localStorage.removeItem(USER_PROFILE_STORAGE_KEY);
    }
  }

  // ==========================================================================
  // EVENT TRACKING
  // ==========================================================================

  /**
   * Track IPO view event
   */
  public trackIPOView(
    ipoId: string,
    slug: string,
    companyName?: string,
    durationMs?: number
  ): void {
    const interaction: IPOInteraction = {
      ipoId,
      slug,
      companyName,
      timestamp: new Date().toISOString(),
      durationMs,
    };

    // Add to view history (max 100, newest first)
    this.profile.history.viewedIPOs = [
      interaction,
      ...this.profile.history.viewedIPOs.filter((v) => v.ipoId !== ipoId), // Remove duplicates
    ].slice(0, 100);

    // Update analytics
    this.profile.analytics = updateAnalyticsAfterView(this.profile.analytics);

    // Update history timestamp
    this.profile.history.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Track comparison event
   */
  public trackComparison(ipoIds: string[]): void {
    const comparisonSet: ComparisonSet = {
      ipos: ipoIds,
      timestamp: new Date().toISOString(),
      resultViewed: true,
    };

    // Add to comparison history (max 20)
    this.profile.history.comparedIPOs = [comparisonSet, ...this.profile.history.comparedIPOs].slice(
      0,
      20
    );

    // Update analytics
    this.profile.analytics.totalComparisons += 1;

    // Update history timestamp
    this.profile.history.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Track save/bookmark event
   */
  public trackSave(ipoId: string, slug: string, companyName?: string): void {
    // Check if already saved
    const alreadySaved = this.profile.history.savedIPOs.some((s) => s.ipoId === ipoId);
    if (alreadySaved) return;

    const interaction: IPOInteraction = {
      ipoId,
      slug,
      companyName,
      timestamp: new Date().toISOString(),
    };

    // Add to saved IPOs (no limit)
    this.profile.history.savedIPOs = [interaction, ...this.profile.history.savedIPOs];

    // Update analytics
    this.profile.analytics.totalSaves += 1;

    // Update history timestamp
    this.profile.history.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Track unsave/unbookmark event
   */
  public trackUnsave(ipoId: string): void {
    this.profile.history.savedIPOs = this.profile.history.savedIPOs.filter(
      (s) => s.ipoId !== ipoId
    );

    // Update analytics
    this.profile.analytics.totalSaves = Math.max(0, this.profile.analytics.totalSaves - 1);

    // Update history timestamp
    this.profile.history.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Track search event
   */
  public trackSearch(query: string, resultsCount?: number, selectedResult?: string): void {
    const searchQuery: SearchQuery = {
      query,
      timestamp: new Date().toISOString(),
      resultsCount,
      selectedResult,
    };

    // Add to search history (max 50)
    this.profile.history.searchHistory = [searchQuery, ...this.profile.history.searchHistory].slice(
      0,
      50
    );

    // Update analytics
    this.profile.analytics.totalSearches += 1;

    // Update history timestamp
    this.profile.history.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Track filter usage
   */
  public trackFilterUsage(filterName: string): void {
    const currentCount = this.profile.history.filterUsage[filterName] || 0;
    this.profile.history.filterUsage[filterName] = currentCount + 1;

    // Update history timestamp
    this.profile.history.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Track session start
   */
  public trackSessionStart(): void {
    this.profile.analytics.sessionCount += 1;
    this.profile.analytics.daysSinceFirstVisit = calculateDaysSinceFirstVisit(
      this.profile.analytics.firstSeenAt
    );
    this.profile.analytics.lastActiveAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Track session end
   */
  public trackSessionEnd(durationMs: number): void {
    // Update average session duration (rolling average)
    const currentAvg = this.profile.analytics.avgSessionDurationMs;
    const sessionCount = this.profile.analytics.sessionCount;

    this.profile.analytics.avgSessionDurationMs =
      (currentAvg * (sessionCount - 1) + durationMs) / sessionCount;

    this.saveProfile();
  }

  // ==========================================================================
  // PREFERENCE LEARNING
  // ==========================================================================

  /**
   * Learn user preferences from behavior history
   */
  public learnPreferences(sectorMap: Record<string, string>): void {
    const { viewedIPOs } = this.profile.history;

    if (viewedIPOs.length < 5) {
      // Not enough data to learn preferences
      return;
    }

    // Extract favorite sectors
    const favoriteSectors = extractFavoriteSectors(viewedIPOs, sectorMap);
    this.profile.preferences.favoriteSectors = favoriteSectors;

    // Update preferences timestamp
    this.profile.preferences.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Infer risk tolerance from viewed IPO scores
   */
  public inferRiskToleranceFromScores(ipoScores: Record<string, number>): void {
    const { viewedIPOs } = this.profile.history;

    if (viewedIPOs.length < 10) {
      // Not enough data to infer risk tolerance
      return;
    }

    // Get scores for viewed IPOs
    const viewedScores = viewedIPOs
      .map((v) => ipoScores[v.ipoId])
      .filter((score): score is number => score !== undefined);

    if (viewedScores.length < 10) return;

    const riskTolerance = inferRiskTolerance(viewedScores);
    this.profile.preferences.riskTolerance = riskTolerance;

    // Calculate min score threshold (10th percentile of viewed scores)
    const sortedScores = [...viewedScores].sort((a, b) => a - b);
    const p10Index = Math.floor(sortedScores.length * 0.1);
    const minScoreThreshold = Math.max(5, sortedScores[p10Index]); // Minimum 5

    this.profile.preferences.minScoreThreshold = minScoreThreshold;

    // Update preferences timestamp
    this.profile.preferences.updatedAt = new Date().toISOString();

    this.saveProfile();
  }

  /**
   * Update display preferences
   */
  public updateCardLayout(layout: 'compact' | 'default' | 'detailed'): void {
    this.profile.preferences.cardLayout = layout;
    this.profile.preferences.updatedAt = new Date().toISOString();
    this.saveProfile();
  }

  /**
   * Update default sort preference
   */
  public updateDefaultSort(
    sort: 'score' | 'subscription' | 'gmp' | 'date' | 'alphabetical'
  ): void {
    this.profile.preferences.defaultSort = sort;
    this.profile.preferences.updatedAt = new Date().toISOString();
    this.saveProfile();
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Check if IPO is saved
   */
  public isSaved(ipoId: string): boolean {
    return this.profile.history.savedIPOs.some((s) => s.ipoId === ipoId);
  }

  /**
   * Get saved IPO IDs
   */
  public getSavedIPOIds(): string[] {
    return this.profile.history.savedIPOs.map((s) => s.ipoId);
  }

  /**
   * Get most viewed sectors (top 5)
   */
  public getMostViewedSectors(sectorMap: Record<string, string>): string[] {
    return extractFavoriteSectors(this.profile.history.viewedIPOs, sectorMap).slice(0, 5);
  }

  /**
   * Get most used filters (top 5)
   */
  public getMostUsedFilters(): Array<{ filter: string; count: number }> {
    return Object.entries(this.profile.history.filterUsage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([filter, count]) => ({ filter, count }));
  }

  /**
   * Get recent searches (last 10)
   */
  public getRecentSearches(): string[] {
    return this.profile.history.searchHistory.slice(0, 10).map((s) => s.query);
  }

  /**
   * Export profile data (for privacy/download)
   */
  public exportProfile(): string {
    return JSON.stringify(this.profile, null, 2);
  }

  /**
   * Import profile data (for restore)
   */
  public importProfile(jsonData: string): boolean {
    try {
      const parsed = JSON.parse(jsonData);
      const validated = validateUserProfile(parsed);
      this.profile = validated;
      this.saveProfile();
      return true;
    } catch (error) {
      console.error('[BehaviorTracker] Error importing profile:', error);
      return false;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let behaviorTrackerInstance: BehaviorTracker | null = null;

/**
 * Get singleton instance of BehaviorTracker
 */
export function getBehaviorTracker(): BehaviorTracker {
  if (!behaviorTrackerInstance) {
    behaviorTrackerInstance = new BehaviorTracker();
  }
  return behaviorTrackerInstance;
}

/**
 * Reset singleton (for testing)
 */
export function resetBehaviorTracker(): void {
  behaviorTrackerInstance = null;
}
