/**
 * User Profile Schema - Phase 5: Personalization Engine
 *
 * localStorage-based user profile system for behavioral learning
 * without requiring login or backend storage.
 *
 * Features:
 * - Preference tracking (sectors, price ranges, risk tolerance)
 * - Behavior history (viewed, compared, saved IPOs)
 * - Privacy-first (all data stays on device)
 * - GDPR compliant (no PII storage)
 * - Automatic cleanup of old data
 * - Type-safe with Zod validation
 *
 * Integration:
 * - Phase 3: Tracks interactions with live updates
 * - Phase 4: Syncs with PWA offline storage
 */

import { z } from 'zod';

// ============================================================================
// ENUMS
// ============================================================================

export const RiskToleranceEnum = z.enum(['low', 'medium', 'high']);
export type RiskTolerance = z.infer<typeof RiskToleranceEnum>;

export const ViewFrequencyEnum = z.enum(['rare', 'occasional', 'frequent', 'power']);
export type ViewFrequency = z.infer<typeof ViewFrequencyEnum>;

// ============================================================================
// PREFERENCES SCHEMA
// ============================================================================

export const UserPreferencesSchema = z.object({
  // Sector preferences (learned from views)
  favoriteSectors: z.array(z.string()).default([]),

  // Price range preferences
  preferredPriceRange: z.object({
    min: z.number().min(0).optional(),
    max: z.number().min(0).optional(),
  }).default({}),

  // Risk tolerance (inferred from viewed IPO scores)
  riskTolerance: RiskToleranceEnum.default('medium'),

  // Minimum acceptable score (learned from interactions)
  minScoreThreshold: z.number().min(0).max(10).default(6),

  // Preferred IPO segments
  preferredSegments: z.array(z.enum(['MAINBOARD', 'SME'])).default([]),

  // Subscription preference (high subscription = popular, or low = opportunity)
  preferHighSubscription: z.boolean().default(true),

  // Display preferences
  cardLayout: z.enum(['compact', 'default', 'detailed']).default('default'),

  // Sort preferences
  defaultSort: z.enum(['score', 'subscription', 'gmp', 'date', 'alphabetical']).default('score'),

  // Notifications (for future use)
  notificationsEnabled: z.boolean().default(false),

  // Last updated timestamp
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// ============================================================================
// BEHAVIOR HISTORY SCHEMA
// ============================================================================

export const IPOInteractionSchema = z.object({
  ipoId: z.string(),
  slug: z.string(),
  companyName: z.string().optional(),
  timestamp: z.string().datetime(),
  durationMs: z.number().optional(), // Time spent viewing
});

export const ComparisonSetSchema = z.object({
  ipos: z.array(z.string()), // Array of IPO IDs
  timestamp: z.string().datetime(),
  resultViewed: z.boolean().default(false),
});

export const SearchQuerySchema = z.object({
  query: z.string(),
  timestamp: z.string().datetime(),
  resultsCount: z.number().optional(),
  selectedResult: z.string().optional(), // IPO ID if clicked
});

export const BehaviorHistorySchema = z.object({
  // Viewing history (last 100 views)
  viewedIPOs: z.array(IPOInteractionSchema).max(100).default([]),

  // Comparison history (last 20 comparisons)
  comparedIPOs: z.array(ComparisonSetSchema).max(20).default([]),

  // Saved/bookmarked IPOs (unlimited, user-managed)
  savedIPOs: z.array(IPOInteractionSchema).default([]),

  // Search history (last 50 searches)
  searchHistory: z.array(SearchQuerySchema).max(50).default([]),

  // Filter usage (tracks which filters used most)
  filterUsage: z.record(z.string(), z.number()).default({}),

  // Last updated timestamp
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type BehaviorHistory = z.infer<typeof BehaviorHistorySchema>;
export type IPOInteraction = z.infer<typeof IPOInteractionSchema>;
export type ComparisonSet = z.infer<typeof ComparisonSetSchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ============================================================================
// ANALYTICS SCHEMA
// ============================================================================

export const UserAnalyticsSchema = z.object({
  // User engagement metrics
  totalIPOsViewed: z.number().default(0),
  totalComparisons: z.number().default(0),
  totalSearches: z.number().default(0),
  totalSaves: z.number().default(0),

  // Average session metrics
  avgSessionDurationMs: z.number().default(0),
  avgIPOsPerSession: z.number().default(0),

  // View frequency classification
  viewFrequency: ViewFrequencyEnum.default('occasional'),

  // Last active date
  lastActiveAt: z.string().datetime().default(() => new Date().toISOString()),

  // First seen date (for retention analysis)
  firstSeenAt: z.string().datetime().default(() => new Date().toISOString()),

  // Days since first visit
  daysSinceFirstVisit: z.number().default(0),

  // Session count
  sessionCount: z.number().default(0),
});

export type UserAnalytics = z.infer<typeof UserAnalyticsSchema>;

// ============================================================================
// COMPLETE USER PROFILE SCHEMA
// ============================================================================

export const UserProfileSchema = z.object({
  // Profile version (for migration support)
  version: z.number().default(1),

  // User preferences
  preferences: UserPreferencesSchema.default(() => {
    const now = new Date().toISOString();
    return {
      favoriteSectors: [],
      preferredPriceRange: {},
      riskTolerance: 'medium' as const,
      minScoreThreshold: 6,
      preferredSegments: [],
      preferHighSubscription: true,
      cardLayout: 'default' as const,
      defaultSort: 'score' as const,
      notificationsEnabled: false,
      updatedAt: now,
    };
  }),

  // Behavior history
  history: BehaviorHistorySchema.default(() => {
    const now = new Date().toISOString();
    return {
      viewedIPOs: [],
      comparedIPOs: [],
      savedIPOs: [],
      searchHistory: [],
      filterUsage: {},
      updatedAt: now,
    };
  }),

  // Analytics
  analytics: UserAnalyticsSchema.default(() => {
    const now = new Date().toISOString();
    return {
      totalIPOsViewed: 0,
      totalComparisons: 0,
      totalSearches: 0,
      totalSaves: 0,
      avgSessionDurationMs: 0,
      avgIPOsPerSession: 0,
      viewFrequency: 'occasional' as const,
      lastActiveAt: now,
      firstSeenAt: now,
      daysSinceFirstVisit: 0,
      sessionCount: 0,
    };
  }),

  // Profile creation date
  createdAt: z.string().datetime().default(() => new Date().toISOString()),

  // Last updated date
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// ============================================================================
// LOCALSTORAGE KEY
// ============================================================================

export const USER_PROFILE_STORAGE_KEY = 'ipodhan_user_profile';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get default user profile with all fields initialized
 */
export function getDefaultUserProfile(): UserProfile {
  // Parse an empty object - schema defaults will fill in all values
  return UserProfileSchema.parse({});
}

/**
 * Validate user profile data against schema
 */
export function validateUserProfile(data: unknown): UserProfile {
  return UserProfileSchema.parse(data);
}

/**
 * Safely parse user profile with fallback to default
 */
export function safeParseUserProfile(data: unknown): UserProfile {
  const result = UserProfileSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.warn('[UserProfile] Invalid profile data, using default:', result.error);
  return getDefaultUserProfile();
}

/**
 * Migrate user profile from old version to new version
 */
export function migrateUserProfile(oldProfile: unknown): UserProfile {
  // Currently only version 1 exists
  // Future versions can implement migration logic here
  return safeParseUserProfile(oldProfile);
}

/**
 * Calculate view frequency based on analytics
 */
export function calculateViewFrequency(analytics: UserAnalytics): ViewFrequency {
  const { totalIPOsViewed, daysSinceFirstVisit } = analytics;

  if (daysSinceFirstVisit === 0) return 'occasional';

  const viewsPerDay = totalIPOsViewed / daysSinceFirstVisit;

  if (viewsPerDay >= 10) return 'power';
  if (viewsPerDay >= 5) return 'frequent';
  if (viewsPerDay >= 1) return 'occasional';
  return 'rare';
}

/**
 * Calculate days since first visit
 */
export function calculateDaysSinceFirstVisit(firstSeenAt: string): number {
  const firstSeen = new Date(firstSeenAt);
  const now = new Date();
  const diffMs = now.getTime() - firstSeen.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Update analytics after a view event
 */
export function updateAnalyticsAfterView(analytics: UserAnalytics): UserAnalytics {
  const daysSince = calculateDaysSinceFirstVisit(analytics.firstSeenAt);
  const viewFrequency = calculateViewFrequency({
    ...analytics,
    totalIPOsViewed: analytics.totalIPOsViewed + 1,
    daysSinceFirstVisit: daysSince,
  });

  return {
    ...analytics,
    totalIPOsViewed: analytics.totalIPOsViewed + 1,
    daysSinceFirstVisit: daysSince,
    viewFrequency,
    lastActiveAt: new Date().toISOString(),
  };
}

/**
 * Infer risk tolerance from viewed IPO scores
 */
export function inferRiskTolerance(viewedScores: number[]): RiskTolerance {
  if (viewedScores.length === 0) return 'medium';

  const avgScore = viewedScores.reduce((sum, score) => sum + score, 0) / viewedScores.length;

  if (avgScore >= 8) return 'low'; // High-score IPOs = low risk preference
  if (avgScore >= 6) return 'medium';
  return 'high'; // Low-score IPOs = high risk tolerance
}

/**
 * Extract favorite sectors from view history
 */
export function extractFavoriteSectors(
  viewedIPOs: IPOInteraction[],
  sectorMap: Record<string, string> // ipoId -> sector
): string[] {
  const sectorCounts: Record<string, number> = {};

  viewedIPOs.forEach(({ ipoId }) => {
    const sector = sectorMap[ipoId];
    if (sector) {
      sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    }
  });

  // Return top 3 sectors
  return Object.entries(sectorCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([sector]) => sector);
}

/**
 * Privacy-safe profile summary (for debugging, no PII)
 */
export function getProfileSummary(profile: UserProfile): Record<string, unknown> {
  return {
    version: profile.version,
    viewFrequency: profile.analytics.viewFrequency,
    totalIPOsViewed: profile.analytics.totalIPOsViewed,
    riskTolerance: profile.preferences.riskTolerance,
    favoriteSectors: profile.preferences.favoriteSectors,
    savedIPOsCount: profile.history.savedIPOs.length,
    daysSinceFirstVisit: profile.analytics.daysSinceFirstVisit,
    sessionCount: profile.analytics.sessionCount,
  };
}
