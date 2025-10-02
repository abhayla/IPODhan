import { describe, it, expect } from 'vitest';
import {
  GetIPOsParamsSchema,
  GetGMPHistoryParamsSchema,
  SearchQuerySchema,
  FilterParamsSchema,
  IPOIdSchema,
  validateData,
} from '@/lib/validation/schemas';

describe('Validation Schemas', () => {
  describe('GetIPOsParamsSchema', () => {
    it('validates correct IPO list params', () => {
      const params = {
        status: 'LIVE' as const,
        category: 'MAINBOARD' as const,
        page: 1,
        limit: 12,
      };
      const result = validateData(GetIPOsParamsSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(params);
      }
    });

    it('rejects invalid status', () => {
      const params = { status: 'INVALID' };
      const result = validateData(GetIPOsParamsSchema, params);
      expect(result.success).toBe(false);
    });

    it('rejects negative page number', () => {
      const params = { page: -1 };
      const result = validateData(GetIPOsParamsSchema, params);
      expect(result.success).toBe(false);
    });

    it('rejects limit > 100', () => {
      const params = { limit: 150 };
      const result = validateData(GetIPOsParamsSchema, params);
      expect(result.success).toBe(false);
    });
  });

  describe('GetGMPHistoryParamsSchema', () => {
    it('validates correct GMP params', () => {
      const params = { days: 7 };
      const result = validateData(GetGMPHistoryParamsSchema, params);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.days).toBe(7);
      }
    });

    it('rejects days > 365', () => {
      const params = { days: 400 };
      const result = validateData(GetGMPHistoryParamsSchema, params);
      expect(result.success).toBe(false);
    });

    it('rejects negative days', () => {
      const params = { days: -5 };
      const result = validateData(GetGMPHistoryParamsSchema, params);
      expect(result.success).toBe(false);
    });
  });

  describe('SearchQuerySchema', () => {
    it('validates and trims search query', () => {
      const query = '  test company  ';
      const result = validateData(SearchQuerySchema, query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('test company');
      }
    });

    it('removes XSS characters', () => {
      const query = 'test<script>alert()</script>';
      const result = validateData(SearchQuerySchema, query);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toContain('<');
        expect(result.data).not.toContain('>');
      }
    });

    it('rejects empty search query', () => {
      const query = '   ';
      const result = validateData(SearchQuerySchema, query);
      expect(result.success).toBe(false);
    });

    it('rejects search query > 100 characters', () => {
      const query = 'a'.repeat(101);
      const result = validateData(SearchQuerySchema, query);
      expect(result.success).toBe(false);
    });
  });

  describe('FilterParamsSchema', () => {
    it('validates correct filter params', () => {
      const params = {
        scoreRange: { min: 50, max: 100 },
        category: 'SME' as const,
        sector: 'Technology',
      };
      const result = validateData(FilterParamsSchema, params);
      expect(result.success).toBe(true);
    });

    it('rejects score range with min > max', () => {
      const params = {
        scoreRange: { min: 80, max: 50 },
      };
      const result = validateData(FilterParamsSchema, params);
      expect(result.success).toBe(false);
    });

    it('rejects issue size with min > max', () => {
      const params = {
        issueSize: { min: 1000, max: 500 },
      };
      const result = validateData(FilterParamsSchema, params);
      expect(result.success).toBe(false);
    });

    it('rejects date range with start > end', () => {
      const params = {
        dateRange: {
          start: new Date('2025-12-31'),
          end: new Date('2025-01-01'),
        },
      };
      const result = validateData(FilterParamsSchema, params);
      expect(result.success).toBe(false);
    });
  });

  describe('IPOIdSchema', () => {
    it('validates correct UUID', () => {
      const id = '123e4567-e89b-12d3-a456-426614174000';
      const result = validateData(IPOIdSchema, id);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(id);
      }
    });

    it('rejects invalid UUID format', () => {
      const id = 'not-a-uuid';
      const result = validateData(IPOIdSchema, id);
      expect(result.success).toBe(false);
    });

    it('rejects empty string', () => {
      const id = '';
      const result = validateData(IPOIdSchema, id);
      expect(result.success).toBe(false);
    });
  });
});
