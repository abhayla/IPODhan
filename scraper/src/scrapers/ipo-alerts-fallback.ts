import logger from '../utils/logger.js';
import { ipoAlertsClient, RateLimitExceededError, APINotFoundError, APIAuthenticationError } from '../services/ipo-alerts-client.js';
import { validateIPOAlertsIPOData, transformIPOAlertsData } from '../utils/validators.js';
import type { ScrapedIPO } from '../utils/validators.js';
import { config } from '../config.js';

// ==================== TYPES ====================

export interface FallbackScraperResult {
  success: boolean;
  iposProcessed: number;
  iposFetched: number;
  iposValid: number;
  iposInvalid: number;
  errors: string[];
  rateLimitUsed: number;
  rateLimitRemaining: number;
  duration: number;
}

// ==================== SCRAPER CORE LOGIC ====================

/**
 * Scrape IPO data from IPO Alerts API
 * @returns Array of validated and transformed IPO data
 */
export async function scrapeIPOAlertsAPI(): Promise<ScrapedIPO[]> {
  const startTime = Date.now();
  const validatedIPOs: ScrapedIPO[] = [];
  const errors: string[] = [];

  try {
    logger.info('Starting IPO Alerts API fallback scrape');

    // Check rate limit before proceeding
    const rateLimitStatus = ipoAlertsClient.getRateLimitStatus();
    logger.info(
      {
        rateLimitUsed: rateLimitStatus.used,
        rateLimitRemaining: rateLimitStatus.remaining,
        rateLimitTotal: rateLimitStatus.limit
      },
      'Rate limit status before API fetch'
    );

    if (rateLimitStatus.remaining < 2) {
      const resetMinutes = Math.ceil(rateLimitStatus.resetInMs / 60000);
      logger.warn(
        {
          remaining: rateLimitStatus.remaining,
          resetInMinutes: resetMinutes
        },
        'Rate limit low, may not be able to fetch all IPOs'
      );
    }

    // Fetch all active IPOs (open + upcoming)
    logger.debug('Fetching all active IPOs from API');
    const apiResponse = await ipoAlertsClient.fetchAllActiveIPOs();

    const apiDuration = Date.now() - startTime;
    logger.info(
      {
        ipoCount: apiResponse.count,
        duration: apiDuration,
        rateLimitRemaining: apiResponse.rate_limit?.remaining
      },
      'API fetch completed'
    );

    // Validate and transform each IPO
    for (const rawIPO of apiResponse.data) {
      try {
        // Validate API response data with Zod
        const validationResult = validateIPOAlertsIPOData(rawIPO);

        if (!validationResult.success) {
          const errorMessage = `Validation failed: ${validationResult.error?.message}`;
          errors.push(errorMessage);
          logger.warn(
            {
              companyName: rawIPO?.company_name || 'Unknown',
              validationErrors: validationResult.error?.issues
            },
            'IPO validation failed, skipping'
          );
          continue;
        }

        // Transform API data to IPODhan format
        const transformedIPO = transformIPOAlertsData(validationResult.data!);
        validatedIPOs.push(transformedIPO);

        logger.debug(
          { companyName: transformedIPO.companyName },
          'IPO validated and transformed successfully'
        );

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Transformation error: ${errorMessage}`);
        logger.error(
          {
            error: errorMessage,
            companyName: rawIPO?.company_name || 'Unknown'
          },
          'Failed to transform IPO data'
        );
      }
    }

    const totalDuration = Date.now() - startTime;
    logger.info(
      {
        iposFetched: apiResponse.count,
        iposValid: validatedIPOs.length,
        iposInvalid: apiResponse.count - validatedIPOs.length,
        errors: errors.length,
        duration: totalDuration
      },
      'IPO Alerts API scrape completed'
    );

    return validatedIPOs;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle specific error types
    if (error instanceof RateLimitExceededError) {
      logger.error(
        { error: errorMessage },
        'Rate limit exceeded during API fallback scrape'
      );
      throw error;
    }

    if (error instanceof APIAuthenticationError) {
      logger.error(
        { error: errorMessage },
        'API authentication failed. Check API key configuration.'
      );
      throw error;
    }

    if (error instanceof APINotFoundError) {
      logger.warn(
        { error: errorMessage },
        'API endpoint not found or no data available'
      );
      // Return empty array for 404 (not an error condition, just no data)
      return [];
    }

    // Network errors, server errors, timeouts
    logger.error(
      {
        error: errorMessage,
        duration: Date.now() - startTime
      },
      'IPO Alerts API scrape failed'
    );
    throw error;
  }
}

/**
 * Retry scrapeIPOAlertsAPI with exponential backoff
 * @returns Array of validated IPOs
 */
export async function scrapeIPOAlertsAPIWithRetry(): Promise<ScrapedIPO[]> {
  const maxAttempts = config.scraper.retryAttempts;
  const delays = config.scraper.retryDelays;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await scrapeIPOAlertsAPI();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Do not retry on authentication errors or rate limit errors
      if (error instanceof APIAuthenticationError || error instanceof RateLimitExceededError) {
        throw error;
      }

      // Retry on network errors, server errors, timeouts
      if (attempt < maxAttempts - 1) {
        const delay = delays[attempt] || delays[delays.length - 1];
        logger.warn(
          {
            attempt: attempt + 1,
            maxAttempts,
            delay,
            error: lastError.message
          },
          'API fallback scrape failed, retrying with exponential backoff'
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`API fallback scrape failed after ${maxAttempts} attempts: ${lastError?.message}`);
}
