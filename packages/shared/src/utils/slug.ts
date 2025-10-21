/**
 * Canonical slug generation for IPO company names
 *
 * This module provides a single source of truth for slug generation across
 * all parts of the IPODhan system (web, scrapers, API).
 *
 * Rules:
 * 1. Convert to lowercase
 * 2. Normalize company legal entities (Ltd., Pvt., Limited, etc.)
 * 3. Replace special characters with semantic equivalents
 * 4. Remove extra spaces and hyphens
 * 5. Ensure uniqueness by appending identifier if needed
 *
 * @module utils/slug
 */

export interface SlugOptions {
  /** Optional suffix to append (e.g., "-ipo") */
  suffix?: string;
  /** Maximum slug length (default: 100) */
  maxLength?: number;
}

/**
 * Generate IPO slug from company name using canonical rules
 *
 * This function ensures consistent slug generation across the entire application.
 * It handles legal entity normalization, special characters, and enforces
 * URL-safe formatting.
 *
 * @param companyName - The company name to convert to a slug
 * @param options - Optional configuration for suffix and max length
 * @returns URL-safe slug string
 *
 * @example
 * ```typescript
 * generateIPOSlug('Company Ltd.') // 'company-ltd'
 * generateIPOSlug('A & B Company') // 'a-and-b-company'
 * generateIPOSlug('Company', { suffix: '-ipo' }) // 'company-ipo'
 * ```
 */
export function generateIPOSlug(
  companyName: string,
  options: SlugOptions = {}
): string {
  const { suffix = '', maxLength = 100 } = options;

  let slug = companyName
    .toLowerCase()
    .trim()

    // Normalize common legal entity suffixes
    // These are placed at the end with a hyphen for better readability
    .replace(/\s+ltd\.?$/i, '-ltd')
    .replace(/\s+limited$/i, '-limited')
    .replace(/\s+pvt\.?\s+ltd\.?$/i, '-pvt-ltd')
    .replace(/\s+private\s+limited$/i, '-private-limited')
    .replace(/\s+pvt\.?$/i, '-pvt')
    .replace(/\s+private$/i, '-private')
    .replace(/\s+inc\.?$/i, '-inc')
    .replace(/\s+incorporated$/i, '-incorporated')
    .replace(/\s+corp\.?$/i, '-corp')
    .replace(/\s+corporation$/i, '-corporation')
    .replace(/\s+llc$/i, '-llc')
    .replace(/\s+llp$/i, '-llp')
    .replace(/\s+plc$/i, '-plc')

    // Replace special characters with semantic equivalents
    // Add spaces around replacements to ensure proper word boundaries
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/@/g, ' at ')
    .replace(/%/g, ' percent ')
    .replace(/₹/g, ' rs ')
    .replace(/\$/g, ' dollar ')
    .replace(/€/g, ' euro ')
    .replace(/£/g, ' pound ')

    // Replace all non-alphanumeric characters (including spaces) with hyphens
    .replace(/[^a-z0-9]+/g, '-')

    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')

    // Collapse multiple consecutive hyphens into one
    .replace(/-+/g, '-');

  // Add suffix if provided
  if (suffix) {
    slug = `${slug}${suffix}`;
  }

  // Enforce maximum length
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength).replace(/-+$/, '');
  }

  return slug;
}

/**
 * Validate slug format according to canonical rules
 *
 * A valid slug must:
 * - Be lowercase only
 * - Contain only a-z, 0-9, and hyphens
 * - Not start or end with a hyphen
 * - Not contain consecutive hyphens
 *
 * @param slug - The slug string to validate
 * @returns True if slug is valid, false otherwise
 *
 * @example
 * ```typescript
 * validateSlug('company-name') // true
 * validateSlug('Company-Name') // false (uppercase)
 * validateSlug('-company') // false (leading hyphen)
 * validateSlug('company--name') // false (consecutive hyphens)
 * ```
 */
export function validateSlug(slug: string): boolean {
  // Slug must:
  // - Be lowercase
  // - Only contain a-z, 0-9, hyphens
  // - Not start or end with hyphen
  // - Not have consecutive hyphens
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return slugPattern.test(slug);
}

/**
 * Generate unique slug by appending counter if needed
 *
 * This function ensures slug uniqueness by checking against existing slugs
 * and appending a numeric counter if duplicates are found.
 *
 * @param companyName - The company name to convert to a slug
 * @param existingSlugs - Array of existing slugs to check against
 * @param options - Optional configuration for suffix and max length
 * @returns Unique slug string
 *
 * @example
 * ```typescript
 * generateUniqueSlug('Company', []) // 'company'
 * generateUniqueSlug('Company', ['company']) // 'company-2'
 * generateUniqueSlug('Company', ['company', 'company-2']) // 'company-3'
 * ```
 */
export function generateUniqueSlug(
  companyName: string,
  existingSlugs: string[],
  options: SlugOptions = {}
): string {
  const baseSlug = generateIPOSlug(companyName, options);

  // If slug is unique, return it
  if (!existingSlugs.includes(baseSlug)) {
    return baseSlug;
  }

  // Append counter until unique
  let counter = 2;
  let uniqueSlug = `${baseSlug}-${counter}`;

  while (existingSlugs.includes(uniqueSlug)) {
    counter++;
    uniqueSlug = `${baseSlug}-${counter}`;

    // Safety check to prevent infinite loops
    if (counter > 1000) {
      throw new Error(`Unable to generate unique slug for "${companyName}" after 1000 attempts`);
    }
  }

  return uniqueSlug;
}

/**
 * Extract company name from slug (reverse operation)
 *
 * This function attempts to convert a slug back into a human-readable
 * company name. Note that this is a best-effort approximation and may
 * not perfectly restore the original name.
 *
 * @param slug - The slug to convert to a company name
 * @returns Approximate company name
 *
 * @example
 * ```typescript
 * slugToCompanyName('company-name') // 'Company Name'
 * slugToCompanyName('company-ltd') // 'Company Ltd.'
 * slugToCompanyName('company-pvt-ltd') // 'Company Pvt. Ltd.'
 * ```
 */
export function slugToCompanyName(slug: string): string {
  return slug
    .replace(/-ipo$/i, '') // Remove -ipo suffix if present
    .split('-')
    .map((word, index, array) => {
      // Special handling for legal entity suffixes
      if (word === 'ltd' && index === array.length - 1) return 'Ltd.';
      if (word === 'pvt' && index === array.length - 2 && array[index + 1] === 'ltd') return 'Pvt.';
      if (word === 'pvt' && index === array.length - 1) return 'Pvt.';
      if (word === 'inc' && index === array.length - 1) return 'Inc.';
      if (word === 'corp' && index === array.length - 1) return 'Corp.';
      if (word === 'llc' && index === array.length - 1) return 'LLC';
      if (word === 'llp' && index === array.length - 1) return 'LLP';
      if (word === 'plc' && index === array.length - 1) return 'PLC';

      // Special handling for special characters
      if (word === 'and') return '&';
      if (word === 'at') return '@';
      if (word === 'plus') return '+';
      if (word === 'percent') return '%';

      // Capitalize first letter of regular words
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .trim();
}

/**
 * Normalize company name for comparison
 *
 * This function normalizes company names to enable fuzzy matching and
 * duplicate detection. It removes legal entities and special formatting.
 *
 * @param companyName - The company name to normalize
 * @returns Normalized company name
 *
 * @example
 * ```typescript
 * normalizeCompanyName('Company Ltd.') // 'company'
 * normalizeCompanyName('Company Pvt. Ltd.') // 'company'
 * normalizeCompanyName('A & B Company') // 'a and b company'
 * ```
 */
export function normalizeCompanyName(companyName: string): string {
  return companyName
    .toLowerCase()
    .trim()
    // Remove common legal entity suffixes
    .replace(/\s+ltd\.?$/i, '')
    .replace(/\s+limited$/i, '')
    .replace(/\s+pvt\.?\s+ltd\.?$/i, '')
    .replace(/\s+private\s+limited$/i, '')
    .replace(/\s+pvt\.?$/i, '')
    .replace(/\s+private$/i, '')
    .replace(/\s+inc\.?$/i, '')
    .replace(/\s+incorporated$/i, '')
    .replace(/\s+corp\.?$/i, '')
    .replace(/\s+corporation$/i, '')
    .replace(/\s+llc$/i, '')
    .replace(/\s+llp$/i, '')
    .replace(/\s+plc$/i, '')
    // Normalize special characters
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
