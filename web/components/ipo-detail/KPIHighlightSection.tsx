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

export interface KPIHighlightSectionProps {
  financialData: FinancialData | null;
  ipoData: IPOData | null;
}

/**
 * Main KPI Highlight Section Component
 */
export function KPIHighlightSection({
  financialData,
  ipoData,
}: KPIHighlightSectionProps) {
  // Case 1: No data available
  if (!financialData || !ipoData) {
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
  } = financialData;

  const { priceRangeMax, issueSize } = ipoData;

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

  if (!hasAnyData) {
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
