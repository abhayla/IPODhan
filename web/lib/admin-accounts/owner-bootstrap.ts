/**
 * The pure decision behind web/scripts/create-owner-admin.ts (spec §9.2 item 6, OD-113): the first
 * and only owner account is created by a CLI run on the server, never through a web route.
 *
 * Mirrors scraper/scripts/lib/repair-tool.ts decideProdWriteRefusal: an --apply against the
 * production database `ipodhan` is refused without --allow-prod. A second owner is always refused.
 */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';

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
  if ((input.dbName ?? '').toLowerCase() === PRODUCTION_DATABASE_NAME && !input.allowProd) {
    return {
      action: 'refuse',
      reason: `refusing to create an owner in the production database "${PRODUCTION_DATABASE_NAME}" (current_database() = "${input.dbName}") without --allow-prod`,
    };
  }
  return { action: 'create' };
}
