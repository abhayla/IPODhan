/**
 * Identity binding for documents fetched from the SEBI and company rungs (item 44, PR #1464 fix round 1).
 *
 * THE RISK. Both rungs match an IPO by COMPANY NAME only (`matchSebiRow`, the issuer's investor
 * page). Item 44 reopens ~48 CLOSED/LISTED final-Prospectus rows for their first SEBI ask, and a
 * Prospectus outranks every other document (OD-30): a same-name filing of another issue (an
 * earlier IPO of the same company, a different company with the same name) would overwrite good
 * RHP values.
 *
 * THE RULE, in the spec's identity order (OD-34 as amended by OD-89: CIN first, then each source's
 * own record number and dates):
 *   (a) a CIN printed on the document's cover that is not the IPO's stored `ipos.cin` refuses it;
 *   (b) a filing date (SEBI's listing date, else the cover's "dated <date>") outside the window
 *       around the IPO's own dates refuses it;
 *   (c) for the post-close publisher types (final Prospectus, basis-of-allotment ad), a document
 *       that neither (a) nor (b) could POSITIVELY bind is not stored: `identity_unverified`.
 * Other types (DRHP/RHP via SEBI) are refused only on a positive mismatch: a DRHP is filed months
 * or years before the issue dates, so a date window does not apply to it, and SEBI is the only
 * DRHP source -- failing it closed on a missing CIN would stop DRHP discovery altogether.
 *
 * Offering types are never excluded by name: an FPO has a Prospectus too; identity decides.
 */

import type { DocumentType } from './document-types.js';

/** Same pattern as `CIN_RX` in scraper/scripts/extract_filing.py (the extractor's CIN reader). */
const CIN_RX = /\b([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/g;

/**
 * The window a post-close filing must fall in, around the IPO's own dates.
 *
 * - LOWER = earliest IPO date (open, else close, else listing) minus 60 days. A book-built issue
 *   files its final Prospectus after the close, but a FIXED-PRICE issue's Prospectus IS its offer
 *   document and is filed before the open (SME issues: typically 1-4 weeks before). 60 days covers
 *   that with margin and still refuses an earlier issue of the same company (years before).
 * - UPPER = latest IPO date (listing, else close, else open) plus 30 days. The final Prospectus is
 *   filed with the RoC on or just after the close and the basis-of-allotment ad appears T+1..T+3;
 *   30 days allows a late upload on a company page and still refuses a later issue (an FPO).
 */
export const IDENTITY_WINDOW_DAYS_BEFORE = 60;
export const IDENTITY_WINDOW_DAYS_AFTER = 30;

/** Types whose rung document must be POSITIVELY bound before it is stored. */
export const STRICT_IDENTITY_TYPES: readonly DocumentType[] = ['PROSPECTUS', 'BASIS_OF_ALLOTMENT_AD'];

export interface IdentityIpo {
  cin?: string | null;
  openDate?: Date | string | null;
  closeDate?: Date | string | null;
  listingDate?: Date | string | null;
}

export type IdentityVerdict =
  | { verdict: 'bound'; by: 'cin' | 'date' | 'cin+date' }
  | { verdict: 'not_checked' }
  | { verdict: 'refused'; reason: 'identity_cin_mismatch' | 'identity_date_outside_window' | 'identity_unverified'; detail: string };

/** Every CIN printed in a text (cover pages print the issuer's; distinct, in order). */
export function readCins(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...String(text).toUpperCase().matchAll(CIN_RX)].map((m) => m[1]))];
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function utcDate(y: number, m: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null;
}

/** "Sep 22, 2026" / "September 22, 2026" / "22 September 2026" / "22-09-2026" -> UTC midnight. */
export function parseFilingDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const s = String(text).trim();
  let m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) {
    return utcDate(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    return utcDate(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  }
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (m) return utcDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** The date a cover says the document is "dated" (a Prospectus prints "Prospectus dated <date>"). */
export function readCoverDatedDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = String(text).match(/\bdated\s*:?\s*([A-Za-z0-9 ,./-]{8,24})/i);
  return m ? parseFilingDate(m[1]) : null;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;

/** The window, or null when the IPO has no date to anchor it. */
export function identityWindow(ipo: IdentityIpo): { from: Date; to: Date } | null {
  const open = asDate(ipo.openDate);
  const close = asDate(ipo.closeDate);
  const listing = asDate(ipo.listingDate);
  const earliest = open ?? close ?? listing;
  const latest = listing ?? close ?? open;
  if (!earliest || !latest) return null;
  return {
    from: new Date(earliest.getTime() - IDENTITY_WINDOW_DAYS_BEFORE * DAY_MS),
    to: new Date(latest.getTime() + IDENTITY_WINDOW_DAYS_AFTER * DAY_MS),
  };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Decide whether a SEBI- or COMPANY-rung document belongs to this IPO. Exchange documents
 * (`source` NSE/BSE) are addressed by the IPO's own exchange record and are `not_checked` here.
 */
export function verifyDocumentIdentity(params: {
  source: string;
  docType: DocumentType;
  ipo: IdentityIpo;
  coverText?: string | null;
  /** The source's own filing date (SEBI's listing row), when it gives one. */
  filingDate?: Date | null;
}): IdentityVerdict {
  if (params.source !== 'SEBI' && params.source !== 'COMPANY') return { verdict: 'not_checked' };
  const strict = STRICT_IDENTITY_TYPES.includes(params.docType);

  const stored = String(params.ipo.cin ?? '').trim().toUpperCase();
  const printed = readCins(params.coverText);
  let cinMatch = false;
  if (stored !== '' && printed.length > 0) {
    if (!printed.includes(stored)) {
      return {
        verdict: 'refused',
        reason: 'identity_cin_mismatch',
        detail: `cover CIN ${printed.join('/')} is not the IPO's ${stored}`,
      };
    }
    cinMatch = true;
  }

  let dateMatch = false;
  if (strict) {
    const filed = params.filingDate ?? readCoverDatedDate(params.coverText);
    const window = identityWindow(params.ipo);
    if (filed && window) {
      if (filed < window.from || filed > window.to) {
        return {
          verdict: 'refused',
          reason: 'identity_date_outside_window',
          detail: `filed ${ymd(filed)} outside ${ymd(window.from)}..${ymd(window.to)}`,
        };
      }
      dateMatch = true;
    }
    if (!cinMatch && !dateMatch) {
      return {
        verdict: 'refused',
        reason: 'identity_unverified',
        detail: `no CIN match (stored ${stored || 'none'}, cover ${printed.join('/') || 'none'}) and no filing date inside the IPO window (${filed ? ymd(filed) : 'no date'}; window ${window ? `${ymd(window.from)}..${ymd(window.to)}` : 'no IPO dates'})`,
      };
    }
  }
  if (cinMatch && dateMatch) return { verdict: 'bound', by: 'cin+date' };
  if (cinMatch) return { verdict: 'bound', by: 'cin' };
  if (dateMatch) return { verdict: 'bound', by: 'date' };
  return { verdict: 'not_checked' };
}
