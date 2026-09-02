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
}

export type MetricSeries = Record<string, Record<string, number> | null | undefined>;

/** The default tolerance of the python original: 1%. */
export const CROSS_DOC_TOLERANCE = 0.01;

export function checkCrossDocumentAgreement(
  a: MetricSeries | null | undefined,
  b: MetricSeries | null | undefined,
  tol: number = CROSS_DOC_TOLERANCE,
  labelA = 'PRICE_BAND_AD',
  labelB = 'RHP'
): AgreementResult {
  const seriesA = a ?? {};
  const seriesB = b ?? {};
  const disagreements: AgreementDisagreement[] = [];
  let compared = 0;

  for (const metric of Object.keys(seriesA).sort()) {
    const sa = seriesA[metric];
    const sb = seriesB[metric];
    if (!sa || !sb) continue;
    for (const year of Object.keys(sa).sort()) {
      if (!(year in sb)) continue;
      const va = Number(sa[year]);
      const vb = Number(sb[year]);
      if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
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
  for (const metric of disagreeingMetrics) {
    if (metric in fields) delete fields[metric];
    // eps_basic disagreeing also invalidates the diluted series it is read with.
    if (metric === 'eps_basic_by_fy' && 'eps_diluted_by_fy' in fields) {
      delete fields.eps_diluted_by_fy;
    }
  }
  return { ...extraction, fields };
}
