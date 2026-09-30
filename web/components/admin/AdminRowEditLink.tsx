'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { isRealIPO } from '@ipodhan/shared/utils/offering-type';

interface AdminRowEditLinkProps {
  /** The IPO's slug — the link target is the row's own editor (§9.2 item 14, OD-110, OD-140). */
  slug: string;
  /** Only render for a confirmed admin session; a reader (or while the check is still loading) gets nothing. */
  isAdmin: boolean;
  /**
   * The row's offering type. Omitted callers only ever render real IPO rows (list/calendar/
   * tracker/prospectus surfaces that already filter to `offering_type = 'IPO'`), so the default
   * keeps their link on the IPO detail page unchanged (OD-110).
   */
  offeringType?: string | null;
  className?: string;
}

/**
 * The admin-only "Edit" link a list/calendar/tracker/prospectus row shows next to an IPO
 * (spec §9.2 item 14, OD-110, OD-140): "a reader never sees it and the page's public HTML/cache is
 * unchanged for readers." An IPO-type row navigates to the IPO detail page, which is the one place
 * §9.2 item 1 built the actual editor. A non-IPO row (OFS, NCD, RIGHTS, BUYBACK, TENDER, REIT) has
 * no public detail page (OD-53), so it opens the admin-only route instead (OD-140) — same editor
 * component, no second edit surface.
 */
export function AdminRowEditLink({ slug, isAdmin, offeringType = 'IPO', className }: AdminRowEditLinkProps) {
  if (!isAdmin) return null;

  const href = isRealIPO(offeringType) ? `/ipos/${slug}?edit=` : `/admin/ipos/${slug}/edit`;

  return (
    <Link
      href={href}
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
