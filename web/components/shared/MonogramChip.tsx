/**
 * MonogramChip — a small neutral initials chip before a company name, giving the
 * quiet row-scanning recognition the reference tables (Screener/Zerodha/Levels.fyi)
 * favor over a rainbow of colored badges. Single neutral tint on purpose (R16 #5):
 * the references deliberately avoid per-row color noise. Upgradeable to real logos.
 */

const STOPWORDS = new Set([
  'ltd', 'limited', 'pvt', 'private', 'and', 'the', 'co', 'company', 'india',
  'industries', 'technologies', 'solutions', 'services',
]);

/** 1–2 initials from the most significant words in the name. */
function initials(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  const pick = words.length ? words : name.trim().split(/\s+/);
  const letters = pick.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '');
  return (letters.join('') || name.slice(0, 2).toUpperCase()).slice(0, 2);
}

export function MonogramChip({
  name,
  size = 'sm',
}: {
  name: string;
  /** 'sm' = inline table chip; 'lg' = fill the parent box (detail-page avatar). */
  size?: 'sm' | 'lg';
}) {
  const sizeCls =
    size === 'lg'
      ? 'h-full w-full rounded-xl text-2xl md:text-3xl lg:text-4xl'
      : 'h-6 w-6 rounded text-[10px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-gray-100 font-semibold text-gray-600 ${sizeCls}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
