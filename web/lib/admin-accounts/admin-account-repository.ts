/**
 * Data access for admin accounts and sessions (spec §9.2 item 6; OD-104, OD-113, OD-114).
 *
 * Deliberately NOT a cached BaseRepository: a removed admin must lose access on the very next
 * request (OD-113), so every session lookup reads the database.
 */
import { asc, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../packages/shared/src/db/schema';
import { adminSessions, adminUsers } from '../../../packages/shared/src/db/schema';
import { hashPassword } from './password-hash';
import { normalizeEmail } from './admin-account-validation';
import { SESSION_TTL_MS } from './session-token';

type Db = NodePgDatabase<typeof schema>;

/** The account as any route may return it: never the password hash. */
export interface AdminAccountView {
  id: string;
  name: string;
  email: string;
  phone: string;
  telegramId: string | null;
  isOwner: boolean;
  disabledAt: Date | null;
  createdAt: Date;
}

/** One admin_sessions row joined to its account, as the session decision reads it. */
export interface SessionWithAccount {
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  adminUserId: string;
  name: string;
  isOwner: boolean;
  disabledAt: Date | null;
}

export interface CreateAccountArgs {
  name: string;
  email: string;
  phone: string;
  telegramId?: string | null;
  password: string;
  isOwner?: boolean;
}

const viewColumns = {
  id: adminUsers.id,
  name: adminUsers.name,
  email: adminUsers.email,
  phone: adminUsers.phone,
  telegramId: adminUsers.telegramId,
  isOwner: adminUsers.isOwner,
  disabledAt: adminUsers.disabledAt,
  createdAt: adminUsers.createdAt,
};

export class AdminAccountRepository {
  constructor(private readonly db: Db) {}

  async createAccount(args: CreateAccountArgs): Promise<AdminAccountView> {
    const passwordHash = await hashPassword(args.password);
    const [row] = await this.db
      .insert(adminUsers)
      .values({
        name: args.name,
        email: normalizeEmail(args.email),
        phone: args.phone,
        telegramId: args.telegramId ?? null,
        passwordHash,
        isOwner: args.isOwner ?? false,
      })
      .returning(viewColumns);
    return row;
  }

  /** Includes the hash: for the login check only, never returned by a route. */
  async findForLogin(email: string): Promise<(AdminAccountView & { passwordHash: string }) | null> {
    const [row] = await this.db
      .select({ ...viewColumns, passwordHash: adminUsers.passwordHash })
      .from(adminUsers)
      .where(eq(adminUsers.email, normalizeEmail(email)))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<AdminAccountView | null> {
    const [row] = await this.db.select(viewColumns).from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return row ?? null;
  }

  async listAccounts(): Promise<AdminAccountView[]> {
    return this.db.select(viewColumns).from(adminUsers).orderBy(asc(adminUsers.createdAt));
  }

  async ownerExists(): Promise<boolean> {
    const rows = await this.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.isOwner, true))
      .limit(1);
    return rows.length > 0;
  }

  /** Removal = disable (OD-113: past edits stay attributed) + end every session at once. */
  async disableAccount(id: string): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(adminUsers)
      .set({ disabledAt: now, updatedAt: now })
      .where(eq(adminUsers.id, id))
      .returning({ id: adminUsers.id });
    await this.db.delete(adminSessions).where(eq(adminSessions.adminUserId, id));
    return updated.length > 0;
  }

  /** Reset = new hash + every existing session ended, so an old browser cannot keep using it. */
  async resetPassword(id: string, password: string): Promise<boolean> {
    const passwordHash = await hashPassword(password);
    const updated = await this.db
      .update(adminUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(adminUsers.id, id))
      .returning({ id: adminUsers.id });
    await this.db.delete(adminSessions).where(eq(adminSessions.adminUserId, id));
    return updated.length > 0;
  }

  async createSession(tokenHash: string, adminUserId: string, now: Date = new Date()): Promise<void> {
    await this.db.insert(adminSessions).values({
      id: tokenHash,
      adminUserId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
  }

  async findSessionWithAccount(tokenHash: string): Promise<SessionWithAccount | null> {
    const [row] = await this.db
      .select({
        sessionId: adminSessions.id,
        createdAt: adminSessions.createdAt,
        expiresAt: adminSessions.expiresAt,
        lastSeenAt: adminSessions.lastSeenAt,
        adminUserId: adminUsers.id,
        name: adminUsers.name,
        isOwner: adminUsers.isOwner,
        disabledAt: adminUsers.disabledAt,
      })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
      .where(eq(adminSessions.id, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async touchSession(tokenHash: string, now: Date, expiresAt: Date): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(adminSessions.id, tokenHash));
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.delete(adminSessions).where(eq(adminSessions.id, tokenHash));
  }

  async deleteExpiredSessions(now: Date = new Date()): Promise<void> {
    await this.db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  }
}
