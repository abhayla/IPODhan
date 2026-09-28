/**
 * The pure decision behind web/scripts/create-owner-admin.ts (spec §9.2 item 6, OD-113): the first
 * and only owner account is created by a CLI run on the server, never through a web route.
 *
 * Mirrors scraper/scripts/lib/repair-tool.ts decideProdWriteRefusal, but as an ALLOW-list (Tier A
 * review M3): --apply writes only to ipodhan_staging, ipodhan_test, or the production database
 * `ipodhan` with --allow-prod. Any other name, including a blank one, is refused, so a typo or a
 * stray DATABASE_URL can never create an owner somewhere unexpected. A second owner is always refused.
 */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';
export const NON_PRODUCTION_DATABASE_NAMES: readonly string[] = ['ipodhan_staging', 'ipodhan_test'];

export type OwnerBootstrapDecision =
  | { action: 'refuse'; reason: string }
  | { action: 'dry-run' }
  | { action: 'create' };

export function decideOwnerBootstrap(input: {
  apply: boolean;
  dbName: string;
  allowProd: boolean;
  ownerExists: boolean;
}): OwnerBootstrapDecision {
  if (input.ownerExists) {
    return {
      action: 'refuse',
      reason: 'an owner account already exists; the owner adds other admins from /admin/accounts (OD-113)',
    };
  }
  if (!input.apply) return { action: 'dry-run' };
  // Exact match: Postgres database names are case-sensitive when quoted, so "IPODHAN" is not ipodhan.
  const dbName = typeof input.dbName === 'string' ? input.dbName : '';
  if (dbName === PRODUCTION_DATABASE_NAME) {
    if (input.allowProd) return { action: 'create' };
    return {
      action: 'refuse',
      reason: `refusing to create an owner in the production database "${PRODUCTION_DATABASE_NAME}" (current_database() = "${dbName}") without --allow-prod`,
    };
  }
  if (NON_PRODUCTION_DATABASE_NAMES.includes(dbName)) return { action: 'create' };
  return {
    action: 'refuse',
    reason: `refusing to create an owner in database "${dbName}": only ${[...NON_PRODUCTION_DATABASE_NAMES, `${PRODUCTION_DATABASE_NAME} (with --allow-prod)`].join(', ')} are allowed`,
  };
}
