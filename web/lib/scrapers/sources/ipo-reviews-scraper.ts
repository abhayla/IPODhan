/**
 * IPO Reviews Scraper
 *
 * Scrapes IPO review data from various financial websites
 *
 * Primary Source: Chittorgarh.com (comprehensive IPO reviews)
 * Secondary Sources: MoneyControl, Apply IPO, Invest or
 *
 * Features:
 * - Scrapes reviews with recommendations
 * - Matches reviews to existing IPOs
 * - Extracts full review content
 * - Handles both Mainboard and SME IPOs
 */

import { BaseScraper, type ScraperResult } from '../base-scraper';
import { cleanText, parseDate, extractLinks } from '../utils/parser';
import { db } from '@/lib/db';
import { ipoReviews, ipos } from '@/lib/db/schema';
import { eq, and, like } from 'drizzle-orm';

export interface IPOReview {
  reviewTitle: string;
  author: string;
  recommendation: 'May apply' | 'Subscribe' | 'Avoid' | 'Not Recommended';
  ipoId: string;
  publishedDate: Date;
  year: number;
  category: 'MAINBOARD' | 'SME';
  reviewUrl: string;
  reviewContent: string;
}

export class IPOReviewsScraper extends BaseScraper<IPOReview[]> {
  constructor() {
    super({
      name: 'IPOReviewsScraper',
      baseUrl: 'https://www.chittorgarh.com',
      rateLimit: 0.5, // 1 request per 2 seconds
      timeout: 30000,
      retries: 3,
    });
  }

  /**
   * Main scrape method
   */
  async scrape(category: 'MAINBOARD' | 'SME' | 'ALL' = 'ALL'): Promise<ScraperResult<IPOReview[]>> {
    try {
      this.logStart(`Scraping IPO reviews for ${category}`);

      const reviews: IPOReview[] = [];

      if (category === 'MAINBOARD' || category === 'ALL') {
        const mainboardReviews = await this.scrapeChittorgarhMainboard();
        reviews.push(...mainboardReviews);
      }

      if (category === 'SME' || category === 'ALL') {
        const smeReviews = await this.scrapeChittorgarhSME();
        reviews.push(...smeReviews);
      }

      // Store in database
      await this.storeReviews(reviews);

      this.logComplete(reviews.length);
      return this.createSuccessResult(reviews);
    } catch (error) {
      this.logError(error as Error);
      return this.createErrorResult(error as Error);
    }
  }

  /**
   * Scrape Mainboard IPO reviews from Chittorgarh
   */
  private async scrapeChittorgarhMainboard(): Promise<IPOReview[]> {
    const url = 'https://www.chittorgarh.com/ipo/ipo-reviews-recommendations/81/';
    const $ = await this.fetchHTML(url);
    const reviews: IPOReview[] = [];

    // Chittorgarh has review cards/table
    $('.ipo-review-item, .review-card, tr.review-row').each((_, element) => {
      try {
        const $el = $(element);

        const reviewTitle = cleanText($el.find('.review-title, .title, h3, h4').first().text());
        const author = cleanText($el.find('.author, .by, .analyst').first().text());
        const recommendationText = cleanText($el.find('.recommendation, .verdict, .rating').first().text());
        const companyName = this.extractCompanyName(reviewTitle);
        const dateText = cleanText($el.find('.date, .published-date, time').first().text());
        const reviewLink = $el.find('a').first().attr('href');

        if (!reviewTitle || !companyName) return;

        const publishedDate = parseDate(dateText) || new Date();
        const year = publishedDate.getFullYear();

        const recommendation = this.parseRecommendation(recommendationText);
        if (!recommendation) return;

        const reviewUrl = reviewLink?.startsWith('http')
          ? reviewLink
          : `${this.config.baseUrl}${reviewLink}`;

        reviews.push({
          reviewTitle,
          author: author || 'Chittorgarh',
          recommendation,
          ipoId: '', // Will be filled when matching with IPO
          publishedDate,
          year,
          category: 'MAINBOARD',
          reviewUrl,
          reviewContent: '', // Will be scraped separately
        });
      } catch (error) {
        this.logError(`Failed to parse review: ${error}`);
      }
    });

    // Fetch full review content for each
    for (const review of reviews) {
      review.reviewContent = await this.scrapeReviewContent(review.reviewUrl);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
    }

    return reviews;
  }

  /**
   * Scrape SME IPO reviews
   */
  private async scrapeChittorgarhSME(): Promise<IPOReview[]> {
    const url = 'https://www.chittorgarh.com/ipo/sme-ipo-reviews/';
    const $ = await this.fetchHTML(url);
    const reviews: IPOReview[] = [];

    // Similar parsing logic as Mainboard
    $('.ipo-review-item, .review-card, tr.review-row').each((_, element) => {
      try {
        const $el = $(element);

        const reviewTitle = cleanText($el.find('.review-title, .title, h3, h4').first().text());
        const author = cleanText($el.find('.author, .by, .analyst').first().text());
        const recommendationText = cleanText($el.find('.recommendation, .verdict, .rating').first().text());
        const companyName = this.extractCompanyName(reviewTitle);
        const dateText = cleanText($el.find('.date, .published-date, time').first().text());
        const reviewLink = $el.find('a').first().attr('href');

        if (!reviewTitle || !companyName) return;

        const publishedDate = parseDate(dateText) || new Date();
        const year = publishedDate.getFullYear();

        const recommendation = this.parseRecommendation(recommendationText);
        if (!recommendation) return;

        const reviewUrl = reviewLink?.startsWith('http')
          ? reviewLink
          : `${this.config.baseUrl}${reviewLink}`;

        reviews.push({
          reviewTitle,
          author: author || 'Chittorgarh',
          recommendation,
          ipoId: '',
          publishedDate,
          year,
          category: 'SME',
          reviewUrl,
          reviewContent: '',
        });
      } catch (error) {
        this.logError(`Failed to parse SME review: ${error}`);
      }
    });

    // Fetch full content
    for (const review of reviews) {
      review.reviewContent = await this.scrapeReviewContent(review.reviewUrl);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return reviews;
  }

  /**
   * Scrape full review content from review page
   */
  private async scrapeReviewContent(url: string): Promise<string> {
    try {
      const $ = await this.fetchHTML(url);

      // Extract main content
      const content = cleanText(
        $('.review-content, .article-content, .main-content, article').first().text()
      );

      return content;
    } catch (error) {
      this.logError(`Failed to scrape review content from ${url}: ${error}`);
      return '';
    }
  }

  /**
   * Extract company name from review title
   */
  private extractCompanyName(title: string): string {
    // Common patterns: "Company Name IPO Review", "IPO Review: Company Name"
    let companyName = title
      .replace(/IPO\s+Review/gi, '')
      .replace(/Review:/gi, '')
      .replace(/\s+-\s+/g, '')
      .trim();

    return companyName;
  }

  /**
   * Parse recommendation from text
   */
  private parseRecommendation(text: string): IPOReview['recommendation'] | null {
    const lower = text.toLowerCase();

    if (lower.includes('subscribe')) return 'Subscribe';
    if (lower.includes('may apply') || lower.includes('mayapply')) return 'May apply';
    if (lower.includes('avoid')) return 'Avoid';
    if (lower.includes('not recommended')) return 'Not Recommended';

    return null;
  }

  /**
   * Match review to existing IPO by company name
   */
  private async matchIPO(companyName: string, category: 'MAINBOARD' | 'SME'): Promise<string | null> {
    try {
      // Fuzzy matching - try exact match first
      let matchedIPOs = await db.select()
        .from(ipos)
        .where(
          and(
            eq(ipos.companyName, companyName),
            eq(ipos.category, category)
          )
        )
        .limit(1);

      if (matchedIPOs.length > 0) {
        return matchedIPOs[0].id;
      }

      // Try partial match
      matchedIPOs = await db.select()
        .from(ipos)
        .where(
          and(
            like(ipos.companyName, `%${companyName}%`),
            eq(ipos.category, category)
          )
        )
        .limit(1);

      if (matchedIPOs.length > 0) {
        return matchedIPOs[0].id;
      }

      return null;
    } catch (error) {
      this.logError(`Failed to match IPO: ${error}`);
      return null;
    }
  }

  /**
   * Store reviews in database
   */
  private async storeReviews(reviews: IPOReview[]): Promise<void> {
    for (const review of reviews) {
      try {
        // Match to IPO
        const companyName = this.extractCompanyName(review.reviewTitle);
        const ipoId = await this.matchIPO(companyName, review.category);

        if (!ipoId) {
          this.logError(`Could not match review to IPO: ${review.reviewTitle}`);
          continue;
        }

        review.ipoId = ipoId;

        // Check if review already exists
        const existing = await db.select()
          .from(ipoReviews)
          .where(
            and(
              eq(ipoReviews.reviewTitle, review.reviewTitle),
              eq(ipoReviews.ipoId, ipoId)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          // Update existing
          await db.update(ipoReviews)
            .set({
              author: review.author,
              recommendation: review.recommendation,
              reviewContent: review.reviewContent,
              updatedAt: new Date(),
            })
            .where(eq(ipoReviews.id, existing[0].id));
        } else {
          // Insert new
          await db.insert(ipoReviews).values({
            reviewTitle: review.reviewTitle,
            author: review.author,
            recommendation: review.recommendation,
            ipoId: review.ipoId,
            publishedDate: review.publishedDate,
            year: review.year,
            category: review.category,
            reviewUrl: review.reviewUrl,
            reviewContent: review.reviewContent,
          });
        }
      } catch (error) {
        this.logError(`Failed to store review: ${error}`);
      }
    }
  }
}

// Export singleton instance
export const ipoReviewsScraper = new IPOReviewsScraper();
