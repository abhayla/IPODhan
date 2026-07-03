/**
 * Sparkline — a tiny inline SVG trend line (no chart lib). Renders a series of
 * numbers as a normalized polyline; colored green if the series ends up, red if
 * down. Used for GMP 30-day trend, matching the micro-charts Screener/Zerodha
 * carry per row. Needs >= 2 points; otherwise renders nothing.
 */

export function Sparkline({
  values,
  width = 44,
  height = 16,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (!values || values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 1.5; // keep the stroke inside the box

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const up = values[values.length - 1] >= values[0];
  const stroke = up ? '#16a34a' : '#dc2626'; // green-600 / red-600

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
