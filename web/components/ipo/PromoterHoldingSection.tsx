/**
 * PromoterHoldingSection Component (Story 11.9)
 * Displays promoter shareholding percentages before and after IPO
 * with equity dilution calculation and visual indicators
 */

'use client';

import { AlertCircle, TrendingDown, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { computeEquityDilution } from '@/lib/utils/kpi-calculations';

/** One promoter as named in the offer document (`promoters`). */
export interface PromoterRowView {
  name: string;
  sharesHeld: number | null;
  /** Weighted average cost of acquisition per share, in rupees. */
  waca: string | null;
  isPromoterGroup?: boolean;
}

/** Promoter acquisitions over a look-back window (`promoter_acquisition_ranges`). */
export interface PromoterAcquisitionRangeView {
  period: string;
  waca: string | null;
  capMultiple: string | null;
  priceLow?: string | null;
  priceHigh?: string | null;
}

interface PromoterHoldingSectionProps {
  promoterHoldingPreIssue: number | null;
  promoterHoldingPostIssue: number | null;
  /** Named promoters with shares held and cost per share. */
  promoters?: PromoterRowView[];
  /** 1Y / 18M / 3Y acquisition windows with their cost and cap multiple. */
  acquisitionRanges?: PromoterAcquisitionRangeView[];
  /** Whether a pre-IPO placement was made (`ipo_details.pre_ipo_placement`). */
  preIpoPlacement?: boolean | null;
  /** Aggregate promoter holding (`ipo_details.promoter_shares_held`). */
  promoterSharesHeld?: number | null;
  /**
   * Promoter / promoter-group share transactions of 1% or more since the DRHP
   * (`ipo_details.promoter_group_transactions_since_drhp`). An EMPTY array is a
   * real answer ("there were none") and renders as such; null renders nothing.
   */
  promoterGroupTransactionsSinceDrhp?: { summary: string }[] | null;
}

const PERIOD_LABELS: Record<string, string> = {
  '1Y': 'Last 1 year',
  '18M': 'Last 18 months',
  '3Y': 'Last 3 years',
};

function parseNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function rupees(v: string | number | null | undefined): string {
  const n = parseNum(v);
  return n === null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Get color class for dilution percentage
 * Green: < 10% (low dilution)
 * Yellow: 10-20% (moderate dilution)
 * Red: > 20% (high dilution)
 */
function getDilutionColorClass(dilution: number): string {
  if (dilution < 10) {
    return 'text-green-600 dark:text-green-400';
  } else if (dilution <= 20) {
    return 'text-yellow-600 dark:text-yellow-400';
  } else {
    return 'text-red-600 dark:text-red-400';
  }
}

/**
 * Get background color class for dilution percentage
 */
function getDilutionBgClass(dilution: number): string {
  if (dilution < 10) {
    return 'bg-green-50 dark:bg-green-950/20';
  } else if (dilution <= 20) {
    return 'bg-yellow-50 dark:bg-yellow-950/20';
  } else {
    return 'bg-red-50 dark:bg-red-950/20';
  }
}

/**
 * Main Promoter Holding Section Component
 */
export function PromoterHoldingSection({
  promoterHoldingPreIssue,
  promoterHoldingPostIssue,
  promoters = [],
  acquisitionRanges = [],
  preIpoPlacement = null,
  promoterSharesHeld = null,
  promoterGroupTransactionsSinceDrhp = null,
}: PromoterHoldingSectionProps) {
  const hasPromoterRows = promoters.length > 0;
  const hasRanges = acquisitionRanges.length > 0;

  // Case 1: no percentages AND no named promoters - show "not available"
  if (
    promoterHoldingPreIssue === null &&
    promoterHoldingPostIssue === null &&
    !hasPromoterRows &&
    !hasRanges
  ) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center gap-3 text-center py-6">
            <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Promoter Holding Data Not Available
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Promoter shareholding information is not yet available for this IPO.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate dilution with a plausibility guard: returns null (→ section hidden) for
  // implausible inputs so a bad-unit row can never render an absurd value like "2152%"
  // (blind-QA finding, #89).
  const dilution = computeEquityDilution(promoterHoldingPreIssue, promoterHoldingPostIssue);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle>Promoter Holding Pattern</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Pre-Issue and Post-Issue Holdings */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Pre-Issue Holding */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <p className="text-sm font-medium text-muted-foreground">
                Promoter Holding Pre Issue
              </p>
              {promoterHoldingPreIssue !== null ? (
                <p className="text-2xl font-bold text-foreground">
                  {promoterHoldingPreIssue.toFixed(2)}%
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Pre-IPO data not available
                </p>
              )}
            </div>

            {/* Post-Issue Holding */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <p className="text-sm font-medium text-muted-foreground">
                Promoter Holding Post Issue
              </p>
              {promoterHoldingPostIssue !== null ? (
                <p className="text-2xl font-bold text-foreground">
                  {promoterHoldingPostIssue.toFixed(2)}%
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Post-IPO data not available yet
                </p>
              )}
            </div>
          </div>

          {/* Equity Dilution — a neutral stat panel (matches the two above), not
              a colored alert box; only the number carries semantic color (R18 #15) */}
          {dilution !== null && (
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium text-foreground">
                      Equity Dilution
                    </p>
                    <p
                      className={`text-2xl font-bold ${getDilutionColorClass(dilution)}`}
                    >
                      {dilution.toFixed(2)}%
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Equity dilution represents the reduction in promoter shareholding
                    due to the IPO. Lower dilution indicates stronger promoter
                    commitment.
                    {dilution < 10 && (
                      <span className="font-medium text-green-700 dark:text-green-300">
                        {' '}
                        Low dilution suggests high promoter confidence.
                      </span>
                    )}
                    {dilution >= 10 && dilution <= 20 && (
                      <span className="font-medium text-yellow-700 dark:text-yellow-300">
                        {' '}
                        Moderate dilution is common in IPOs.
                      </span>
                    )}
                    {dilution > 20 && (
                      <span className="font-medium text-red-700 dark:text-red-300">
                        {' '}
                        High dilution may indicate significant fundraising needs.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Named promoters and their cost of acquisition - the figures the
              offer document publishes alongside the holding percentages. */}
          {hasPromoterRows && (
            <div className="overflow-x-auto">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">Promoters</p>
                {promoterSharesHeld !== null && promoterSharesHeld !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Total shares held:{' '}
                    <span className="font-medium text-foreground">
                      {promoterSharesHeld.toLocaleString('en-IN')}
                    </span>
                  </p>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="py-3 px-4 text-left font-semibold">Name</th>
                    <th className="py-3 px-4 text-right font-semibold">Shares held</th>
                    <th className="py-3 px-4 text-right font-semibold">Cost per share</th>
                  </tr>
                </thead>
                <tbody>
                  {promoters.map((p) => (
                    <tr key={p.name} className="border-b last:border-0">
                      <td className="py-3 px-4 font-medium">
                        {p.name}
                        {p.isPromoterGroup && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (promoter group)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {p.sharesHeld !== null && p.sharesHeld !== undefined
                          ? p.sharesHeld.toLocaleString('en-IN')
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">{rupees(p.waca)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {promoterGroupTransactionsSinceDrhp && (
                <div className="mt-4 rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-semibold mb-1">
                    Promoter-group transactions since the DRHP
                  </p>
                  {promoterGroupTransactionsSinceDrhp.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      None disclosed of 1% or more of the paid-up equity share capital.
                    </p>
                  ) : (
                    <ul className="list-disc pl-4 space-y-1">
                      {promoterGroupTransactionsSinceDrhp.map((t) => (
                        <li key={t.summary} className="text-xs text-muted-foreground">
                          {t.summary}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Acquisitions in the look-back windows SEBI requires the issuer to
              disclose, with the cap price expressed as a multiple of the cost. */}
          {hasRanges && (
            <div className="overflow-x-auto">
              <p className="text-sm font-semibold mb-3">
                Promoter acquisitions before the offer
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="py-3 px-4 text-left font-semibold">Period</th>
                    <th className="py-3 px-4 text-right font-semibold">
                      Weighted average cost
                    </th>
                    <th className="py-3 px-4 text-right font-semibold">
                      Cap price as a multiple
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {acquisitionRanges.map((r) => (
                    <tr key={r.period} className="border-b last:border-0">
                      <td className="py-3 px-4 font-medium">
                        {PERIOD_LABELS[r.period] ?? r.period}
                      </td>
                      <td className="py-3 px-4 text-right">{rupees(r.waca)}</td>
                      <td className="py-3 px-4 text-right">
                        {parseNum(r.capMultiple) !== null
                          ? `${parseNum(r.capMultiple)!.toFixed(2)}x`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preIpoPlacement !== null && (
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm font-medium text-muted-foreground">
                Pre-IPO placement
              </p>
              <p className="text-lg font-bold text-foreground">
                {preIpoPlacement ? 'Yes' : 'No'}
              </p>
            </div>
          )}

          {/* Helper Text */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> Promoter holding data is sourced from the
              company&apos;s DRHP/RHP documents. Post-issue percentages reflect the
              shareholding after dilution from the public offering.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
