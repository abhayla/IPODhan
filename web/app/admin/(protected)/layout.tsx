/**
 * ONE server-side session check for every admin page (the route group `(protected)` does not
 * change any URL). Every page placed under app/admin/(protected)/ is covered by construction;
 * /admin/login lives outside the group, so it stays reachable without a session and cannot loop.
 *
 * Defence in depth, NOT the only check. Measured 2026-09-30 on a production build (next build +
 * next start, Next 15.5): with this layout redirecting an anonymous request, a child page that
 * has NO check of its own still RAN, and its rendered output was present in the body of the 307
 * response and in the RSC response. In the App Router a layout does not control whether its child
 * segments render, and it is not re-rendered on client-side navigation between pages under it.
 * So every admin page and every admin API route keeps its OWN session check (withAdminAuth on API
 * routes; getAdminSessionFromCookies on server pages), and the static detector in
 * tests/unit/app/admin/admin-pages-static-guard.test.ts, which fails any unguarded admin server
 * file, remains the class guard. What this layout adds: the admin chrome is never rendered for a
 * request without a valid session, a browser is always sent to the login page, and the client-side
 * guard is no longer the only layout-level check.
 *
 * The ADMIN_PANEL_ENABLED kill switch is honoured inside getAdminSessionFromCookies (null when
 * off), so with the panel disabled every admin page redirects to the login page, whose sign-in
 * API refuses too.
 */
import { redirect } from 'next/navigation';
import { getAdminSessionFromCookies } from '@/lib/admin-accounts/admin-session';
import { AdminShell } from '@/components/admin/AdminShell';

export const dynamic = 'force-dynamic';

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSessionFromCookies();
  if (!admin) {
    redirect('/admin/login');
  }
  return <AdminShell>{children}</AdminShell>;
}
