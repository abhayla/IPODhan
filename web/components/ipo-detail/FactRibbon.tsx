/**
 * Fact Ribbon — the Zerodha-style KPI strip (spec G4/D2,
 * docs/13-components/UI-SPEC-REFERENCE-PARITY.md). One bordered card divided
 * into equal cells: label 12/500 muted over value 18/600. Replaces the three
 * oversized stat cards on the IPO detail page. Desktop: one row (≤8 cells);
 * mobile: 2×3 grid showing the six priority cells.
 */

import { cn } from '@/lib/utils';

export interface RibbonCell {
  label: string;
  value: string;
  /** 'gain' | 'loss' colors the value; undefined = plain (the only colored cell should be GMP) */
  tone?: 'gain' | 'loss';
  /** Hidden on mobile when true (spec D2: mobile shows six priority cells) */
  mobileHidden?: boolean;
  /**
   * T-328: true when this cell's value is a HELD, disputed HIGH_VALUE field
   * on a live IPO (an unresolved cross-source disagreement) — renders a
   * small "Under verification" marker instead of asserting the number as
   * settled fact.
   */
  disputed?: boolean;
}

interface FactRibbonProps {
  cells: RibbonCell[];
}

export function FactRibbon({ cells }: FactRibbonProps) {
  if (cells.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 divide-x divide-y lg:divide-y-0 divide-border overflow-hidden">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className={cn('px-4 py-4', cell.mobileHidden && 'hidden lg:block')}
        >
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            {cell.label}
          </p>
          <p
            className={cn(
              'mt-1 text-lg font-semibold tabular-nums leading-6',
              cell.tone === 'gain' && 'text-green-700',
              cell.tone === 'loss' && 'text-red-700'
            )}
          >
            {cell.value}
          </p>
          {cell.disputed && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Under verification
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
