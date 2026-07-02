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
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-100" aria-hidden>
        <div
          className={`h-full rounded-full ${oversubscribed ? 'bg-green-500' : 'bg-amber-500'}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <span className="tabular-nums text-sm">{value.toFixed(2)}x</span>
    </div>
  );
}
