import Parser from 'rss-parser';
import logger from '../utils/logger.js';
import { parseDate, sanitizeText, retryWithExponentialBackoff } from '../utils/scraper-utils.js';

const RSS_URL = 'https://www.moneycontrol.com/rss/iponews.xml';

export interface IPONewsItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  companyName?: string;
  ipoDate?: string;
}

export interface MoneycontrolRSSResult {
  news: IPONewsItem[];
  errors: string[];
}

/**
 * Parse Moneycontrol IPO RSS feed
 * Extracts IPO news and announcements for early detection of new IPOs
 * @returns Array of IPO news items
 */
export async function parseMoneycontrolRSS(): Promise<MoneycontrolRSSResult> {
  const result: MoneycontrolRSSResult = {
    news: [],
    errors: []
  };

  try {
    logger.info({ url: RSS_URL }, 'Starting Moneycontrol RSS feed parser');

    const parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // Parse RSS feed with retry logic
    const feed = await retryWithExponentialBackoff(
      () => parser.parseURL(RSS_URL),
      3,
      1000
    );

    if (!feed.items || feed.items.length === 0) {
      logger.warn('No items found in Moneycontrol RSS feed');
      result.errors.push('No RSS feed items found');
      return result;
    }

    logger.info({ itemCount: feed.items.length }, 'Found RSS feed items');

    // Process each RSS item
    for (const item of feed.items) {
      try {
        if (!item.title || !item.link) {
          continue; // Skip items without required fields
        }

        const title = sanitizeText(item.title);
        const description = item.contentSnippet || item.content || '';
        const pubDate = item.pubDate || item.isoDate || new Date().toISOString();

        // Extract company name from title
        // Typical format: "Company Name IPO opens/closes on..."
        let companyName: string | undefined;
        const companyMatch = title.match(/^([A-Z][a-zA-Z\s&]+?)(?:\s+IPO|\s+ipo)/);
        if (companyMatch) {
          companyName = sanitizeText(companyMatch[1]);
        }

        // Extract IPO date from title or description
        let ipoDate: string | undefined;
        const datePatterns = [
          /(?:opens|closes|to open|to close|launched).*?(?:on|from)\s+(\d{1,2}[/-]\w+[/-]\d{2,4})/i,
          /(\d{1,2}[/-]\w+[/-]\d{2,4}).*?(?:to|till|until)\s+(\d{1,2}[/-]\w+[/-]\d{2,4})/i,
          /(?:between)\s+(\d{1,2}[/-]\w+[/-]\d{2,4})/i
        ];

        for (const pattern of datePatterns) {
          const dateMatch = (title + ' ' + description).match(pattern);
          if (dateMatch) {
            ipoDate = parseDate(dateMatch[1]);
            if (ipoDate) break;
          }
        }

        const newsItem: IPONewsItem = {
          title: sanitizeText(title),
          link: item.link,
          pubDate: parseDate(pubDate) || new Date().toISOString(),
          description: sanitizeText(description),
          companyName,
          ipoDate
        };

        result.news.push(newsItem);

        logger.debug(
          { title: newsItem.title, companyName: newsItem.companyName },
          'Parsed RSS news item'
        );

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn({ error: errorMsg, item: item.title }, 'Failed to parse RSS item');
        result.errors.push(`RSS item parsing error: ${errorMsg}`);
      }
    }

    logger.info(
      { newsItems: result.news.length, errors: result.errors.length },
      'Moneycontrol RSS parser completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Moneycontrol RSS parser failed');
    result.errors.push(`RSS parser error: ${errorMsg}`);
    return result;
  }
}

/**
 * Filter RSS news for new IPO announcements
 * Identifies news items about newly announced or upcoming IPOs
 * @param news - Array of news items from RSS feed
 * @returns Filtered array of new IPO announcements
 */
export function filterNewIPOAnnouncements(news: IPONewsItem[]): IPONewsItem[] {
  const newIPOKeywords = [
    'opens', 'to open', 'launched', 'announces', 'files',
    'drhp', 'prospectus', 'upcoming', 'new ipo'
  ];

  return news.filter(item => {
    const text = (item.title + ' ' + item.description).toLowerCase();
    return newIPOKeywords.some(keyword => text.includes(keyword));
  });
}
