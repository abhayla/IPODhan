/**
 * Unit Tests for URL Utilities
 * Tests UTM parameter generation and share text creation
 */

import { describe, it, expect } from 'vitest';
import {
  addUTMParams,
  generateShareUrl,
  createShareText,
} from '@/lib/utils/url-utils';

describe('addUTMParams', () => {
  it('should add UTM parameters to a URL without query params', () => {
    const url = 'https://ipodhan.com/ipos/techcorp';
    const result = addUTMParams(url, 'whatsapp', 'social', 'ipo_share');

    expect(result).toBe(
      'https://ipodhan.com/ipos/techcorp?utm_source=whatsapp&utm_medium=social&utm_campaign=ipo_share'
    );
  });

  it('should preserve existing query parameters', () => {
    const url = 'https://ipodhan.com/ipos/techcorp?tab=financials';
    const result = addUTMParams(url, 'twitter', 'social', 'ipo_share');

    expect(result).toContain('tab=financials');
    expect(result).toContain('utm_source=twitter');
    expect(result).toContain('utm_medium=social');
    expect(result).toContain('utm_campaign=ipo_share');
  });

  it('should handle URLs with hash fragments', () => {
    const url = 'https://ipodhan.com/ipos/techcorp#overview';
    const result = addUTMParams(url, 'copy', 'social', 'ipo_share');

    expect(result).toContain('#overview');
    expect(result).toContain('utm_source=copy');
  });

  it('should encode special characters in parameters', () => {
    const url = 'https://ipodhan.com/ipos/techcorp';
    const result = addUTMParams(url, 'test source', 'test medium', 'test campaign');

    expect(result).toContain('utm_source=test+source');
    expect(result).toContain('utm_medium=test+medium');
    expect(result).toContain('utm_campaign=test+campaign');
  });

  it('should return original URL if parsing fails', () => {
    const invalidUrl = 'not-a-valid-url';
    const result = addUTMParams(invalidUrl, 'whatsapp', 'social', 'ipo_share');

    expect(result).toBe(invalidUrl);
  });

  it('should override existing UTM parameters', () => {
    const url = 'https://ipodhan.com/ipos/techcorp?utm_source=old';
    const result = addUTMParams(url, 'whatsapp', 'social', 'ipo_share');

    expect(result).toContain('utm_source=whatsapp');
    expect(result).not.toContain('utm_source=old');
  });
});

describe('generateShareUrl', () => {
  it('should generate share URL for WhatsApp', () => {
    const url = 'https://ipodhan.com/ipos/techcorp';
    const result = generateShareUrl(url, 'whatsapp');

    expect(result).toBe(
      'https://ipodhan.com/ipos/techcorp?utm_source=whatsapp&utm_medium=social&utm_campaign=ipo_share'
    );
  });

  it('should generate share URL for Twitter', () => {
    const url = 'https://ipodhan.com/ipos/techcorp';
    const result = generateShareUrl(url, 'twitter');

    expect(result).toContain('utm_source=twitter');
  });

  it('should generate share URL for Copy', () => {
    const url = 'https://ipodhan.com/ipos/techcorp';
    const result = generateShareUrl(url, 'copy');

    expect(result).toContain('utm_source=copy');
  });

  it('should generate share URL for Native share', () => {
    const url = 'https://ipodhan.com/ipos/techcorp';
    const result = generateShareUrl(url, 'native');

    expect(result).toContain('utm_source=native');
  });
});

describe('createShareText', () => {
  it('should create share text with full metrics', () => {
    const result = createShareText('TechCorp', 4.0, 25, 120, 500);

    expect(result).toContain('TechCorp IPO');
    expect(result).toContain('Rating: 4.0/5');
    expect(result).toContain('Subscription: 25x');
    expect(result).toContain('GMP: ₹120');
    expect(result).toContain('on IPODhan');
  });

  it('should create share text without rating', () => {
    const result = createShareText('TechCorp', null, 25, 120, 500);

    expect(result).not.toContain('Rating');
    expect(result).toContain('Subscription: 25x');
    expect(result).toContain('GMP: ₹120');
  });

  it('should create share text with only company name', () => {
    const result = createShareText('TechCorp');

    expect(result).toBe('Check out TechCorp IPO on IPODhan');
  });

  it('should handle partial metrics', () => {
    const result = createShareText('TechCorp', 3.5, null, 120, null);

    expect(result).toContain('Rating: 3.5/5');
    expect(result).toContain('GMP: ₹120');
    expect(result).not.toContain('Subscription');
    expect(result).not.toContain('Issue');
  });

  it('should truncate text if too long', () => {
    const result = createShareText(
      'Very Long Company Name That Makes The Text Too Long',
      4.5,
      100,
      500,
      10000
    );

    // Should be under 200 chars
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('on IPODhan');
  });

  it('should format rating with one decimal place', () => {
    const result = createShareText('TechCorp', 4.23456, null, null, null);

    expect(result).toContain('Rating: 4.2/5');
  });

  it('should handle zero values correctly', () => {
    const result = createShareText('TechCorp', 0, 0, 0, 0);

    expect(result).toContain('Rating: 0.0/5');
    expect(result).toContain('Subscription: 0x');
    expect(result).toContain('GMP: ₹0');
    expect(result).toContain('Issue: ₹0 Cr');
  });

  it('should handle undefined metrics', () => {
    const result = createShareText('TechCorp', undefined, undefined, undefined, undefined);

    expect(result).toBe('Check out TechCorp IPO on IPODhan');
  });

  it('should prioritize rating and subscription when truncating', () => {
    const result = createShareText(
      'Company With Very Long Name For Testing',
      4.5,
      25,
      120,
      500
    );

    // Should keep rating and subscription even when truncating
    if (result.length > 150) {
      expect(result).toContain('Rating');
      expect(result).toContain('Subscription');
    }
  });
});
