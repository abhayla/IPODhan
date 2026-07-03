/**
 * SubscriptionBar — a compact in-row heat-bar for IPO subscription (demand).
 *
 * The references (Screener/Zerodha/Levels.fyi) lead with a visual signal layer;
 * a bare "2.5x" is flat. This encodes the same number as a filled bar so the
 * eye reads "oversubscribed or not" before parsing the digits:
 *   < 1x  → amber (under-subscribed, weak demand)
 *   ≥ 1x  → green (fully/over-subscribed)
 * Bar fills to 100% at 5x (the retail-relevant saturation point); the exact
 * multiple is always printed alongside. Null → an honest em dash.
 */

const SATURATION = 5; // x at which the bar is full

export function SubscriptionBar({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400">—</span>;
  }
  const fill = Math.min(Math.max(value, 0) / SATURATION, 1) * 100;
  const oversubscribed = value >= 1;
  const legend = `${value.toFixed(2)}x subscribed (bar fills at ${SATURATION}x; green = oversubscribed, amber = under)`;
  return (
    <div className="flex items-center justify-end gap-2" title={legend}>
      {/* Crisper track: taller, subtle inset ring, saturated fill (R14 fidelity) */}
      <div
        className="h-2 w-16 overflow-hidden rounded-full bg-gray-200/70 ring-1 ring-inset ring-black/[0.04]"
        aria-hidden
      >
        <div
          className={`h-full rounded-full ${oversubscribed ? 'bg-green-600' : 'bg-amber-500'}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <span className="w-14 text-right text-sm font-medium tabular-nums">{value.toFixed(2)}x</span>
    </div>
  );
}
