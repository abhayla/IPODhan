/**
 * IPO Reviews Aggregator
 *
 * Aggregates IPO reviews from multiple sources:
 * 1. Chittorgarh - Broker recommendations
 * 2. Investorgain - Detailed analyst reports
 * 3. Moneycontrol - Analyst ratings and commentary
 *
 * Features:
 * - Multi-source scraping with individual error handling
 * - Deduplication by author name (fuzzy matching)
 * - Recommendation normalization across sources
 * - Retry logic with exponential backoff
 */

import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import {
  scrapeWithCheerio,
  retryWithExponentialBackoff,
  parseDate,
  sanitizeText,
  fuzzyMatch,
} from '../utils/scraper-utils.js';

// ==================== TYPES ====================

export interface ScrapedIPOReview {
  source: 'CHITTORGARH' | 'INVESTORGAIN' | 'MONEYCONTROL';
  author: string;
  reviewTitle: string;
  recommendation: 'Subscribe' | 'May apply' | 'Avoid' | 'Not Recommended';
  publishedDate: Date;
  reviewContent: string;
  reviewUrl?: string;
}

interface IPOContext {
  ipoId: string;
  companyName: string;
  slug: string;
}

// ==================== MAIN AGGREGATOR ====================

/**
 * Aggregate IPO reviews from all sources
 * @param context - IPO context (ID, name, slug)
 * @returns Array of deduplicated reviews
 */
export async function aggregateIPOReviews(context: IPOContext): Promise<ScrapedIPOReview[]> {
  const { companyName } = context;
  const reviews: ScrapedIPOReview[] = [];

  // Source 1: Chittorgarh (HIGH priority - most reliable)
  try {
    logger.info({ companyName }, '[Reviews] Scraping Chittorgarh reviews...');
    const chittorgarhReviews = await retryWithExponentialBackoff(
      () => scrapeChittorgarhReviews(companyName),
      2,
      1000
    );
    reviews.push(...chittorgarhReviews);
    logger.info({ companyName, count: chittorgarhReviews.length }, '[Reviews] ✓ Chittorgarh reviews scraped');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ companyName, error: errorMsg }, '[Reviews] Failed to scrape Chittorgarh reviews');
  }

  // Source 2: Investorgain (MEDIUM priority)
  try {
    logger.info({ companyName }, '[Reviews] Scraping Investorgain reviews...');
    const investorgainReviews = await retryWithExponentialBackoff(
      () => scrapeInvestorgainReviews(companyName),
      2,
      1000
    );
    reviews.push(...investorgainReviews);
    logger.info({ companyName, count: investorgainReviews.length }, '[Reviews] ✓ Investorgain reviews scraped');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ companyName, error: errorMsg }, '[Reviews] Failed to scrape Investorgain reviews');
  }

  // Source 3: Moneycontrol (LOW priority - less structured)
  try {
    logger.info({ companyName }, '[Reviews] Scraping Moneycontrol reviews...');
    const moneycontrolReviews = await retryWithExponentialBackoff(
      () => scrapeMoneycontrolReviews(companyName),
      2,
      1000
    );
    reviews.push(...moneycontrolReviews);
    logger.info({ companyName, count: moneycontrolReviews.length }, '[Reviews] ✓ Moneycontrol reviews scraped');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ companyName, error: errorMsg }, '[Reviews] Failed to scrape Moneycontrol reviews');
  }

  // Deduplicate by author (keep most recent if duplicate)
  const uniqueReviews = deduplicateReviews(reviews);

  logger.info(
    { companyName, total: reviews.length, unique: uniqueReviews.length },
    '[Reviews] Review aggregation complete'
  );

  return uniqueReviews;
}

// ==================== CHITTORGARH SCRAPER ====================

/**
 * Scrape reviews from Chittorgarh
 * URL Pattern: https://www.chittorgarh.com/ipo/{company-slug}/
 */
async function scrapeChittorgarhReviews(companyName: string): Promise<ScrapedIPOReview[]> {
  const slug = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const url = `https://www.chittorgarh.com/ipo/${slug}/`;

  try {
    const $ = await scrapeWithCheerio(url);
    const reviews: ScrapedIPOReview[] = [];

    // Look for review sections in various possible locations
    // Pattern 1: Table with broker recommendations
    $('table.ipo-table tr, table.dataTable tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');

      if (cells.length >= 3) {
        const brokerName = sanitizeText(cells.eq(0).text());
        const recommendation = sanitizeText(cells.eq(1).text());
        const content = sanitizeText(cells.eq(2).text());

        if (brokerName && recommendation && brokerName !== 'Broker' && brokerName !== 'Brokerage') {
          reviews.push({
            source: 'CHITTORGARH',
            author: brokerName,
            reviewTitle: `${companyName} IPO - ${recommendation}`,
            recommendation: normalizeRecommendation(recommendation),
            reviewContent: content || recommendation,
            publishedDate: new Date(), // Chittorgarh doesn't always show dates
            reviewUrl: url,
          });
        }
      }
    });

    // Pattern 2: Div-based reviews
    $('.broker-review, .review-item, .ipo-review').each((_, elem) => {
      const $elem = $(elem);
      const author = sanitizeText($elem.find('.broker-name, .author').text()) ||
                    sanitizeText($elem.find('strong, b').first().text());
      const recommendation = sanitizeText($elem.find('.recommendation, .rating').text());
      const content = sanitizeText($elem.find('.review-text, .content, p').text());

      if (author && recommendation) {
        reviews.push({
          source: 'CHITTORGARH',
          author,
          reviewTitle: `${companyName} IPO - ${recommendation}`,
          recommendation: normalizeRecommendation(recommendation),
          reviewContent: content || recommendation,
          publishedDate: new Date(),
          reviewUrl: url,
        });
      }
    });

    return reviews;
  } catch (error) {
    logger.error({ url, error }, '[Chittorgarh] Failed to scrape reviews');
    throw error;
  }
}

// ==================== INVESTORGAIN SCRAPER ====================

/**
 * Scrape reviews from Investorgain
 * URL Pattern: https://www.investorgain.com/report/{company}/
 */
async function scrapeInvestorgainReviews(companyName: string): Promise<ScrapedIPOReview[]> {
  const slug = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const url = `https://www.investorgain.com/report/${slug}/`;

  try {
    const $ = await scrapeWithCheerio(url);
    const reviews: ScrapedIPOReview[] = [];

    // Investorgain typically has detailed reports from specific brokers
    $('.report-card, .broker-report, article').each((_, elem) => {
      const $elem = $(elem);
      const author = sanitizeText($elem.find('.broker-name, .author, h3').text());
      const title = sanitizeText($elem.find('.report-title, h2, h4').text());
      const recommendation = sanitizeText($elem.find('.recommendation, .verdict').text());
      const content = sanitizeText($elem.find('.report-content, .summary, p').text());
      const dateStr = sanitizeText($elem.find('.published-date, .date, time').text());

      if (author && recommendation) {
        reviews.push({
          source: 'INVESTORGAIN',
          author,
          reviewTitle: title || `${companyName} IPO - ${recommendation}`,
          recommendation: normalizeRecommendation(recommendation),
          reviewContent: content || recommendation,
          publishedDate: parseDateWithFallback(dateStr),
          reviewUrl: url,
        });
      }
    });

    return reviews;
  } catch (error) {
    logger.error({ url, error }, '[Investorgain] Failed to scrape reviews');
    throw error;
  }
}

// ==================== MONEYCONTROL SCRAPER ====================

/**
 * Scrape reviews from Moneycontrol
 * URL Pattern: https://www.moneycontrol.com/ipo/ipo-details/{slug}
 */
async function scrapeMoneycontrolReviews(companyName: string): Promise<ScrapedIPOReview[]> {
  const slug = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const url = `https://www.moneycontrol.com/ipo/ipo-details/${slug}`;

  try {
    const $ = await scrapeWithCheerio(url);
    const reviews: ScrapedIPOReview[] = [];

    // Moneycontrol has analyst views in various sections
    $('.analyst-view, .expert-view, .broker-view').each((_, elem) => {
      const $elem = $(elem);
      const author = sanitizeText($elem.find('.analyst-name, .expert-name, strong').text());
      const recommendation = sanitizeText($elem.find('.recommendation, .view').text());
      const content = sanitizeText($elem.find('.view-content, p').text());

      if (author && recommendation) {
        reviews.push({
          source: 'MONEYCONTROL',
          author,
          reviewTitle: `${companyName} IPO - ${recommendation}`,
          recommendation: normalizeRecommendation(recommendation),
          reviewContent: content || recommendation,
          publishedDate: new Date(),
          reviewUrl: url,
        });
      }
    });

    return reviews;
  } catch (error) {
    logger.error({ url, error }, '[Moneycontrol] Failed to scrape reviews');
    throw error;
  }
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Normalize recommendation text to standard enum values
 */
function normalizeRecommendation(rec: string): 'Subscribe' | 'May apply' | 'Avoid' | 'Not Recommended' {
  const lower = rec.toLowerCase();

  // Subscribe variations
  if (
    lower.includes('subscribe') ||
    lower.includes('apply') && !lower.includes('may') ||
    lower.includes('buy') ||
    lower.includes('recommended')
  ) {
    return 'Subscribe';
  }

  // May apply variations
  if (
    lower.includes('may apply') ||
    lower.includes('neutral') ||
    lower.includes('moderate')
  ) {
    return 'May apply';
  }

  // Avoid variations
  if (
    lower.includes('avoid') ||
    lower.includes('skip') ||
    lower.includes('no') ||
    lower.includes('not recommended')
  ) {
    return 'Avoid';
  }

  // Default
  return 'Not Recommended';
}

/**
 * Parse date with fallback to current date
 */
function parseDateWithFallback(dateStr: string): Date {
  if (!dateStr) return new Date();

  const parsed = parseDate(dateStr);
  if (!parsed) return new Date();

  try {
    return new Date(parsed);
  } catch {
    return new Date();
  }
}

/**
 * Deduplicate reviews by author name (fuzzy matching)
 * Keeps the most recent review if duplicates found
 */
function deduplicateReviews(reviews: ScrapedIPOReview[]): ScrapedIPOReview[] {
  const uniqueMap = new Map<string, ScrapedIPOReview>();

  for (const review of reviews) {
    const normalizedAuthor = review.author.toLowerCase().trim();

    // Check for exact match first
    if (uniqueMap.has(normalizedAuthor)) {
      const existing = uniqueMap.get(normalizedAuthor)!;
      // Keep the more recent review
      if (review.publishedDate > existing.publishedDate) {
        uniqueMap.set(normalizedAuthor, review);
      }
      continue;
    }

    // Check for fuzzy matches
    let foundMatch = false;
    for (const [existingAuthor, existingReview] of uniqueMap.entries()) {
      const similarity = fuzzyMatch(normalizedAuthor, existingAuthor);

      // If 85%+ similar, consider it a duplicate
      if (similarity >= 0.85) {
        foundMatch = true;
        // Keep the more recent review
        if (review.publishedDate > existingReview.publishedDate) {
          uniqueMap.delete(existingAuthor);
          uniqueMap.set(normalizedAuthor, review);
        }
        break;
      }
    }

    // If no match found, add as new review
    if (!foundMatch) {
      uniqueMap.set(normalizedAuthor, review);
    }
  }

  return Array.from(uniqueMap.values());
}
