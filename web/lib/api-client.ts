/**
 * API Client Service
 *
 * Centralized HTTP client for making type-safe API calls to backend routes.
 * Features:
 * - Native Fetch API with TypeScript types
 * - Error handling with custom APIError class
 * - Request/response interceptors
 * - Retry logic with exponential backoff
 * - Request cancellation support
 * - Loading state management
 * - Environment-based configuration
 */

import * as Sentry from '@sentry/nextjs';
import type {
  ipos,
  subscriptions,
  gmpRecords,
  financialData,
  documents,
  listingPerformance,
  marketHolidays,
  registrars,
} from '@/lib/db/schema';

// ==================== TYPES ====================

/**
 * Infer TypeScript types from Drizzle schema
 */
export type IPO = typeof ipos.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type GMPRecord = typeof gmpRecords.$inferSelect;
export type FinancialData = typeof financialData.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type ListingPerformance = typeof listingPerformance.$inferSelect;
export type MarketHoliday = typeof marketHolidays.$inferSelect;
export type Registrar = typeof registrars.$inferSelect;

/**
 * API Response Types
 */
export interface IPOListResponse {
  data: IPO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface IPODetailResponse {
  ipo: IPO;
  subscription?: Subscription[];
  gmp?: GMPRecord[];
  financials?: FinancialData;
  documents?: Document[];
  listingPerformance?: ListingPerformance;
}

export interface SubscriptionResponse {
  data: Subscription[];
  ipoSlug: string;
}

export interface GMPResponse {
  data: GMPRecord[];
  ipoSlug: string;
  latestGMP?: number;
}

export interface SearchResponse {
  results: IPO[];
  total: number;
  query: string;
}

export interface HolidaysResponse {
  data: MarketHoliday[];
  year: number;
  exchange?: string;
}

export interface RegistrarsResponse {
  data: Registrar[];
}

export interface APIErrorResponse {
  error: {
    code: string;
    message: string;
    details?: object;
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Request parameter types
 */
export interface GetIPOsParams {
  status?: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';
  category?: 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD';
  sector?: string;
  page?: number;
  limit?: number;
}

export interface GetSubscriptionParams {
  latest?: boolean;
}

export interface GetGMPParams {
  days?: number;
}

export interface SearchIPOsParams {
  query: string;
  limit?: number;
}

export interface GetHolidaysParams {
  year: number;
  exchange?: 'NSE' | 'BSE' | 'BOTH';
}

// ==================== ERROR HANDLING ====================

/**
 * Custom API Error class with user-friendly messages
 */
export class APIError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: object;
  public readonly requestId?: string;

  constructor(
    message: string,
    code: string,
    status: number,
    details?: object,
    requestId?: string
  ) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
    Object.setPrototypeOf(this, APIError.prototype);
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    const messageMap: Record<string, string> = {
      NOT_FOUND: 'The requested resource was not found.',
      VALIDATION_ERROR: 'Invalid request data. Please check your input.',
      RATE_LIMIT_EXCEEDED: 'Too many requests. Please try again later.',
      SERVER_ERROR: 'An unexpected error occurred. Please try again.',
      NETWORK_ERROR: 'Network connection failed. Please check your internet.',
      TIMEOUT: 'Request timed out. Please try again.',
      UNAUTHORIZED: 'You are not authorized to access this resource.',
      FORBIDDEN: 'Access to this resource is forbidden.',
    };

    return messageMap[this.code] || this.message || 'An error occurred.';
  }

  /**
   * Check if error should be retried
   */
  isRetryable(): boolean {
    // Retry network errors and 5xx errors, but not 4xx client errors
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'TIMEOUT' ||
      (this.status >= 500 && this.status < 600)
    );
  }
}

// ==================== CONFIGURATION ====================

/**
 * API Client Configuration
 */
interface APIClientConfig {
  baseURL: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
}

/**
 * Get API base URL from environment or default
 */
function getBaseURL(): string {
  if (typeof window !== 'undefined') {
    // Client-side: Use NEXT_PUBLIC_API_BASE_URL or default
    return (
      process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api'
    );
  }
  // Server-side: Use same default
  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
}

/**
 * Default configuration
 */
const defaultConfig: APIClientConfig = {
  baseURL: getBaseURL(),
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second base delay
};

// ==================== REQUEST UTILITIES ====================

/**
 * Generate unique request ID for debugging
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number, baseDelay: number): number {
  return baseDelay * Math.pow(2, attempt - 1);
}

// ==================== INTERCEPTORS ====================

/**
 * Request interceptor type
 */
export type RequestInterceptor = (
  url: string,
  options: RequestInit
) => Promise<{ url: string; options: RequestInit }> | { url: string; options: RequestInit };

/**
 * Response interceptor type
 */
export type ResponseInterceptor = (response: Response) => Promise<Response> | Response;

/**
 * Interceptor storage
 */
const requestInterceptors: RequestInterceptor[] = [];
const responseInterceptors: ResponseInterceptor[] = [];

/**
 * Add request interceptor
 */
export function addRequestInterceptor(interceptor: RequestInterceptor): void {
  requestInterceptors.push(interceptor);
}

/**
 * Add response interceptor
 */
export function addResponseInterceptor(interceptor: ResponseInterceptor): void {
  responseInterceptors.push(interceptor);
}

/**
 * Execute request interceptors
 */
async function executeRequestInterceptors(
  url: string,
  options: RequestInit
): Promise<{ url: string; options: RequestInit }> {
  let result = { url, options };
  for (const interceptor of requestInterceptors) {
    result = await interceptor(result.url, result.options);
  }
  return result;
}

/**
 * Execute response interceptors
 */
async function executeResponseInterceptors(response: Response): Promise<Response> {
  let result = response;
  for (const interceptor of responseInterceptors) {
    result = await interceptor(result);
  }
  return result;
}

// ==================== LOADING STATE ====================

/**
 * Loading state tracker
 */
class LoadingStateManager {
  private activeRequests = new Set<string>();

  addRequest(requestId: string): void {
    this.activeRequests.add(requestId);
  }

  removeRequest(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  isLoading(): boolean {
    return this.activeRequests.size > 0;
  }

  getActiveRequestCount(): number {
    return this.activeRequests.size;
  }
}

export const loadingState = new LoadingStateManager();

// ==================== REQUEST DEDUPLICATION ====================

// Note: Request deduplication infrastructure (reserved for future use)
// Uncomment below when implementing request caching:
//
// const requestCache = new Map<string, Promise<unknown>>();
// function getCacheKey(url: string, options: RequestInit): string {
//   return `${options.method || 'GET'}:${url}`;
// }

// ==================== CORE FETCH WRAPPER ====================

/**
 * Enhanced fetch with retry logic, timeout, and error handling
 */
async function fetchWithRetry<T>(
  endpoint: string,
  options: RequestInit = {},
  config: APIClientConfig = defaultConfig,
  signal?: AbortSignal
): Promise<T> {
  const requestId = generateRequestId();
  const url = `${config.baseURL}${endpoint}`;

  // Add request to loading state
  loadingState.addRequest(requestId);

  try {
    // Set default headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Request-ID': requestId,
      ...(options.headers || {}),
    };

    let requestOptions: RequestInit = {
      ...options,
      headers,
      signal,
    };

    // Execute request interceptors
    const intercepted = await executeRequestInterceptors(url, requestOptions);
    const finalUrl = intercepted.url;
    requestOptions = intercepted.options;

    // Retry logic
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        // Create timeout controller
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), config.timeout);

        // Combine timeout signal with user signal
        const combinedSignal = signal
          ? combineAbortSignals([signal, timeoutController.signal])
          : timeoutController.signal;

        // Make request
        let response = await fetch(finalUrl, {
          ...requestOptions,
          signal: combinedSignal,
        });

        clearTimeout(timeoutId);

        // Execute response interceptors
        response = await executeResponseInterceptors(response);

        // Handle response
        if (!response.ok) {
          const errorData: APIErrorResponse = await response.json().catch(() => ({
            error: {
              code: 'UNKNOWN_ERROR',
              message: response.statusText || 'An error occurred',
              timestamp: new Date().toISOString(),
            },
          }));

          const apiError = new APIError(
            errorData.error.message,
            errorData.error.code,
            response.status,
            errorData.error.details,
            errorData.error.requestId || requestId
          );

          // Log 5xx errors to Sentry in production
          if (
            process.env.NODE_ENV === 'production' &&
            response.status >= 500 &&
            response.status < 600
          ) {
            Sentry.captureException(apiError, {
              tags: {
                errorCode: apiError.code,
                httpStatus: apiError.status,
                requestId: apiError.requestId || requestId,
              },
              contexts: {
                api: {
                  url: finalUrl,
                  method: requestOptions.method || 'GET',
                  attempt,
                },
              },
            });
          }

          // Don't retry 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            throw apiError;
          }

          // Retry 5xx errors
          if (attempt < config.maxRetries) {
            lastError = apiError;
            const delay = getRetryDelay(attempt, config.retryDelay);
            await sleep(delay);
            continue;
          }

          throw apiError;
        }

        // Parse successful response
        const data: T = await response.json();
        return data;
      } catch (error) {
        // Handle abort/timeout
        if (error instanceof Error && error.name === 'AbortError') {
          throw new APIError(
            'Request was cancelled',
            'TIMEOUT',
            0,
            undefined,
            requestId
          );
        }

        // Handle network errors
        if (error instanceof TypeError && error.message.includes('fetch')) {
          const networkError = new APIError(
            'Network request failed',
            'NETWORK_ERROR',
            0,
            { originalError: error.message },
            requestId
          );

          if (attempt < config.maxRetries) {
            lastError = networkError;
            const delay = getRetryDelay(attempt, config.retryDelay);
            await sleep(delay);
            continue;
          }

          throw networkError;
        }

        // Re-throw APIError
        if (error instanceof APIError) {
          throw error;
        }

        // Unknown error
        throw new APIError(
          error instanceof Error ? error.message : 'An unknown error occurred',
          'UNKNOWN_ERROR',
          0,
          { originalError: error },
          requestId
        );
      }
    }

    // If we exhausted retries
    throw lastError || new APIError('Request failed', 'UNKNOWN_ERROR', 0, undefined, requestId);
  } finally {
    // Remove request from loading state
    loadingState.removeRequest(requestId);
  }
}

/**
 * Combine multiple AbortSignals
 */
function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

// ==================== API METHODS ====================

/**
 * Get list of IPOs with filtering and pagination
 */
export async function getIPOs(
  params: GetIPOsParams = {},
  signal?: AbortSignal
): Promise<IPOListResponse> {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.append('status', params.status);
  if (params.category) searchParams.append('category', params.category);
  if (params.sector) searchParams.append('sector', params.sector);
  if (params.page) searchParams.append('page', params.page.toString());
  if (params.limit) searchParams.append('limit', params.limit.toString());

  const endpoint = `/ipos${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  return fetchWithRetry<IPOListResponse>(endpoint, { method: 'GET' }, defaultConfig, signal);
}

/**
 * Get detailed IPO information by slug
 */
export async function getIPOBySlug(
  slug: string,
  signal?: AbortSignal
): Promise<IPODetailResponse> {
  return fetchWithRetry<IPODetailResponse>(
    `/ipos/${slug}`,
    { method: 'GET' },
    defaultConfig,
    signal
  );
}

/**
 * Get subscription data for an IPO
 */
export async function getSubscription(
  slug: string,
  params: GetSubscriptionParams = {},
  signal?: AbortSignal
): Promise<SubscriptionResponse> {
  const searchParams = new URLSearchParams();
  if (params.latest !== undefined) searchParams.append('latest', params.latest.toString());

  const endpoint = `/ipos/${slug}/subscription${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  return fetchWithRetry<SubscriptionResponse>(endpoint, { method: 'GET' }, defaultConfig, signal);
}

/**
 * Get GMP (Grey Market Premium) history for an IPO
 */
export async function getGMP(
  slug: string,
  params: GetGMPParams = {},
  signal?: AbortSignal
): Promise<GMPResponse> {
  const searchParams = new URLSearchParams();
  if (params.days) searchParams.append('days', params.days.toString());

  const endpoint = `/ipos/${slug}/gmp${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  return fetchWithRetry<GMPResponse>(endpoint, { method: 'GET' }, defaultConfig, signal);
}

/**
 * Search IPOs by company name
 */
export async function searchIPOs(
  params: SearchIPOsParams,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const searchParams = new URLSearchParams();
  searchParams.append('q', params.query);
  if (params.limit) searchParams.append('limit', params.limit.toString());

  const endpoint = `/search?${searchParams.toString()}`;
  return fetchWithRetry<SearchResponse>(endpoint, { method: 'GET' }, defaultConfig, signal);
}

/**
 * Get market holidays
 */
export async function getHolidays(
  params: GetHolidaysParams,
  signal?: AbortSignal
): Promise<HolidaysResponse> {
  const searchParams = new URLSearchParams();
  searchParams.append('year', params.year.toString());
  if (params.exchange) searchParams.append('exchange', params.exchange);

  const endpoint = `/holidays?${searchParams.toString()}`;
  return fetchWithRetry<HolidaysResponse>(endpoint, { method: 'GET' }, defaultConfig, signal);
}

/**
 * Get all registrars
 */
export async function getRegistrars(signal?: AbortSignal): Promise<RegistrarsResponse> {
  return fetchWithRetry<RegistrarsResponse>(`/registrars`, { method: 'GET' }, defaultConfig, signal);
}

// ==================== DEFAULT EXPORT ====================

/**
 * Default API client object
 */
export const apiClient = {
  getIPOs,
  getIPOBySlug,
  getSubscription,
  getGMP,
  searchIPOs,
  getHolidays,
  getRegistrars,
};

// ==================== LOGGING INTERCEPTORS (Default) ====================

/**
 * Default request logging interceptor (development only)
 */
if (process.env.NODE_ENV === 'development') {
  addRequestInterceptor((url, options) => {
    console.log('[API Request]', options.method || 'GET', url);
    return { url, options };
  });

  addResponseInterceptor((response) => {
    console.log('[API Response]', response.status, response.url);
    return response;
  });
}
