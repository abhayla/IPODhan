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

describe('every admin API route requires admin auth', () => {
  const files = listRouteFiles(ADMIN_ROOT);

  it('finds the admin route files', () => {
    expect(files.length).toBeGreaterThanOrEqual(31);
  });

  it('has no exported handler without withAdminAuth or requireAdminAuth', () => {
    const offenders = files
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
