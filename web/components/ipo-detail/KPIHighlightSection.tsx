/**
 * KPIHighlightSection Component (Story 11.11)
 * Displays critical financial KPIs in a prominent, visually distinct section
 * Features:
 * - 6 key metrics (Market Cap, ROE, RoNW, P/BV, EPS Comparison, P/E Comparison)
 * - Responsive grid layout (3 cols → 2 cols → 1 col)
 * - Pre/Post IPO comparisons with change percentages
 * - Color-coded indicators
 */

'use client';

import { Building2, TrendingUp, DollarSign, BarChart, Banknote, Signal, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KPICard } from './KPICard';
import { KPIComparisonCard } from './KPIComparisonCard';
import {
  calculatePreIPO_PE,
  calculatePostIPO_PE,
  calculateEPSChange,
  calculatePEChange,
  calculatePriceToBook,
} from '@/lib/utils/kpi-calculations';
import {
  formatMarketCap,
  formatPercentage,
  formatRatio,
  formatEPS,
  formatPE,
} from '@/lib/utils/kpi-formatters';

export interface FinancialData {
  marketCap?: number | null;
  preIpoEps?: number | null;
  postIpoEps?: number | null;
  ronw?: number | null;
  roe?: number | null;
  netWorth?: number | null;
}

export interface IPOData {
  priceRangeMax?: number | null;
  issueSize?: number | null;
}

/** One fiscal year of statements, for the DSCR / rent / basis strip. */
export interface StatementKpiView {
  fiscalYear: number;
  basis: string;
  unit: string;
  dscr: string | null;
  rentExpense: string | null;
}

/** A concentration percentage stated in a risk factor (`ipo_risk_factors.kpis`). */
export interface ConcentrationKpiView {
  label: string;
  valuePct: number;
  fiscalYear: number | null;
}

export interface KPIHighlightSectionProps {
  financialData: FinancialData | null;
  ipoData: IPOData | null;
  /** Per-year statement extras (DSCR, rent, reporting basis). */
  statements?: StatementKpiView[];
  /** Customer / product / geography concentration, from the risk factors. */
  concentrationKpis?: ConcentrationKpiView[];
}

const UNIT_DIVISOR: Record<string, number> = { MILLION: 10, LAKH: 100, CRORE: 1 };

function toNumberOrNull(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Main KPI Highlight Section Component
 */
export function KPIHighlightSection({
  financialData,
  ipoData,
  statements = [],
  concentrationKpis = [],
}: KPIHighlightSectionProps) {
  const statementExtras = (
    <StatementAndConcentrationKpis
      statements={statements}
      concentrationKpis={concentrationKpis}
    />
  );
  const hasExtras =
    statements.some((s) => s.dscr !== null || s.rentExpense !== null || Boolean(s.basis)) ||
    concentrationKpis.length > 0;

  // Case 1: No data available
  if ((!financialData || !ipoData) && !hasExtras) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center gap-3 text-center py-6">
            <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                KPI Data Not Available
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Key performance indicators are not yet available for this IPO.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Extract values
  const {
    marketCap,
    preIpoEps,
    postIpoEps,
    ronw,
    roe,
    netWorth,
  } = financialData ?? ({} as FinancialData);

  const { priceRangeMax, issueSize } = ipoData ?? ({} as IPOData);

  // Calculate derived metrics
  const preIPO_PE = calculatePreIPO_PE(priceRangeMax ?? null, preIpoEps ?? null);
  const postIPO_PE = calculatePostIPO_PE(priceRangeMax ?? null, postIpoEps ?? null);
  const epsChange = calculateEPSChange(preIpoEps ?? null, postIpoEps ?? null);
  const peChange = calculatePEChange(preIPO_PE, postIPO_PE);

  // Calculate P/BV (Price-to-Book Value)
  // Note: This is a simplified calculation. Ideally, we'd need total shares
  // For now, we'll use issueSize and priceRangeMax as a proxy
  const totalShares = issueSize && priceRangeMax
    ? issueSize / priceRangeMax // issueSize is in rupees (GitHub #9); shares = size / price
    : null;
  const priceToBook = calculatePriceToBook(priceRangeMax ?? null, netWorth ?? null, totalShares);

  // Check if any data is available
  const hasAnyData =
    marketCap !== null &&
    marketCap !== undefined ||
    roe !== null && roe !== undefined ||
    ronw !== null && ronw !== undefined ||
    priceToBook !== null ||
    preIpoEps !== null && preIpoEps !== undefined ||
    postIpoEps !== null && postIpoEps !== undefined ||
    preIPO_PE !== null ||
    postIPO_PE !== null;

  if (!hasAnyData && !hasExtras) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center gap-3 text-center py-6">
            <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                KPI Data Not Available
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Financial metrics are being updated. Please check back later.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-xl">Key Performance Indicators</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Critical financial metrics to evaluate the company&apos;s health and IPO valuation
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* 1. Market Capitalization */}
          <KPICard
            icon={Building2}
            title="Market Capitalization"
            value={formatMarketCap(marketCap)}
            tooltip="Post-IPO market capitalization based on issue price. This represents the total market value of the company's outstanding shares after the IPO."
          />

          {/* 2. Return on Equity (ROE) */}
          <KPICard
            icon={TrendingUp}
            title="Return on Equity (ROE)"
            value={formatPercentage(roe ? Number(roe) : null)}
            tooltip="Return on Equity - measures profitability relative to shareholder equity. Higher ROE indicates better efficiency in generating profits from investments."

          />

          {/* 3. Return on Net Worth (RoNW) */}
          <KPICard
            icon={DollarSign}
            title="Return on Net Worth (RoNW)"
            value={formatPercentage(ronw ? Number(ronw) : null)}
            tooltip="Return on Net Worth - net profit as percentage of net worth. Similar to ROE, it shows how effectively the company uses its net worth to generate profits."

          />

          {/* 4. Price-to-Book Value (P/BV) */}
          <KPICard
            icon={Banknote}
            title="Price-to-Book Value"
            value={formatRatio(priceToBook)}
            tooltip="Price-to-Book Value ratio - market price relative to book value. A ratio > 1 means the market values the company higher than its book value."

          />

          {/* 5. EPS Comparison (Pre vs Post) */}
          <KPIComparisonCard
            icon={Signal}
            title="EPS Comparison"
            preLabel="Pre-IPO EPS"
            preValue={formatEPS(preIpoEps ? Number(preIpoEps) : null)}
            postLabel="Post-IPO EPS"
            postValue={formatEPS(postIpoEps ? Number(postIpoEps) : null)}
            changePercent={epsChange}
            tooltip="Earnings Per Share comparison before and after IPO. This shows the impact of IPO dilution on per-share earnings. Higher post-IPO EPS is generally positive."

          />

          {/* 6. P/E Ratio Comparison (Pre vs Post) */}
          <KPIComparisonCard
            icon={BarChart}
            title="P/E Ratio Comparison"
            preLabel="Pre-IPO P/E"
            preValue={formatPE(preIPO_PE)}
            postLabel="Post-IPO P/E"
            postValue={formatPE(postIPO_PE)}
            changePercent={peChange}
            tooltip="Price-to-Earnings ratio comparison before and after IPO. Lower post-IPO P/E (due to dilution) is generally viewed positively as it indicates better valuation for new investors."

            invertColors={true}
          />
        </div>

        {/* Extras the offer document publishes that the six cards above do not
            carry: debt service cover, rent, the reporting basis, and the
            concentration percentages quoted in the risk factors. */}
        {statementExtras}

        {/* Footer Note */}
        <div className="mt-6 text-xs text-muted-foreground border-t pt-4">
          <p>
            <strong>Note:</strong> KPI data is calculated based on financial statements from the company&apos;s DRHP/RHP documents.
            Pre-IPO metrics reflect the company&apos;s position before the offering, while post-IPO metrics account for dilution
            from new shares issued. All values are approximate and should be used for informational purposes only.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * DSCR / rent / reporting basis per fiscal year, plus the concentration
 * percentages the risk factors state. Renders nothing when neither exists.
 */
function StatementAndConcentrationKpis({
  statements,
  concentrationKpis,
}: {
  statements: StatementKpiView[];
  concentrationKpis: ConcentrationKpiView[];
}) {
  const years = [...statements].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const hasDscr = years.some((y) => toNumberOrNull(y.dscr) !== null);
  const hasRent = years.some((y) => toNumberOrNull(y.rentExpense) !== null);
  const bases = Array.from(new Set(years.map((y) => y.basis).filter(Boolean)));

  if (!hasDscr && !hasRent && bases.length === 0 && concentrationKpis.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 space-y-4 border-t pt-6">
      {(hasDscr || hasRent) && (
        <div className="overflow-x-auto">
          <p className="text-sm font-semibold mb-3">Other reported metrics</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="py-3 px-4 text-left font-semibold">Metric</th>
                {years.map((y) => (
                  <th key={y.fiscalYear} className="py-3 px-4 text-right font-semibold">
                    FY{y.fiscalYear}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hasDscr && (
                <tr className="border-b last:border-0">
                  <td className="py-3 px-4">Debt service coverage ratio (DSCR)</td>
                  {years.map((y) => {
                    const v = toNumberOrNull(y.dscr);
                    return (
                      <td key={y.fiscalYear} className="py-3 px-4 text-right font-medium">
                        {v === null ? '—' : v.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              )}
              {hasRent && (
                <tr className="border-b last:border-0">
                  <td className="py-3 px-4">Rent expense (₹ Cr)</td>
                  {years.map((y) => {
                    const v = toNumberOrNull(y.rentExpense);
                    const divisor = UNIT_DIVISOR[y.unit] ?? 1;
                    return (
                      <td key={y.fiscalYear} className="py-3 px-4 text-right font-medium">
                        {v === null
                          ? '—'
                          : (v / divisor).toLocaleString('en-IN', {
                              maximumFractionDigits: 2,
                            })}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {bases.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Reported on a{' '}
          <strong>{bases.map((b) => b.toLowerCase()).join(' / ')}</strong> basis.
        </p>
      )}

      {concentrationKpis.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-3">Concentration</p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {concentrationKpis.map((k, i) => (
              <div key={`${k.label}-${i}`} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  {k.label}
                  {k.fiscalYear ? ` (FY${k.fiscalYear})` : ''}
                </p>
                <p className="text-lg font-bold">{k.valuePct.toFixed(2)}%</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
