'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the current browser has an admin session, checked client-side against the
 * admin-only `/api/admin/auth/me` route (spec §9.2 item 14, OD-110). Used on pages that
 * must stay statically cacheable for readers (ISR list/calendar/tracker/prospectus pages) —
 * reading the admin cookie server-side on those pages would force them dynamic for every
 * visitor. A reader gets `isAdmin: false` immediately with no extra network cost beyond
 * this one same-origin call; the call itself never affects what a reader is served, because
 * the page's own HTML and cache entry are already fixed before this runs.
 */
export function useAdminSession(): { isAdmin: boolean; loading: boolean } {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/admin/auth/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) {
          setIsAdmin(Boolean(body?.success));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { isAdmin, loading };
}
