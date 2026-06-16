/**
 * Genuine-IPO predicate — the ONE source of truth for "is this row a real IPO?"
 *
 * The `ipos` table carries every offering type (IPO, FPO, RIGHTS, OFS, NCD, INVITS,
 * BUYBACK, DELISTING, TENDER, …) so corporate actions and non-IPO offerings live
 * alongside IPOs. Every IPO surface (the listings/findAll default filter AND the
 * `/ipos/[slug]` detail 404) MUST gate on this predicate so non-IPO rows never
 * render as IPOs. Non-IPO offerings have their own listing surfaces (/ofs, /ncd,
 * /rights-issues, /fpo-listings) which query by an explicit offering type.
 *
 * SME IPOs are `offering_type='IPO'` with `segment='SME'` — both segments are real
 * IPOs, so the set is exactly `['IPO']`.
 */
import type { offeringTypeEnum } from '../db/schema';

// Internal alias (the package already exports a public `OfferingType`); used only
// to constrain the literal set below to valid enum members.
type OfferingTypeValue = (typeof offeringTypeEnum.enumValues)[number];

/** The offering types shown on IPO surfaces. Everything else is a non-IPO. */
export const REAL_IPO_OFFERING_TYPES = ['IPO'] as const satisfies readonly OfferingTypeValue[];

const REAL_IPO_SET: ReadonlySet<string> = new Set(REAL_IPO_OFFERING_TYPES);

/**
 * True iff `offeringType` is a genuine IPO. Null / undefined / unknown → false:
 * an unclassified row must never pollute IPO surfaces (the column is NOT NULL in
 * practice, so this is a defensive floor, not a routine path).
 */
export function isRealIPO(offeringType: string | null | undefined): boolean {
  return offeringType != null && REAL_IPO_SET.has(offeringType);
}
