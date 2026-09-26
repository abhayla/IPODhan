// Shared discrete-parameter (DATABASE_HOST-branch) connection-param resolver
// for every scripts/*.mjs pool (#640). Mirrors
// packages/shared/src/db/index.ts#resolveDiscreteDbParams — scripts/ has no
// dependency on packages/shared today (plain `node`, not tsx; a .ts import
// there fails at runtime — see pg-utc.mjs's own duplication note), so this is
// a deliberate, small duplication rather than a new cross-package import.
//
// RCA (#640): `database: process.env.DATABASE_NAME || 'ipodhan'` and
// `user: process.env.DATABASE_USER || 'postgres'` meant a script run through
// the tunnel (DATABASE_HOST set) that forgot DATABASE_NAME silently connected
// to the PRODUCTION database, as the superuser. Both are now REQUIRED once
// DATABASE_HOST + DATABASE_PASSWORD select this branch: throws naming
// whichever variable is missing, never defaults.

/**
 * Describe which of DATABASE_HOST/DATABASE_PASSWORD are actually set, from
 * the real env state — never assume both are set just because this function
 * was called (#640 round 1 review).
 * @param {NodeJS.ProcessEnv} env
 */
function describeHostPasswordState(env) {
  const present = [
    env.DATABASE_HOST ? 'DATABASE_HOST' : null,
    env.DATABASE_PASSWORD ? 'DATABASE_PASSWORD' : null,
  ].filter(Boolean);
  if (present.length === 0) return 'neither DATABASE_HOST nor DATABASE_PASSWORD is set';
  if (present.length === 1) return `${present[0]} is set (the other is not)`;
  return `${present.join(' and ')} are set`;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ host: string, port: number, database: string, user: string, password: string }}
 */
export function resolveDiscreteDbParams(env = process.env) {
  const host = env.DATABASE_HOST;
  const password = env.DATABASE_PASSWORD;
  const database = env.DATABASE_NAME;
  if (!database) {
    throw new Error(
      `${describeHostPasswordState(env)}, but DATABASE_NAME is missing — refusing to ` +
        "default to the production database name ('ipodhan'). Set DATABASE_NAME explicitly (#640)."
    );
  }
  const user = env.DATABASE_USER;
  if (!user) {
    throw new Error(
      `${describeHostPasswordState(env)}, but DATABASE_USER is missing — refusing to ` +
        "default to the superuser ('postgres'). Set DATABASE_USER explicitly (#640)."
    );
  }
  return {
    host,
    port: parseInt(env.DATABASE_PORT || '5432', 10),
    database,
    user,
    password,
  };
}
