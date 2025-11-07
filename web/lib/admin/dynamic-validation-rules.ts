/**
 * Custom Validation Rules for Dynamic Admin
 *
 * This module provides business-logic validation rules for IPO-related data
 * that extend beyond basic type and schema validation. These rules enforce
 * domain-specific constraints and data quality standards.
 *
 * Part of Phase 4: Admin Consolidation (Traditional Admin Removal)
 * Created: 2025-11-07
 *
 * Architecture:
 * - Uses Drizzle-inferred types for type safety
 * - Extends basic validateField() from schema-introspector
 * - Returns structured validation results with helpful error messages
 * - Supports cross-field validation (e.g., priceRangeMin <= priceRangeMax)
 */

import type { InferSelectModel } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';

// Type aliases for better readability
type IPO = InferSelectModel<typeof schema.ipos>;
type FinancialData = InferSelectModel<typeof schema.financialData>;
type Subscription = InferSelectModel<typeof schema.subscriptions>;
type GMPRecord = InferSelectModel<typeof schema.gmpRecords>;

/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string; // Non-blocking warnings
}

/**
 * Validation context for cross-field validation
 */
export interface ValidationContext {
  tableName: string;
  fieldName: string;
  value: any;
  record?: Record<string, any>; // Full record for cross-field checks
}

/**
 * Field validator function signature
 */
export type FieldValidator = (
  value: any,
  record?: Record<string, any>
) => ValidationResult;

/**
 * Table-specific validation rules registry
 */
export const customValidationRules: Record<
  string,
  Record<string, FieldValidator>
> = {
  // ========================================
  // IPOs Table Validations
  // ========================================
  ipos: {
    /**
     * Lot Size: Must be positive integer (minimum 1 share per lot)
     * Common error: lot_size = 1 was historical data quality issue (Phase 3)
     */
    lotSize: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true }; // Nullable field
      }

      if (!Number.isInteger(value)) {
        return {
          valid: false,
          error: 'Lot size must be a whole number (no decimals)',
        };
      }

      if (value <= 0) {
        return {
          valid: false,
          error: 'Lot size must be at least 1 share',
        };
      }

      if (value === 1) {
        return {
          valid: true,
          warning:
            'Lot size of 1 is unusual for IPOs. Please verify this is correct.',
        };
      }

      if (value > 10000) {
        return {
          valid: true,
          warning:
            'Lot size exceeds 10,000 shares. This is uncommon, please verify.',
        };
      }

      return { valid: true };
    },

    /**
     * Price Range Min: Must be positive and <= priceRangeMax
     */
    priceRangeMin: (value: number | null, record?: Record<string, any>) => {
      if (value === null || value === undefined) {
        return { valid: true }; // Nullable field
      }

      if (value <= 0) {
        return {
          valid: false,
          error: 'Price range minimum must be greater than ₹0',
        };
      }

      // Cross-field validation with priceRangeMax
      if (record?.priceRangeMax && value > record.priceRangeMax) {
        return {
          valid: false,
          error: `Price minimum (₹${value}) cannot exceed maximum (₹${record.priceRangeMax})`,
        };
      }

      if (value > 100000) {
        return {
          valid: true,
          warning: 'Price exceeds ₹1 lakh. Please verify this is correct.',
        };
      }

      return { valid: true };
    },

    /**
     * Price Range Max: Must be positive and >= priceRangeMin
     */
    priceRangeMax: (value: number | null, record?: Record<string, any>) => {
      if (value === null || value === undefined) {
        return { valid: true }; // Nullable field
      }

      if (value <= 0) {
        return {
          valid: false,
          error: 'Price range maximum must be greater than ₹0',
        };
      }

      // Cross-field validation with priceRangeMin
      if (record?.priceRangeMin && value < record.priceRangeMin) {
        return {
          valid: false,
          error: `Price maximum (₹${value}) cannot be less than minimum (₹${record.priceRangeMin})`,
        };
      }

      if (value > 100000) {
        return {
          valid: true,
          warning: 'Price exceeds ₹1 lakh. Please verify this is correct.',
        };
      }

      return { valid: true };
    },

    /**
     * Issue Size: Must be positive (in crores)
     */
    issueSize: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true }; // Nullable field
      }

      if (value <= 0) {
        return {
          valid: false,
          error: 'Issue size must be greater than ₹0 crores',
        };
      }

      if (value < 10) {
        return {
          valid: true,
          warning:
            'Issue size below ₹10 crores is unusually small for IPOs.',
        };
      }

      if (value > 100000) {
        return {
          valid: true,
          warning: 'Issue size exceeds ₹1 lakh crores. Please verify.',
        };
      }

      return { valid: true };
    },

    /**
     * Open Date: Must be before close date if both present
     */
    openDate: (value: Date | string | null, record?: Record<string, any>) => {
      if (!value) return { valid: true };

      const openDate = new Date(value);
      if (isNaN(openDate.getTime())) {
        return { valid: false, error: 'Invalid date format' };
      }

      // Cross-field validation with closeDate
      if (record?.closeDate) {
        const closeDate = new Date(record.closeDate);
        if (openDate >= closeDate) {
          return {
            valid: false,
            error: 'IPO open date must be before close date',
          };
        }
      }

      return { valid: true };
    },

    /**
     * Close Date: Must be after open date if both present
     */
    closeDate: (value: Date | string | null, record?: Record<string, any>) => {
      if (!value) return { valid: true };

      const closeDate = new Date(value);
      if (isNaN(closeDate.getTime())) {
        return { valid: false, error: 'Invalid date format' };
      }

      // Cross-field validation with openDate
      if (record?.openDate) {
        const openDate = new Date(record.openDate);
        if (closeDate <= openDate) {
          return {
            valid: false,
            error: 'IPO close date must be after open date',
          };
        }
      }

      return { valid: true };
    },
  },

  // ========================================
  // Financial Data Table Validations
  // ========================================
  financialData: {
    /**
     * P/E Ratio: Reasonable range 0-1000
     */
    peRatio: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value < 0) {
        return {
          valid: false,
          error: 'P/E ratio cannot be negative',
        };
      }

      if (value > 1000) {
        return {
          valid: false,
          error: 'P/E ratio exceeds 1000 (maximum allowed)',
        };
      }

      if (value > 500) {
        return {
          valid: true,
          warning: 'P/E ratio exceeds 500. This is unusually high, please verify.',
        };
      }

      return { valid: true };
    },

    /**
     * ROE (Return on Equity): Range -100% to 100%
     */
    roe: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value < -100) {
        return {
          valid: false,
          error: 'ROE cannot be less than -100%',
        };
      }

      if (value > 100) {
        return {
          valid: false,
          error: 'ROE cannot exceed 100%',
        };
      }

      if (value < -50) {
        return {
          valid: true,
          warning: 'Negative ROE below -50% is concerning. Please verify.',
        };
      }

      return { valid: true };
    },

    /**
     * Debt to Equity: Must be non-negative
     */
    debtToEquity: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value < 0) {
        return {
          valid: false,
          error: 'Debt-to-equity ratio cannot be negative',
        };
      }

      if (value > 10) {
        return {
          valid: true,
          warning: 'Debt-to-equity ratio exceeds 10. High leverage, please verify.',
        };
      }

      return { valid: true };
    },

    /**
     * Revenue (any fiscal year): Must be non-negative
     */
    revenueFy2024: (value: number | null) => validateRevenue(value, 'FY2024'),
    revenueFy2023: (value: number | null) => validateRevenue(value, 'FY2023'),
    revenueFy2022: (value: number | null) => validateRevenue(value, 'FY2022'),

    /**
     * Profit (any fiscal year): Can be negative (loss)
     */
    profitFy2024: (value: number | null) => validateProfit(value, 'FY2024'),
    profitFy2023: (value: number | null) => validateProfit(value, 'FY2023'),
    profitFy2022: (value: number | null) => validateProfit(value, 'FY2022'),

    /**
     * EPS (Earnings Per Share): Can be negative
     */
    eps: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value < -1000 || value > 10000) {
        return {
          valid: true,
          warning: 'EPS value is outside typical range (-1000 to 10000). Please verify.',
        };
      }

      return { valid: true };
    },

    /**
     * Net Worth: Must be positive for IPO eligibility
     */
    netWorth: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value <= 0) {
        return {
          valid: false,
          error: 'Net worth must be positive for IPO listing eligibility',
        };
      }

      return { valid: true };
    },
  },

  // ========================================
  // Subscriptions Table Validations
  // ========================================
  subscriptions: {
    /**
     * Total Subscription: Must be non-negative
     */
    totalSubscription: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value < 0) {
        return {
          valid: false,
          error: 'Total subscription cannot be negative',
        };
      }

      return { valid: true };
    },

    /**
     * QIB Subscription: Must be non-negative
     */
    qibSubscription: (value: number | null) => validateSubscriptionValue(value, 'QIB'),

    /**
     * NII Subscription: Must be non-negative
     */
    niiSubscription: (value: number | null) => validateSubscriptionValue(value, 'NII'),

    /**
     * Retail Subscription: Must be non-negative
     */
    retailSubscription: (value: number | null) => validateSubscriptionValue(value, 'Retail'),

    /**
     * Employee Subscription: Must be non-negative
     */
    employeeSubscription: (value: number | null) => validateSubscriptionValue(value, 'Employee'),
  },

  // ========================================
  // GMP Records Table Validations
  // ========================================
  gmpRecords: {
    /**
     * GMP Price: Must be non-negative
     */
    gmpPrice: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value < 0) {
        return {
          valid: false,
          error: 'GMP price cannot be negative',
        };
      }

      if (value > 10000) {
        return {
          valid: true,
          warning: 'GMP price exceeds ₹10,000. Please verify this is correct.',
        };
      }

      return { valid: true };
    },

    /**
     * GMP Percentage: Typically -50% to +500%
     */
    gmpPercentage: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value < -100) {
        return {
          valid: false,
          error: 'GMP percentage cannot be less than -100% (complete loss)',
        };
      }

      if (value > 1000) {
        return {
          valid: true,
          warning: 'GMP percentage exceeds 1000%. This is extremely rare, please verify.',
        };
      }

      return { valid: true };
    },

    /**
     * Estimated Listing Price: Must be positive
     */
    estimatedListingPrice: (value: number | null) => {
      if (value === null || value === undefined) {
        return { valid: true };
      }

      if (value <= 0) {
        return {
          valid: false,
          error: 'Estimated listing price must be greater than ₹0',
        };
      }

      return { valid: true };
    },
  },
};

// ========================================
// Helper Functions
// ========================================

/**
 * Helper: Validate revenue for any fiscal year
 */
function validateRevenue(value: number | null, fiscalYear: string): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  if (value < 0) {
    return {
      valid: false,
      error: `Revenue for ${fiscalYear} cannot be negative`,
    };
  }

  return { valid: true };
}

/**
 * Helper: Validate profit for any fiscal year (can be negative)
 */
function validateProfit(value: number | null, fiscalYear: string): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  // Profit can be negative (net loss), so only check for extreme values
  if (value < -100000 || value > 100000) {
    return {
      valid: true,
      warning: `Profit for ${fiscalYear} is outside typical range. Please verify.`,
    };
  }

  return { valid: true };
}

/**
 * Helper: Validate subscription value (any category)
 */
function validateSubscriptionValue(
  value: number | null,
  category: string
): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  if (value < 0) {
    return {
      valid: false,
      error: `${category} subscription cannot be negative`,
    };
  }

  return { valid: true };
}

// ========================================
// Main Validation Function
// ========================================

/**
 * Validates a field using custom business logic rules
 * This extends the basic validateField() from schema-introspector
 *
 * @param context - Validation context with table, field, value, and full record
 * @returns ValidationResult with valid flag and optional error/warning messages
 */
export function validateCustomField(context: ValidationContext): ValidationResult {
  const { tableName, fieldName, value, record } = context;

  // Check if custom validation exists for this table and field
  const tableValidations = customValidationRules[tableName];
  if (!tableValidations) {
    return { valid: true }; // No custom validations for this table
  }

  const fieldValidator = tableValidations[fieldName];
  if (!fieldValidator) {
    return { valid: true }; // No custom validation for this field
  }

  // Execute custom validation
  try {
    return fieldValidator(value, record);
  } catch (error) {
    console.error(
      `[Validation Error] Failed to validate ${tableName}.${fieldName}:`,
      error
    );
    return {
      valid: false,
      error: 'Internal validation error. Please contact support.',
    };
  }
}

/**
 * Validates all fields in a record using custom rules
 * Useful for form submission validation
 *
 * @param tableName - Name of the table
 * @param record - Record data to validate
 * @returns Object with valid flag and map of field errors/warnings
 */
export function validateRecord(
  tableName: string,
  record: Record<string, any>
): {
  valid: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  // Get all fields with custom validations for this table
  const tableValidations = customValidationRules[tableName];
  if (!tableValidations) {
    return { valid: true, errors, warnings };
  }

  // Validate each field
  for (const [fieldName, validator] of Object.entries(tableValidations)) {
    const value = record[fieldName];
    const result = validator(value, record);

    if (!result.valid && result.error) {
      errors[fieldName] = result.error;
    }

    if (result.warning) {
      warnings[fieldName] = result.warning;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    warnings,
  };
}
