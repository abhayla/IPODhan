/**
 * MobileMetricCard — the mobile (row-card) counterpart to the dense desktop
 * tables (spec L2/D5). On < md, tables clip the persona's decision columns
 * (gain, GMP, subscription) off-screen; a card row keeps every field visible
 * with no horizontal scroll.
 *
 * Generic on purpose: listing + home map their own fields in.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

export interface CardField {
  label: string;
  value: ReactNode;
}

export function MobileMetricCard({
  href,
  title,
  status,
  fields,
}: {
  href: string;
  title: string;
  status?: ReactNode;
  fields: CardField[];
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-border bg-white px-3 py-2.5 active:bg-muted/50"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-900">{title}</span>
        {status}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              {f.label}
            </dt>
            <dd className="text-sm tabular-nums text-gray-800">{f.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
