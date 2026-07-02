/**
 * Listing KPI ribbon (spec G4 — Zerodha strip).
 *
 * One bordered card split by 1px vertical rules. Replaces the 6-card summary
 * metrics grid on the listing pages. Cell = label (12/500 muted) over value
 * (18/600). Only honest, countable metrics — no fabricated gain/loss splits.
 */

interface RibbonCell {
  label: string;
  value: number;
}

export function ListingKpiRibbon({
  total,
  open,
  upcoming,
}: {
  total: number;
  open: number;
  upcoming: number;
}) {
  const cells: RibbonCell[] = [
    { label: 'Total IPOs', value: total },
    { label: 'Open now', value: open },
    { label: 'Upcoming', value: upcoming },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-white">
      {cells.map((cell) => (
        <div key={cell.label} className="px-4 py-3">
          <div className="text-xs font-medium text-gray-500">{cell.label}</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
            {cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}
