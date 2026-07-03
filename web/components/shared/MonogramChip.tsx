/**
 * MonogramChip — a small colored initials chip before a company name, giving the
 * instant visual recognition the reference tables (Screener/Zerodha/Levels.fyi)
 * get from logos, with zero external asset dependency. Deterministic color per
 * company so the same name always looks the same. Upgradeable to real logos.
 */

const PALETTE = [
  { bg: 'bg-blue-100', text: 'text-blue-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
];

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

/** Stable hash → palette index. */
function paletteFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function MonogramChip({
  name,
  size = 'sm',
}: {
  name: string;
  /** 'sm' = inline table chip; 'lg' = fill the parent box (detail-page avatar). */
  size?: 'sm' | 'lg';
}) {
  const tone = paletteFor(name);
  const sizeCls =
    size === 'lg'
      ? 'h-full w-full rounded-xl text-2xl md:text-3xl lg:text-4xl'
      : 'h-6 w-6 rounded text-[10px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-semibold ${sizeCls} ${tone.bg} ${tone.text}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
