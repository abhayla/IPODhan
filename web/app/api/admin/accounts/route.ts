/**
 * Owner-only admin account management (OD-113): GET lists admins, POST adds one.
 * Account fields are only name, email, phone and an optional Telegram ID (OD-114). The password
 * hash is never returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { logger } from '@/lib/logger';
import { requireOwner, withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import { AdminAccountRepository } from '@/lib/admin-accounts/admin-account-repository';
import { validateAccountInput, validatePassword } from '@/lib/admin-accounts/admin-account-validation';

export const GET = withAdminAuth(async (_request: NextRequest, admin: AdminAuthContext) => {
  const forbidden = requireOwner(admin);
  if (forbidden) return forbidden;
  const accounts = await new AdminAccountRepository(db).listAccounts();
  return NextResponse.json({ success: true, data: accounts });
});

export const POST = withAdminAuth(async (request: NextRequest, admin: AdminAuthContext) => {
  const forbidden = requireOwner(admin);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request', message: 'Body must be JSON' }, { status: 400 });
  }
  const input = validateAccountInput(body);
  if (!input.ok) return NextResponse.json({ error: 'Bad Request', message: input.error }, { status: 400 });
  const password = validatePassword((body as Record<string, unknown>).password);
  if (!password.ok) return NextResponse.json({ error: 'Bad Request', message: password.error }, { status: 400 });

  const repo = new AdminAccountRepository(db);
  if (await repo.findForLogin(input.value.email)) {
    return NextResponse.json(
      { error: 'Conflict', message: 'An admin with this email already exists' },
      { status: 409 }
    );
  }
  const created = await repo.createAccount({ ...input.value, password: password.value, isOwner: false });
  logger.info({ adminId: created.id, by: admin.adminId }, 'Admin account added');
  return NextResponse.json({ success: true, data: created }, { status: 201 });
});
