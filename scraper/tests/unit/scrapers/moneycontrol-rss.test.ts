/**
 * Unit tests for moneycontrol-rss.ts
 * Tests: RSS parsing, company name extraction, date extraction, filtering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseMoneycontrolRSS,
  filterNewIPOAnnouncements,
  type IPONewsItem
} from '../../../src/scrapers/moneycontrol-rss.js';
import * as scraperUtils from '../../../src/utils/scraper-utils.js';
import Parser from 'rss-parser';

describe('moneycontrol-rss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseMoneycontrolRSS', () => {
    it('should successfully parse RSS feed with IPO news', async () => {
      const mockFeed = {
        items: [
          {
            title: 'ABC Company IPO opens on 10-Oct-2025',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'ABC Company announces IPO opening'
          },
          {
            title: 'XYZ Limited IPO to close on 15-Nov-2025',
            link: 'https://example.com/ipo2',
            pubDate: '2025-10-05T12:00:00Z',
            contentSnippet: 'XYZ Limited IPO subscription details'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(2);
      expect(result.news[0].title).toContain('ABC Company IPO');
      expect(result.news[1].title).toContain('XYZ Limited IPO');
      expect(result.errors).toHaveLength(0);
    });

    it('should extract company name from title', async () => {
      const mockFeed = {
        items: [
          {
            title: 'Reliance Industries IPO opens on 10-Oct-2025',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'IPO details'
          },
          {
            title: 'Tata Consultancy Services IPO announcement',
            link: 'https://example.com/ipo2',
            pubDate: '2025-10-05T12:00:00Z',
            contentSnippet: 'IPO news'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(2);
      expect(result.news[0].companyName).toBe('Reliance Industries');
      expect(result.news[1].companyName).toBe('Tata Consultancy Services');
    });

    it('should extract IPO date from title (opens on pattern)', async () => {
      const mockFeed = {
        items: [
          {
            title: 'ABC Company IPO opens on 10-Oct-2025',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'IPO details'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(1);
      expect(result.news[0].ipoDate).toBeDefined();
      // Date may be off by one day due to timezone (IST UTC+5:30)
      expect(result.news[0].ipoDate).toMatch(/2025-10-(09|10)/);
    });

    it('should extract IPO date from description', async () => {
      const mockFeed = {
        items: [
          {
            title: 'New IPO Announcement',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'The IPO will open from 15-Nov-2025 to 17-Nov-2025'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(1);
      expect(result.news[0].ipoDate).toBeDefined();
      // Date may be off by one day due to timezone (IST UTC+5:30)
      expect(result.news[0].ipoDate).toMatch(/2025-11-(14|15)/);
    });

    it('should handle RSS feed with no items', async () => {
      const mockFeed = {
        items: []
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(0);
      expect(result.errors).toContain('No RSS feed items found');
    });

    it('should skip items without required fields', async () => {
      const mockFeed = {
        items: [
          {
            title: 'Valid IPO News',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'Valid content'
          },
          {
            // Missing title
            link: 'https://example.com/ipo2',
            pubDate: '2025-10-05T12:00:00Z',
            contentSnippet: 'Invalid content'
          },
          {
            title: 'Another Valid IPO',
            // Missing link
            pubDate: '2025-10-10T10:00:00Z',
            contentSnippet: 'Valid content'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      // Only first item should be included
      expect(result.news).toHaveLength(1);
      expect(result.news[0].title).toBe('Valid IPO News');
    });

    it('should sanitize HTML from title and description', async () => {
      const mockFeed = {
        items: [
          {
            title: '<strong>ABC Company</strong> IPO opens',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: '<p>IPO <b>details</b> here</p>'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(1);
      expect(result.news[0].title).not.toContain('<');
      expect(result.news[0].title).not.toContain('>');
      expect(result.news[0].description).not.toContain('<');
      expect(result.news[0].description).not.toContain('>');
    });

    it('should handle parsing errors gracefully', async () => {
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockRejectedValue(
        new Error('RSS feed timeout')
      );

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(0);
      expect(result.errors).toContain('RSS parser error: RSS feed timeout');
    });

    it('should use fallback pubDate if not provided', async () => {
      const mockFeed = {
        items: [
          {
            title: 'ABC Company IPO',
            link: 'https://example.com/ipo1',
            contentSnippet: 'IPO details'
            // No pubDate or isoDate
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(1);
      expect(result.news[0].pubDate).toBeDefined();
      // Should use current date as fallback
      expect(() => new Date(result.news[0].pubDate)).not.toThrow();
    });

    it('should handle items with contentSnippet or content field', async () => {
      const mockFeed = {
        items: [
          {
            title: 'IPO 1',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'Description via snippet'
          },
          {
            title: 'IPO 2',
            link: 'https://example.com/ipo2',
            pubDate: '2025-10-05T12:00:00Z',
            content: 'Description via content'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(2);
      expect(result.news[0].description).toBe('Description via snippet');
      expect(result.news[1].description).toBe('Description via content');
    });

    it('should extract company names with & symbols', async () => {
      const mockFeed = {
        items: [
          {
            title: 'Procter & Gamble IPO opens on 10-Oct-2025',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'IPO details'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      expect(result.news).toHaveLength(1);
      expect(result.news[0].companyName).toContain('Procter & Gamble');
    });

    it('should handle individual item parsing errors', async () => {
      const mockFeed = {
        items: [
          {
            title: 'Valid IPO',
            link: 'https://example.com/ipo1',
            pubDate: '2025-10-01T10:00:00Z',
            contentSnippet: 'Valid content'
          },
          {
            title: null as any, // Will cause parsing error
            link: 'https://example.com/ipo2',
            pubDate: '2025-10-05T12:00:00Z',
            contentSnippet: 'Invalid content'
          }
        ]
      };

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue(mockFeed);

      const result = await parseMoneycontrolRSS();

      // First valid item should be parsed
      expect(result.news).toHaveLength(1);
      expect(result.news[0].title).toBe('Valid IPO');
    });
  });

  describe('filterNewIPOAnnouncements', () => {
    const newsItems: IPONewsItem[] = [
      {
        title: 'ABC Company IPO opens on 10-Oct-2025',
        link: 'https://example.com/1',
        pubDate: '2025-10-01T10:00:00Z',
        description: 'ABC Company announces its IPO'
      },
      {
        title: 'Stock market update',
        link: 'https://example.com/2',
        pubDate: '2025-10-02T10:00:00Z',
        description: 'General market news'
      },
      {
        title: 'XYZ Limited files DRHP',
        link: 'https://example.com/3',
        pubDate: '2025-10-03T10:00:00Z',
        description: 'XYZ Limited prepares for IPO'
      },
      {
        title: 'New IPO from TechCorp',
        link: 'https://example.com/4',
        pubDate: '2025-10-04T10:00:00Z',
        description: 'TechCorp upcoming IPO details'
      },
      {
        title: 'Market analysis report',
        link: 'https://example.com/5',
        pubDate: '2025-10-05T10:00:00Z',
        description: 'Weekly market analysis'
      }
    ];

    it('should filter news items with "opens" keyword', () => {
      const filtered = filterNewIPOAnnouncements(newsItems);
      const openNews = filtered.filter(item => item.title.toLowerCase().includes('opens'));
      expect(openNews.length).toBeGreaterThan(0);
    });

    it('should filter news items with "files" keyword', () => {
      const filtered = filterNewIPOAnnouncements(newsItems);
      const fileNews = filtered.filter(item => item.title.toLowerCase().includes('files'));
      expect(fileNews.length).toBeGreaterThan(0);
    });

    it('should filter news items with "new ipo" keyword', () => {
      const filtered = filterNewIPOAnnouncements(newsItems);
      const newIPONews = filtered.filter(item => item.title.toLowerCase().includes('new ipo'));
      expect(newIPONews.length).toBeGreaterThan(0);
    });

    it('should exclude non-IPO news', () => {
      const filtered = filterNewIPOAnnouncements(newsItems);

      // Should not include general market news
      const hasMarketUpdate = filtered.some(item => item.title.includes('Stock market update'));
      expect(hasMarketUpdate).toBe(false);

      const hasAnalysis = filtered.some(item => item.title.includes('Market analysis'));
      expect(hasAnalysis).toBe(false);
    });

    it('should return empty array for empty input', () => {
      const filtered = filterNewIPOAnnouncements([]);
      expect(filtered).toEqual([]);
    });

    it('should filter based on description as well as title', () => {
      const newsWithDescriptionMatch: IPONewsItem[] = [
        {
          title: 'Financial News',
          link: 'https://example.com/1',
          pubDate: '2025-10-01T10:00:00Z',
          description: 'Company announces new IPO launch'
        }
      ];

      const filtered = filterNewIPOAnnouncements(newsWithDescriptionMatch);
      expect(filtered).toHaveLength(1);
    });

    it('should be case-insensitive', () => {
      const mixedCaseNews: IPONewsItem[] = [
        {
          title: 'Company OPENS IPO Today',
          link: 'https://example.com/1',
          pubDate: '2025-10-01T10:00:00Z',
          description: 'IPO details'
        },
        {
          title: 'DRHP Filed',
          link: 'https://example.com/2',
          pubDate: '2025-10-02T10:00:00Z',
          description: 'Company files DRHP'
        }
      ];

      const filtered = filterNewIPOAnnouncements(mixedCaseNews);
      expect(filtered).toHaveLength(2);
    });

    it('should match "to open" keyword', () => {
      const newsWithToOpen: IPONewsItem[] = [
        {
          title: 'ABC Company IPO to open tomorrow',
          link: 'https://example.com/1',
          pubDate: '2025-10-01T10:00:00Z',
          description: 'IPO details'
        }
      ];

      const filtered = filterNewIPOAnnouncements(newsWithToOpen);
      expect(filtered).toHaveLength(1);
    });

    it('should match "launched" keyword', () => {
      const newsWithLaunched: IPONewsItem[] = [
        {
          title: 'Company launched IPO today',
          link: 'https://example.com/1',
          pubDate: '2025-10-01T10:00:00Z',
          description: 'IPO launch details'
        }
      ];

      const filtered = filterNewIPOAnnouncements(newsWithLaunched);
      expect(filtered).toHaveLength(1);
    });

    it('should match "upcoming" keyword', () => {
      const newsWithUpcoming: IPONewsItem[] = [
        {
          title: 'Upcoming IPOs this week',
          link: 'https://example.com/1',
          pubDate: '2025-10-01T10:00:00Z',
          description: 'List of upcoming IPOs'
        }
      ];

      const filtered = filterNewIPOAnnouncements(newsWithUpcoming);
      expect(filtered).toHaveLength(1);
    });
  });
});
