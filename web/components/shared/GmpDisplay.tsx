/**
 * GmpDisplay — the rich GMP cell (spec richness layer): latest ₹ value colored
 * by sign, a movement trend arrow vs the prior snapshot, a 30-day sparkline, and
 * a freshness stamp ("2h ago"). This answers the persona's "GMP as of when?"
 * trust question that a bare "+₹44" leaves open. Missing GMP → honest em dash.
 */

import { ArrowUp, ArrowDown } from 'lucide-react';
import { Sparkline } from './Sparkline';

/** Compact "ago" — hours/minutes for fresh GMP, days for older. */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function GmpDisplay({
  gmp,
  gmpPercent,
  gmpUpdatedAt,
  gmpTrend,
  gmpSeries,
}: {
  gmp: number | null | undefined;
  gmpPercent?: number | null;
  gmpUpdatedAt?: string | null;
  gmpTrend?: 'up' | 'down' | 'flat' | null;
  gmpSeries?: number[];
}) {
  if (gmp === null || gmp === undefined) {
    return <span className="text-gray-400">—</span>;
  }
  const positive = gmp >= 0;
  const freshness = gmpUpdatedAt ? ago(gmpUpdatedAt) : '';

  // Freshness moves to a tooltip so the cell reads clean (value+trend / %),
  // not a 4-signal jumble (blind-review R12 #2).
  return (
    <div
      className="flex flex-col items-end gap-0.5 tabular-nums"
      title={freshness ? `GMP updated ${freshness}` : undefined}
    >
      <div className="flex items-center gap-1.5">
        {gmpSeries && gmpSeries.length >= 2 && <Sparkline values={gmpSeries} />}
        <span className={positive ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
          {positive ? '+' : ''}₹{gmp}
        </span>
        {gmpTrend === 'up' && <ArrowUp className="h-3 w-3 text-green-600" aria-label="rising" />}
        {gmpTrend === 'down' && <ArrowDown className="h-3 w-3 text-red-600" aria-label="falling" />}
      </div>
      {gmpPercent !== null && gmpPercent !== undefined && (
        <div className="text-xs text-muted-foreground">
          {positive ? '+' : ''}
          {gmpPercent.toFixed(1)}%
        </div>
      )}
    </div>
  );
}
