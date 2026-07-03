/**
 * SubscriptionBar — a compact in-row heat-bar for IPO subscription (demand).
 *
 * The references (Screener/Zerodha/Levels.fyi) lead with a visual signal layer;
 * a bare "2.5x" is flat. This encodes the same number as a filled bar so the
 * eye reads "oversubscribed or not" before parsing the digits:
 *   < 1x  → amber (under-subscribed, weak demand)
 *   ≥ 1x  → green (fully/over-subscribed)
 * Fill is LOG-scaled (R23 #3): a linear "full at 5x" bar made 14x and 205x look
 * identical (both pinned full) — actively misleading on a trust number. Log10 to
 * ~300x lets 14x (~45%) and 205x (~93%) read distinctly. Exact multiple always
 * printed alongside; the number is the source of truth, the bar is the cue.
 */

// Full bar approached near ~300x; log-scaled so the whole 1x–300x range separates.
const LOG_MAX = Math.log10(300);

export function SubscriptionBar({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400">—</span>;
  }
  const v = Math.max(value, 0);
  const fill = v <= 0 ? 0 : Math.min(Math.log10(v + 1) / LOG_MAX, 1) * 100;
  const oversubscribed = value >= 1;
  const legend = `${value.toFixed(2)}x subscribed (log-scaled bar; green = oversubscribed, amber = under)`;
  return (
    <div className="flex items-center justify-end gap-2" title={legend}>
      {/* Quiet 5px track + muted fill — a data cue, not a shout (R18 #3) */}
      <div
        className="h-[5px] w-16 overflow-hidden rounded-full bg-gray-200/60"
        aria-hidden
      >
        <div
          className={`h-full rounded-full ${oversubscribed ? 'bg-green-500/80' : 'bg-amber-400/80'}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <span className="w-14 text-right text-sm font-medium tabular-nums">{value.toFixed(2)}x</span>
    </div>
  );
}
