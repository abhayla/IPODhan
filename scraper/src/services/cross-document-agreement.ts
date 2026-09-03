/**
 * Cross-document agreement gate (walk step G4, W-45).
 *
 * `scraper/scripts/extract_financials_pdf.py::check_cross_document_agreement`
 * has had no caller since it was written. This is a FAITHFUL TypeScript
 * reimplementation of that function's rule and tolerance, NOT a bridge call:
 * the check is twenty lines of pure numeric comparison over data the persist
 * step already holds in memory, so spawning python to re-read two JSON files
 * would add a process, a serialisation round trip and a second failure mode for
 * no behavioural gain. The rule and the 1% default tolerance are copied exactly
 * (relative difference against the larger magnitude, so a sign flip or a
 * near-zero value cannot slip through a fixed epsilon).
 *
 * WHY IT MATTERS: the price band advertisement and the RHP are published by the
 * same issuer, on the same day, off the same restated accounts. If FY26 PAT
 * differs between them, one of the two was MIS-PARSED — and there is no way to
 * tell which. So neither series is written.
 */

import { convertUnit, type FilingUnit } from './filing-persister.js';

export interface AgreementDisagreement {
  metric: string;
  fiscalYear: string;
  valueA: number;
  valueB: number;
  relativeDifference: number;
}

export interface AgreementResult {
  agree: boolean;
  detail: string;
  /** Metric names to withhold from BOTH documents' writes. */
  disagreeingMetrics: string[];
  disagreements: AgreementDisagreement[];
  comparedCount: number;
  /**
   * Set when the comparison could not be MADE because one document's unit is
   * unparseable. Not an agreement and not a disagreement — the caller must
   * report it and withhold rather than assume either.
   */
  skipped_cross_document_unit_unknown?: string;
}

export type MetricSeries = Record<string, Record<string, number> | null | undefined>;

/** The default tolerance of the python original: 1%. */
export const CROSS_DOC_TOLERANCE = 0.01;

/**
 * Metrics that are PER-SHARE or a RATIO, not an amount. They are exempt from
 * unit conversion: EPS of Rs 12.78 is Rs 12.78 whether the table beside it is
 * printed in millions or crores, and multiplying it by 10 to "convert" it would
 * manufacture a disagreement out of two documents that agree perfectly.
 */
const PER_SHARE_METRICS = new Set(['eps_basic_by_fy', 'eps_diluted_by_fy', 'dscr_by_fy']);

export function checkCrossDocumentAgreement(
  a: MetricSeries | null | undefined,
  b: MetricSeries | null | undefined,
  tol: number = CROSS_DOC_TOLERANCE,
  labelA = 'PRICE_BAND_AD',
  labelB = 'RHP',
  // MAJOR-3: the two documents need not publish in the same unit. The ad may
  // print lakhs where the RHP prints millions; comparing the raw numbers then
  // reports a 10x "disagreement" between two documents that agree exactly, and
  // withholds correct data. Amounts are converted to a common unit first.
  unitA?: FilingUnit | null,
  unitB?: FilingUnit | null
): AgreementResult {
  const seriesA = a ?? {};
  const seriesB = b ?? {};

  // A unit is REQUIRED once either side supplies one: comparing a converted
  // series against an unconvertible one is exactly the silent mistake this
  // guards. Both absent means the caller is comparing pre-normalised numbers.
  const unitsSupplied = unitA !== undefined || unitB !== undefined;
  if (unitsSupplied && (!unitA || !unitB)) {
    const which = !unitA ? labelA : labelB;
    return {
      agree: false,
      detail: `cannot compare: ${which} states no unit this code can parse`,
      disagreeingMetrics: [],
      disagreements: [],
      comparedCount: 0,
      skipped_cross_document_unit_unknown: `${which} has no parseable unit`,
    };
  }
  const disagreements: AgreementDisagreement[] = [];
  let compared = 0;

  for (const metric of Object.keys(seriesA).sort()) {
    const sa = seriesA[metric];
    const sb = seriesB[metric];
    if (!sa || !sb) continue;
    for (const year of Object.keys(sa).sort()) {
      if (!(year in sb)) continue;
      const rawA = Number(sa[year]);
      const rawB = Number(sb[year]);
      if (!Number.isFinite(rawA) || !Number.isFinite(rawB)) continue;
      // Amounts are brought onto document A's unit; per-share figures and
      // ratios are compared as printed.
      const convertible = unitA && unitB && !PER_SHARE_METRICS.has(metric);
      const va = rawA;
      const vb = convertible ? convertUnit(rawB, unitB, unitA) : rawB;
      compared += 1;
      const denom = Math.max(Math.abs(va), Math.abs(vb), 1e-9);
      const rel = Math.abs(va - vb) / denom;
      if (rel > tol) {
        disagreements.push({
          metric,
          fiscalYear: year,
          valueA: va,
          valueB: vb,
          relativeDifference: rel,
        });
      }
    }
  }

  if (compared === 0) {
    return {
      agree: true,
      detail: 'no overlapping metric/year between the two documents',
      disagreeingMetrics: [],
      disagreements: [],
      comparedCount: 0,
    };
  }
  if (disagreements.length > 0) {
    return {
      agree: false,
      detail: disagreements
        .map(
          (d) =>
            `${d.metric} ${d.fiscalYear}: ${d.valueA} (${labelA}) vs ${d.valueB} (${labelB}) — ` +
            `${(d.relativeDifference * 100).toFixed(2)}% apart`
        )
        .join('; '),
      disagreeingMetrics: [...new Set(disagreements.map((d) => d.metric))].sort(),
      disagreements,
      comparedCount: compared,
    };
  }
  return {
    agree: true,
    detail: `${compared} values agree within ${(tol * 100).toFixed(1)}%`,
    disagreeingMetrics: [],
    disagreements: [],
    comparedCount: compared,
  };
}

/** The metric series the two documents both publish and that we compare. */
export const CROSS_DOC_METRICS = [
  'revenue_by_fy',
  'pat_by_fy',
  'eps_basic_by_fy',
] as const;

interface ExtractionLike {
  fields?: Record<string, { value: unknown; check?: { passed?: boolean } | null }>;
}

/** Pull the comparable series out of an extraction, trusted fields only. */
export function comparableSeries(extraction: ExtractionLike): MetricSeries {
  const out: MetricSeries = {};
  for (const metric of CROSS_DOC_METRICS) {
    const f = extraction.fields?.[metric];
    if (!f || !f.check?.passed || f.value === null || typeof f.value !== 'object') continue;
    const series: Record<string, number> = {};
    for (const [y, v] of Object.entries(f.value as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) series[y] = v;
    }
    if (Object.keys(series).length > 0) out[metric] = series;
  }
  return out;
}

/**
 * The full financial block. A disagreement on ANY compared metric condemns the
 * WHOLE block, because every one of these is read off the same restated summary
 * table: if the PAT column was mis-parsed, the total-income and EBITDA columns
 * beside it were read from the same mis-parsed table and cannot be trusted
 * either. Withholding only the compared series left the un-compared neighbours
 * (total income, EBITDA, net worth, operating cash flow) to ship as fact.
 */
export const FINANCIAL_BLOCK_METRICS = [
  'revenue_by_fy',
  'total_income_by_fy',
  'ebitda_by_fy',
  'pat_by_fy',
  'net_worth_by_fy',
  'eps_basic_by_fy',
  'eps_diluted_by_fy',
  'op_cash_flow_by_fy',
  'dscr_by_fy',
  'rent_by_fy',
  'ronw_by_fy',
] as const;

/**
 * What the paired (--json-ad + --json-rhp) run should DO with an agreement
 * result. Extracted as a pure function so the decision is testable without
 * running the CLI, which is exactly how the bug it encodes survived:
 *
 * On `skipped_cross_document_unit_unknown` the script printed REFUSED and then
 * carried on. `disagreeingMetrics` is EMPTY in that case (nothing was compared,
 * so nothing can be blamed on a metric), so `withholdDisagreeingMetrics` was a
 * no-op and BOTH documents persisted in full — the opposite of what the word
 * REFUSED on the console told the operator. An unknown unit means the two
 * documents could not be compared at all; that is a reason to write neither,
 * not a reason to write both.
 */
export interface PairedPersistDecision {
  /** Persist the two documents at all? */
  proceed: boolean;
  /** Process exit code the CLI must use. */
  exitCode: number;
  /** Operator-facing reason, null when proceeding cleanly. */
  reason: string | null;
  /** Metrics to withhold when proceeding after an ordinary disagreement. */
  withhold: string[];
}

export function decidePairedPersist(agreement: AgreementResult): PairedPersistDecision {
  if (agreement.skipped_cross_document_unit_unknown) {
    return {
      proceed: false,
      exitCode: 1,
      reason:
        `${agreement.skipped_cross_document_unit_unknown} - the two documents cannot be ` +
        'compared, so NEITHER is persisted.',
      withhold: [],
    };
  }
  if (!agreement.agree) {
    // An ordinary disagreement is still persistable: the documents agree about
    // everything except the financial block, which is withheld from both.
    return {
      proceed: true,
      exitCode: 0,
      reason: agreement.detail,
      withhold: agreement.disagreeingMetrics,
    };
  }
  return { proceed: true, exitCode: 0, reason: null, withhold: [] };
}

/** Any disagreement expands to the whole financial block (MOD-7). */
export function expandWithheldMetrics(disagreeingMetrics: string[]): string[] {
  return disagreeingMetrics.length === 0 ? [] : [...FINANCIAL_BLOCK_METRICS];
}

/**
 * Strip every disagreeing metric from an extraction so the persister cannot
 * write it. The whole SERIES goes, not just the offending year: if FY26 PAT was
 * mis-parsed, the FY25 and FY24 figures from the same mis-read table cannot be
 * trusted either.
 */
export function withholdDisagreeingMetrics<T extends ExtractionLike>(
  extraction: T,
  disagreeingMetrics: string[]
): T {
  if (disagreeingMetrics.length === 0) return extraction;
  const fields = { ...(extraction.fields ?? {}) };
  for (const metric of expandWithheldMetrics(disagreeingMetrics)) {
    if (metric in fields) delete fields[metric];
  }
  return { ...extraction, fields };
}
