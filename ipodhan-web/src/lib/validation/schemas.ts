/**
 * Zod validation schemas for user inputs
 * Implements SEC-001 fix - input validation at API boundaries
 */

import { z } from 'zod';

/**
 * IPO List Query Parameters Schema
 * Validates GET /api/ipos query params
 */
export const GetIPOsParamsSchema = z.object({
  status: z.enum(['LIVE', 'UPCOMING', 'CLOSED']).optional(),
  category: z.enum(['MAINBOARD', 'SME']).optional(),
  page: z.number().int().positive().default(1).optional(),
  limit: z.number().int().positive().max(100).default(12).optional(),
});

export type GetIPOsParamsValidated = z.infer<typeof GetIPOsParamsSchema>;

/**
 * GMP History Parameters Schema
 * Validates GET /api/ipos/:id/gmp query params
 */
export const GetGMPHistoryParamsSchema = z.object({
  days: z.number().int().positive().max(365).default(7).optional(),
});

export type GetGMPHistoryParamsValidated = z.infer<typeof GetGMPHistoryParamsSchema>;

/**
 * Search Query Schema
 * Validates search input with sanitization
 */
export const SearchQuerySchema = z
  .string()
  .trim()
  .min(1, 'Search query must not be empty')
  .max(100, 'Search query must be 100 characters or less')
  .transform((val) => val.replace(/[<>]/g, '')); // Basic XSS protection

export type SearchQueryValidated = z.infer<typeof SearchQuerySchema>;

/**
 * Filter Parameters Schema
 * Validates filter selections
 */
export const FilterParamsSchema = z.object({
  scoreRange: z
    .object({
      min: z.number().min(0).max(100),
      max: z.number().min(0).max(100),
    })
    .refine((data) => data.min <= data.max, {
      message: 'Min score must be less than or equal to max score',
    })
    .optional(),
  category: z.enum(['MAINBOARD', 'SME']).optional(),
  sector: z
    .string()
    .max(50)
    .transform((val) => val.trim())
    .optional(),
  issueSize: z
    .object({
      min: z.number().positive().optional(),
      max: z.number().positive().optional(),
    })
    .refine(
      (data) => {
        if (data.min !== undefined && data.max !== undefined) {
          return data.min <= data.max;
        }
        return true;
      },
      {
        message: 'Min issue size must be less than or equal to max issue size',
      }
    )
    .optional(),
  dateRange: z
    .object({
      start: z.date().optional(),
      end: z.date().optional(),
    })
    .refine(
      (data) => {
        if (data.start && data.end) {
          return data.start <= data.end;
        }
        return true;
      },
      {
        message: 'Start date must be before or equal to end date',
      }
    )
    .optional(),
});

export type FilterParamsValidated = z.infer<typeof FilterParamsSchema>;

/**
 * IPO ID Schema
 * Validates IPO ID param
 */
export const IPOIdSchema = z.string().uuid('Invalid IPO ID format');

export type IPOIdValidated = z.infer<typeof IPOIdSchema>;

/**
 * Pagination Parameters Schema
 */
export const PaginationParamsSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(12),
});

export type PaginationParamsValidated = z.infer<typeof PaginationParamsSchema>;

/**
 * Sort Option Schema
 */
export const SortOptionSchema = z.enum(['score', 'closingDate', 'gmp', 'size', 'relevance']);

export type SortOptionValidated = z.infer<typeof SortOptionSchema>;

/**
 * Helper function to safely validate data
 * Returns { success: true, data } or { success: false, errors }
 */
export function validateData<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}
