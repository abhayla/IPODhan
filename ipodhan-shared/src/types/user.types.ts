/**
 * User Model Interface
 */
export interface User {
  id: string;
  email?: string;
  phone: string;
  subscriptionTier: 'FREE' | 'BASIC' | 'PREMIUM';
  preferences: {
    notifications: {
      whatsapp: boolean;
      email: boolean;
      sms: boolean;
    };
    sectors: string[];
    riskProfile: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  };
  metadata: {
    source: string;
    referralCode?: string;
  };
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User Watchlist Item Interface
 */
export interface WatchlistItem {
  id: string;
  userId: string;
  ipoId: string;
  addedAt: Date;
}