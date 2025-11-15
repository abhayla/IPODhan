/**
 * Timeline Date Validation Utility
 *
 * Enforces business rules for IPO timeline dates since PostgreSQL CHECK constraints
 * cannot reference other tables (close_date is in ipos table, timeline dates in ipo_details).
 *
 * Business Rules:
 * - All timeline dates must be >= close_date
 * - All timeline dates must be <= close_date + 30 days
 * - Real-world IPO timeline: Close → Basis (+2d) → Refunds (+4d) → Credit (+6d) → Listing (+10-14d)
 *
 * @see docs/16-database/TIMELINE_DATE_BUSINESS_RULES.md
 */

export interface TimelineDateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IPOTimelineDates {
  closeDate: Date | null;
  basisOfAllotmentDate?: Date | null;
  initiationOfRefundsDate?: Date | null;
  creditOfSharesDate?: Date | null;
  listingDate?: Date | null;
}

/**
 * Validate timeline dates against business rules
 *
 * @param dates - Object containing close_date and timeline dates
 * @returns Validation result with errors and warnings
 */
export function validateTimelineDates(
  dates: IPOTimelineDates
): TimelineDateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // If no close date, cannot validate timeline dates
  if (!dates.closeDate) {
    if (
      dates.basisOfAllotmentDate ||
      dates.initiationOfRefundsDate ||
      dates.creditOfSharesDate
    ) {
      errors.push(
        'Timeline dates (basis_of_allotment, initiation_of_refunds, credit_of_shares) require a valid close_date'
      );
    }
    return { isValid: errors.length === 0, errors, warnings };
  }

  const closeDate = new Date(dates.closeDate);
  const maxAllowedDate = new Date(closeDate);
  maxAllowedDate.setDate(maxAllowedDate.getDate() + 30);

  // Validate Basis of Allotment Date
  if (dates.basisOfAllotmentDate) {
    const basisDate = new Date(dates.basisOfAllotmentDate);
    const gapDays = Math.floor(
      (basisDate.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (gapDays < 0) {
      errors.push(
        `Basis of Allotment date (${basisDate.toISOString().split('T')[0]}) cannot be before close_date (${closeDate.toISOString().split('T')[0]})`
      );
    } else if (gapDays > 30) {
      errors.push(
        `Basis of Allotment date (${basisDate.toISOString().split('T')[0]}) is ${gapDays} days after close_date. Maximum allowed: 30 days.`
      );
    } else if (gapDays !== 2) {
      warnings.push(
        `Basis of Allotment date is ${gapDays} days after close_date. Standard timeline: 2 days.`
      );
    }
  }

  // Validate Initiation of Refunds Date
  if (dates.initiationOfRefundsDate) {
    const refundDate = new Date(dates.initiationOfRefundsDate);
    const gapDays = Math.floor(
      (refundDate.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (gapDays < 0) {
      errors.push(
        `Initiation of Refunds date (${refundDate.toISOString().split('T')[0]}) cannot be before close_date (${closeDate.toISOString().split('T')[0]})`
      );
    } else if (gapDays > 30) {
      errors.push(
        `Initiation of Refunds date (${refundDate.toISOString().split('T')[0]}) is ${gapDays} days after close_date. Maximum allowed: 30 days.`
      );
    } else if (gapDays !== 4) {
      warnings.push(
        `Initiation of Refunds date is ${gapDays} days after close_date. Standard timeline: 4 days.`
      );
    }
  }

  // Validate Credit of Shares Date
  if (dates.creditOfSharesDate) {
    const creditDate = new Date(dates.creditOfSharesDate);
    const gapDays = Math.floor(
      (creditDate.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (gapDays < 0) {
      errors.push(
        `Credit of Shares date (${creditDate.toISOString().split('T')[0]}) cannot be before close_date (${closeDate.toISOString().split('T')[0]})`
      );
    } else if (gapDays > 30) {
      errors.push(
        `Credit of Shares date (${creditDate.toISOString().split('T')[0]}) is ${gapDays} days after close_date. Maximum allowed: 30 days.`
      );
    } else if (gapDays !== 6) {
      warnings.push(
        `Credit of Shares date is ${gapDays} days after close_date. Standard timeline: 6 days.`
      );
    }
  }

  // Validate Listing Date (if provided)
  if (dates.listingDate) {
    const listingDate = new Date(dates.listingDate);
    const gapDays = Math.floor(
      (listingDate.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (gapDays < 0) {
      errors.push(
        `Listing date (${listingDate.toISOString().split('T')[0]}) cannot be before close_date (${closeDate.toISOString().split('T')[0]})`
      );
    } else if (gapDays > 30) {
      warnings.push(
        `Listing date is ${gapDays} days after close_date. Standard timeline: 10-14 days. This is unusual but allowed.`
      );
    }
  }

  // Cross-field validation: Timeline dates should be in sequence
  if (dates.basisOfAllotmentDate && dates.initiationOfRefundsDate) {
    const basisDate = new Date(dates.basisOfAllotmentDate);
    const refundDate = new Date(dates.initiationOfRefundsDate);

    if (refundDate < basisDate) {
      warnings.push(
        'Initiation of Refunds date should typically come after Basis of Allotment date'
      );
    }
  }

  if (dates.initiationOfRefundsDate && dates.creditOfSharesDate) {
    const refundDate = new Date(dates.initiationOfRefundsDate);
    const creditDate = new Date(dates.creditOfSharesDate);

    if (creditDate < refundDate) {
      warnings.push(
        'Credit of Shares date should typically come after Initiation of Refunds date'
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Calculate recommended timeline dates based on close_date
 *
 * @param closeDate - IPO close date
 * @returns Recommended dates following standard business timeline
 */
export function calculateRecommendedTimelineDates(closeDate: Date | null): {
  basisOfAllotmentDate: Date | null;
  initiationOfRefundsDate: Date | null;
  creditOfSharesDate: Date | null;
} {
  if (!closeDate) {
    return {
      basisOfAllotmentDate: null,
      initiationOfRefundsDate: null,
      creditOfSharesDate: null,
    };
  }

  const close = new Date(closeDate);

  const basisDate = new Date(close);
  basisDate.setDate(basisDate.getDate() + 2); // Standard: +2 days

  const refundDate = new Date(close);
  refundDate.setDate(refundDate.getDate() + 4); // Standard: +4 days

  const creditDate = new Date(close);
  creditDate.setDate(creditDate.getDate() + 6); // Standard: +6 days

  return {
    basisOfAllotmentDate: basisDate,
    initiationOfRefundsDate: refundDate,
    creditOfSharesDate: creditDate,
  };
}

/**
 * Helper: Add days to a date
 *
 * @param date - Base date
 * @param days - Number of days to add
 * @returns New date with days added, or null if input date is null
 */
export function addDaysToDate(date: Date | null, days: number): Date | null {
  if (!date) return null;
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
