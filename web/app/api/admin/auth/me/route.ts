/**
 * GET /api/admin/auth/me -- who the server thinks the caller is. The admin shell uses it to decide
 * whether a browser is signed in and whether to show owner-only screens.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';

export const GET = withAdminAuth(async (_request: NextRequest, admin: AdminAuthContext) => {
  return NextResponse.json({
    success: true,
    data: { adminId: admin.adminId, adminName: admin.adminName, isOwner: admin.isOwner },
  });
});
