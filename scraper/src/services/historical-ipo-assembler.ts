/**
 * Historical-IPO record assembler (GitHub #71).
 *
 * Aged-out IPOs (e.g. Ather Energy, listed May-2025) are absent from the live
 * exchange/aggregator feeds the scrapers poll, so the pipeline never ingests them.
 * Their data IS deterministically reachable from ARCHIVAL Chittorgarh sources:
 *   - dates (open/close/allotment/listing): CG report-118 (clean ISO fields)
 *   - issue size / ISIN / lot / description / financials: CG detail page
 *   - financials: the #67 DRHP pdfplumber extractor when a RHP is supplied
 *     (oracle-verified in #67), else the CG detail financials extractor.
 *
 * This module is the PURE assembler: given the archival inputs it produces the
 * consolidated upsertIPO payload + a completeness report. No network, no LLM, no
 * hand-typed values — every field comes from a deterministic extractor. The
 * orchestrator script does discovery + fetch + routes the write through upsertIPO
 * (dry-run by default).
 */
import type { ScrapedIPO } from '../utils/validators.js';
import {
  extractIsinFromDetailHtml,
  extractIssueSizeRupeesFromDetailHtml,
  extractLotSizeFromDetailHtml,
  extractCompanyDescriptionFromDetailHtml,
} from '../scrapers/chittorgarh-detail-fields.js';

/** The CG report-118 row fields the assembler reads (clean ISO date fields). */
export interface HistoricalReportRow {
  Company?: string;
  'Issue Type'?: string;
  '~urlrewrite_folder_name'?: string;
  '~Issue_Open_Date'?: string;
  '~Issue_Close_Date'?: string;
  '~Timetable_BOA_dt'?: string;
  '~IPO_Listing_date'?: string;
  [k: string]: unknown;
}

export interface AssembledHistorical {
  scraped: ScrapedIPO;
  completeness: {
    hasDates: boolean;
    hasIssueSize: boolean;
    hasIsin: boolean;
    hasLot: boolean;
    hasDescription: boolean;
    missing: string[];
  };
}

function isoDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/); // already-ISO archival field
  return m ? m[1] : null;
}

/**
 * Assemble a historical IPO's consolidated record from archival Chittorgarh inputs.
 * `financials` (optional) is the #67 DRHP-extractor output; when omitted the
 * caller may attach CG-detail financials separately. Throws if the minimum
 * identity (company name + listing date) cannot be established — never fabricates.
 */
export function assembleHistoricalRecord(input: {
  reportRow: HistoricalReportRow;
  detailHtml: string;
  segment?: 'MAINBOARD' | 'SME' | null;
}): AssembledHistorical {
  const { reportRow, detailHtml } = input;
  const companyName = (reportRow.Company || '').trim();
  if (!companyName) throw new Error('Historical assemble: missing company name');

  const openDate = isoDate(reportRow['~Issue_Open_Date']);
  const closeDate = isoDate(reportRow['~Issue_Close_Date']);
  const allotmentDate = isoDate(reportRow['~Timetable_BOA_dt']);
  const listingDate = isoDate(reportRow['~IPO_Listing_date']);
  if (!listingDate) throw new Error(`Historical assemble: ${companyName} has no listing date (not an aged-out LISTED IPO)`);

  const issueSizeRupees = extractIssueSizeRupeesFromDetailHtml(detailHtml);
  const isin = extractIsinFromDetailHtml(detailHtml);
  const lot = extractLotSizeFromDetailHtml(detailHtml);
  const description = extractCompanyDescriptionFromDetailHtml(detailHtml);

  const segment =
    input.segment ??
    (/\bSME\b/i.test(reportRow['Issue Type'] || '') ? 'SME' : 'MAINBOARD');

  const scraped: ScrapedIPO = {
    companyName,
    issueSize: issueSizeRupees ?? 0,
    openDate: openDate ?? listingDate,
    closeDate: closeDate ?? openDate ?? listingDate,
    listingExchange: 'BOTH',
    segment,
    offeringType: 'IPO',
    status: 'LISTED', // listing date has passed for an aged-out historical IPO
    listingDate,
    ...(allotmentDate ? { allotmentDate } : {}),
    ...(lot ? { lotSize: lot } : {}),
    ...(isin ? { isin } : {}),
    ...(description ? { companyDescription: description } : {}),
  };

  const missing: string[] = [];
  if (!issueSizeRupees) missing.push('issueSize');
  if (!isin) missing.push('isin');
  if (!lot) missing.push('lotSize');
  if (!description) missing.push('companyDescription');
  if (!openDate || !closeDate) missing.push('open/closeDate');

  return {
    scraped,
    completeness: {
      hasDates: !!(openDate && closeDate && listingDate),
      hasIssueSize: !!issueSizeRupees,
      hasIsin: !!isin,
      hasLot: !!lot,
      hasDescription: !!description,
      missing,
    },
  };
}
