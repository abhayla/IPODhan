import { z } from 'zod';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { sanitizeDisplayCompanyName } from '@ipodhan/shared/utils/company-name-normalizer';

// ==================== SCRAPED IPO SCHEMA ====================

export const ScrapedIPOSchema = z.object({
  companyName: z.string().min(1, 'Company name is required').max(255),
  issueSize: z.number().nonnegative('Issue size must be non-negative'),
  // A literal 0 means "unannounced" (the source returned a blank price cell),
  // never a real ₹0 band - normalize it to undefined here so every caller of
  // every schema built on ScrapedIPOSchema treats an unannounced band as
  // absent-and-kept rather than rejecting the whole IPO (T-236).
  priceRangeMin: z.preprocess(
    (val) => (val === 0 ? undefined : val),
    z.number().positive('Price range min must be positive').optional()
  ),
  priceRangeMax: z.preprocess(
    (val) => (val === 0 ? undefined : val),
    z.number().positive('Price range max must be positive').optional()
  ),
  openDate: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Open date must be a valid ISO 8601 date string'
  ),
  closeDate: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    'Close date must be a valid ISO 8601 date string'
  ),
  listingExchange: z.enum(['NSE', 'BSE', 'BOTH'], {
    message: 'Invalid listing exchange'
  }),
  // Story 11.8: Replaced category with segment + offeringType
  // NOTE: segment is nullable for RIGHTS/InvITs/REITs/NCDs (they don't have market segments)
  segment: z.enum(['MAINBOARD', 'SME']).nullable().optional(),
  offeringType: z.enum(['IPO', 'FPO', 'RIGHTS', 'OFS', 'BUYBACK', 'DELISTING', 'TENDER', 'NCD', 'BONDS', 'INVITS', 'REITS', 'IPP', 'QIP', 'PREFERENTIAL'], {
    message: 'Invalid offering type'
  }),
  sector: z.string().max(100).optional(),
  status: z.enum(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED'], {
    message: 'Invalid IPO status - must be UPCOMING, OPEN, CLOSED, or LISTED'
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
  registrar: z.string().max(255).nullable().optional(), // Allow null when not available
  leadManagers: z.array(z.string()).nullable().optional(),
  symbol: z.string().nullable().optional(), // NSE/BSE stock symbol (nullable for RIGHTS/NCD)
  isin: z.string().length(12).nullable().optional() // ISIN code (12 characters, nullable when not available)
}).refine(
  (data) => new Date(data.closeDate) >= new Date(data.openDate),
  {
    message: 'Close date must be after or equal to open date',
    path: ['closeDate']
  }
).refine(
  (data) => {
    // Only validate if both values are present (not undefined)
    if (data.priceRangeMin === undefined || data.priceRangeMax === undefined) {
      return true;
    }
    return data.priceRangeMax >= data.priceRangeMin;
  },
  {
    message: 'Price range max must be greater than or equal to price range min',
    path: ['priceRangeMax']
  }
)
// Note: Removed strict validation for symbol/leadManagers
// These fields are optional/nullable and may not be available from all sources
// Particularly for Rights Issues (RI) and Debt Issues (NCD) on BSE
// The application layer should handle missing fields appropriately;

export type ScrapedIPO = z.infer<typeof ScrapedIPOSchema>;

// ==================== MONEYCONTROL IPO SCHEMA ====================

export const MoneycontrolIPOSchema = ScrapedIPOSchema.merge(z.object({
  dataSource: z.literal('MONEYCONTROL'),
  rating: z.number().min(0).max(5).optional(), // Moneycontrol's IPO rating (0-5 stars)
  listingGains: z.number().optional(), // Expected listing gains percentage
  // Subscription %s parsed from Moneycontrol's table, carried so the orchestrator
  // can persist a subscription snapshot for symbol-less SME IPOs (optional —
  // only present/populated for currently-bidding rows).
  totalSubscription: z.number().min(0).optional(),
  qibSubscription: z.number().min(0).optional(),
  niiSubscription: z.number().min(0).optional(),
  retailSubscription: z.number().min(0).optional(),
}));

export type MoneycontrolIPO = z.infer<typeof MoneycontrolIPOSchema>;

/**
 * Validate Moneycontrol scraped IPO data
 * @param data - Raw scraped Moneycontrol data
 * @returns Validation result with parsed data or error
 */
export function validateMoneycontrolIPOData(data: unknown): {
  success: boolean;
  data?: MoneycontrolIPO;
  error?: z.ZodError;
} {
  try {
    const parsed = MoneycontrolIPOSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    throw error;
  }
}

// ==================== CHITTORGARH IPO SCHEMA ====================

export const ChittorgarhIPOSchema = ScrapedIPOSchema.merge(z.object({
  dataSource: z.literal('CHITTORGARH'),
  gmp: z.number().optional(), // Grey Market Premium in INR
  gmpPercentage: z.number().optional(), // GMP as percentage of issue price
  gmpUpdatedAt: z.string().optional().refine(
    (date) => !date || !isNaN(Date.parse(date)),
    'GMP updated date must be a valid ISO 8601 date string'
  ),
}));

export type ChittorgarhIPO = z.infer<typeof ChittorgarhIPOSchema>;

/**
 * Validate Chittorgarh scraped IPO data
 * @param data - Raw scraped Chittorgarh data
 * @returns Validation result with parsed data or error
 */
export function validateChittorgarhIPOData(data: unknown): {
  success: boolean;
  data?: ChittorgarhIPO;
  error?: z.ZodError;
} {
  try {
    const parsed = ChittorgarhIPOSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    throw error;
  }
}

/**
 * Validate GMP (Grey Market Premium) value
 * Ensures GMP is within reasonable bounds relative to issue price
 * @param gmp - GMP value in INR
 * @param issuePrice - Issue price in INR
 * @returns true if GMP is valid
 */
export function validateGMP(gmp: number, issuePrice: number): boolean {
  if (!gmp || !issuePrice) return true; // Allow missing GMP

  const gmpPercentage = (gmp / issuePrice) * 100;

  // Reject unrealistic GMP values
  // GMP typically ranges from -50% to +200% of issue price
  if (gmpPercentage > 200 || gmpPercentage < -50) {
    return false;
  }

  return true;
}

// ==================== SCRAPED SUBSCRIPTION SCHEMA ====================

export const ScrapedSubscriptionSchema = z.object({
  ipoCompanyName: z.string().min(1, 'IPO company name is required'),
  ipoSymbol: z.string().optional(), // NSE/BSE stock symbol
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
  // Share counts behind the multiples (NSE ships these on the Total row).
  totalSharesBid: z.number().int().min(0).optional(),
  sharesOffered: z.number().int().min(0).optional(),
  // T-266: how much of the market this figure covers. CONSOLIDATED = both
  // exchange books (NSE /api/ipo-active-category); EXCHANGE_ONLY = one book
  // (NSE /api/ipo-current-issue, or the BSE API). A partial figure must never
  // be published as the whole-market number - see data-persister.ts.
  coverage: z.enum(['CONSOLIDATED', 'EXCHANGE_ONLY']).optional(),
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
  // Delegates to the shared canonical display-name sanitizer (#42) so the
  // HTML-strip + trailing-status-token rule lives in exactly one place and the
  // scraper create-path and the IPORepository write choke point stay in lock-step.
  if (!name) {
    console.warn('[sanitizeCompanyName] Called with null/undefined name');
    return '';
  }
  return sanitizeDisplayCompanyName(name);
}

/**
 * Coerce a non-positive or absent numeric to null (Stage A.5 / substance gate).
 * IPO money/size fields stored as 0 are a substance bug — 0 does NOT mean a free
 * issue, it means "unknown" — and a stored 0 masquerades as 100% coverage in any
 * non-null count. Use this at the write boundary so issue_size (etc.) is NULL when
 * unknown rather than a misleading 0. Accepts a number or a numeric string.
 */
export function coercePositiveOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export interface IpoDateSet {
  openDate?: Date | string | null;
  closeDate?: Date | string | null;
  allotmentDate?: Date | string | null;
  listingDate?: Date | string | null;
}

function toEpoch(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/**
 * Write-path date-plausibility guard (#41 / #52). A current scrape MUST NOT stomp
 * an IPO's dates. The lifecycle ordering is strict: open < close < allotment <
 * listing. This guard drops the single field that contradicts the others, using
 * `listing_date` as the disambiguator since the corrupt field is not always the
 * same one:
 *   - WINDLAS/AAA/CMS/STALLION: old IPO, listing absent, allotment is the stable
 *     original (years ago) and a current scrape stomped open/close into the future
 *     -> anchor on allotment; null the open/close that don't precede it.
 *   - Leapfrog: current IPO, listing present and consistent with open/close, and the
 *     ALLOTMENT is the outlier (lands before open) -> trust listing-corroborated
 *     open/close; null the bad allotment instead.
 * Also nulls an open>close inversion. Returns a NEW object with offending fields
 * nulled; never throws. Pure (no clock) — the verdict is derivable from the inputs.
 */
// T-306 F2: when a present listing_date conflicts with open/close, this threshold
// decides which side is the corrupt one. A listing that sits FAR in the past
// relative to open/close (> this many ms) is the WINDLAS "stomp" signature — a
// rescrape overwrote open/close with future junk while the old, stable listing
// survived, so listing is the trustworthy anchor. A listing that is only
// mildly/near-term inconsistent with an otherwise self-coherent open/close pair
// is itself the outlier (the kwality-walls-india-ltd shape: open/close ~80 days
// after listing) — keep open/close, null the listing instead. 180 days cleanly
// separates the two real prod shapes seen so far (~80 days vs ~4.7 years).
const FAR_PAST_ANCHOR_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Same open/close/allotment/listing ordering rule that `isDateSequenceCoherent`
 * (ipo-date-plausibility.ts) DETECTS — this function is the write-path twin that
 * RESOLVES a detected violation by nulling the offending field(s). Keep both in
 * sync: a pair this function treats as impossible must also be a pair the
 * coherence check flags, and vice versa (T-306 reconciliation).
 */
export function sanitizeIpoDates(dates: IpoDateSet): IpoDateSet {
  const result: IpoDateSet = { ...dates };
  const open = toEpoch(dates.openDate);
  const close = toEpoch(dates.closeDate);
  const allot = toEpoch(dates.allotmentDate);
  const listing = toEpoch(dates.listingDate);

  // open > close is impossible — both are suspect, drop both.
  if (open !== null && close !== null && open > close) {
    result.openDate = null;
    result.closeDate = null;
    return result;
  }

  // T-309 presence-coherence: a listing_date without an open_date is unconfirmable
  // (an IPO cannot be scheduled to list before it is scheduled to open) — null the
  // listing rather than let it stand alone. Returns early so the ORDER-based
  // branches below (T-306), which assume a present listing implies open/close
  // should exist, never see this shape.
  if (listing !== null && open === null) {
    result.listingDate = null;
    return result;
  }

  if (listing !== null) {
    const closeConflict = close !== null && close >= listing;
    const openConflict = open !== null && open >= listing;
    if (closeConflict || openConflict) {
      const anchor = close ?? open;
      const gap = anchor !== null ? anchor - listing : null;
      if (gap !== null && gap > FAR_PAST_ANCHOR_THRESHOLD_MS) {
        // WINDLAS-shape stomp: listing is the stable anchor, open/close are junk.
        if (closeConflict) result.closeDate = null;
        if (openConflict) result.openDate = null;
      } else {
        // kwality-shape: open/close are self-coherent and near-term; listing is
        // the outlier that must not be allowed to null two GOOD dates.
        result.listingDate = null;
      }
    }

    // allotment must sit between the (possibly just-resolved) close/open and
    // listing; if it precedes that window or follows a still-present listing
    // it is the outlier, not open/close/listing.
    if (allot !== null) {
      const resolvedClose = toEpoch(result.closeDate);
      const resolvedOpen = toEpoch(result.openDate);
      const resolvedListing = toEpoch(result.listingDate);
      // (T-306 F reconciliation) close>=allotment is incoherent on its own —
      // matches isDateSequenceCoherent's "close_date is at/after allotment_date"
      // rule, independent of whether listing also conflicts.
      const closeConflict = resolvedClose !== null && resolvedClose >= allot;
      // open>allotment (strict) only matters when close was already nulled above
      // (the WINDLAS-shape stomp) — mirrors the detector's open-vs-allotment rule.
      const openConflict = resolvedClose === null && resolvedOpen !== null && resolvedOpen > allot;
      // allotment>=listing (was strict `>`) — matches the detector's
      // "allotment_date is at/after listing_date" rule, which treats equality
      // as incoherent too.
      const listingConflict = resolvedListing !== null && allot >= resolvedListing;
      if (closeConflict || openConflict || listingConflict) result.allotmentDate = null;
    }
  } else if (allot !== null) {
    // No listing: allotment is the stable original record — open/close must precede it.
    if (close !== null && close >= allot) result.closeDate = null;
    if (open !== null && open >= allot) result.openDate = null;
  }
  return result;
}

// Tokens that mark a string as a registrar NAME (vs an address/garbage segment).
const REGISTRAR_KEYWORDS = /(registrar|technolog|services|consultant|securities|share|investor|corporate|capital|bigshare|link\s*intime|cameo|kfin|karvy|maashitla|skyline|purva|integrated|beetal|alankit|\bmas\b)/i;

/**
 * Sanitize a scraped registrar string (#45). Registrars arrive polluted with address
 * and contact blocks delimited by '^', tabs, or newlines (e.g.
 * "CAMEO CORPORATE SERVICES LTD.^Subramanian Building,..." or
 * "1\tKfin Technologies Limited\tM Murali Krishna\tTel.: ..."). This picks the
 * registrar-name segment, trims trailing address/contact text, and re-spaces a glued
 * legal suffix. It does NOT collapse distinct variants (Kfin vs Karvy) — that is the
 * risky canonicalization deferred for mis-map risk; this only removes pollution.
 * Returns null for an empty/absent value.
 */
export function sanitizeRegistrar(value: string | null | undefined): string | null {
  if (!value) return null;
  const segments = String(value).split(/[\^\t\n\r]+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  // Prefer a segment that reads like a registrar name; else the most-alphabetic segment.
  const byAlpha = [...segments].sort((a, b) => b.replace(/[^a-z]/gi, '').length - a.replace(/[^a-z]/gi, '').length);
  let s = segments.find((x) => REGISTRAR_KEYWORDS.test(x)) ?? byAlpha[0];
  // Cut trailing contact/address riding on the same segment.
  s = s.split(/\s*(?:Tel\.?:|E-?mail:|Phone:|,\s*\d)/i)[0].trim();
  // Re-insert a space where a legal suffix got glued to the name ("TechnologiesLimited").
  s = s.replace(/([a-z])(Limited|Ltd\.?|Private\b)/g, '$1 $2').replace(/\s+/g, ' ').trim();
  return s || null;
}

// A cell/segment that reads like a company (vs a bare person name or a
// contact-detail fragment) for lead-manager pollution filtering.
const COMPANY_ENTITY_KEYWORDS = /(securities|capital|finance|financial|bank|services|advisors?|advisory|partners|corp\.?|inc\.?|limited|ltd\.?|llp|pvt\.?)/i;

/**
 * Sanitize a scraped lead_managers array (#T-299 P2-8). Some sources capture a
 * two-column contact table (e.g. compliance-officer name + phone/email) instead
 * of, or glued alongside, the actual Book Running Lead Manager row, joining the
 * two table cells with a literal tab inside one array entry — e.g.
 * `["ICICI Securities Limited\tKishan Rastogi", "Rahul Sharma\tTel: ...E-mail: ..."]`.
 * Every entry is split on tabs into its cells; a cell is kept only if it reads
 * like a company name (legal-entity keyword) and has any trailing contact info
 * (Tel:/E-mail:/Phone:) cut off. Returns null for an empty/absent value or when
 * nothing survives the filter (never invents a manager name).
 */
export function sanitizeLeadManagers(value: string[] | null | undefined): string[] | null {
  if (!value || value.length === 0) return null;

  const kept: string[] = [];
  for (const raw of value) {
    const cells = String(raw).split(/\t+/).map((c) => c.trim()).filter(Boolean);
    for (let cell of cells) {
      cell = cell.split(/\s*(?:Tel\.?:|E-?mail:|Phone:)/i)[0].trim();
      if (!cell || !COMPANY_ENTITY_KEYWORDS.test(cell)) continue;
      kept.push(cell);
    }
  }

  const deduped = Array.from(new Set(kept));
  return deduped.length > 0 ? deduped : null;
}

/**
 * Consolidation-output write choke (#42/#45/#52). The create path sanitizes
 * company_name / registrar / dates inline while building the insert record, but the
 * consolidation UPDATE path writes `consolidationResult.consolidatedData` directly
 * via `ipoRepository.update` — so a per-field merge that picks an unsanitized winning
 * value (a name with a trailing status token, a registrar with an address block, or a
 * date field merged from a different-vintage source that breaks the ordering) is
 * persisted UNGUARDED, re-introducing exactly the pollution the create path removed.
 *
 * This re-applies all three sanitizers to a merged write record just before it is
 * written, so every write path — create AND consolidation-update — enforces the same
 * substance guarantees. Only fields PRESENT on the record are touched (so a partial
 * update never invents keys); the input is not mutated.
 */
export function sanitizeIpoWriteFields<T extends Record<string, any>>(record: T): T {
  const out: Record<string, any> = { ...record };

  if (typeof out.companyName === 'string' && out.companyName) {
    out.companyName = sanitizeCompanyName(out.companyName);
  }
  if ('registrar' in out) {
    out.registrar = sanitizeRegistrar(out.registrar);
  }
  if ('leadManagers' in out) {
    out.leadManagers = sanitizeLeadManagers(out.leadManagers);
  }
  if ('sector' in out && typeof out.sector === 'string') {
    // '' passes z.string().optional() and plants a blank that both renders as empty
    // AND defeats NULL-based backfill filters — normalize to undefined (column untouched).
    out.sector = out.sector.trim() || undefined;
  }

  const hasAnyDate = ['openDate', 'closeDate', 'allotmentDate', 'listingDate'].some(
    (k) => k in out
  );
  if (hasAnyDate) {
    const safe = sanitizeIpoDates({
      openDate: out.openDate ?? null,
      closeDate: out.closeDate ?? null,
      allotmentDate: out.allotmentDate ?? null,
      listingDate: out.listingDate ?? null,
    });
    // Write back only the keys the record actually carried, so an absent key stays
    // absent (a partial update must not null a column it never intended to touch).
    if ('openDate' in out) out.openDate = safe.openDate ?? null;
    if ('closeDate' in out) out.closeDate = safe.closeDate ?? null;
    if ('allotmentDate' in out) out.allotmentDate = safe.allotmentDate ?? null;
    if ('listingDate' in out) out.listingDate = safe.listingDate ?? null;
  }

  return out as T;
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
 * Generate slug from company name (using canonical slug utility)
 *
 * @deprecated Import directly from '@ipodhan/shared/utils/slug' instead
 * This re-export is provided for backward compatibility
 *
 * @param companyName - Company name to slugify
 * @returns URL-friendly slug
 */
export function generateSlug(companyName: string): string {
  return generateIPOSlug(companyName);
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
    message: 'Invalid IPO status'
  }),
  category: z.enum(['MAINBOARD', 'SME', 'RIGHTS', 'NCD'], {
    message: 'Invalid IPO category'
  }),
  exchange: z.enum(['NSE', 'BSE', 'BOTH'], {
    message: 'Invalid exchange'
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
 * Map the IPO Alerts API's `category` (MAINBOARD/SME/RIGHTS/NCD) onto the
 * post-Story-11.8 segment + offeringType pair. MAINBOARD/SME are market
 * segments (offeringType stays the IPO Alerts default of 'IPO'); RIGHTS/NCD
 * are offering types with no market segment (segment is null, matching
 * `ScrapedIPOSchema`'s "nullable for RIGHTS/InvITs/REITs/NCDs" contract).
 */
function segmentAndOfferingTypeFromAlertsCategory(
  category: IPOAlertsAPIIPO['category']
): { segment: 'MAINBOARD' | 'SME' | null; offeringType: 'IPO' | 'RIGHTS' | 'NCD' } {
  if (category === 'RIGHTS' || category === 'NCD') {
    return { segment: null, offeringType: category };
  }
  return { segment: category, offeringType: 'IPO' };
}

/**
 * Transform IPO Alerts API data to IPODhan ScrapedIPO format
 * Converts API underscore_case to camelCase and maps fields
 * @param apiData - Validated IPO Alerts API data
 * @returns Transformed ScrapedIPO data
 */
export function transformIPOAlertsData(apiData: IPOAlertsAPIIPO): ScrapedIPO {
  const { segment, offeringType } = segmentAndOfferingTypeFromAlertsCategory(apiData.category);

  return {
    companyName: sanitizeCompanyName(apiData.company_name),
    issueSize: apiData.issue_size,
    priceRangeMin: apiData.price_range.min,
    priceRangeMax: apiData.price_range.max,
    openDate: apiData.open_date,
    closeDate: apiData.close_date,
    listingExchange: apiData.exchange,
    segment,
    offeringType,
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
