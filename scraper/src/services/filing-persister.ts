/**
 * Filing persister (walk step G4) - writes one `extract_filing.py` extraction
 * into the filing tables.
 *
 * CONTRACT (the three rules this module exists to enforce):
 *  1. A field is written ONLY when its `check.passed` is true AND its value is
 *     non-null. A failed arithmetic/plausibility check means the extractor is
 *     not confident in the number - persisting it anyway would launder a wrong
 *     value into the product, which is exactly the "renders fine, is absurd"
 *     class the plausibility rules exist to stop.
 *  2. Every `ipos` scalar goes through `upsertIPO` so the field-priority matrix,
 *     `field_sources` and `data_conflicts` all apply. Nothing here writes an
 *     `ipos` column directly.
 *  3. Child tables are written through their repositories on their natural key
 *     ((ipoId, fiscalYear, basis), (ipoId, pricingEvent), full-replace per IPO),
 *     so a re-run updates in place and never duplicates rows.
 *
 * SOURCE ENUM NOTE: `scraper_source` has DRHP but no RHP and no PRICE_BAND_AD.
 * Both filing doc types therefore write as `DRHP` - the enum's "authoritative
 * offer document" slot. Adding enum members is a schema migration, which this
 * work package is explicitly not allowed to do; the documentId/sourceSha on
 * each field_sources.dataLineage records which document it actually was.
 */

import type { IPORepository } from '@ipodhan/shared';
import type {
  FinancialStatementsRepository,
  IpoValuationRepository,
  PromotersRepository,
  IpoIntermediariesRepository,
  BrlmTrackRecordRepository,
  FieldSourcesRepository,
  FinancialDataRepository,
  PromoterInsert,
  IpoIntermediaryInsert,
} from '@ipodhan/shared';
import type { PeerCompanyRepository } from '../repositories/peer-company-repository.js';
import { upsertIPO } from './data-persister.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------- extraction

export interface ExtractedField {
  value: unknown;
  page?: number | null;
  check?: { name?: string; passed?: boolean; detail?: string } | null;
}

export interface FilingExtraction {
  doc_type: string;
  source_doc?: string;
  pages?: number;
  extraction_status?: string;
  unit?: string | null;
  fiscal_years?: number[] | null;
  fields: Record<string, ExtractedField>;
}

export type FilingDocType = 'PRICE_BAND_AD' | 'RHP' | 'DRHP' | 'PROSPECTUS';

export interface PersistFilingOptions {
  docType: FilingDocType;
  documentId?: string | null;
  sourceSha?: string | null;
  /** false (default) computes the plan and writes nothing. */
  apply?: boolean;
}

/** The one ipo_details write this module needs, narrowed so tests can mock it. */
export interface IpoDetailsWriter {
  upsert(ipoId: string, values: Record<string, unknown>): Promise<void>;
}

export interface FilingPersisterDeps {
  ipoRepository: IPORepository;
  financialStatements: FinancialStatementsRepository;
  ipoValuation: IpoValuationRepository;
  promoters: PromotersRepository;
  intermediaries: IpoIntermediariesRepository;
  brlmTrackRecord: BrlmTrackRecordRepository;
  peerCompanies: PeerCompanyRepository;
  financialData: FinancialDataRepository;
  fieldSources: FieldSourcesRepository;
  ipoDetailsWriter: IpoDetailsWriter;
  /**
   * The same field-protection gate every orchestrator runs
   * (packages/shared admin/field-protection-checker). Injected so the write
   * path can be tested without a database. Omitting it is only legitimate in a
   * test that is not exercising protection.
   */
  protectionFilter?: (
    ipoId: string,
    tableName: string,
    data: Record<string, unknown>,
    scraperName: string
  ) => Promise<{ filtered: Record<string, unknown> }>;
}

export interface PersistFilingSummary {
  written: Record<string, number>;
  skipped_failed_check: string[];
  skipped_no_column: string[];
  /** Unit-dependent writes refused because the filing states no usable unit. */
  skipped_no_unit: string[];
  /** Statement rows refused because a stored row is in a different unit. */
  skipped_unit_mismatch: string[];
  /** What actually went to `ipos` via upsertIPO (issueSize et al). */
  ipos_fields: string[];
  applied: boolean;
}

type ScraperSourceLiteral =
  | 'ADMIN'
  | 'DRHP'
  | 'NSE'
  | 'BSE'
  | 'API_FALLBACK'
  | 'MONEYCONTROL'
  | 'CHITTORGARH';

// ------------------------------------------------------------------- helpers

/** The only accessor for an extracted field: passed-check + non-null, or null. */
export function trusted(extraction: FilingExtraction, name: string): unknown {
  const f = extraction.fields?.[name];
  if (!f) return null;
  if (f.value === null || f.value === undefined) return null;
  if (!f.check?.passed) return null;
  return f.value;
}

function num(extraction: FilingExtraction, name: string): number | null {
  const v = trusted(extraction, name);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(extraction: FilingExtraction, name: string): string | null {
  const v = trusted(extraction, name);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function bool(extraction: FilingExtraction, name: string): boolean | null {
  const v = trusted(extraction, name);
  return typeof v === 'boolean' ? v : null;
}

function list<T>(extraction: FilingExtraction, name: string): T[] {
  const v = trusted(extraction, name);
  return Array.isArray(v) ? (v as T[]) : [];
}

function byFy(extraction: FilingExtraction, name: string): Record<string, number> {
  const v = trusted(extraction, name);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
  }
  return out;
}

/** The only units a filing amount may be denominated in. */
export type FilingUnit = 'MILLION' | 'CRORE' | 'LAKH' | 'RUPEES';

const RUPEES_PER_UNIT: Record<FilingUnit, number> = {
  RUPEES: 1,
  LAKH: 100_000,
  MILLION: 1_000_000,
  CRORE: 10_000_000,
};

/**
 * STRICT unit parser — returns null for anything not recognised.
 *
 * This used to default an unknown or absent unit to millions, which is the
 * worst possible failure mode for money: an extraction that already reports
 * `fresh_issue_amount` in RUPEES (or omits `unit` entirely) had that figure
 * multiplied by a million on its way to `ipos.issue_size`. A null here means
 * every unit-dependent write is SKIPPED with a reason, never guessed.
 */
export function parseFilingUnit(unit: string | null | undefined): FilingUnit | null {
  switch ((unit || '').trim().toLowerCase()) {
    case 'million':
    case 'millions':
      return 'MILLION';
    case 'crore':
    case 'crores':
      return 'CRORE';
    case 'lakh':
    case 'lakhs':
      return 'LAKH';
    case 'rupee':
    case 'rupees':
      return 'RUPEES';
    default:
      return null;
  }
}

/** Published unit -> rupees. Filing money fields are amounts, never per-share. */
export function toRupees(value: number, unit: FilingUnit): number {
  return value * RUPEES_PER_UNIT[unit];
}

/** Published unit -> INR crore (the unit financial_data is denominated in). */
export function toCrore(value: number, unit: FilingUnit): number {
  return toRupees(value, unit) / RUPEES_PER_UNIT.CRORE;
}

/**
 * Convert an amount between two filing units with EXACT integer factors, so a
 * later filing reporting crores can be merged into a row already stored in
 * millions without changing what the row means.
 */
export function convertUnit(value: number, from: FilingUnit, to: FilingUnit): number {
  return (value * RUPEES_PER_UNIT[from]) / RUPEES_PER_UNIT[to];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function bump(written: Record<string, number>, table: string, n = 1): void {
  if (n <= 0) return;
  written[table] = (written[table] || 0) + n;
}

/** financial_statements.unit is NOT NULL and has no RUPEES member. */
type StatementUnit = 'MILLION' | 'LAKH' | 'CRORE';
function asStatementUnit(u: FilingUnit | null): StatementUnit | null {
  return u === 'MILLION' || u === 'LAKH' || u === 'CRORE' ? u : null;
}

/**
 * scraper_source has no RHP / PRICE_BAND_AD member; both map to DRHP, the
 * enum's authoritative-offer-document slot. See the module header.
 */
export function scraperSourceForDocType(_docType: FilingDocType): 'DRHP' {
  return 'DRHP';
}

function numOrNull(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? v.toString() : null;
}

function asNumeric(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? v.toString() : null;
}

function asCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'string' && d) return d.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fields the extractor produces with a PASSING check that have no column
 * anywhere in the schema. Reported, never silently dropped (W-09).
 */
const NO_COLUMN_FIELDS: Record<string, string> = {
  ofs_shares: 'no OFS share-count column',
  total_offer_shares_at_floor: 'no total-offer share-count column',
  total_offer_amount_at_floor: 'no floor-total-amount column (issue_size is the cap total)',
  post_offer_shares_at_floor: 'no post-offer share-count column',
  post_offer_shares_at_cap: 'no post-offer share-count column',
  issue_structure: 'issue_type enum is BOOK_BUILDING/FIXED_PRICE/HYBRID, not fresh/OFS',
  shares_monotonic: 'derived check, not a stored field',
  eps_weighted_average: 'no weighted-average-EPS column',
  industry_peer_pe_average: 'no peer-average-PE column',
  waca_secondary_transactions: 'no secondary-transaction WACA column',
  floor_multiple_of_waca_secondary: 'no secondary-WACA multiple column',
  cap_multiple_of_waca_secondary: 'no secondary-WACA multiple column',
  concentration_kpis: 'no concentration-KPI table (ipo_risk_factors.kpis needs a risk factor row)',
  cin: 'no CIN column on ipos/ipo_details',
  anchor_bid_date: 'no anchor-bid-date column',
  book_building_regulation: 'no regulation-citation column (mapped to issue_type only)',
  brlm_issues_3y_total: 'totals row; the per-BRLM rows carry the figures',
  brlm_closed_below_total: 'totals row; the per-BRLM rows carry the figures',
  promoter_name: 'covered by the promoters table',
  promoter_names: 'covered by the promoters table',
  promoter_selling_shareholders: 'no selling-shareholder table',
  financial_basis: 'mapped to financial_statements.basis, not stored separately',
  fiscal_years: 'mapped to financial_statements.fiscal_year',
  unit: 'mapped to financial_statements.unit',
  financial_plausibility_pat_not_above_revenue: 'extractor self-check, not data',
  financial_plausibility_ebitda_at_least_pat: 'extractor self-check, not data',
  financial_plausibility_yoy_ratio_within_bounds: 'extractor self-check, not data',
  financial_plausibility_eps_times_shares_matches_pat: 'extractor self-check, not data',
  financial_plausibility_unit_stated_near_table: 'extractor self-check, not data',
  eps_sign_matches_pat: 'extractor self-check, not data',
};

// ------------------------------------------------------------------ the work

export async function persistFilingExtraction(
  ipoId: string,
  extraction: FilingExtraction,
  options: PersistFilingOptions,
  deps: FilingPersisterDeps
): Promise<PersistFilingSummary> {
  const apply = options.apply === true;
  const source = scraperSourceForDocType(options.docType);
  const unit = parseFilingUnit(extraction.unit);

  const written: Record<string, number> = {};
  const skippedFailedCheck: string[] = [];
  const skippedNoColumn: string[] = [];
  const skippedNoUnit: string[] = [];
  const skippedUnitMismatch: string[] = [];
  const iposFields: string[] = [];

  /**
   * Guard for EVERY rupee/crore conversion. `unit === null` means the filing
   * did not state a unit this code understands, so the amount cannot be
   * converted at all — the write is skipped with a reason instead of being
   * silently multiplied by the old millions default.
   */
  const withUnit = <T>(field: string, fn: (u: FilingUnit) => T): T | null => {
    if (unit === null) {
      skippedNoUnit.push(`${field} (filing states no usable unit: ${String(extraction.unit)})`);
      return null;
    }
    return fn(unit);
  };

  // Every field the extractor emitted but could not vouch for is reported, so
  // the caller sees "null with a reason" rather than a silent omission.
  for (const [name, f] of Object.entries(extraction.fields || {})) {
    if (f && (f.value === null || f.value === undefined || !f.check?.passed)) {
      skippedFailedCheck.push(`${name}: ${f.check?.name ?? 'no_check'}=${f.check?.passed === true}`);
    }
  }

  const existing = await deps.ipoRepository.findById(ipoId);
  if (!existing) {
    throw new Error(`persistFilingExtraction: no IPO row for id ${ipoId}`);
  }

  // `ipos.scraper_locked` is an ADMIN "hands off this row" flag. upsertIPO
  // honours it, but this module also writes ipo_details and eight child tables
  // through repositories and a raw upsert that never see it — so a locked IPO
  // was only half-protected. Refuse the WHOLE run, before the first write.
  if ((existing as { scraperLocked?: boolean }).scraperLocked === true) {
    throw new Error(
      `persistFilingExtraction: IPO ${ipoId} (${existing.companyName}) is scraper_locked — ` +
        `refusing the entire filing write. Clear the lock in admin to allow it.`
    );
  }

  const lineage = {
    method: 'FILING_EXTRACTION',
    docType: options.docType,
    documentId: options.documentId ?? null,
    sourceSha: options.sourceSha ?? null,
    sourceDoc: extraction.source_doc ?? null,
  };

  const trackField = async (tableName: string, fieldName: string): Promise<void> => {
    if (!apply) return;
    let previousValue: string | null = null;
    let previousSource: ScraperSourceLiteral | null = null;
    try {
      const prior = await deps.fieldSources.findByField(ipoId, tableName, fieldName);
      if (prior) {
        previousValue = prior.previousValue ?? null;
        previousSource = (prior.source as ScraperSourceLiteral) ?? null;
      }
    } catch {
      // provenance is best-effort; a read failure must not lose the write
    }
    await deps.fieldSources.trackFieldUpdate({
      ipoId,
      tableName,
      fieldName,
      source,
      confidence: 100, // tier 1a: read off the filing itself, arithmetic-checked
      previousValue,
      previousSource,
      dataLineage: lineage,
      updatedBy: 'FILING_PERSISTER',
    });
  };

  // ---------------------------------------------------------------- 1. ipos
  //
  // issue_size is THE field this step exists for: the ad's total offer is
  // fresh issue + OFS AT THE CAP - the number the ad itself prints as the
  // offer size - not the share-count-derived figure the exchanges publish
  // (walk ledger W-11).
  const freshMn = num(extraction, 'fresh_issue_amount');
  const ofsAtCapMn = num(extraction, 'ofs_amount_at_cap') ?? num(extraction, 'ofs_amount');
  // The fresh issue is REQUIRED: an offer total computed from the OFS leg
  // alone silently understates the issue by the whole fresh component, so a
  // dropped fresh_issue_amount means no issue_size at all. The OFS leg is
  // optional (a pure fresh issue has none).
  const issueSizeRupees =
    freshMn !== null
      ? withUnit('ipos.issueSize', (u) => Math.round(toRupees(freshMn + (ofsAtCapMn ?? 0), u)))
      : null;

  const floor = num(extraction, 'price_band_floor');
  const cap = num(extraction, 'price_band_cap');
  const lotSize = num(extraction, 'lot_size');
  const faceValue = num(extraction, 'face_value');
  const openDate = str(extraction, 'open_date');
  const closeDate = str(extraction, 'close_date');
  const allotmentDate = str(extraction, 'basis_of_allotment_date');
  const listingDate = str(extraction, 'listing_date');
  const description = str(extraction, 'business_description');

  const scraped: Record<string, unknown> = {
    companyName: existing.companyName,
    segment: existing.segment ?? undefined,
    offeringType: existing.offeringType,
    status: existing.status,
    listingExchange:
      (existing.listingExchanges || []).length > 1
        ? 'BOTH'
        : ((existing.listingExchanges || [])[0] ?? 'BSE'),
    // upsertIPO requires open/close; fall back to the row's own so a filing
    // that did not carry them never nulls what is already there.
    openDate: openDate ?? toIso(existing.openDate),
    closeDate: closeDate ?? toIso(existing.closeDate),
  };
  if (issueSizeRupees !== null) {
    scraped.issueSize = issueSizeRupees;
    iposFields.push('issueSize');
  }
  if (floor !== null) {
    scraped.priceRangeMin = floor;
    iposFields.push('priceRangeMin');
  }
  if (cap !== null) {
    scraped.priceRangeMax = cap;
    iposFields.push('priceRangeMax');
  }
  if (lotSize !== null) {
    scraped.lotSize = Math.round(lotSize);
    iposFields.push('lotSize');
  }
  if (faceValue !== null) {
    scraped.faceValue = Math.round(faceValue);
    iposFields.push('faceValue');
  }
  if (openDate) iposFields.push('openDate');
  if (closeDate) iposFields.push('closeDate');
  if (allotmentDate) {
    scraped.allotmentDate = allotmentDate;
    iposFields.push('allotmentDate');
  }
  if (listingDate) {
    scraped.listingDate = listingDate;
    iposFields.push('listingDate');
  }
  if (description) {
    scraped.companyDescription = description;
    iposFields.push('companyDescription');
  }

  if (iposFields.length > 0) {
    if (apply) {
      await upsertIPO(
        deps.ipoRepository,
        scraped as never,
        source,
        existing as never
      );
    }
    bump(written, 'ipos', 1);
  }

  // -------------------------------------------------------- 2. ipo_details
  const details: Record<string, unknown> = {};
  const mark = (col: string, v: unknown): void => {
    if (v === null || v === undefined) return;
    details[col] = v;
  };

  mark('basisOfAllotmentDate', allotmentDate);
  mark('initiationOfRefundsDate', str(extraction, 'refund_date'));
  mark('creditOfSharesDate', str(extraction, 'credit_date'));
  mark('upiCutoffTime', str(extraction, 'upi_cutoff_time'));
  mark('designatedExchange', str(extraction, 'designated_stock_exchange'));
  mark('complianceOfficer', str(extraction, 'compliance_officer'));
  mark('companyDescription', description);
  if (faceValue !== null) mark('faceValue', faceValue.toString());
  const lotMultiple = num(extraction, 'lot_multiple');
  if (lotMultiple !== null) mark('lotMultiple', Math.round(lotMultiple));
  const preIpo = bool(extraction, 'pre_ipo_placement');
  if (preIpo !== null) mark('preIpoPlacement', preIpo);

  const qib = num(extraction, 'qib_pct');
  const nii = num(extraction, 'nii_pct');
  const retail = num(extraction, 'retail_pct');
  if (qib !== null || nii !== null || retail !== null) {
    mark('allocationPct', { qib, nii, retail });
  }

  // fresh + ofs must SUM to ipos.issue_size (both in rupees) - GitHub #8.
  // ipo_details.fresh_issue / ofs_issue are in RUPEES (they must sum to
  // ipos.issue_size, also rupees). Both are skipped when the unit is unusable.
  if (freshMn !== null) {
    mark('freshIssue', withUnit('ipo_details.freshIssue', (u) => round2(toRupees(freshMn, u)).toString()));
  }
  if (ofsAtCapMn !== null) {
    mark('ofsIssue', withUnit('ipo_details.ofsIssue', (u) => round2(toRupees(ofsAtCapMn, u)).toString()));
  }

  // The ad cites SEBI ICDR Reg 6(1)/6(2) only for a book-built offer.
  if (str(extraction, 'book_building_regulation')) mark('issueType', 'BOOK_BUILDING');

  if (Object.keys(details).length > 0) {
    // Per-field protection: an admin who hand-corrected one ipo_details column
    // must not have it overwritten by the next filing run. The raw Drizzle
    // upsert cannot see field_protection_metadata, so the payload is filtered
    // BEFORE it reaches the writer, exactly as the orchestrators do for `ipos`.
    let writable = details;
    if (deps.protectionFilter) {
      const result = await deps.protectionFilter(ipoId, 'ipo_details', details, source);
      writable = result.filtered as Record<string, unknown>;
      for (const col of Object.keys(details)) {
        if (!(col in writable)) skippedNoColumn.push(`ipo_details.${col} (field is protected)`);
      }
    }
    if (Object.keys(writable).length > 0) {
      if (apply) {
        await deps.ipoDetailsWriter.upsert(ipoId, { ...writable, dataSource: source });
        for (const col of Object.keys(writable)) await trackField('ipo_details', col);
      }
      bump(written, 'ipo_details', 1);
    }
  }

  // ------------------------------------------------- 3. financial_statements
  const basisRaw = str(extraction, 'financial_basis');
  // Every document this persister reads (price band ad, DRHP, RHP, prospectus)
  // publishes RESTATED financial information — SEBI ICDR requires it. Defaulting
  // an unlabelled block to STANDALONE was a real defect: the ad states its basis
  // and the RHP does not, so the SAME three years landed twice under two
  // different bases (6 rows for 3 fiscal years), the RHP's copy mislabelled.
  // Only an explicit "standalone"-without-"restated" label downgrades it.
  // Lowercase BEFORE matching: the label arrives from the document in whatever
  // case it was printed ("Standalone", "RESTATED STANDALONE"), and a
  // case-sensitive check silently classified "Standalone" as RESTATED.
  const basisLower = basisRaw?.toLowerCase() ?? null;
  const basis: 'RESTATED' | 'STANDALONE' =
    basisLower && basisLower.includes('standalone') && !basisLower.includes('restated')
      ? 'STANDALONE'
      : 'RESTATED';
  const unitEnum = asStatementUnit(unit);
  const revenue = byFy(extraction, 'revenue_by_fy');
  const totalIncome = byFy(extraction, 'total_income_by_fy');
  const ebitda = byFy(extraction, 'ebitda_by_fy');
  const pat = byFy(extraction, 'pat_by_fy');
  const netWorth = byFy(extraction, 'net_worth_by_fy');
  const epsBasic = byFy(extraction, 'eps_basic_by_fy');
  const epsDiluted = byFy(extraction, 'eps_diluted_by_fy');
  const opCashFlow = byFy(extraction, 'op_cash_flow_by_fy');
  const dscr = byFy(extraction, 'dscr_by_fy');
  const rent = byFy(extraction, 'rent_by_fy');

  const fyKeys = new Set<string>([
    ...Object.keys(revenue),
    ...Object.keys(totalIncome),
    ...Object.keys(ebitda),
    ...Object.keys(pat),
    ...Object.keys(netWorth),
    ...Object.keys(epsBasic),
    ...Object.keys(epsDiluted),
    ...Object.keys(opCashFlow),
  ]);

  if (!unitEnum && fyKeys.size > 0) {
    // unit is NOT NULL on the table and an unlabelled amount is a wrong number
    // waiting to render - refuse the whole block rather than guess.
    skippedNoUnit.push(
      `financial_statements (unit '${String(extraction.unit)}' is not one of MILLION/LAKH/CRORE)`
    );
  } else {
    // The repository upsert writes the WHOLE row, so a second filing that
    // carries fewer columns (the RHP has no operating-cash-flow row) would null
    // what the first filing already stored. Read the existing rows and keep any
    // value this extraction does not carry — enrich, never erase.
    const existingStatements = apply ? await deps.financialStatements.listByIpo(ipoId) : [];
    let n = 0;
    for (const fy of [...fyKeys].sort()) {
      const fiscalYear = Number(fy);
      if (!Number.isInteger(fiscalYear)) continue;
      const prior = existingStatements.find(
        (r) => r.fiscalYear === fiscalYear && r.basis === basis
      );

      // The unique key is (ipo_id, fiscal_year, basis) — it does NOT include
      // the unit. Carrying prior columns forward while stamping THIS
      // extraction's unit on the row would silently re-denominate the values
      // the earlier filing stored (an ad in millions merged with an RHP in
      // crores gave a row labelled CRORE holding million-scale figures).
      // The stored row's unit wins: incoming values are converted into it with
      // exact factors. Only an unconvertible prior unit refuses the row.
      const priorUnit = prior ? asStatementUnit(prior.unit as StatementUnit) : null;
      if (prior && priorUnit === null) {
        skippedUnitMismatch.push(
          `financial_statements FY${fiscalYear}/${basis} (stored unit '${String(prior.unit)}' unrecognised)`
        );
        continue;
      }
      const rowUnit: StatementUnit = priorUnit ?? unitEnum;
      const perShare = (m: Record<string, number>, kept: string | null): string | null =>
        m[fy] !== undefined ? m[fy].toString() : kept;
      const s = (m: Record<string, number>, col: keyof typeof prior): string | null => {
        if (m[fy] !== undefined) {
          const raw = m[fy];
          return rowUnit === unitEnum
            ? raw.toString()
            : round2(convertUnit(raw, unitEnum, rowUnit)).toString();
        }
        const kept = prior ? (prior[col] as string | null) : null;
        return kept ?? null;
      };
      if (apply) {
        await deps.financialStatements.upsert({
          ipoId,
          fiscalYear,
          basis,
          unit: rowUnit,
          revenue: s(revenue, 'revenue'),
          totalIncome: s(totalIncome, 'totalIncome'),
          ebitda: s(ebitda, 'ebitda'),
          pat: s(pat, 'pat'),
          netWorth: s(netWorth, 'netWorth'),
          // Per-share figures are NOT amounts — they are never unit-converted.
          epsBasic: perShare(epsBasic, prior?.epsBasic ?? null),
          epsDiluted: perShare(epsDiluted, prior?.epsDiluted ?? null),
          opCashFlow: s(opCashFlow, 'opCashFlow'),
          // A ratio, not an amount.
          dscr: perShare(dscr, prior?.dscr ?? null),
          rentExpense: s(rent, 'rentExpense'),
        });
      }
      n += 1;
    }
    if (n > 0) {
      bump(written, 'financial_statements', n);
      await trackField('financial_statements', 'rows');
    }
  }

  // ------------------------------------------------------- 4. ipo_valuation
  const mcapFloorMn = num(extraction, 'market_cap_at_floor');
  const mcapCapMn = num(extraction, 'market_cap_at_cap');
  const valuation: Record<string, unknown> = {};
  const vset = (k: string, v: number | null): void => {
    if (v !== null) valuation[k] = v;
  };
  vset('priceFloor', floor);
  vset('priceCap', cap);
  vset('sharesAtFloor', num(extraction, 'shares_at_floor'));
  vset('sharesAtCap', num(extraction, 'shares_at_cap'));
  // F7 UNIT CONTRACT: ipo_valuation.mcap_at_floor / mcap_at_cap are stored in
  // RUPEES, while financial_data.market_cap (below) is stored in CRORE. Same
  // source number, two different denominations — do not copy one to the other.
  if (mcapFloorMn !== null) {
    const v = withUnit('ipo_valuation.mcapAtFloor', (u) => round2(toRupees(mcapFloorMn, u)));
    if (v !== null) valuation.mcapAtFloor = v;
  }
  if (mcapCapMn !== null) {
    const v = withUnit('ipo_valuation.mcapAtCap', (u) => round2(toRupees(mcapCapMn, u)));
    if (v !== null) valuation.mcapAtCap = v;
  }
  vset('peAtFloor', num(extraction, 'pe_at_floor'));
  vset('peAtCap', num(extraction, 'pe_at_cap'));
  vset('ronwWeighted3y', num(extraction, 'weighted_average_ronw'));
  vset('faceValueMultipleFloor', num(extraction, 'floor_multiple_of_face'));
  vset('faceValueMultipleCap', num(extraction, 'cap_multiple_of_face'));

  if (Object.keys(valuation).length > 0) {
    const pricingEvent: 'PRICE_BAND_AD' | 'PROSPECTUS' =
      options.docType === 'PRICE_BAND_AD' ? 'PRICE_BAND_AD' : 'PROSPECTUS';
    if (apply) {
      await deps.ipoValuation.upsert({
        ipoId,
        pricingEvent,
        priceFloor: asNumeric(valuation.priceFloor),
        priceCap: asNumeric(valuation.priceCap),
        sharesAtFloor: asCount(valuation.sharesAtFloor),
        sharesAtCap: asCount(valuation.sharesAtCap),
        mcapAtFloor: asNumeric(valuation.mcapAtFloor),
        mcapAtCap: asNumeric(valuation.mcapAtCap),
        peAtFloor: asNumeric(valuation.peAtFloor),
        peAtCap: asNumeric(valuation.peAtCap),
        peNotAscertainableReason: null,
        ronwWeighted3y: asNumeric(valuation.ronwWeighted3y),
        faceValueMultipleFloor: asNumeric(valuation.faceValueMultipleFloor),
        faceValueMultipleCap: asNumeric(valuation.faceValueMultipleCap),
      } as never);
      await trackField('ipo_valuation', pricingEvent);
    }
    bump(written, 'ipo_valuation', 1);
  }

  // ----------------------------------------------------------- 5. promoters
  const sellers = list<{ name?: string; shares_offered?: number; waca?: number }>(
    extraction,
    'promoter_selling_shareholders'
  );
  const wacaByName = new Map<string, number>();
  for (const s of sellers) {
    if (s?.name && typeof s.waca === 'number') wacaByName.set(s.name, s.waca);
  }
  const soloWaca = num(extraction, 'promoter_waca');
  const promoterNames = list<string>(extraction, 'promoter_names');
  const names =
    promoterNames.length > 0
      ? promoterNames
      : ([str(extraction, 'promoter_name')].filter(Boolean) as string[]);

  if (names.length > 0) {
    const rows: PromoterInsert[] = names.map((name) => ({
      ipoId,
      name,
      // promoter_shares_held is the AGGREGATE promoter holding; assigning it to
      // one named promoter would invent a per-person figure the ad never
      // printed. Left null; the aggregate is reported as skipped_no_column.
      sharesHeld: null,
      waca:
        (wacaByName.get(name) ?? (names.length === 1 ? soloWaca : null))?.toString() ?? null,
      wacaLastYear: null,
      isPromoterGroup: false,
    }));
    if (apply) {
      await deps.promoters.replacePromoters(ipoId, rows);
      await trackField('promoters', 'rows');
    }
    bump(written, 'promoters', rows.length);
  }
  if (num(extraction, 'promoter_shares_held') !== null) {
    skippedNoColumn.push(
      'promoter_shares_held (aggregate promoter holding; promoters.shares_held is per-promoter)'
    );
  }

  // ------------------------------------ 6. promoter_acquisition_ranges (3Y)
  const waca3y = num(extraction, 'waca_last_3y');
  const capMult3y = num(extraction, 'cap_multiple_last_3y');
  if (waca3y !== null || capMult3y !== null) {
    if (apply) {
      await deps.promoters.replaceAcquisitionRanges(ipoId, [
        {
          ipoId,
          period: '3Y',
          waca: waca3y?.toString() ?? null,
          capMultiple: capMult3y?.toString() ?? null,
          priceLow: null,
          priceHigh: null,
        },
      ]);
      await trackField('promoter_acquisition_ranges', 'rows');
    }
    bump(written, 'promoter_acquisition_ranges', 1);
  }

  // ------------------------------------------------- 7. ipo_intermediaries
  const trackRows = list<{ brlm?: string; issues_3y?: number; closed_below?: number }>(
    extraction,
    'brlm_track_record'
  );
  const brlmNames = (existing.leadManagers || []).filter((n): n is string => !!n);
  const intermediaries: IpoIntermediaryInsert[] = brlmNames.map((name) => ({
    ipoId,
    role: 'BRLM',
    name,
    // The extractor emits SEBI registration numbers as a bare LIST with no
    // name->reg mapping. Pairing them positionally against a differently
    // sourced BRLM name list would publish a registration number against the
    // wrong firm - left null, and the list is reported as skipped.
    sebiRegNo: null,
    contactPerson: null,
    phone: null,
    email: null,
    grievanceEmail: null,
  }));
  const registrarReg = str(extraction, 'registrar_sebi_reg');
  if (existing.registrar) {
    intermediaries.push({
      ipoId,
      role: 'REGISTRAR',
      name: existing.registrar,
      // Exactly one registrar and exactly one registrar reg number: unambiguous.
      sebiRegNo: registrarReg,
      contactPerson: null,
      phone: null,
      email: null,
      grievanceEmail: null,
    });
  }
  if (list<string>(extraction, 'brlm_sebi_regs').length > 0) {
    skippedNoColumn.push('brlm_sebi_regs (no name->registration mapping in the extraction)');
  }
  if (intermediaries.length > 0) {
    if (apply) {
      await deps.intermediaries.replaceForIpo(ipoId, intermediaries);
      await trackField('ipo_intermediaries', 'rows');
    }
    bump(written, 'ipo_intermediaries', intermediaries.length);
  }

  // -------------------------------------------------- 8. brlm_track_record
  const asOfDate = str(extraction, 'rhp_filing_date');
  if (asOfDate) {
    let n = 0;
    for (const row of trackRows) {
      if (!row?.brlm) continue;
      if (apply) {
        await deps.brlmTrackRecord.upsert({
          brlmName: row.brlm,
          asOfDate,
          issues3y: typeof row.issues_3y === 'number' ? row.issues_3y : null,
          closedBelowIssuePrice: typeof row.closed_below === 'number' ? row.closed_below : null,
          sourceIpoId: ipoId,
        } as never);
      }
      n += 1;
    }
    if (n > 0) bump(written, 'brlm_track_record', n);
  } else if (trackRows.length > 0) {
    skippedFailedCheck.push('brlm_track_record: no trusted as-of date (rhp_filing_date)');
  }

  // ------------------------------------------------------ 9. peer_companies
  const peers = list<Record<string, unknown>>(extraction, 'peer_companies');
  if (peers.length > 0) {
    const peerRows = peers
      .filter((p) => typeof p.name === 'string' && (p.name as string).trim() !== '')
      .map((p) => ({
        ipoId,
        companyName: (p.name as string).trim(),
        isListed: true, // the ad's peer table lists only listed comparables
        peRatio: numOrNull(p.pe),
        eps: numOrNull(p.eps_basic),
        dilutedEps: numOrNull(p.eps_diluted),
        ronw: numOrNull(p.ronw_pct),
        nav: numOrNull(p.nav),
        pbvRatio: numOrNull(p.pb),
        dataSource: source,
        lastUpdated: new Date(),
      }));
    if (peerRows.length > 0) {
      if (apply) {
        await deps.peerCompanies.deleteByIPOId(ipoId);
        await deps.peerCompanies.batchCreate(peerRows as never);
        await trackField('peer_companies', 'rows');
      }
      bump(written, 'peer_companies', peerRows.length);
      for (const col of ['face_value', 'closing_price', 'revenue_from_operations', 'market_cap']) {
        skippedNoColumn.push(`peer_companies.${col} (no column on peer_companies)`);
      }
    }
  }

  // ----------------------------------------------------- 10. financial_data
  // The six-metric backfill's target table, folded in here so one command
  // persists a filing end to end (backfill-financials-pdf.ts remains the path
  // for IPOs with no filing extraction). financial_data is denominated in INR
  // CRORE and has FY2022/23/24 slots only - a filing reporting FY2025/FY2026
  // has nowhere to put those years (W-09 inventory gap).
  const latestFy = [...fyKeys].map(Number).filter(Number.isInteger).sort((a, b) => b - a)[0];
  const fd: Record<string, unknown> = { ipoId };
  let fdFields = 0;
  const putCrore = (col: string, m: Record<string, number>, fy: number): void => {
    const v = m[String(fy)];
    if (v === undefined) return;
    const c = withUnit(`financial_data.${col}`, (u) => round2(toCrore(v, u)));
    if (c === null) return;
    fd[col] = c.toString();
    fdFields += 1;
  };
  for (const fy of [2022, 2023, 2024]) {
    putCrore(`revenueFy${fy}`, revenue, fy);
    putCrore(`profitFy${fy}`, pat, fy);
    putCrore(`ebitdaFy${fy}`, ebitda, fy);
    putCrore(`totalIncomeFy${fy}`, totalIncome, fy);
  }
  for (const fy of [...fyKeys].map(Number).filter((f) => f > 2024)) {
    skippedNoColumn.push(`financial_data FY${fy} (columns exist only for FY2022-FY2024)`);
  }
  if (latestFy !== undefined) {
    const lk = String(latestFy);
    if (netWorth[lk] !== undefined) {
      const nw = withUnit('financial_data.netWorth', (u) => round2(toCrore(netWorth[lk], u)));
      if (nw !== null) {
        fd.netWorth = nw.toString();
        fdFields += 1;
      }
    }
    if (epsBasic[lk] !== undefined) {
      fd.eps = round2(epsBasic[lk]).toString(); // per-share: never unit-scaled
      fdFields += 1;
    }
    const ronw = byFy(extraction, 'ronw_by_fy');
    if (ronw[lk] !== undefined) {
      fd.ronw = round2(ronw[lk]).toString();
      fdFields += 1;
    }
  }
  const peCap = num(extraction, 'pe_at_cap');
  if (peCap !== null) {
    fd.peRatio = peCap.toString();
    fdFields += 1;
  }
  if (mcapCapMn !== null) {
    // F7 UNIT CONTRACT: CRORE here, rupees in ipo_valuation.mcap_at_cap.
    const mc = withUnit('financial_data.marketCap', (u) => round2(toCrore(mcapCapMn, u)));
    if (mc !== null) {
      fd.marketCap = mc.toString();
      fdFields += 1;
    }
  }
  const preHold = num(extraction, 'promoter_holding_pre_pct');
  if (preHold !== null) {
    fd.promoterHoldingPreIssue = preHold.toString();
    fdFields += 1;
  }
  const postHold = num(extraction, 'promoter_holding_post_pct_at_cap');
  if (postHold !== null) {
    fd.promoterHoldingPostIssue = postHold.toString();
    fdFields += 1;
  }
  if (fdFields > 0) {
    if (apply) {
      await deps.financialData.upsert(fd as never);
      for (const col of Object.keys(fd)) {
        if (col !== 'ipoId') await trackField('financial_data', col);
      }
    }
    bump(written, 'financial_data', 1);
  }

  // ------------------------------------------------- unmapped-but-extracted
  for (const [field, reason] of Object.entries(NO_COLUMN_FIELDS)) {
    if (trusted(extraction, field) !== null) skippedNoColumn.push(`${field} (${reason})`);
  }

  logger.info(
    { ipoId, docType: options.docType, apply, written },
    '[FilingPersister] filing extraction persisted'
  );

  return {
    written,
    skipped_failed_check: skippedFailedCheck.sort(),
    skipped_no_column: [...new Set(skippedNoColumn)].sort(),
    skipped_no_unit: [...new Set(skippedNoUnit)].sort(),
    skipped_unit_mismatch: [...new Set(skippedUnitMismatch)].sort(),
    ipos_fields: iposFields,
    applied: apply,
  };
}
