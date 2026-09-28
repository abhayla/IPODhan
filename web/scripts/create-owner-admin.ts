/**
 * Create the ONE owner admin account (spec §9.2 item 6; OD-104, OD-113, OD-114).
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   ADMIN_OWNER_PASSWORD='...' npx tsx scripts/create-owner-admin.ts \
 *     --name "Full Name" --email owner@example.com --phone +919999999999 [--telegram @handle] \
 *     [--apply] [--allow-prod]
 *
 * The password is read from the ADMIN_OWNER_PASSWORD environment variable, or from stdin when that
 * is unset (pipe it in). It is never accepted as an argument and never printed.
 *
 * Refuses: a second owner (always); --apply against the production database `ipodhan` without
 * --allow-prod. The target database is asked of the writing connection (`SELECT current_database()`).
 */
import { sql } from 'drizzle-orm';
import { db, getPool } from '../lib/db/index';
import { AdminAccountRepository } from '../lib/admin-accounts/admin-account-repository';
import { validateAccountInput, validatePassword } from '../lib/admin-accounts/admin-account-validation';
import { decideOwnerBootstrap } from '../lib/admin-accounts/owner-bootstrap';

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const allowProd = args.includes('--allow-prod');

  const input = validateAccountInput({
    name: flag(args, 'name'),
    email: flag(args, 'email'),
    phone: flag(args, 'phone'),
    telegramId: flag(args, 'telegram'),
  });
  if (!input.ok) {
    console.error(`create-owner-admin: ${input.error}`);
    return 2;
  }

  const rawPassword = process.env.ADMIN_OWNER_PASSWORD ?? (await readStdin());
  const password = validatePassword(rawPassword);
  if (!password.ok) {
    console.error(`create-owner-admin: ${password.error} (set ADMIN_OWNER_PASSWORD or pipe it on stdin)`);
    return 2;
  }

  const result = await db.execute(sql`SELECT current_database() AS db`);
  const dbName = String((result.rows[0] as { db: string }).db);
  const repo = new AdminAccountRepository(db);
  const decision = decideOwnerBootstrap({ apply, dbName, allowProd, ownerExists: await repo.ownerExists() });

  if (decision.action === 'refuse') {
    console.error(`create-owner-admin: ${decision.reason}`);
    return 1;
  }
  if (decision.action === 'dry-run') {
    console.log(
      `create-owner-admin: DRY RUN on "${dbName}" -- would create owner ${input.value.name} <${input.value.email}>. Re-run with --apply to write.`
    );
    return 0;
  }

  const created = await repo.createAccount({ ...input.value, password: password.value, isOwner: true });
  console.log(`create-owner-admin: created owner ${created.name} <${created.email}> (id ${created.id}) on "${dbName}"`);
  return 0;
}

main()
  .then(async (code) => {
    await getPool().end();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`create-owner-admin: failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    await getPool()
      .end()
      .catch(() => undefined);
    process.exit(1);
  });
