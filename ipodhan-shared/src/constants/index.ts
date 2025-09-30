/**
 * Shared constants across IPODhan platform
 */

export const IPO_STATUS = {
  UPCOMING: 'UPCOMING',
  LIVE: 'LIVE',
  CLOSED: 'CLOSED',
  LISTED: 'LISTED',
} as const;

export const IPO_CATEGORY = {
  MAINBOARD: 'MAINBOARD',
  SME: 'SME',
} as const;

export const SUBSCRIPTION_TIER = {
  FREE: 'FREE',
  BASIC: 'BASIC',
  PREMIUM: 'PREMIUM',
} as const;

export const VERDICT = {
  APPLY: 'APPLY',
  CONSIDER: 'CONSIDER',
  SKIP: 'SKIP',
} as const;

export const CONFIDENCE_LEVEL = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;