/**
 * Pure builder for the #69 company_description backfill.
 *
 * Produces the upsertIPO payload that fills company_description (and carries
 * through sector) for an existing genuine IPO, preserving its other fields so
 * upsertIPO's guards have a stable anchor and nothing else is stomped. Writing
 * goes through upsertIPO (write-path SSOT) — the matrix entries added for
 * company_description + sector make consolidation manage them.
 */
import type { ScrapedIPO } from '../utils/validators.js';

export interface DescBackfillIpo {
  id: string;
  companyName: string;
  slug: string;
  symbol: string | null;
  isin: string | null;
  segment: 'MAINBOARD' | 'SME' | null;
  offeringType: string;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  listingDate: string | null;
  issueSize: string | number | null;
  sector: string | null;
  companyDescription: string | null;
}

/**
 * Build the upsertIPO payload to set company_description on an existing IPO.
 * Throws on an empty description (never writes a blank). Carries the existing
 * sector through unchanged. listingExchange is inferred from symbol/isin presence
 * (BOTH is the safe default — it does not change exchange membership).
 */
export function buildDescriptionScrapedIPO(ipo: DescBackfillIpo, description: string): ScrapedIPO {
  const desc = description.trim();
  if (desc.length < 20) {
    throw new Error(`Refusing to write an implausibly short description for ${ipo.companyName}`);
  }
  const issueSizeNum =
    ipo.issueSize === null || ipo.issueSize === undefined
      ? 0
      : typeof ipo.issueSize === 'string'
        ? parseFloat(ipo.issueSize) || 0
        : ipo.issueSize;

  const today = new Date().toISOString().split('T')[0];
  return {
    companyName: ipo.companyName,
    issueSize: issueSizeNum,
    openDate: ipo.openDate ?? today,
    closeDate: ipo.closeDate ?? ipo.openDate ?? today,
    // W-145: a description backfill knows nothing about the listing board —
    // asserting 'BOTH' here re-widened single-board rows on every run.
    listingExchange: undefined,
    segment: ipo.segment ?? undefined,
    offeringType: ipo.offeringType as ScrapedIPO['offeringType'],
    status: ipo.status as ScrapedIPO['status'], // preserve existing status — a description backfill must not change it
    companyDescription: desc,
    sector: ipo.sector ?? undefined,
    symbol: ipo.symbol ?? undefined,
    isin: (ipo.isin ?? undefined) || undefined,
    ...(ipo.listingDate ? { listingDate: ipo.listingDate } : {}),
  };
}
