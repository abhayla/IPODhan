import { z } from 'zod';

// ==================== SCRAPED IPO SCHEMA ====================

export const ScrapedIPOSchema = z.object({
  companyName: z.string().min(1, 'Company name is required').max(255),
  issueSize: z.number().nonnegative('Issue size must be non-negative'),
  priceRangeMin: z.number().nonnegative('Price range min must be non-negative'),
  priceRangeMax: z
    .number()
    .nonnegative('Price range max must be non-negative'),
  openDate: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Open date must be a valid ISO 8601 date string'
  ),
  closeDate: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Close date must be a valid ISO 8601 date string'
  ),
  listingExchange: z.enum(['NSE', 'BSE', 'BOTH'], {
    errorMap: () => ({ message: 'Invalid listing exchange' })
  }),
  category: z.enum(['MAINBOARD', 'SME', 'RIGHTS', 'NCD'], {
    errorMap: () => ({ message: 'Invalid IPO category' })
  }),
  sector: z.string().max(100).optional(),
  status: z.enum(['UPCOMING', 'LIVE', 'CLOSED', 'LISTED'], {
    errorMap: () => ({ message: 'Invalid IPO status - must be UPCOMING, LIVE, CLOSED, or LISTED' })
  }),
  lotSize: z.number().int().positive().optional(),
  faceValue: z.number().int().positive().optional(),
  allotmentDate: z.string().optional().refine(
    (date) => !date || !isNaN(Date.parse(date)),
    'Allotment date must be a valid ISO 8601 date string'
  ),
  listingDate: z.string().optional().refine(
    (date) => !date || !isNaN(Date.parse(date)),
    'Listing date must be a valid ISO 8601 date string'
  ),
  companyDescription: z.string().optional(),
  registrar: z.string().max(255).optional(),
  leadManagers: z.array(z.string()).optional()
}).refine(
  (data) => new Date(data.closeDate) >= new Date(data.openDate),
  {
    message: 'Close date must be after or equal to open date',
    path: ['closeDate']
  }
).refine(
  (data) => data.priceRangeMax >= data.priceRangeMin,
  {
    message: 'Price range max must be greater than or equal to price range min',
    path: ['priceRangeMax']
  }
);

export type ScrapedIPO = z.infer<typeof ScrapedIPOSchema>;

// ==================== SCRAPED SUBSCRIPTION SCHEMA ====================

export const ScrapedSubscriptionSchema = z.object({
  ipoCompanyName: z.string().min(1, 'IPO company name is required'),
  qibSubscription: z.number().min(0, 'QIB subscription must be non-negative'),
  niiSubscription: z.number().min(0, 'NII subscription must be non-negative'),
  retailSubscription: z.number().min(0, 'Retail subscription must be non-negative'),
  totalSubscription: z.number().min(0, 'Total subscription must be non-negative'),
  employeeSubscription: z.number().min(0, 'Employee subscription must be non-negative').optional(),
  anchorInvestorSubscription: z.number().min(0).optional(),
  bNIISubscription: z.number().min(0).optional(),
  sNIISubscription: z.number().min(0).optional(),
  retailHNISubscription: z.number().min(0).optional(),
  retailOthersSubscription: z.number().min(0).optional(),
  timestamp: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Timestamp must be a valid ISO 8601 date string'
  )
});

export type ScrapedSubscription = z.infer<typeof ScrapedSubscriptionSchema>;

// ==================== VALIDATION FUNCTIONS ====================

/**
 * Validate scraped IPO data with Zod schema
 * @param data - Raw scraped IPO data
 * @returns Validation result with parsed data or error
 */
export function validateIPOData(data: unknown): {
  success: boolean;
  data?: ScrapedIPO;
  error?: z.ZodError;
} {
  try {
    const parsed = ScrapedIPOSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    throw error;
  }
}

/**
 * Validate scraped subscription data with Zod schema
 * @param data - Raw scraped subscription data
 * @returns Validation result with parsed data or error
 */
export function validateSubscriptionData(data: unknown): {
  success: boolean;
  data?: ScrapedSubscription;
  error?: z.ZodError;
} {
  try {
    const parsed = ScrapedSubscriptionSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    throw error;
  }
}

/**
 * Sanitize company name for safe database insertion
 * Removes HTML tags, trims whitespace, limits length
 */
export function sanitizeCompanyName(name: string): string {
  return name
    .replace(/<\/?[a-z][a-z0-9]*[^>]*>/g, '') // Remove HTML tags (lowercase only)
    .replace(/[<>]/g, '') // Remove remaining angle brackets
    .trim()
    .slice(0, 200); // Limit length
}

/**
 * Sanitize subscription number to prevent injection
 * Ensures valid numeric value within reasonable bounds
 */
export function sanitizeSubscriptionNumber(value: any): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error('Invalid subscription number');
  }
  // Cap at reasonable max (10000x subscribed is extremely rare)
  return Math.min(parsed, 10000);
}

/**
 * Generate slug from company name
 * @param companyName - Company name to slugify
 * @returns URL-friendly slug
 */
export function generateSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .slice(0, 255); // Limit length
}

// ==================== IPO ALERTS API SCHEMAS ====================

/**
 * IPO Alerts API Response Schema
 * Note: API uses underscore_case field naming
 */
export const IPOAlertsAPIIPOSchema = z.object({
  id: z.string().min(1, 'API IPO ID is required'),
  company_name: z.string().min(1, 'Company name is required'),
  issue_size: z.number().positive('Issue size must be positive'),
  price_range: z.object({
    min: z.number().positive('Price range min must be positive'),
    max: z.number().positive('Price range max must be positive')
  }).refine(
    (data) => data.max >= data.min,
    {
      message: 'Price range max must be greater than or equal to min',
      path: ['max']
    }
  ),
  open_date: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Open date must be a valid date string'
  ),
  close_date: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Close date must be a valid date string'
  ),
  status: z.enum(['OPEN', 'UPCOMING', 'CLOSED', 'LISTED'], {
    errorMap: () => ({ message: 'Invalid IPO status' })
  }),
  category: z.enum(['MAINBOARD', 'SME', 'RIGHTS', 'NCD'], {
    errorMap: () => ({ message: 'Invalid IPO category' })
  }),
  exchange: z.enum(['NSE', 'BSE', 'BOTH'], {
    errorMap: () => ({ message: 'Invalid exchange' })
  }),
  sector: z.string().max(100).optional(),
  lot_size: z.number().int().positive().optional(),
  face_value: z.number().int().positive().optional(),
  allotment_date: z.string().optional().refine(
    (date) => !date || !isNaN(Date.parse(date)),
    'Allotment date must be a valid date string'
  ),
  listing_date: z.string().optional().refine(
    (date) => !date || !isNaN(Date.parse(date)),
    'Listing date must be a valid date string'
  ),
  company_description: z.string().optional(),
  registrar: z.string().max(255).optional(),
  lead_managers: z.array(z.string()).optional()
}).refine(
  (data) => new Date(data.close_date) >= new Date(data.open_date),
  {
    message: 'Close date must be after or equal to open date',
    path: ['close_date']
  }
);

export type IPOAlertsAPIIPO = z.infer<typeof IPOAlertsAPIIPOSchema>;

/**
 * Validate IPO Alerts API response data
 * @param data - Raw API response data
 * @returns Validation result with parsed data or error
 */
export function validateIPOAlertsIPOData(data: unknown): {
  success: boolean;
  data?: IPOAlertsAPIIPO;
  error?: z.ZodError;
} {
  try {
    const parsed = IPOAlertsAPIIPOSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    throw error;
  }
}

/**
 * Transform IPO Alerts API data to IPODhan ScrapedIPO format
 * Converts API underscore_case to camelCase and maps fields
 * @param apiData - Validated IPO Alerts API data
 * @returns Transformed ScrapedIPO data
 */
export function transformIPOAlertsData(apiData: IPOAlertsAPIIPO): ScrapedIPO {
  return {
    companyName: sanitizeCompanyName(apiData.company_name),
    issueSize: apiData.issue_size,
    priceRangeMin: apiData.price_range.min,
    priceRangeMax: apiData.price_range.max,
    openDate: apiData.open_date,
    closeDate: apiData.close_date,
    listingExchange: apiData.exchange,
    category: apiData.category,
    sector: apiData.sector,
    status: apiData.status,
    lotSize: apiData.lot_size,
    faceValue: apiData.face_value,
    allotmentDate: apiData.allotment_date,
    listingDate: apiData.listing_date,
    companyDescription: apiData.company_description,
    registrar: apiData.registrar,
    leadManagers: apiData.lead_managers
  };
}
