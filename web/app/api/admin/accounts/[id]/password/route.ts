/**
 * POST /api/admin/accounts/[id]/password -- owner-only password reset (OD-113). Every existing
 * session of that admin ends, so a browser signed in with the old password is signed out.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { logger } from '@/lib/logger';
import { requireOwner, withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import { AdminAccountRepository } from '@/lib/admin-accounts/admin-account-repository';
import { validatePassword } from '@/lib/admin-accounts/admin-account-validation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withAdminAuth(
  async (request: NextRequest, admin: AdminAuthContext, { params }: { params: Promise<{ id: string }> }) => {
    const forbidden = requireOwner(admin);
    if (forbidden) return forbidden;

    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad Request', message: 'Invalid id' }, { status: 400 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Bad Request', message: 'Body must be JSON' }, { status: 400 });
    }
    const password = validatePassword((body as Record<string, unknown> | null)?.password);
    if (!password.ok) return NextResponse.json({ error: 'Bad Request', message: password.error }, { status: 400 });

    const repo = new AdminAccountRepository(db);
    const target = await repo.findById(id);
    if (!target) return NextResponse.json({ error: 'Not Found', message: 'No such admin' }, { status: 404 });

    await repo.resetPassword(id, password.value);
    logger.info({ adminId: id, by: admin.adminId }, 'Admin password reset');
    return NextResponse.json({ success: true });
  }
);
