/**
 * Centralized Selector Constants for E2E Tests
 *
 * This file provides reusable selector constants to maintain consistency
 * and reduce duplication across all UX E2E tests.
 */

// ============================================================================
// COMMON SELECTORS
// ============================================================================

export const COMMON = {
  // IPO Cards
  IPO_CARD: '[data-testid="ipo-card"], .ipo-card, article',
  IPO_CARD_TITLE: '[data-testid="ipo-title"], .ipo-title, h2, h3',
  IPO_CARD_STATUS: '[data-testid="ipo-status"], .ipo-status, .status-badge',

  // Navigation
  NAV_BAR: '[data-testid="nav-bar"], nav, header nav',
  NAV_LINK: '[data-testid="nav-link"], nav a',
  BOTTOM_NAV: '[data-testid="bottom-navigation"], .bottom-nav, [role="navigation"][class*="bottom"]',

  // Buttons
  BUTTON: 'button, [role="button"]',
  SUBMIT_BUTTON: 'button[type="submit"], [role="button"][type="submit"]',
  CLOSE_BUTTON: '[data-testid="close"], [aria-label*="close" i], button[aria-label*="close" i]',

  // Input Fields
  SEARCH_INPUT: '[data-testid="search"], input[type="search"], input[placeholder*="search" i]',
  FILTER_INPUT: '[data-testid="filter"], input[name="filter"]',

  // Loading States
  LOADING_SPINNER: '[data-testid="loading"], .loading, .spinner, [role="status"]',
  SKELETON: '[data-testid="skeleton"], .skeleton-loader',

  // Modals
  MODAL: '[role="dialog"], .modal, [data-testid="modal"]',
  MODAL_OVERLAY: '[data-testid="modal-overlay"], .modal-overlay, .backdrop',

  // Links
  LINK: 'a[href], [role="link"]',
};

// ============================================================================
// PHASE 2: DATA INTELLIGENCE SURFACE
// ============================================================================

export const PHASE_2 = {
  // Score Breakdown
  SCORE_BREAKDOWN: '[data-testid="score-breakdown"], .score-breakdown, [data-viz="radar"]',
  RADAR_CHART: '[data-testid="radar-chart"], .radar-chart, canvas',
  SCORE_COMPONENT: '[data-testid="score-component"], .score-component',
  FINANCIAL_SCORE: '[data-testid="financial-score"], .financial-score',
  VALUATION_SCORE: '[data-testid="valuation-score"], .valuation-score',

  // Contextual Tooltips
  CONTEXTUAL_TOOLTIP: '[data-testid="contextual-tooltip"], .contextual-tooltip, [role="tooltip"]',
  TOOLTIP_TRIGGER: '[data-testid="tooltip-trigger"], [aria-describedby], [data-tooltip]',
  SECTOR_COMPARISON: '[data-testid="sector-comparison"], .sector-comparison',

  // Sector Heat Map
  SECTOR_HEATMAP: '[data-testid="sector-heatmap"], .sector-heatmap, [data-viz="heatmap"]',
  HEATMAP_CELL: '[data-testid="heatmap-cell"], .heatmap-cell',
  METRIC_TOGGLE: '[data-testid="metric-toggle"], .metric-toggle, button[data-metric]',

  // Correlation Matrix
  CORRELATION_MATRIX: '[data-testid="correlation-matrix"], .correlation-matrix, [data-viz="scatter"]',
  SCATTER_PLOT: '[data-testid="scatter-plot"], .scatter-plot',
  SCATTER_POINT: '[data-testid="scatter-point"], .scatter-point, circle',
  TREND_LINE: '[data-testid="trend-line"], .trend-line, line',
  R_SQUARED: '[data-testid="r-squared"]',

  // Predictive Meter
  PREDICTIVE_METER: '[data-testid="predictive-meter"], .predictive-meter, [data-viz="gauge"]',
  GAUGE_CHART: '[data-testid="gauge"], .gauge',
  PROBABILITY_TEXT: '[data-testid="probability"], .probability',
  CONFIDENCE_LEVEL: '[data-testid="confidence"], .confidence',

  // Time Series Playback
  TIMESERIES_PLAYBACK: '[data-testid="timeseries-playback"], .timeseries-playback, [data-viz="timeline"]',
  PLAYBACK_CONTROLS: '[data-testid="playback-controls"], .playback-controls',
  PLAY_BUTTON: '[data-testid="play-button"], button[aria-label*="play" i]',
  PAUSE_BUTTON: '[data-testid="pause-button"], button[aria-label*="pause" i]',
  TIMELINE: '[data-testid="timeline"], .timeline, input[type="range"]',

  // Score Range Filter
  SCORE_RANGE_FILTER: '[data-testid="score-range-filter"], .score-range-filter',
  RANGE_SLIDER: '[data-testid="range-slider"], input[type="range"]',
  MIN_SCORE_INPUT: '[data-testid="min-score"], input[name="minScore"]',
  MAX_SCORE_INPUT: '[data-testid="max-score"], input[name="maxScore"]',

  // D3.js Visualizations
  D3_VISUALIZATION: 'svg[data-d3], canvas[data-d3], [data-viz]',
  CHART_CONTAINER: '[data-testid="chart"], .chart-container',
};

// ============================================================================
// PHASE 3: REAL-TIME EXPERIENCE
// ============================================================================

export const PHASE_3 = {
  // Live Subscription Tracker
  LIVE_SUBSCRIPTION_TRACKER: '[data-testid="live-subscription-tracker"], .live-subscription-tracker, [data-live="subscription"]',
  SUBSCRIPTION_VALUE: '[data-testid="subscription-value"], .subscription-value',
  TREND_INDICATOR: '[data-testid="trend-indicator"], .trend-indicator, [data-trend]',

  // Live GMP Ticker
  LIVE_GMP_TICKER: '[data-testid="live-gmp-ticker"], .live-gmp-ticker, [data-live="gmp"]',
  GMP_PRICE: '[data-testid="gmp-price"], .gmp-price',
  PRICE_CHANGE: '[data-testid="price-change"], .price-change',

  // Viewer Count
  VIEWER_COUNT: '[data-testid="viewer-count"], .viewer-count',
  VIEWER_NUMBER: '[data-testid="viewer-number"], .viewer-number',

  // Market Pulse
  MARKET_PULSE: '[data-testid="market-pulse"], .market-pulse',
  PULSE_METRIC: '[data-testid="pulse-metric"], .pulse-metric, [data-metric]',
  METRIC_VALUE: '[data-testid="metric-value"], .metric-value',

  // Hot Right Now
  HOT_RIGHT_NOW: '[data-testid="hot-right-now"], .hot-right-now',
  HOTNESS_SCORE: '[data-testid="hotness-score"], .hotness-score',
  HOT_IPO_CARD: '[data-testid="hot-ipo"], .hot-ipo',

  // Visual Filter Builder
  VISUAL_FILTER_BUILDER: '[data-testid="visual-filter-builder"], .visual-filter-builder',
  FILTER_CHIP: '[data-testid="filter-chip"], .filter-chip, .chip',
  FILTER_BADGE: '[data-testid="filter-badge"], .badge',
  CLEAR_FILTERS: '[data-testid="clear-filters"], button[aria-label*="clear" i]',

  // SSE Connection
  CONNECTION_STATUS: '[data-testid="connection-status"], .connection-status, .status-dot',
  CONNECTION_INDICATOR: '[data-testid="connection-indicator"], .connection-indicator',

  // Real-time Updates
  UPDATE_TIMESTAMP: '[data-testid="last-updated"], .last-updated',
  LIVE_BADGE: '[data-testid="live-badge"], .live-badge, .pulse',
};

// ============================================================================
// PHASE 4: MOBILE EXCELLENCE
// ============================================================================

export const PHASE_4 = {
  // Bottom Navigation
  BOTTOM_NAV: '[data-testid="bottom-navigation"], .bottom-nav',
  BOTTOM_NAV_ITEM: '[data-testid="bottom-nav-item"], .bottom-nav-item',
  ACTIVE_TAB: '[aria-current="page"], .active',

  // Swipeable IPO Cards
  SWIPEABLE_CARD: '[data-testid="swipeable-card"], .swipeable-card',
  SWIPE_ACTIONS: '[data-testid="swipe-actions"], .swipe-actions',
  QUICK_ACTION: '[data-testid="quick-action"], .quick-action',

  // Pull to Refresh
  PULL_TO_REFRESH: '[data-testid="pull-to-refresh"], .pull-to-refresh',
  REFRESH_INDICATOR: '[data-testid="refresh-indicator"], .refresh-indicator',
  REFRESHING_TEXT: '[data-testid="refreshing"]',

  // Zoomable Charts
  ZOOMABLE_CHART: '[data-testid="zoomable-chart"], .zoomable-chart',
  ZOOM_CONTROLS: '[data-testid="zoom-controls"], .zoom-controls',
  ZOOM_IN_BUTTON: '[data-testid="zoom-in"], button[aria-label*="zoom in" i]',
  ZOOM_OUT_BUTTON: '[data-testid="zoom-out"], button[aria-label*="zoom out" i]',
  RESET_ZOOM_BUTTON: '[data-testid="reset-zoom"], button[aria-label*="reset" i]',

  // PWA
  MANIFEST_LINK: 'link[rel="manifest"]',
  SERVICE_WORKER_SCRIPT: 'script[data-sw], script[src*="service-worker"]',
  INSTALL_PROMPT: '[data-testid="install-prompt"], .install-prompt',

  // Touch Interactions
  TOUCH_TARGET: '[data-touch], button, a, input, [role="button"]',
  CONTEXT_MENU: '[data-testid="context-menu"], .context-menu, [role="menu"]',

  // Safe Areas
  SAFE_AREA: '[data-testid="safe-area"], .safe-area',
  NOTCH_PADDING: '[style*="padding-top"][style*="env(safe-area"]',
};

// ============================================================================
// PHASE 5: PERSONALIZATION ENGINE
// ============================================================================

export const PHASE_5 = {
  // For You Section
  FOR_YOU_SECTION: '[data-testid="for-you"], .for-you-section',
  RECOMMENDATION: '[data-testid="recommendation"], .recommendation',
  CONFIDENCE_SCORE: '[data-testid="confidence-score"], .confidence-score',
  RECOMMENDATION_REASON: '[data-testid="recommendation-reason"], .recommendation-reason',

  // Profile Strength
  PROFILE_STRENGTH: '[data-testid="profile-strength"], .profile-strength',
  STRENGTH_INDICATOR: '[data-testid="strength-indicator"], .strength-indicator',
  PROFILE_PROGRESS: '[data-testid="profile-progress"], progress, [role="progressbar"]',

  // Smart Defaults
  SMART_DEFAULTS: '[data-testid="smart-defaults"]',
  DEFAULT_FILTER: '[data-testid="default-filter"], .default-filter',

  // Suggested Comparisons
  SUGGESTED_COMPARISONS: '[data-testid="suggested-comparisons"], .suggested-comparisons',
  COMPARISON_PAIR: '[data-testid="comparison-pair"], .comparison-pair',
  COMPARE_BUTTON: '[data-testid="compare-button"], button[aria-label*="compare" i]',

  // Keyboard Shortcuts
  KEYBOARD_SHORTCUTS: '[data-testid="keyboard-shortcuts"], .keyboard-shortcuts',
  SHORTCUT_HELP: '[data-testid="shortcut-help"], .shortcut-help',
  SHORTCUT_KEY: '[data-testid="shortcut-key"], kbd, .key',

  // Multi-Select Mode
  MULTI_SELECT_MODE: '[data-testid="multi-select"], .multi-select-mode',
  MULTI_SELECT_TOGGLE: '[data-testid="multi-select-toggle"], button[aria-label*="multi-select" i]',
  CHECKBOX: 'input[type="checkbox"], [role="checkbox"]',
  SELECT_ALL: '[data-testid="select-all"], button[aria-label*="select all" i]',

  // Bulk Actions
  BULK_ACTIONS: '[data-testid="bulk-actions"], .bulk-actions',
  BULK_ACTION_BAR: '[data-testid="bulk-action-bar"], .bulk-action-bar',
  EXPORT_BUTTON: '[data-testid="export"], button[aria-label*="export" i]',
  SHARE_BUTTON: '[data-testid="share"], button[aria-label*="share" i]',

  // User Profile (localStorage)
  PROFILE_SETTINGS: '[data-testid="profile-settings"], .profile-settings',
  CLEAR_PROFILE: '[data-testid="clear-profile"], button[aria-label*="clear profile" i]',
};

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

export const INTEGRATION = {
  // Cross-feature Integration
  FILTER_WITH_RECOMMENDATIONS: '[data-testid="filtered-recommendations"]',
  COMPARE_WITH_SCORE: '[data-testid="compare-score"]',
  LIVE_FILTER_UPDATE: '[data-testid="live-filter-update"]',

  // Performance Indicators
  PERFORMANCE_METRIC: '[data-testid="performance-metric"]',
  LOAD_TIME: '[data-testid="load-time"]',
  FPS_COUNTER: '[data-testid="fps-counter"]',
};

// ============================================================================
// TEXT PATTERNS (for flexible text matching)
// ============================================================================

export const TEXT_PATTERNS = {
  // Numbers and Percentages
  PERCENTAGE: /\d+(\.\d+)?%/,
  NUMBER: /\d+(\.\d+)?/,
  CURRENCY: /[₹$€£]\s?\d+/,

  // Status
  OPEN: /open/i,
  CLOSED: /closed/i,
  LISTED: /listed/i,

  // Time
  LAST_UPDATED: /last\s+updated|updated\s+\d+/i,
  TIME_AGO: /\d+\s+(second|minute|hour|day)s?\s+ago/i,

  // Subscription
  SUBSCRIPTION_TIMES: /\d+(\.\d+)?\s*x/i,

  // Confidence
  CONFIDENCE: /high|medium|low|confidence/i,

  // Hotness
  HOTNESS: /hot.*\d+/i,

  // Profile
  PROFILE_STRENGTH: /profile.*\d+%/i,

  // Viewing
  VIEWERS: /\d+.*viewing/i,

  // Filters
  FILTER: /filter|personalized|smart.*filter/i,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Creates a selector that matches any of the provided selectors
 */
export function anyOf(...selectors: string[]): string {
  return selectors.join(', ');
}

/**
 * Creates a data-testid selector
 */
export function testId(id: string): string {
  return `[data-testid="${id}"]`;
}

/**
 * Creates an aria-label selector (case-insensitive)
 */
export function ariaLabel(label: string): string {
  return `[aria-label*="${label}" i]`;
}

/**
 * Creates a role selector
 */
export function role(roleName: string): string {
  return `[role="${roleName}"]`;
}

/**
 * Creates a class selector
 */
export function className(name: string): string {
  return `.${name}`;
}
