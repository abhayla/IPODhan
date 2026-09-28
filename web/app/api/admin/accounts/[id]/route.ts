/**
 * DELETE /api/admin/accounts/[id] -- owner-only removal (OD-113). Removal disables the account and
 * ends its sessions at once; the row stays so every past edit stays attributed to that admin.
 * The owner account itself cannot be removed here (that would lock the owner out).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { logger } from '@/lib/logger';
import { requireOwner, withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import { AdminAccountRepository } from '@/lib/admin-accounts/admin-account-repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withAdminAuth(
  async (_request: NextRequest, admin: AdminAuthContext, { params }: { params: Promise<{ id: string }> }) => {
    const forbidden = requireOwner(admin);
    if (forbidden) return forbidden;

    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad Request', message: 'Invalid id' }, { status: 400 });

    const repo = new AdminAccountRepository(db);
    const target = await repo.findById(id);
    if (!target) return NextResponse.json({ error: 'Not Found', message: 'No such admin' }, { status: 404 });
    if (target.isOwner) {
      return NextResponse.json({ error: 'Bad Request', message: 'The owner account cannot be removed' }, { status: 400 });
    }

    await repo.disableAccount(id);
    logger.info({ adminId: id, by: admin.adminId }, 'Admin account removed');
    return NextResponse.json({ success: true });
  }
);
