'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';

interface AdminRowEditLinkProps {
  /** The IPO's slug — the link target is always the IPO detail page's own editor (§9.2 item 14, OD-110). */
  slug: string;
  /** Only render for a confirmed admin session; a reader (or while the check is still loading) gets nothing. */
  isAdmin: boolean;
  className?: string;
}

/**
 * The admin-only "Edit" link a list/calendar/tracker/prospectus row shows next to an IPO
 * (spec §9.2 item 14, OD-110): "a reader never sees it and the page's public HTML/cache is
 * unchanged for readers." It never opens its own editor — it navigates to the IPO detail
 * page, which is the one place §9.2 item 1 built the actual editor.
 */
export function AdminRowEditLink({ slug, isAdmin, className }: AdminRowEditLinkProps) {
  if (!isAdmin) return null;

  return (
    <Link
      href={`/ipos/${slug}?edit=`}
      onClick={(e) => e.stopPropagation()}
      className={
        className ??
        'inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100'
      }
      data-testid="admin-row-edit-link"
      aria-label={`Edit ${slug}`}
      title="Edit this IPO (admin)"
    >
      <Pencil className="h-3 w-3" aria-hidden="true" />
      Edit
    </Link>
  );
}
