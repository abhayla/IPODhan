import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import * as schema from './schema.js';

// ==================== IPO SCHEMAS ====================

export const insertIPOSchema = createInsertSchema(schema.ipos, {
  companyName: z.string().min(1, 'Company name is required').max(255),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(255)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  sector: z.string().max(100).optional(),
  issueSize: z.string().optional(), // numeric stored as string in Drizzle
  priceRangeMin: z.number().int().positive().optional(),
  priceRangeMax: z.number().int().positive().optional(),
  lotSize: z.number().int().positive().optional(),
  faceValue: z.number().int().positive().optional(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  companyDescription: z.string().optional(),
  ratingRationale: z.string().optional().nullable(),
});

export const selectIPOSchema = createSelectSchema(schema.ipos);

// ==================== SUBSCRIPTION SCHEMAS ====================

export const insertSubscriptionSchema = createInsertSchema(schema.subscriptions, {
  ipoId: z.string().uuid('Invalid IPO ID'),
  timestamp: z.date(),
  totalApplications: z.number().int().nonnegative().optional(),
});

export const selectSubscriptionSchema = createSelectSchema(schema.subscriptions);

// ==================== GMP RECORD SCHEMAS ====================

export const insertGMPRecordSchema = createInsertSchema(schema.gmpRecords, {
  ipoId: z.string().uuid('Invalid IPO ID'),
  timestamp: z.date(),
  gmp: z.number().int(),
  expectedListingPrice: z.number().int().optional(),
  subjectRate: z.number().int().optional().nullable(),
  kostakRate: z.number().int().optional().nullable(),
  saudaDetails: z.string().optional().nullable(),
  source: z.string().min(1).max(100),
});

export const selectGMPRecordSchema = createSelectSchema(schema.gmpRecords);

// ==================== FINANCIAL DATA SCHEMAS ====================

export const insertFinancialDataSchema = createInsertSchema(schema.financialData, {
  ipoId: z.string().uuid('Invalid IPO ID'),
});

export const selectFinancialDataSchema = createSelectSchema(schema.financialData);

// ==================== DOCUMENT SCHEMAS ====================

export const insertDocumentSchema = createInsertSchema(schema.documents, {
  ipoId: z.string().uuid('Invalid IPO ID'),
  title: z.string().min(1).max(255),
  url: z.string().url('Invalid document URL'),
  fileSize: z.number().int().nonnegative().optional(),
});

export const selectDocumentSchema = createSelectSchema(schema.documents);

// ==================== LISTING PERFORMANCE SCHEMAS ====================

export const insertListingPerformanceSchema = createInsertSchema(
  schema.listingPerformance,
  {
    ipoId: z.string().uuid('Invalid IPO ID'),
    listingPrice: z.number().int().positive(),
    issuePrice: z.number().int().positive(),
    currentPrice: z.number().int().positive().optional().nullable(),
  }
);

export const selectListingPerformanceSchema = createSelectSchema(
  schema.listingPerformance
);

// ==================== MARKET HOLIDAY SCHEMAS ====================

export const insertMarketHolidaySchema = createInsertSchema(schema.marketHolidays, {
  date: z.date(),
  description: z.string().min(1).max(255),
  year: z.number().int().min(2000).max(2100),
});

export const selectMarketHolidaySchema = createSelectSchema(schema.marketHolidays);

// ==================== REGISTRAR SCHEMAS ====================

export const insertRegistrarSchema = createInsertSchema(schema.registrars, {
  name: z.string().min(1).max(255),
  shortName: z.string().max(100).optional(),
  email: z.string().email('Invalid email').optional(),
  phone: z.string().max(20).optional(),
  website: z.string().url('Invalid website URL').optional(),
  allotmentCheckUrl: z.string().url('Invalid allotment check URL').optional(),
  active: z.boolean().default(true),
});

export const selectRegistrarSchema = createSelectSchema(schema.registrars);

// ==================== PEER COMPANY SCHEMAS ====================

export const insertPeerCompanySchema = createInsertSchema(schema.peerCompanies, {
  ipoId: z.string().uuid('Invalid IPO ID'),
  companyName: z.string().min(1).max(255),
  sector: z.string().max(100).optional(),
  isListed: z.boolean(),
  dataSource: z.string().max(100).optional(),
});

export const selectPeerCompanySchema = createSelectSchema(schema.peerCompanies);

// ==================== BROKER AFFILIATE SCHEMAS ====================

export const insertBrokerAffiliateSchema = createInsertSchema(
  schema.brokerAffiliates,
  {
    brokerName: z.string().min(1).max(255),
    affiliateUrl: z.string().url('Invalid affiliate URL'),
    displayText: z.string().max(100).optional(),
    active: z.boolean().default(true),
    displayOrder: z.number().int().nonnegative().default(0),
  }
);

export const selectBrokerAffiliateSchema = createSelectSchema(schema.brokerAffiliates);

// ==================== CUSTOM VALIDATION SCHEMAS ====================

// Validate price range consistency
export const validatePriceRange = z
  .object({
    priceRangeMin: z.number().int().positive().optional(),
    priceRangeMax: z.number().int().positive().optional(),
  })
  .refine(
    (data) => {
      if (data.priceRangeMin && data.priceRangeMax) {
        return data.priceRangeMin <= data.priceRangeMax;
      }
      return true;
    },
    {
      message: 'Price range minimum must be less than or equal to maximum',
    }
  );

// Validate date range consistency
export const validateIPODates = z
  .object({
    openDate: z.date().optional(),
    closeDate: z.date().optional(),
    allotmentDate: z.date().optional().nullable(),
    listingDate: z.date().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.openDate && data.closeDate) {
        return data.openDate <= data.closeDate;
      }
      return true;
    },
    {
      message: 'Open date must be before close date',
    }
  );

// ==================== HISTORICAL IPO VALIDATION SCHEMAS ====================

/**
 * Historical IPO Query Parameters Validation Schema
 * Used for /api/ipos/history endpoint
 */
export const historicalIPOQueryParamsSchema = z.object({
  year: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val || val === 'All') return true;
        const yearNum = parseInt(val, 10);
        return yearNum >= 2020 && yearNum <= 2025;
      },
      {
        message: 'Year must be between 2020 and 2025, or "All"',
      }
    ),
  sector: z.string().max(100).optional(),
  performance: z.enum(['Positive', 'Negative', 'All']).optional(),
  sort: z.enum(['listing_date', 'listing_gain', 'subscription']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
