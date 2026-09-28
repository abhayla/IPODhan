/**
 * Prod-write guard for web/scripts/ data tools.
 *
 * Mirrors `decideProdWriteRefusal` / `PRODUCTION_DATABASE_NAME` from
 * `scraper/scripts/lib/repair-tool.ts` (that module cannot be imported
 * directly from web/ — it drags in scraper-only relative imports, e.g.
 * `../../../scripts/lib/alias-preflight-auto.mjs`, that resolve relative to
 * its own file location and pull scraper's tsconfig/module graph into web's
 * build). This is a small, focused, deliberately duplicated port — same
 * decision, same shape — for the one web/ tool that needs it
 * (`web/scripts/seed-broker-affiliates.ts`, issue #97, class B4).
 *
 * `dbName` MUST come from `SELECT current_database()` run on the SAME
 * connection that is about to write — never from an env var — because the
 * env can claim "staging" while the socket is actually on prod.
 */

/** The one database name a web/scripts tool refuses to WRITE to without --allow-prod. */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';

export function decideProdWriteRefusal(input: {
  apply: boolean;
  dbName: string;
  allowProd: boolean;
  toolName?: string;
}): { refuse: boolean; reason?: string } {
  if (!input.apply) return { refuse: false }; // a dry run writes nothing — nothing to refuse
  const isProdDb = (input.dbName ?? '').toLowerCase() === PRODUCTION_DATABASE_NAME;
  if (isProdDb && !input.allowProd) {
    const prefix = input.toolName ? `${input.toolName}: ` : '';
    return {
      refuse: true,
      reason:
        `${prefix}refusing to APPLY writes against the production database ` +
        `"${PRODUCTION_DATABASE_NAME}" (current_database() = "${input.dbName}") — pass --allow-prod to override.`,
    };
  }
  return { refuse: false };
}
