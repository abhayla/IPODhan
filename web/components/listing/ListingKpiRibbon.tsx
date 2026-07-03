/**
 * Listing KPI ribbon (spec G4 — Zerodha strip).
 *
 * One bordered card split by 1px vertical rules. Screener/Levels pack 6–8
 * metrics into the space a 3-card row wastes; this renders a compact,
 * information-dense strip. Cell = label (12/500 muted) over value (18/600).
 * Only honest, computed metrics — no fabricated splits.
 */

export interface RibbonCell {
  label: string;
  value: string | number;
  /** Optional value color (e.g. gain/loss). */
  tone?: 'default' | 'gain' | 'loss';
}

export function ListingKpiRibbon({ cells }: { cells: RibbonCell[] }) {
  const toneClass = (tone?: RibbonCell['tone']) =>
    tone === 'gain' ? 'text-green-600' : tone === 'loss' ? 'text-red-600' : 'text-gray-900';

  return (
    <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-white sm:grid-cols-6">
      {cells.map((cell) => (
        <div key={cell.label} className="px-3 py-2.5">
          <div className="truncate text-xs font-medium text-gray-500">{cell.label}</div>
          <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass(cell.tone)}`}>
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}
