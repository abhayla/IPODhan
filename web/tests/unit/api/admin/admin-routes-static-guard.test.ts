/**
 * Class guard: every route file under app/api/admin/ calls an admin-auth
 * helper, and every HTTP method it exports is covered.
 *
 * middleware.ts does not protect /api/admin, so the only thing standing
 * between an admin handler and an anonymous caller is the handler calling
 * withAdminAuth (lib/middleware/admin-auth) or requireAdminAuth
 * (lib/auth/admin-auth). A new route that forgets both fails here.
 *
 * Per exported method:
 *   - `export const METHOD = withAdminAuth(` is guarded;
 *   - `export async function METHOD(...)` must call `requireAdminAuth()`
 *     inside that function's own body.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
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

/** Body text of `export async function METHOD(...) { ... }`, by brace matching. */
function functionBody(src: string, start: number): string {
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function unguardedMethods(src: string): string[] {
  const missing: string[] = [];
  for (const m of HTTP_METHODS) {
    const wrapped = new RegExp(`export\\s+const\\s+${m}\\s*=\\s*withAdminAuth\\s*\\(`).test(src);
    const constExport = new RegExp(`export\\s+const\\s+${m}\\s*=`).exec(src);
    const fnExport = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\s*\\(`).exec(src);
    const reExport = new RegExp(`export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`).test(src);
    if (wrapped) continue;
    if (fnExport) {
      const body = functionBody(src, fnExport.index);
      if (/\bawait\s+requireAdminAuth\s*\(/.test(body)) continue;
      missing.push(m);
    } else if (constExport || reExport) {
      missing.push(m);
    }
  }
  return missing;
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

  it('flags an unguarded handler (self-test of the detector)', () => {
    expect(unguardedMethods('export async function GET(req) { return ok(); }')).toEqual(['GET']);
    expect(unguardedMethods('export const POST = async (req) => ok();')).toEqual(['POST']);
    expect(
      unguardedMethods(
        'export async function GET(r) { const e = await requireAdminAuth(); if (e) return e; }\n' +
          'export async function DELETE(r) { return ok(); }',
      ),
    ).toEqual(['DELETE']);
    expect(unguardedMethods('export const PATCH = withAdminAuth(async (r, a) => ok());')).toEqual([]);
  });
});
