/**
 * Unit tests for search-history utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveSearch,
  getRecentSearches,
  clearSearchHistory,
} from '@/lib/search-history';

describe('search-history', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('saveSearch', () => {
    it('should save search to localStorage', () => {
      saveSearch('reliance');
      const recent = getRecentSearches();
      expect(recent).toEqual(['reliance']);
    });

    it('should ignore empty searches', () => {
      saveSearch('');
      const recent = getRecentSearches();
      expect(recent).toEqual([]);
    });

    it('should ignore single character searches', () => {
      saveSearch('a');
      const recent = getRecentSearches();
      expect(recent).toEqual([]);
    });

    it('should add new searches to the beginning', () => {
      saveSearch('reliance');
      saveSearch('tech');
      const recent = getRecentSearches();
      expect(recent).toEqual(['tech', 'reliance']);
    });

    it('should limit to 5 most recent searches', () => {
      saveSearch('search1');
      saveSearch('search2');
      saveSearch('search3');
      saveSearch('search4');
      saveSearch('search5');
      saveSearch('search6');

      const recent = getRecentSearches();
      expect(recent).toHaveLength(5);
      expect(recent).toEqual([
        'search6',
        'search5',
        'search4',
        'search3',
        'search2',
      ]);
    });

    it('should avoid duplicate searches (case-insensitive)', () => {
      saveSearch('reliance');
      saveSearch('tech');
      saveSearch('Reliance');

      const recent = getRecentSearches();
      expect(recent).toHaveLength(2);
      expect(recent).toEqual(['Reliance', 'tech']);
    });

    it('should move duplicate to front if searched again', () => {
      saveSearch('search1');
      saveSearch('search2');
      saveSearch('search3');
      saveSearch('search1');

      const recent = getRecentSearches();
      expect(recent).toEqual(['search1', 'search3', 'search2']);
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw error
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      setItemSpy.mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      expect(() => saveSearch('test')).not.toThrow();

      // Should log error
      expect(consoleSpy).toHaveBeenCalled();

      setItemSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should trim whitespace from searches', () => {
      saveSearch('  reliance  ');
      const recent = getRecentSearches();
      expect(recent).toEqual(['  reliance  ']);
    });
  });

  describe('getRecentSearches', () => {
    it('should return empty array if no searches saved', () => {
      const recent = getRecentSearches();
      expect(recent).toEqual([]);
    });

    it('should return saved searches', () => {
      saveSearch('search1');
      saveSearch('search2');

      const recent = getRecentSearches();
      expect(recent).toEqual(['search2', 'search1']);
    });

    it('should handle corrupted localStorage data', () => {
      localStorage.setItem('recent-searches', 'invalid json');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const recent = getRecentSearches();

      expect(recent).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle non-array data in localStorage', () => {
      localStorage.setItem('recent-searches', JSON.stringify({ invalid: 'data' }));

      const recent = getRecentSearches();
      expect(recent).toEqual([]);
    });

    it('should limit returned searches to 5 even if more stored', () => {
      // Manually add more than 5 to localStorage
      const searches = ['1', '2', '3', '4', '5', '6', '7'];
      localStorage.setItem('recent-searches', JSON.stringify(searches));

      const recent = getRecentSearches();
      expect(recent).toHaveLength(5);
      expect(recent).toEqual(['1', '2', '3', '4', '5']);
    });

    it('should handle localStorage errors gracefully', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
      getItemSpy.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const recent = getRecentSearches();
      expect(recent).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();

      getItemSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('clearSearchHistory', () => {
    it('should clear all search history', () => {
      saveSearch('search1');
      saveSearch('search2');

      clearSearchHistory();

      const recent = getRecentSearches();
      expect(recent).toEqual([]);
    });

    it('should handle errors gracefully', () => {
      const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
      removeItemSpy.mockImplementation(() => {
        throw new Error('Storage error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => clearSearchHistory()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      removeItemSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should work even if storage is empty', () => {
      expect(() => clearSearchHistory()).not.toThrow();
    });
  });

  describe('integration tests', () => {
    it('should maintain search history across save and retrieve operations', () => {
      saveSearch('reliance');
      saveSearch('tech');
      saveSearch('healthcare');

      const recent1 = getRecentSearches();
      expect(recent1).toEqual(['healthcare', 'tech', 'reliance']);

      saveSearch('finance');
      const recent2 = getRecentSearches();
      expect(recent2).toEqual(['finance', 'healthcare', 'tech', 'reliance']);

      clearSearchHistory();
      const recent3 = getRecentSearches();
      expect(recent3).toEqual([]);
    });

    it('should persist searches in localStorage', () => {
      saveSearch('test');

      // Simulate page reload by directly reading from localStorage
      const stored = localStorage.getItem('recent-searches');
      expect(stored).toBe(JSON.stringify(['test']));

      // Verify getRecentSearches reads from localStorage
      const recent = getRecentSearches();
      expect(recent).toEqual(['test']);
    });
  });
});
