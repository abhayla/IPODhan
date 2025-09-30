/**
 * IPO Model Interface
 */
export interface IPO {
  id: string;
  symbol: string;
  companyName: string;
  issueSize: number;
  priceBand: {
    low: number;
    high: number;
  };
  lotSize: number;
  dates: {
    open: Date;
    close: Date;
    listing?: Date;
  };
  status: 'UPCOMING' | 'LIVE' | 'CLOSED' | 'LISTED';
  category: 'MAINBOARD' | 'SME';
  registrar?: string;
  exchange?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * IPO Score Model Interface
 */
export interface IPOScore {
  id: string;
  ipoId: string;
  totalScore: number;
  components: {
    fundamental: number;
    sentiment: number;
    subscription: number;
    sector: number;
  };
  verdict: 'APPLY' | 'CONSIDER' | 'SKIP';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  algorithmVersion: string;
  calculatedAt: Date;
}

/**
 * GMP History Model Interface
 */
export interface GMPHistory {
  id: string;
  ipoId: string;
  gmp: {
    absolute: number;
    percentage: number;
  };
  kostakRate?: number;
  source: 'IPOWATCH' | 'INVESTORGAIN' | 'CHITTORGARH';
  recordedAt: Date;
}

/**
 * Subscription Data Model Interface
 */
export interface SubscriptionData {
  id: string;
  ipoId: string;
  category: 'QIB' | 'NII' | 'RETAIL' | 'EMPLOYEE';
  subscription: {
    times: number;
    sharesOffered: bigint;
    sharesBid: bigint;
  };
  recordedAt: Date;
}