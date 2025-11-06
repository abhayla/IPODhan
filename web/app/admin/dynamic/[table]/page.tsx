/**
 * Dynamic Admin - Table Redirect
 * Redirects /admin/dynamic/[table] to /admin/dynamic/[table]/list
 *
 * This prevents 404 errors when users navigate to the base table route
 */

import { redirect } from 'next/navigation';

type RouteParams = {
  params: Promise<{ table: string }>;
};

export default async function DynamicTableRedirect({ params }: RouteParams) {
  const { table } = await params;
  redirect(`/admin/dynamic/${table}/list`);
}
