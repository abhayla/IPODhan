/**
 * Unit Tests for Google Analytics Tracking
 * Tests GA4 event tracking functions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackShare, trackPageView, trackEvent, initGA } from '@/lib/analytics/gtag';

describe('Google Analytics Tracking', () => {
  beforeEach(() => {
    // Reset window.gtag mock before each test
    if (typeof window !== 'undefined') {
      window.gtag = vi.fn();
      window.dataLayer = [];
    }
  });

  describe('trackShare', () => {
    it('should call gtag with correct share event parameters', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackShare('whatsapp', 'TechCorp');

      expect(mockGtag).toHaveBeenCalledWith('event', 'share', {
        method: 'whatsapp',
        content_type: 'ipo',
        item_id: 'TechCorp',
      });
    });

    it('should track Twitter share', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackShare('twitter', 'CompanyName');

      expect(mockGtag).toHaveBeenCalledWith('event', 'share', {
        method: 'twitter',
        content_type: 'ipo',
        item_id: 'CompanyName',
      });
    });

    it('should track copy link share', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackShare('copy', 'StartupCo');

      expect(mockGtag).toHaveBeenCalledWith('event', 'share', {
        method: 'copy',
        content_type: 'ipo',
        item_id: 'StartupCo',
      });
    });

    it('should track native share', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackShare('native', 'MobileCo');

      expect(mockGtag).toHaveBeenCalledWith('event', 'share', {
        method: 'native',
        content_type: 'ipo',
        item_id: 'MobileCo',
      });
    });

    it('should not throw error if gtag is undefined', () => {
      window.gtag = undefined;

      expect(() => trackShare('whatsapp', 'TechCorp')).not.toThrow();
    });

    it('should handle gtag errors gracefully', () => {
      window.gtag = vi.fn(() => {
        throw new Error('GA4 error');
      });

      expect(() => trackShare('whatsapp', 'TechCorp')).not.toThrow();
    });
  });

  describe('trackPageView', () => {
    it('should call gtag with page_view event', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackPageView('/ipos/techcorp', 'TechCorp IPO Details');

      expect(mockGtag).toHaveBeenCalledWith('event', 'page_view', {
        page_path: '/ipos/techcorp',
        page_title: 'TechCorp IPO Details',
      });
    });

    it('should not throw error if gtag is undefined', () => {
      window.gtag = undefined;

      expect(() => trackPageView('/test', 'Test Page')).not.toThrow();
    });
  });

  describe('trackEvent', () => {
    it('should call gtag with custom event', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackEvent('ipo_filter', {
        filter_type: 'status',
        filter_value: 'upcoming',
      });

      expect(mockGtag).toHaveBeenCalledWith('event', 'ipo_filter', {
        filter_type: 'status',
        filter_value: 'upcoming',
      });
    });

    it('should track event without parameters', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackEvent('button_click');

      expect(mockGtag).toHaveBeenCalledWith('event', 'button_click', undefined);
    });

    it('should not throw error if gtag is undefined', () => {
      window.gtag = undefined;

      expect(() => trackEvent('test_event')).not.toThrow();
    });
  });

  describe('initGA', () => {
    it('should call gtag with config command', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      initGA('G-XXXXXXXXXX');

      expect(mockGtag).toHaveBeenCalledWith('config', 'G-XXXXXXXXXX', undefined);
    });

    it('should pass config parameters', () => {
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      const config = {
        debug_mode: true,
        page_path: '/test',
      };

      initGA('G-XXXXXXXXXX', config);

      expect(mockGtag).toHaveBeenCalledWith('config', 'G-XXXXXXXXXX', config);
    });

    it('should not throw error if gtag is undefined', () => {
      window.gtag = undefined;

      expect(() => initGA('G-XXXXXXXXXX')).not.toThrow();
    });
  });

  describe('Browser Environment', () => {
    it('should only track in browser environment', () => {
      // In browser environment (window is defined)
      const mockGtag = vi.fn();
      window.gtag = mockGtag;

      trackShare('whatsapp', 'TechCorp');

      expect(mockGtag).toHaveBeenCalled();
    });
  });
});
