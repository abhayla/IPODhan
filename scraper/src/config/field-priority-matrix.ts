/**
 * Field Priority Matrix
 * Defines which scraper source has priority for each field
 * Used by data consolidation service to resolve conflicts intelligently
 */

export type ScraperSource =
  | 'ADMIN'           // Manual admin overrides (highest priority)
  | 'DRHP'            // Official regulatory documents
  | 'NSE'             // NSE official scraper
  | 'BSE'             // BSE official scraper
  | 'MONEYCONTROL'    // Moneycontrol scraper
  | 'CHITTORGARH'     // Chittorgarh GMP scraper
  | 'INVESTORGAIN_GMP'// InvestorGain GMP scraper
  | 'API_FALLBACK';   // Fallback API scraper

export type NormalizationType =
  | 'currency'           // Indian currency formats (₹500 Cr, 500 Crores, etc.)
  | 'date'               // Date formats (DD-MM-YYYY, DD/MM/YYYY, etc.)
  | 'company_name'       // Company name variations (Ltd, Limited, Pvt, etc.)
  | 'percentage'         // Percentage formats (85%, 85, 0.85)
  | 'number'             // Plain numbers
  | 'none';              // No normalization

export interface FieldRules {
  /**
   * Priority order of sources (first = highest priority)
   * ADMIN always wins if present
   */
  sources: ScraperSource[];

  /**
   * Normalization type to apply before comparison
   */
  normalization?: NormalizationType;

  /**
   * Minimum confidence threshold (0-100)
   * Reject data below this confidence
   */
  confidenceThreshold?: number;

  /**
   * Time-based priority
   * If true, newest data wins regardless of source
   */
  timeBased?: boolean;

  /**
   * Ignore DRHP for this field (for real-time data)
   */
  ignoreDRHP?: boolean;

  /**
   * Validation rules
   */
  validation?: {
    min?: number;
    max?: number;
    regex?: string;
    allowNull?: boolean;
  };

  /**
   * Description for documentation
   */
  description?: string;
}

/**
 * Field Priority Matrix
 *
 * **How to read this**:
 * - sources: [A, B, C] means A wins over B, B wins over C
 * - ADMIN is implicit highest priority (always wins)
 * - timeBased: true means newest data wins
 * - ignoreDRHP: true means DRHP is not used for this field
 *
 * **Priority Principles**:
 * 1. Admin always wins (manual override)
 * 2. DRHP is authoritative for financial data
 * 3. NSE is primary for IPO core data
 * 4. BSE is better for lot size
 * 5. Chittorgarh specializes in GMP data
 * 6. Real-time data uses latest value
 */
export const FIELD_PRIORITY_MATRIX: Record<string, FieldRules> = {
  // ==================== FINANCIAL DATA (DRHP is authoritative) ====================

  revenue_fy1: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue for fiscal year 1 - DRHP is most accurate',
  },

  revenue_fy2: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue for fiscal year 2',
  },

  revenue_fy3: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue for fiscal year 3',
  },

  profit_fy1: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit for fiscal year 1',
  },

  profit_fy2: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit for fiscal year 2',
  },

  profit_fy3: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit for fiscal year 3',
  },

  // Specific fiscal year fields (camelCase - actual database fields)
  revenueFy2022: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue FY2022 - DRHP is most accurate',
  },

  revenueFy2023: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue FY2023 - DRHP is most accurate',
  },

  revenueFy2024: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Revenue FY2024 - DRHP is most accurate',
  },

  profitFy2022: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit FY2022 - DRHP is most accurate',
  },

  profitFy2023: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit FY2023 - DRHP is most accurate',
  },

  profitFy2024: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 80,
    description: 'Profit FY2024 - DRHP is most accurate',
  },

  pe_ratio: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 75,
    description: 'Price-to-Earnings ratio',
    validation: { min: 0, max: 1000 },
  },

  roe_percentage: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'percentage',
    confidenceThreshold: 75,
    description: 'Return on Equity percentage',
    validation: { min: -100, max: 500 },
  },

  roce_percentage: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'percentage',
    confidenceThreshold: 75,
    description: 'Return on Capital Employed',
    validation: { min: -100, max: 500 },
  },

  pb_ratio: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 75,
    description: 'Price-to-Book ratio',
    validation: { min: 0, max: 100 },
  },

  debt_to_equity: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 75,
    description: 'Debt-to-Equity ratio',
    validation: { min: 0, max: 50 },
  },

  // ==================== IPO CORE DATA (NSE is primary) ====================

  issue_size: {
    sources: ['ADMIN', 'NSE', 'DRHP', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Total issue size - NSE is most reliable',
    validation: { min: 1e6, max: 1e12 }, // 1 Cr to 10 Lakh Cr
  },

  fresh_issue_size: {
    sources: ['ADMIN', 'NSE', 'DRHP', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Fresh issue size',
  },

  offer_for_sale_size: {
    sources: ['ADMIN', 'NSE', 'DRHP', 'BSE', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Offer for sale size',
  },

  price_band_min: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 90,
    description: 'Minimum price in price band',
    validation: { min: 1, max: 100000 },
  },

  price_band_max: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 90,
    description: 'Maximum price in price band',
    validation: { min: 1, max: 100000 },
  },

  issue_price: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 95,
    description: 'Final issue price - critical field',
    validation: { min: 1, max: 100000 },
  },

  open_date: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'date',
    confidenceThreshold: 95,
    description: 'IPO open date - critical field',
  },

  close_date: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'date',
    confidenceThreshold: 95,
    description: 'IPO close date - critical field',
  },

  listing_date: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'date',
    confidenceThreshold: 95,
    description: 'Expected listing date',
  },

  // ==================== LOT SIZE (BSE is more accurate) ====================

  lot_size: {
    sources: ['ADMIN', 'BSE', 'NSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'number',
    confidenceThreshold: 90,
    description: 'Lot size - BSE data is more accurate historically',
    validation: { min: 10, max: 100000 },
  },

  min_investment: {
    sources: ['ADMIN', 'BSE', 'NSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'currency',
    confidenceThreshold: 85,
    description: 'Minimum investment amount',
  },

  // ==================== REAL-TIME DATA (Latest wins) ====================

  status: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'none',
    timeBased: true,
    ignoreDRHP: true,
    description: 'IPO status - real-time field, newest value wins',
  },

  total_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'Total subscription times - real-time data',
    validation: { min: 0, max: 1000 },
  },

  retail_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'Retail subscription - real-time',
    validation: { min: 0, max: 1000 },
  },

  qib_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'QIB subscription - real-time',
    validation: { min: 0, max: 1000 },
  },

  nii_subscription: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'NII subscription - real-time',
    validation: { min: 0, max: 1000 },
  },

  // ==================== GMP DATA (Chittorgarh specializes) ====================

  gmp_price: {
    sources: ['ADMIN', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 70,
    description: 'Grey Market Premium - Chittorgarh is specialist',
    validation: { min: -1000, max: 10000 },
  },

  gmp_percentage: {
    sources: ['ADMIN', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'percentage',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 70,
    description: 'GMP percentage',
    validation: { min: -100, max: 500 },
  },

  expected_listing_price: {
    sources: ['ADMIN', 'CHITTORGARH', 'MONEYCONTROL', 'NSE', 'BSE'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    description: 'Expected listing price (GMP-based)',
  },

  // ==================== COMPANY INFO ====================

  company_name: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'company_name',
    confidenceThreshold: 85,
    description: 'Company name - normalized',
  },

  industry: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 75,
    description: 'Industry/Sector',
  },

  registrar: {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 85,
    description: 'Registrar name',
  },

  lead_managers: {
    sources: ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'none',
    confidenceThreshold: 80,
    description: 'Lead manager banks',
  },

  // ==================== LISTING PERFORMANCE ====================

  listing_price: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'number',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 95,
    description: 'Actual listing price - critical',
    validation: { min: 1, max: 100000 },
  },

  listing_gain_percentage: {
    sources: ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL'],
    normalization: 'percentage',
    timeBased: true,
    ignoreDRHP: true,
    confidenceThreshold: 90,
    description: 'Listing gains percentage',
    validation: { min: -100, max: 1000 },
  },
};

/**
 * Get field rules for a specific field
 * Returns default rules if field not in matrix
 */
export function getFieldRules(fieldName: string): FieldRules {
  return FIELD_PRIORITY_MATRIX[fieldName] || {
    sources: ['ADMIN', 'NSE', 'BSE', 'DRHP', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'],
    normalization: 'none',
    confidenceThreshold: 75,
    description: 'Default rules - NSE priority',
  };
}

/**
 * Get source priority index (lower = higher priority)
 * Returns -1 if source not in priority list
 */
export function getSourcePriority(fieldName: string, source: ScraperSource): number {
  const rules = getFieldRules(fieldName);
  return rules.sources.indexOf(source);
}

/**
 * Check if field is time-based (newest wins)
 */
export function isTimeBased(fieldName: string): boolean {
  const rules = getFieldRules(fieldName);
  return rules.timeBased || false;
}

/**
 * Check if field ignores DRHP data
 */
export function ignoresDRHP(fieldName: string): boolean {
  const rules = getFieldRules(fieldName);
  return rules.ignoreDRHP || false;
}

/**
 * Get all field names with rules
 */
export function getAllTrackedFields(): string[] {
  return Object.keys(FIELD_PRIORITY_MATRIX);
}

/**
 * Get fields by normalization type
 */
export function getFieldsByNormalization(type: NormalizationType): string[] {
  return Object.entries(FIELD_PRIORITY_MATRIX)
    .filter(([_, rules]) => rules.normalization === type)
    .map(([fieldName]) => fieldName);
}

/**
 * Export summary for documentation
 */
export function generatePriorityMatrixSummary(): string {
  const lines = ['# Field Priority Matrix Summary\n'];

  const grouped: Record<string, string[]> = {
    'Financial Data (DRHP Priority)': [],
    'IPO Core Data (NSE Priority)': [],
    'Real-Time Data (Latest Wins)': [],
    'GMP Data (Chittorgarh Priority)': [],
    'Other Fields': [],
  };

  for (const [field, rules] of Object.entries(FIELD_PRIORITY_MATRIX)) {
    const topSource = rules.sources[0];
    const line = `- **${field}**: ${rules.sources.join(' > ')} ${rules.timeBased ? '(time-based)' : ''}`;

    if (topSource === 'DRHP' || field.includes('revenue') || field.includes('profit')) {
      grouped['Financial Data (DRHP Priority)'].push(line);
    } else if (rules.timeBased) {
      grouped['Real-Time Data (Latest Wins)'].push(line);
    } else if (topSource === 'CHITTORGARH' || field.includes('gmp')) {
      grouped['GMP Data (Chittorgarh Priority)'].push(line);
    } else if (topSource === 'NSE') {
      grouped['IPO Core Data (NSE Priority)'].push(line);
    } else {
      grouped['Other Fields'].push(line);
    }
  }

  for (const [category, fields] of Object.entries(grouped)) {
    if (fields.length > 0) {
      lines.push(`\n## ${category}\n`);
      lines.push(fields.join('\n'));
    }
  }

  return lines.join('\n');
}
