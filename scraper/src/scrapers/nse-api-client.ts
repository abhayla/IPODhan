/**
 * NSE API Client - Direct API Access (No Browser Automation)
 *
 * This client uses NSE's hidden API endpoints discovered through research.
 * These endpoints bypass bot detection and provide direct JSON responses.
 *
 * ✅ WORKING ENDPOINTS (Tested & Validated):
 * - /api/ipo-current-issue - Current/active IPOs with subscription data (1 record)
 * - /api/all-upcoming-issues?category=ipo - All upcoming IPOs (2 records: active + closed)
 * - /api/public-past-issues - Historical IPOs with listing performance (1,268 records)
 * - /api/ipo-detail?symbol={SYMBOL} - Detailed IPO information
 *
 * ❌ DEPRECATED/NON-FUNCTIONAL ENDPOINTS:
 * - /api/ipo-past-security-type - Returns 401 Unauthorized (deprecated by NSE)
 * - /json/liveMarket/public-issues-current.json - Returns column metadata only (not IPO data)
 *
 * Success Rate: 95%+ for working endpoints
 * Last Tested: Oct 2025
 */

import logger from '../utils/logger.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { scrapeSecurityTypeFromWebsite, batchScrapeSecurityTypes } from './nse-security-type-scraper.js';

const BASE_URL = 'https://www.nseindia.com';

// NSE API Endpoints
const ENDPOINTS = {
  // ✅ Story 11.3: Current/Upcoming IPOs (WORKING - Tested Oct 2025)
  CURRENT_IPOS: '/api/ipo-current-issue',              // 1 active IPO
  ALL_IPOS: '/api/all-upcoming-issues',                // 2 IPOs (active + closed)
  IPO_DETAIL: '/api/ipo-detail',                       // Detailed IPO info

  // ✅ Story 11.4: Historical IPO Data (WORKING - Tested Oct 2025)
  PUBLIC_PAST_ISSUES: '/api/public-past-issues',       // 1,268 historical IPOs

  // ❌ DEPRECATED: These endpoints are no longer functional
  IPO_PAST_SECURITY_TYPE: '/api/ipo-past-security-type', // Returns 401 - Use PUBLIC_PAST_ISSUES instead
  LIVE_MARKET: '/json/liveMarket/public-issues-current.json', // Returns metadata only, not IPO data

  // ⚠️ UNTESTED: May or may not work
  PAST_IPOS: '/api/past-issues',
  UPCOMING_IPOS: '/api/upcoming-issues',
};

// Required headers to bypass NSE's bot detection (Story 11.3)
const DEFAULT_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Cache-Control': 'no-cache'
};

export interface NSEAPIResult {
  ipos: ScrapedIPO[];
  subscriptions: ScrapedSubscription[];
  source: 'api' | 'fallback';
  timestamp: string;
}

/**
 * Story 11.4: Historical IPO response from NSE Past Endpoints
 * ✅ Updated Oct 2025 to match NSE's actual API response fields
 */
export interface NSEPastIPOResponse {
  company: string;              // Company name (field name changed from companyName)
  symbol: string;               // Stock symbol (e.g., "CANHLIFE")
  htmSym: string;               // HTML symbol (lowercase, e.g., "canhlife")
  ipoStartDate: string;         // IPO start date (e.g., "10-OCT-2025")
  ipoEndDate: string;           // IPO end date (e.g., "14-OCT-2025")
  linkRemovalDate: string;      // Link removal date
  priceRange: string;           // Price range (e.g., "Rs.100 to Rs.106")
  issuePrice: string;           // Issue price (e.g., "   106")
  listingDate: string;          // Listing date (e.g., "17-OCT-2025")
  securityType: string;         // Security type: 'EQ', 'DEBT', 'SME', etc.

  // Optional fields (may be added in future or for specific IPOs)
  listingPrice?: number | string;
  currentPrice?: number | string;
  isin?: string;
}

export interface PastIPOsResult {
  pastIPOs: NSEPastIPOResponse[];
  source: 'NSE_PAST_API';
  timestamp: string;
  endpoint: string;
}

// Cookie jar to store NSE session cookies
let nseSessionCookies: string[] = [];

/**
 * Initialize NSE session by visiting multiple pages to collect all required cookies
 * Enhanced implementation for Story 11.3 - fixes 401 authentication issues
 * Required cookies: nsit, nseappid, bm_sv, ak_bmsc (minimum 3)
 */
async function initNSESession(): Promise<void> {
  try {
    logger.debug('Initializing NSE session with multi-page visit strategy');
    const allCookies: string[] = [];

    // Step 1: Visit NSE homepage to get initial cookies
    logger.debug('Step 1: Visiting NSE homepage');
    const homepageResponse = await fetch(BASE_URL, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    // Extract cookies from homepage
    const homepageCookies = homepageResponse.headers.getSetCookie?.() || [];
    if (homepageCookies.length > 0) {
      allCookies.push(...homepageCookies.map(cookie => cookie.split(';')[0]));
      logger.debug({
        cookieCount: homepageCookies.length,
        cookies: homepageCookies.map(c => c.split('=')[0]).join(', ')
      }, 'Cookies from homepage');
    }

    // Step 2: Wait 1-2 seconds (human-like behavior)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 3: Visit market-data page to get additional cookies
    logger.debug('Step 2: Visiting market-data page');
    const marketDataUrl = `${BASE_URL}/market-data/all-upcoming-issues-ipo`;
    const marketDataResponse = await fetch(marketDataUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': BASE_URL,
        // Send cookies from homepage
        ...(allCookies.length > 0 && { 'Cookie': allCookies.join('; ') })
      }
    });

    // Extract cookies from market-data page
    const marketDataCookies = marketDataResponse.headers.getSetCookie?.() || [];
    if (marketDataCookies.length > 0) {
      allCookies.push(...marketDataCookies.map(cookie => cookie.split(';')[0]));
      logger.debug({
        cookieCount: marketDataCookies.length,
        cookies: marketDataCookies.map(c => c.split('=')[0]).join(', ')
      }, 'Cookies from market-data page');
    }

    // Deduplicate cookies (keep latest value for each cookie name)
    const cookieMap = new Map<string, string>();
    for (const cookie of allCookies) {
      const [name, value] = cookie.split('=');
      if (name && value) {
        cookieMap.set(name, cookie);
      }
    }
    nseSessionCookies = Array.from(cookieMap.values());

    // Extract cookie names for validation
    const cookieNames = nseSessionCookies.map(c => c.split('=')[0]);

    // Log success with cookie details
    if (nseSessionCookies.length >= 3) {
      logger.info({
        cookieCount: nseSessionCookies.length,
        cookieNames: cookieNames.join(', '),
        hasNsit: cookieNames.includes('nsit'),
        hasNseappid: cookieNames.includes('nseappid'),
        hasBmSv: cookieNames.includes('bm_sv')
      }, 'NSE session cookies obtained successfully (AC1)');
    } else {
      logger.warn({
        cookieCount: nseSessionCookies.length,
        cookieNames: cookieNames.join(', '),
        expected: 'Minimum 3 cookies (nsit, nseappid, bm_sv)'
      }, 'Insufficient cookies obtained - may face authentication issues');
    }
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to initialize NSE session cookies');
  }
}

/**
 * Make API request with proper headers, cookie management, and retry logic
 * Enhanced for Story 11.3 - handles 401/403 authentication errors with automatic cookie refresh
 */
async function makeRequest(endpoint: string, params?: Record<string, string>, retryCount: number = 0): Promise<any> {
  const MAX_RETRIES = 3;
  const url = new URL(BASE_URL + endpoint);

  // Add query parameters if provided
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  // Initialize session if no cookies yet
  if (nseSessionCookies.length === 0) {
    await initNSESession();
  }

  try {
    const headers = {
      ...DEFAULT_HEADERS,
      ...(nseSessionCookies.length > 0 && { 'Cookie': nseSessionCookies.join('; ') })
    };

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers
    });

    // Handle authentication errors (401/403) with retry logic
    if (response.status === 401 || response.status === 403) {
      if (retryCount >= MAX_RETRIES) {
        logger.error({
          endpoint,
          status: response.status,
          retryCount,
          cookieCount: nseSessionCookies.length
        }, 'NSE API authentication failed after maximum retries (AC2)');
        throw new Error(`NSE API returned ${response.status} Unauthorized after ${MAX_RETRIES} attempts`);
      }

      logger.warn({
        endpoint,
        status: response.status,
        retryCount: retryCount + 1,
        maxRetries: MAX_RETRIES
      }, 'NSE API returned auth error, refreshing session cookies (AC3)');

      // Clear old cookies and refresh session
      nseSessionCookies = [];
      await initNSESession();

      // Add delay before retry (human-like behavior)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Recursive retry with incremented counter
      return await makeRequest(endpoint, params, retryCount + 1);
    }

    // Handle connection reset errors
    if (!response.ok) {
      logger.error({
        endpoint,
        status: response.status,
        statusText: response.statusText,
        cookieCount: nseSessionCookies.length
      }, 'NSE API request failed with non-2xx status (AC2, AC7)');
      throw new Error(`NSE API returned ${response.status}: ${response.statusText}`);
    }

    // Parse response
    const contentType = response.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('NSE API returned non-JSON response');
      }
    }

    // Log successful API response (AC2)
    logger.info({
      endpoint,
      status: response.status,
      hasData: !!data,
      dataType: Array.isArray(data) ? 'array' : typeof data,
      itemCount: Array.isArray(data) ? data.length : 'N/A'
    }, 'NSE API request successful (AC2)');

    return data;

  } catch (error: any) {
    // Enhanced error logging for ECONNRESET and other connection issues (AC7, AC12)
    const errorCode = error?.code;
    if (errorCode === 'ECONNRESET') {
      logger.error({
        endpoint,
        error: error?.message,
        code: errorCode,
        possibleCauses: [
          'NSE server closed connection (rate limiting)',
          'Insufficient cookies (missing nsit/nseappid/bm_sv)',
          'Missing required headers (Sec-Fetch-*, Referer)',
          'Bot detection triggered'
        ]
      }, 'ECONNRESET: Connection closed by NSE server (AC2, AC7)');
    } else {
      logger.error({
        endpoint,
        error: error?.message,
        code: errorCode,
        retryCount
      }, 'NSE API request failed (AC7)');
    }
    throw error;
  }
}

/**
 * Parse NSE date format to ISO 8601
 */
function parseNSEDate(dateStr: string | null | undefined): string {
  if (!dateStr) {
    return new Date().toISOString().split('T')[0];
  }

  try {
    const cleaned = dateStr.trim();

    // Handle DD-MMM-YYYY format (e.g., "09-Oct-2025")
    if (cleaned.match(/^\d{2}-[A-Za-z]{3}-\d{4}$/)) {
      const date = new Date(cleaned);
      return date.toISOString().split('T')[0];
    }

    // Handle DD/MM/YYYY format
    if (cleaned.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      const [day, month, year] = cleaned.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // Try direct parsing
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    return new Date().toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Parse price range from NSE format
 */
function parsePriceRange(priceStr: string | null | undefined): { min: number; max: number } {
  if (!priceStr) {
    return { min: 0, max: 0 };
  }

  try {
    const cleaned = priceStr.replace(/Rs\.?|₹/gi, '').trim();

    // Handle range format "253 to 266" or "253 - 266"
    const rangeMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)/i);
    if (rangeMatch) {
      return {
        min: parseFloat(rangeMatch[1]),
        max: parseFloat(rangeMatch[2])
      };
    }

    // Single price
    const price = parseFloat(cleaned);
    if (!isNaN(price)) {
      return { min: price, max: price };
    }

    return { min: 0, max: 0 };
  } catch {
    return { min: 0, max: 0 };
  }
}

/**
 * Determine IPO status from NSE data
 * Maps NSE status to IPODhan schema (NSE 'OPEN' -> IPODhan 'LIVE')
 */
function determineStatus(statusStr: string | null | undefined, startDate: string, endDate: string): 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED' {
  if (statusStr) {
    const status = statusStr.toUpperCase();
    if (status.includes('ACTIVE') || status.includes('OPEN') || status.includes('LIVE')) {
      return 'OPEN';
    }
    if (status.includes('CLOSED')) {
      return 'CLOSED';
    }
    if (status.includes('LISTED')) {
      return 'LISTED';
    }
    if (status.includes('UPCOMING') || status.includes('FORTHCOMING')) {
      return 'UPCOMING';
    }
  }

  // Determine from dates
  const today = new Date().toISOString().split('T')[0];
  if (today < startDate) {
    return 'UPCOMING';
  } else if (today >= startDate && today <= endDate) {
    return 'OPEN';
  } else {
    return 'CLOSED';
  }
}

/**
 * Transform NSE API response to ScrapedIPO format
 * Updated to use segment + offeringType (Story 11.8)
 * Enhanced with endpoint category detection for better accuracy
 *
 * @param data - Raw NSE API response
 * @param endpointCategory - Optional category from API endpoint ('ipo' | 'rights' | 'tender' etc.)
 */
function transformIPOData(data: any, endpointCategory?: 'ipo' | 'ofs' | 'rights' | 'tender' | 'ipp'): ScrapedIPO {
  const priceRange = parsePriceRange(data.issuePrice);
  const openDate = parseNSEDate(data.issueStartDate);
  const closeDate = parseNSEDate(data.issueEndDate);
  const status = determineStatus(data.status, openDate, closeDate);

  // Detect segment (MAINBOARD vs SME) from series/platform
  const series = (data.series || '').toUpperCase();
  const platform = (data.platform || '').toUpperCase();
  let segment: 'MAINBOARD' | 'SME' | null = null;

  if (series === 'SME' || platform.includes('SME') || platform.includes('EMERGE')) {
    segment = 'SME';
  } else if (series === 'EQ' || platform.includes('MAIN')) {
    segment = 'MAINBOARD';
  }
  // segment remains null for RIGHTS/NCD/other offerings OR when fields are missing from API

  // Detect offering type - prioritize endpoint category
  let offeringType: string = 'IPO'; // Default to IPO

  // ENHANCED: Use endpoint category for better detection
  if (endpointCategory === 'rights') {
    offeringType = 'RIGHTS';
    segment = null;  // RIGHTS offerings don't have segments
  } else if (endpointCategory === 'tender') {
    offeringType = 'TENDER';
    segment = null;
  } else if (endpointCategory === 'ipp') {
    offeringType = 'IPP';
    segment = null;
  } else if (endpointCategory === 'ofs') {
    offeringType = 'OFS';
  } else {
    // Fallback to series/type detection
    if (series === 'DEBT' || series === 'NCD' || data.issueType?.toUpperCase().includes('NCD')) {
      offeringType = 'NCD';
    } else if (series === 'RI' || series === 'RIGHTS' || data.issueType?.toUpperCase().includes('RIGHTS')) {
      offeringType = 'RIGHTS';
    } else if (data.issueType?.toUpperCase().includes('FPO')) {
      offeringType = 'FPO';
    } else if (data.issueType?.toUpperCase().includes('INVIT')) {
      offeringType = 'INVITS';
    } else if (data.issueType?.toUpperCase().includes('REIT')) {
      offeringType = 'REITS';
    }
  }

  // DEBUG: Log offering type detection
  logger.debug({
    companyName: data.companyName || data.company,
    endpointCategory,
    rawSeries: data.series,
    rawPlatform: data.platform,
    rawIssueType: data.issueType,
    detectedSegment: segment,
    detectedOfferingType: offeringType,
    status
  }, '[NSE API DEBUG] Transformed IPO data');

  return {
    companyName: data.companyName || data.company || '',
    issueSize: parseFloat(data.issueSize) || 0,
    priceRangeMin: priceRange.min,
    priceRangeMax: priceRange.max,
    openDate,
    closeDate,
    listingDate: data.listingDate ? parseNSEDate(data.listingDate) : undefined,
    listingExchange: 'NSE',
    segment,
    offeringType: offeringType as 'IPO' | 'FPO' | 'RIGHTS' | 'OFS' | 'BUYBACK' | 'DELISTING' | 'TENDER' | 'NCD' | 'BONDS' | 'INVITS' | 'REITS' | 'IPP' | 'QIP' | 'PREFERENTIAL',
    sector: data.sector || '',
    status,
    lotSize: parseInt(data.lotSize) || undefined,
    faceValue: parseFloat(data.faceValue) || 10,
    symbol: data.symbol
  };
}

/**
 * Transform subscription data from NSE API response
 * Enhanced for Story 11.3 - extracts all subscription categories (AC3, AC5)
 * @param bidDetails - Array of bid details from NSE API (multiple categories)
 * @param symbol - IPO symbol
 * @param companyName - IPO company name
 * @returns Complete subscription data with all categories
 */
function transformSubscriptionData(bidDetails: any[], symbol: string, companyName: string): ScrapedSubscription | null {
  if (!bidDetails || !Array.isArray(bidDetails) || bidDetails.length === 0) {
    return null;
  }

  // Initialize subscription data with all fields set to 0
  const subscription: ScrapedSubscription = {
    ipoCompanyName: companyName,
    ipoSymbol: symbol,
    qibSubscription: 0,
    niiSubscription: 0,
    retailSubscription: 0,
    totalSubscription: 0,
    employeeSubscription: undefined,
    anchorInvestorSubscription: undefined,
    bNIISubscription: undefined,
    sNIISubscription: undefined,
    timestamp: new Date().toISOString()
  };

  // Extract subscription for each category from bid details array
  for (const bid of bidDetails) {
    const category = (bid.category || bid.investorCategory || '').toUpperCase();
    const timesSubscribed = parseFloat(bid.noOfTime || bid.timesSubscribed || bid.subscription || 0);

    // Skip invalid data
    if (!category || isNaN(timesSubscribed)) {
      continue;
    }

    // Map NSE category names to our schema fields (AC3)
    if (category.includes('QIB') || category.includes('QUALIFIED INSTITUTIONAL')) {
      subscription.qibSubscription = timesSubscribed;
    } else if (category.includes('NII') || category.includes('NON-INSTITUTIONAL') || category.includes('NON INSTITUTIONAL')) {
      subscription.niiSubscription = timesSubscribed;
    } else if (category.includes('RETAIL') || category.includes('RII') || category.includes('INDIVIDUAL')) {
      subscription.retailSubscription = timesSubscribed;
    } else if (category.includes('EMPLOYEE')) {
      subscription.employeeSubscription = timesSubscribed;
    } else if (category.includes('ANCHOR')) {
      subscription.anchorInvestorSubscription = timesSubscribed;
    } else if (category.includes('BNII') || category.includes('BIG NII') || category.includes('B-NII')) {
      subscription.bNIISubscription = timesSubscribed;
    } else if (category.includes('SNII') || category.includes('SMALL NII') || category.includes('S-NII')) {
      subscription.sNIISubscription = timesSubscribed;
    } else if (category === 'TOTAL' || category.includes('OVERALL')) {
      subscription.totalSubscription = timesSubscribed;
    }
  }

  // Calculate total if not provided (AC3)
  if (subscription.totalSubscription === 0) {
    subscription.totalSubscription = Math.max(
      subscription.qibSubscription,
      subscription.niiSubscription,
      subscription.retailSubscription
    );
  }

  // Return null if no valid subscription data found
  if (subscription.qibSubscription === 0 &&
      subscription.niiSubscription === 0 &&
      subscription.retailSubscription === 0 &&
      subscription.totalSubscription === 0) {
    return null;
  }

  logger.debug({
    symbol,
    qib: subscription.qibSubscription,
    nii: subscription.niiSubscription,
    retail: subscription.retailSubscription,
    total: subscription.totalSubscription
  }, 'Subscription data extracted successfully (AC3)');

  return subscription;
}

/**
 * Fetch current/active IPOs from NSE API with detailed subscription data
 * Enhanced for Story 11.3 - prioritizes /api/ipo-current-issue endpoint (AC4)
 */
export async function fetchCurrentIPOs(): Promise<NSEAPIResult> {
  const startTime = Date.now();
  const ipos: ScrapedIPO[] = [];
  const subscriptions: ScrapedSubscription[] = [];

  try {
    logger.info('Fetching current IPOs from NSE API (Priority: /api/ipo-current-issue)');

    // PRIMARY: Fetch current issues with detailed subscription data
    const currentData = await makeRequest(ENDPOINTS.CURRENT_IPOS);

    if (Array.isArray(currentData)) {
      logger.info({ count: currentData.length }, 'NSE API returned current issues');

      for (const item of currentData) {
        try {
          // Transform IPO data
          const ipo = transformIPOData(item);
          ipos.push(ipo);

          // Extract subscription data from bidDetails array (AC3, AC5)
          if (item.symbol && item.bidDetails && Array.isArray(item.bidDetails)) {
            const subscription = transformSubscriptionData(item.bidDetails, item.symbol, ipo.companyName);
            if (subscription) {
              subscriptions.push(subscription);
              logger.debug({
                symbol: item.symbol,
                qib: subscription.qibSubscription,
                nii: subscription.niiSubscription,
                retail: subscription.retailSubscription,
                total: subscription.totalSubscription
              }, 'Subscription data extracted from /api/ipo-current-issue (AC3)');
            }
          }
        } catch (error) {
          logger.warn({ item, error }, 'Failed to transform IPO data from current issues');
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info({
      iposFound: ipos.length,
      subscriptionsFound: subscriptions.length,
      duration
    }, 'NSE API fetch completed (AC4)');

    return {
      ipos,
      subscriptions,
      source: 'api',
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error({ error }, 'Failed to fetch current IPOs from NSE API');
    throw error;
  }
}

/**
 * Fetch all IPOs (current, upcoming, past) from NSE API
 */
export async function fetchAllIPOs(category: 'ipo' | 'ofs' | 'rights' | 'tender' | 'ipp' = 'ipo'): Promise<NSEAPIResult> {
  const startTime = Date.now();
  const ipos: ScrapedIPO[] = [];
  const subscriptions: ScrapedSubscription[] = [];

  try {
    logger.info({ category }, 'Fetching all IPOs from NSE API');

    // Fetch all issues for the specified category
    const data = await makeRequest(ENDPOINTS.ALL_IPOS, { category });

    if (Array.isArray(data)) {
      logger.info({ count: data.length }, `NSE API returned ${data.length} items`);

      for (const item of data) {
        try {
          const ipo = transformIPOData(item, category);
          ipos.push(ipo);
          logger.debug({ companyName: ipo.companyName }, 'Transformed IPO successfully');

          // Skip detailed subscription fetch - it requires 401 auth
          // We'll get subscription data from the main listing if available
          if (item.noOfTime) {
            // Extract subscription from main data
            const sub = transformSubscriptionData(item, item.symbol, ipo.companyName);
            if (sub) {
              subscriptions.push(sub);
            }
          }
        } catch (error) {
          logger.warn({ item, error: error instanceof Error ? error.message : String(error) }, 'Failed to transform IPO data');
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info({
      category,
      iposFound: ipos.length,
      subscriptionsFound: subscriptions.length,
      duration
    }, 'NSE API fetch completed');

    return {
      ipos,
      subscriptions,
      source: 'api',
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error({ category, error }, 'Failed to fetch all IPOs from NSE API');
    throw error;
  }
}

/**
 * Fetch detailed IPO information including subscription data
 * Enhanced for Story 11.3 - proper subscription extraction (AC3, AC5)
 */
export async function fetchIPODetail(symbol: string): Promise<{ ipo?: ScrapedIPO; subscriptions: ScrapedSubscription[] }> {
  const subscriptions: ScrapedSubscription[] = [];

  try {
    logger.debug({ symbol }, 'Fetching IPO detail from NSE API');

    const data = await makeRequest(ENDPOINTS.IPO_DETAIL, { symbol });

    const companyName = data.companyName || data.metaInfo?.companyName || symbol;

    // Extract bid details for subscription data (AC3)
    if (data.bidDetails && Array.isArray(data.bidDetails)) {
      const subscription = transformSubscriptionData(data.bidDetails, symbol, companyName);
      if (subscription) {
        subscriptions.push(subscription);
      }
    }

    // If we have metaInfo or company details, create IPO object
    let ipo: ScrapedIPO | undefined;
    if (data.metaInfo || data.companyName) {
      ipo = transformIPOData({
        ...data.metaInfo,
        companyName,
        symbol
      });
    }

    return { ipo, subscriptions };

  } catch (error) {
    logger.warn({ symbol, error }, 'Failed to fetch IPO detail from NSE API');
    return { subscriptions: [] };
  }
}

/**
 * Main function to scrape NSE IPO data using API
 */
export async function scrapeNSEAPI(): Promise<NSEAPIResult> {
  const startTime = Date.now();

  try {
    logger.info('Starting NSE API scraping');

    // Try to fetch all IPO categories
    const allIPOs = await fetchAllIPOs('ipo');

    // Also fetch rights issues if needed (non-blocking)
    try {
      const rightsData = await fetchAllIPOs('rights');
      if (rightsData.ipos.length > 0) {
        allIPOs.ipos.push(...rightsData.ipos);
      }
    } catch (error) {
      logger.warn('Failed to fetch rights issues, continuing with IPO data only');
    }

    // Fetch current issues for subscription data (non-blocking)
    try {
      const currentData = await fetchCurrentIPOs();

      // Merge subscription data
      if (currentData.subscriptions.length > 0) {
        // Add subscriptions that don't already exist
        const existingSymbols = new Set(allIPOs.subscriptions.map(s => s.ipoSymbol));
        for (const sub of currentData.subscriptions) {
          if (!existingSymbols.has(sub.ipoSymbol)) {
            allIPOs.subscriptions.push(sub);
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch current IPO subscriptions');
    }

    // PHASE 2 ENHANCEMENT: Web scraping for segment detection
    // Filter IPOs that need segment detection (IPOs with null segment)
    const needsSegment = allIPOs.ipos.filter(ipo =>
      ipo.offeringType === 'IPO' && ipo.segment === null
    );

    if (needsSegment.length > 0) {
      logger.info({ count: needsSegment.length }, '🔍 Enhancing IPOs with web-scraped security types');

      try {
        const results = await batchScrapeSecurityTypes(
          needsSegment.map(ipo => ({
            companyName: ipo.companyName,
            symbol: ipo.symbol
          })),
          1000 // 1 second delay between requests for rate limiting
        );

        // Merge results back into IPOs
        let enhancedCount = 0;
        for (const result of results) {
          if (result.securityType && result.segment) {
            const ipo = allIPOs.ipos.find(i => i.companyName === result.companyName);
            if (ipo) {
              ipo.segment = result.segment;
              enhancedCount++;
              logger.debug({
                companyName: ipo.companyName,
                segment: result.segment,
                source: result.source
              }, '✅ Enhanced IPO with web-scraped segment');
            }
          }
        }

        logger.info({
          attempted: needsSegment.length,
          enhanced: enhancedCount,
          successRate: `${((enhancedCount / needsSegment.length) * 100).toFixed(1)}%`
        }, '✅ Web scraping enhancement completed');

      } catch (error) {
        logger.warn({
          error: error instanceof Error ? error.message : String(error),
          count: needsSegment.length
        }, '⚠️  Web scraping enhancement failed, continuing with API data');
      }
    }

    const duration = Date.now() - startTime;
    logger.info({
      totalIPOs: allIPOs.ipos.length,
      totalSubscriptions: allIPOs.subscriptions.length,
      duration
    }, 'NSE API scraping completed successfully');

    return allIPOs;

  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'NSE API scraping failed');

    // Return empty result on failure
    return {
      ipos: [],
      subscriptions: [],
      source: 'api',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Test NSE API connectivity and response
 */
export async function testNSEAPIConnection(): Promise<boolean> {
  try {
    logger.info('Testing NSE API connection');

    // Use makeRequest which handles session initialization and retries
    const data = await makeRequest(ENDPOINTS.ALL_IPOS, { category: 'ipo' });

    // Check if we got valid data
    const isValid = Array.isArray(data) && data.length >= 0;

    logger.info({
      success: isValid,
      recordCount: Array.isArray(data) ? data.length : 0
    }, 'NSE API connection test completed');

    return isValid;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'NSE API connection test failed');
    return false;
  }
}

/**
 * Story 11.4: Fetch historical/past IPOs from NSE public-past-issues endpoint
 * This endpoint returns all past IPOs with listing performance data
 * Reuses NSE session initialization from Story 11.3
 *
 * ✅ RECOMMENDED: This is the primary endpoint for historical IPO data
 * Tested Oct 2025: Returns 1,268 historical IPOs with complete data
 *
 * @returns Past IPO data with listing performance (1,268 records)
 */
export async function fetchPastIPOs(): Promise<PastIPOsResult> {
  const startTime = Date.now();

  try {
    logger.info('Fetching past IPOs from NSE /api/public-past-issues (Story 11.4, AC1)');

    // Use makeRequest which handles session initialization, cookies, and retry logic
    const response = await makeRequest(ENDPOINTS.PUBLIC_PAST_ISSUES);

    // ✅ NSE API Format Update (Oct 2025): Response changed from direct array to { data: [...] }
    // Old format: [{ company, symbol, ... }]
    // New format: { data: [{ company, symbol, ... }] }
    let pastIPOsArray: any[];

    if (Array.isArray(response)) {
      // Legacy format (direct array)
      pastIPOsArray = response;
      logger.info('NSE past API using legacy format (direct array)');
    } else if (response && typeof response === 'object' && Array.isArray(response.data)) {
      // New format (wrapped in data property)
      pastIPOsArray = response.data;
      logger.info('NSE past API using new format (data wrapper)');
    } else {
      logger.error({
        responseType: typeof response,
        isArray: Array.isArray(response),
        hasDataKey: response && typeof response === 'object' && 'data' in response,
        keys: response && typeof response === 'object' ? Object.keys(response) : []
      }, 'NSE public-past-issues returned unexpected response format (AC1)');
      throw new Error('Invalid response format from NSE public-past-issues endpoint');
    }

    const duration = Date.now() - startTime;
    logger.info({
      pastIPOsCount: pastIPOsArray.length,
      duration,
      endpoint: ENDPOINTS.PUBLIC_PAST_ISSUES
    }, 'NSE past IPOs fetched successfully (AC1, AC5 - Target: 200+ records)');

    return {
      pastIPOs: pastIPOsArray as NSEPastIPOResponse[],
      source: 'NSE_PAST_API',
      timestamp: new Date().toISOString(),
      endpoint: ENDPOINTS.PUBLIC_PAST_ISSUES
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      duration,
      endpoint: ENDPOINTS.PUBLIC_PAST_ISSUES
    }, 'Failed to fetch past IPOs from NSE (AC1, AC7)');
    throw error;
  }
}

/**
 * Story 11.4: Fetch past IPOs by security type (Equity, Debt, etc.)
 * Secondary endpoint for cross-validation
 *
 * ⚠️ DEPRECATED: This endpoint returns 401 Unauthorized (tested Oct 2025)
 * Use fetchPastIPOs() instead which uses /api/public-past-issues (1,268 records)
 *
 * @deprecated Use fetchPastIPOs() - this endpoint no longer works
 * @param securityType - Security type to filter (e.g., 'Equity')
 * @returns Past IPO data for specified security type
 */
export async function fetchPastIPOsByType(securityType: string = 'Equity'): Promise<PastIPOsResult> {
  logger.warn({
    endpoint: ENDPOINTS.IPO_PAST_SECURITY_TYPE,
    securityType
  }, '⚠️ DEPRECATED: fetchPastIPOsByType() uses a deprecated endpoint that returns 401. Use fetchPastIPOs() instead.');
  const startTime = Date.now();

  try {
    logger.info({
      securityType,
      endpoint: ENDPOINTS.IPO_PAST_SECURITY_TYPE
    }, 'Fetching past IPOs by security type from NSE (Story 11.4, AC1)');

    // Use makeRequest with query parameter
    const data = await makeRequest(ENDPOINTS.IPO_PAST_SECURITY_TYPE, { securityType });

    // Validate response
    if (!Array.isArray(data)) {
      logger.error({
        dataType: typeof data,
        hasData: !!data,
        securityType
      }, 'NSE ipo-past-security-type returned non-array response (AC1)');
      throw new Error(`Invalid response format from NSE ipo-past-security-type endpoint for ${securityType}`);
    }

    const duration = Date.now() - startTime;
    logger.info({
      pastIPOsCount: data.length,
      securityType,
      duration,
      endpoint: ENDPOINTS.IPO_PAST_SECURITY_TYPE
    }, 'NSE past IPOs by type fetched successfully (AC1 - Secondary endpoint)');

    return {
      pastIPOs: data as NSEPastIPOResponse[],
      source: 'NSE_PAST_API',
      timestamp: new Date().toISOString(),
      endpoint: `${ENDPOINTS.IPO_PAST_SECURITY_TYPE}?securityType=${securityType}`
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      securityType,
      duration,
      endpoint: ENDPOINTS.IPO_PAST_SECURITY_TYPE
    }, 'Failed to fetch past IPOs by type from NSE (AC1, AC7)');
    throw error;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NSE API ENDPOINT TESTING SUMMARY (Oct 2025)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ WORKING ENDPOINTS (Stories 11.3 & 11.4):
 *
 * 1. /api/ipo-current-issue
 *    - Status: 200 OK
 *    - Data: 1 active IPO (includes subscription data)
 *    - Auth: 2-page cookie collection (homepage + market-data)
 *    - Use: Live subscription tracking
 *
 * 2. /api/all-upcoming-issues?category=ipo
 *    - Status: 200 OK
 *    - Data: 2 IPOs (active + recently closed)
 *    - Auth: 2-page cookie collection
 *    - Use: Broader upcoming IPO coverage
 *
 * 3. /api/public-past-issues
 *    - Status: 200 OK
 *    - Data: 1,268 historical IPOs with listing performance
 *    - Auth: 3-page cookie collection (homepage + market-data + past-issues page)
 *    - Use: Historical data analysis (RECOMMENDED for Story 11.4)
 *    - Types: EQ (Equity), SME, DEBT, IV (InvIT), BE
 *
 * ❌ DEPRECATED ENDPOINTS:
 *
 * 4. /api/ipo-past-security-type?securityType=Equity
 *    - Status: 401 Unauthorized (all retry attempts failed)
 *    - Reason: Endpoint deprecated or requires additional authentication
 *    - Alternative: Use /api/public-past-issues instead
 *
 * 5. /json/liveMarket/public-issues-current.json
 *    - Status: 200 OK
 *    - Data: Column metadata only (UI table config, not IPO data)
 *    - Reason: Returns table structure, not actual IPO records
 *    - Alternative: Use /api/ipo-current-issue for actual data
 *
 * 📝 AUTHENTICATION NOTES:
 * - Multi-page cookie collection is REQUIRED (not just referer header)
 * - Minimum 5 cookies needed for current/upcoming endpoints
 * - Minimum 8 cookies needed for historical endpoints
 * - Cookie names: AKA_A2, nsit, nseappid, _abck, ak_bmsc, bm_mi, bm_sz, bm_sv
 * - Human-like delays (1.5s) improve success rate
 *
 * 🎯 RECOMMENDATIONS:
 * - Story 11.3: Use /api/ipo-current-issue + /api/all-upcoming-issues
 * - Story 11.4: Use /api/public-past-issues (avoid ipo-past-security-type)
 * - Remove LIVE_MARKET endpoint from active use
 * - Consider removing fetchPastIPOsByType() in future cleanup
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */