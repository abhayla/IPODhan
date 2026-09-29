/**
 * Admin-only editor route for a row whose offering type is not IPO (OD-140, §9.2 items 4, 14).
 *
 * OFS, NCD, RIGHTS, BUYBACK, TENDER and REIT rows have no public detail page
 * (`REAL_IPO_OFFERING_TYPES = ['IPO']`, packages/shared/src/utils/offering-type.ts, and
 * `web/app/ipos/[slug]/page.tsx` 404s for the rest), so the §9.2 item 1 editor built for the IPO
 * detail page has nowhere to live for them. This route hosts the SAME editor component
 * (IpoPageEditor / AdminEditButton) the IPO detail page uses, for that row only.
 *
 * The route's own SERVER-SIDE session check (getAdminSessionFromCookies) is what keeps an
 * anonymous request out — independent of app/admin/layout.tsx's client-only redirect, which is
 * the 2026-09-24 admin-route auth-hole class (any admin route whose server entry point does not
 * itself verify the session). An unauthenticated request never reaches the IPO lookup or the
 * editor below; it is redirected to /admin/login before either runs.
 *
 * Public behaviour is unchanged: a non-IPO slug still 404s on /ipos/[slug] (OD-53's notice).
 * An IPO-type slug is redirected to its own detail page (OD-110: editing an IPO-type row happens
 * only there), so this route never becomes a second editor surface for the same row.
 */
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { getAdminSessionFromCookies } from '@/lib/admin-accounts/admin-session';
import { isRealIPO } from '@ipodhan/shared/utils/offering-type';
import { IpoPageEditor, AdminEditButton } from '@/components/admin/ipo-editor/IpoPageEditor';

export const dynamic = 'force-dynamic';

interface AdminEditNonIpoPageProps {
  params: Promise<{ slug: string }>;
}

export default async function AdminEditNonIpoPage({ params }: AdminEditNonIpoPageProps) {
  const { slug } = await params;

  // Server-side session check at the route entry (OD-140). A reader or an anonymous curl request
  // never reaches the row lookup or the editor below.
  const admin = await getAdminSessionFromCookies();
  if (!admin) {
    redirect('/admin/login');
  }

  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);
  const row = await ipoRepository.findBySlug(slug);

  if (!row) {
    notFound();
  }

  // OD-110: an IPO-type row keeps its one editor on the public detail page — this route is only
  // for the offering types that have no public page to host it on.
  if (isRealIPO(row.offeringType)) {
    redirect(`/ipos/${row.slug}`);
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-4">
          <Link href="/admin" className="text-sm text-blue-400 hover:underline">
            &larr; Admin dashboard
          </Link>
        </div>
        <h1 className="mb-1 text-2xl font-semibold">{row.companyName}</h1>
        <p className="mb-6 text-sm text-gray-400">
          {row.offeringType} &middot; {row.status} &middot; no public detail page (OD-53, OD-140)
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="admin-edit-bar">
          <AdminEditButton section="all" label="Edit this row" />
          <IpoPageEditor ipoId={row.id} editTarget={null} editRowKey={null} />
        </div>
      </div>
    </div>
  );
}
