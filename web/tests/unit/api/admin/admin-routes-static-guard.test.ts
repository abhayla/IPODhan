/**
 * Class guard: every route file under app/api/admin/ calls an admin-auth
 * helper, and every HTTP method it exports is covered.
 *
 * middleware.ts does not protect /api/admin, so the only thing standing
 * between an admin handler and an anonymous caller is the handler calling
 * withAdminAuth (lib/middleware/admin-auth) or requireAdminAuth
 * (lib/auth/admin-auth). A new route that forgets both fails here.
 *
 * The detector parses each file with the TypeScript compiler (see
 * ./admin-route-guard-detector.ts) rather than matching text, so a guard
 * mentioned only in a comment or a string, a discarded auth-check result, or
 * a check that runs after other logic already ran, is NOT accepted as a
 * guard.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { unguardedMethods } from './admin-route-guard-detector';

const ADMIN_ROOT = path.resolve(__dirname, '../../../../app/api/admin');

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.name === 'route.ts' || entry.name === 'route.js') out.push(full);
  }
  return out;
}

// The exact set of admin route files. A count floor (`>= N`) went red on a
// legitimate deletion (#1189, OD-125) and would stay green if a route were
// swapped for another; an exact list fails on any add, remove or rename, so
// every change to the admin API surface is a deliberate edit reviewed here.
const EXPECTED_ADMIN_ROUTES = [
  'accounts/[id]/password/route.ts',
  'accounts/[id]/route.ts',
  'accounts/route.ts',
  'anchor-investors/route.ts',
  'audit/export/route.ts',
  'audit/route.ts',
  'auth/login/route.ts',
  'auth/logout/route.ts',
  'auth/me/route.ts',
  'cache/clear/route.ts',
  'conflicts/auto-resolve/route.ts',
  'conflicts/bulk-resolve/route.ts',
  'conflicts/resolve/route.ts',
  'conflicts/route.ts',
  'conflicts/stats/route.ts',
  'drhp/ipo/[ipoId]/route.ts',
  'dynamic/[table]/[id]/route.ts',
  'dynamic/[table]/list/route.ts',
  'dynamic/[table]/route.ts',
  'gmp/[ipoId]/route.ts',
  'ipos/[id]/editor/route.ts',
  'ipos/[id]/lists/[list]/route.ts',
  'ipos/[id]/route.ts',
  'ipos/[id]/visibility/route.ts',
  'ipos/route.ts',
  'metrics/data-pipeline/route.ts',
  'notifications/test/route.ts',
  'protection/fields/[ipoId]/route.ts',
  'protection/fields/bulk/route.ts',
  'protection/ipo/[ipoId]/route.ts',
  'protection/notifications/route.ts',
  'queue/route.ts',
  'relaunch-reapply/route.ts',
  'revalidate/route.ts',
  'scraper/logs/route.ts',
  'scraper/status/route.ts',
  'settings/notifications/route.ts',
  'status/update/route.ts',
  'update-field-record/route.ts',
  'update-field/route.ts',
];

// The ONE admin route that must answer an anonymous caller: it is how a session is obtained (spec
// section 9.2 item 6, OD-104). Adding a route here is a security decision, reviewed in this file.
const PUBLIC_ADMIN_ROUTES = ['auth/login/route.ts'];

// Write handlers still on requireAdminAuth, which yields no identity. Only machine callers remain:
// the scraper calls both with ADMIN_API_TOKEN, which requireAdminAuth checks and withAdminAuth does
// not (it checks ADMIN_AUTH_TOKEN), so moving them would 401 the scraper's status and revalidation
// calls. Adding a route here is a security decision, reviewed in this file (Tier A round 2 M2).
const MACHINE_ONLY_WRITES = ['revalidate/route.ts:POST', 'status/update/route.ts:POST'];

/** Exported write handlers NOT declared as `export const X = withAdminAuth(...)`. */
function writesWithoutIdentity(source: string): string[] {
  const out: string[] = [];
  const re = /export\s+(?:async\s+function\s+(POST|PUT|PATCH|DELETE)\b|const\s+(POST|PUT|PATCH|DELETE)\s*=\s*([A-Za-z_$][\w$]*))/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m[1]) out.push(m[1]);
    else if (m[3] !== 'withAdminAuth') out.push(m[2]);
  }
  return out;
}

describe('every admin write handler carries the admin identity (withAdminAuth)', () => {
  it('no write handler outside the machine-only list uses an identity-less guard', () => {
    const offenders = listRouteFiles(ADMIN_ROOT)
      .map((f) => path.relative(ADMIN_ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !PUBLIC_ADMIN_ROUTES.includes(rel))
      .flatMap((rel) => writesWithoutIdentity(fs.readFileSync(path.join(ADMIN_ROOT, rel), 'utf8')).map((m) => `${rel}:${m}`))
      .filter((id) => !MACHINE_ONLY_WRITES.includes(id));
    expect(offenders).toEqual([]);
  });

  it('detector self-test', () => {
    expect(writesWithoutIdentity('export async function POST(req) { await requireAdminAuth(); }')).toEqual(['POST']);
    expect(writesWithoutIdentity('export const DELETE = withAdminAuth(async () => ok());')).toEqual([]);
    expect(writesWithoutIdentity('export const PATCH = someOtherWrapper(async () => ok());')).toEqual(['PATCH']);
    expect(writesWithoutIdentity('export async function GET(req) { await requireAdminAuth(); }')).toEqual([]);
  });
});

describe('every admin API route requires admin auth', () => {
  const files = listRouteFiles(ADMIN_ROOT);

  it('finds exactly the expected admin route files', () => {
    const actual = files.map((f) => path.relative(ADMIN_ROOT, f).split(path.sep).join('/')).sort();
    expect(actual).toEqual([...EXPECTED_ADMIN_ROUTES].sort());
  });

  it('has no exported handler without withAdminAuth or requireAdminAuth', () => {
    const offenders = files
      .filter((f) => !PUBLIC_ADMIN_ROUTES.includes(path.relative(ADMIN_ROOT, f).split(path.sep).join('/')))
      .map((f) => ({ file: path.relative(ADMIN_ROOT, f), missing: unguardedMethods(fs.readFileSync(f, 'utf8')) }))
      .filter((r) => r.missing.length > 0)
      .map((r) => `${r.file}: ${r.missing.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  describe('detector self-test', () => {
    it('flags a handler with no guard at all', () => {
      expect(unguardedMethods('export async function GET(req) { return ok(); }')).toEqual(['GET']);
      expect(unguardedMethods('export const POST = async (req) => ok();')).toEqual(['POST']);
    });

    it('flags a guard mentioned only in a comment', () => {
      const src = `
        // this route calls requireAdminAuth() before returning data
        export async function GET(req) {
          return ok();
        }
      `;
      expect(unguardedMethods(src)).toEqual(['GET']);
    });

    it('flags requireAdminAuth() called but its result ignored', () => {
      const src = `
        export async function GET(req) {
          await requireAdminAuth();
          return ok();
        }
      `;
      expect(unguardedMethods(src)).toEqual(['GET']);
    });

    it('flags requireAdminAuth() called after a DB call / body parse', () => {
      const src = `
        export async function POST(req) {
          const body = await req.json();
          const rows = await db.select().from(ipos);
          const authError = await requireAdminAuth();
          if (authError) return authError;
          return ok(rows, body);
        }
      `;
      expect(unguardedMethods(src)).toEqual(['POST']);
    });

    it('flags only the unguarded handler when one of two is guarded', () => {
      const src = `
        export async function GET(r) {
          const authError = await requireAdminAuth();
          if (authError) return authError;
          return ok();
        }
        export async function DELETE(r) { return ok(); }
      `;
      expect(unguardedMethods(src)).toEqual(['DELETE']);
    });

    it('passes the real top-level guard shape', () => {
      const src = `
        export async function GET(request) {
          // MUST check admin auth first
          const authError = await requireAdminAuth();
          if (authError) return authError;
          return ok();
        }
      `;
      expect(unguardedMethods(src)).toEqual([]);
    });

    it('passes the real try-wrapped guard shape', () => {
      const src = `
        export async function POST(request, { params }) {
          try {
            const authError = await requireAdminAuth();
            if (authError) return authError;
            const { table } = await params;
            return ok(table);
          } catch (e) {
            return fail(e);
          }
        }
      `;
      expect(unguardedMethods(src)).toEqual([]);
    });

    it('passes withAdminAuth(...)', () => {
      expect(unguardedMethods('export const PATCH = withAdminAuth(async (r, a) => ok());')).toEqual([]);
    });

    it('does not accept withAdminAuth mentioned only in a string or comment', () => {
      const src = `
        // wrapped with withAdminAuth(...) below
        export const GET = async (r) => ok('withAdminAuth(fake)');
      `;
      expect(unguardedMethods(src)).toEqual(['GET']);
    });
  });
});
