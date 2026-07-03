'use client';

/**
 * DataFreshness — the "as of" trust stamp the reference products all carry
 * (Zerodha "02 Jul, 04:09 pm IST"; Levels "Last updated …"). IPODhan had none,
 * which capped trust site-wide. Shows a relative age + an absolute IST time.
 *
 * `asOf` is the server render/fetch time (pages are ISR, ≤5-min fresh) or a real
 * data-update timestamp. Relative age is computed client-side so it stays live.
 */

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function istTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function DataFreshness({
  asOf,
  label = 'Updated',
  className = '',
}: {
  asOf: string;
  label?: string;
  className?: string;
}) {
  // Render the absolute time immediately (SSR-safe); refine the relative age on
  // the client so it never shows a stale "3 min ago" from the ISR snapshot.
  const [age, setAge] = useState<string>('');
  useEffect(() => {
    setAge(relativeAge(asOf));
    const id = setInterval(() => setAge(relativeAge(asOf)), 60_000);
    return () => clearInterval(id);
  }, [asOf]);

  const abs = istTime(asOf);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className}`}
      title={`Data as of ${abs} IST`}
    >
      <Clock className="h-3 w-3" aria-hidden />
      {label} {age && <span>{age} · </span>}
      {abs} IST
    </span>
  );
}
