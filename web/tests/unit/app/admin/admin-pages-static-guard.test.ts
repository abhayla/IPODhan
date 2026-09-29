/**
 * Class guard (fail-CLOSED, #1324 round 1): every non-client-component file under
 * web/app/admin/** — a page.tsx, layout.tsx, route.ts, or any file carrying a 'use server'
 * directive — either guards EVERY exported entry point (default export, generateMetadata, an
 * HTTP method, or every exported function in a 'use server' file) with a real session check
 * before anything else, OR is named in the explicit, reviewed ADMIN_SERVER_FILES_WITHOUT_DATA
 * allowlist below with a one-line reason. A file that is neither guarded nor allowlisted FAILS —
 * there is no third "doesn't look like a data read" state that passes silently (that was the
 * round-1 defect: docs/reviews/failure-classes/admin-route-auth-hole... the detector's own
 * heuristic for "this file reads data" was the pass condition, so anything the heuristic failed
 * to recognize passed unguarded).
 *
 * See ./admin-page-guard-detector.ts for the AST logic and its self-tests below for the eight
 * evasion shapes round 1 found: an imported helper read, a repository factory call, an aliased
 * `db` import, an indirect (`const P = ...; export default P;`) default export, an anonymous
 * arrow default export, a `generateMetadata` read, a module-scope read, and a 'use server' file.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateAdminServerFile } from './admin-page-guard-detector';

const ADMIN_ROOT = path.resolve(__dirname, '../../../../app/admin');

function listCandidateFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listCandidateFiles(full));
      continue;
    }
    if (!/\.(tsx|ts|js)$/.test(entry.name)) continue;
    if (/\.(test|spec)\./.test(entry.name)) continue;
    if (['page.tsx', 'page.ts', 'layout.tsx', 'layout.ts', 'route.ts', 'route.js'].includes(entry.name)) {
      out.push(full);
      continue;
    }
    // Any other file is a candidate ONLY if it itself carries a 'use server' directive — a plain
    // component/helper imported by a page is not itself a Next.js server entry point.
    if (/^\s*['"]use server['"]/.test(fs.readFileSync(full, 'utf8'))) out.push(full);
  }
  return out;
}

// The exact set of admin server-entry candidate files. An exact list (not a count floor) fails on
// any add, remove or rename, so every change to the admin server-entry surface is reviewed here —
// same reasoning as EXPECTED_ADMIN_ROUTES in admin-routes-static-guard.test.ts.
const EXPECTED_CANDIDATE_FILES = [
  'accounts/page.tsx',
  'anchor-investors/page.tsx',
  'audit/page.tsx',
  'conflicts/page.tsx',
  'dynamic/[table]/[id]/page.tsx',
  'dynamic/[table]/list/page.tsx',
  'dynamic/[table]/page.tsx',
  'dynamic/ipos/[id]/objectives/page.tsx',
  'edit/[slug]/page.tsx',
  'ipos/new/page.tsx',
  'layout.tsx',
  'login/page.tsx',
  'metrics/page.tsx',
  'notifications/page.tsx',
  'page.tsx',
  'pipeline/page.tsx',
  'settings/page.tsx',
];

// Files with NO guarded entry points that are reviewed as carrying no data to protect. Each entry
// needs a one-line reason and is a security decision reviewed in THIS file, same discipline as
// PUBLIC_ADMIN_ROUTES / MACHINE_ONLY_WRITES in admin-routes-static-guard.test.ts.
const ADMIN_SERVER_FILES_WITHOUT_DATA: Record<string, string> = {
  'dynamic/[table]/page.tsx': 'redirect-only — forwards to /admin/dynamic/[table]/list, no data read',
  'ipos/new/page.tsx': 'static form driven by the offeringType schema enum only, no DB/repository call',
};

describe('every non-client admin server file guards its entry points, or is reviewed as data-free', () => {
  const files = listCandidateFiles(ADMIN_ROOT);

  it('finds exactly the expected candidate files', () => {
    const actual = files.map((f) => path.relative(ADMIN_ROOT, f).split(path.sep).join('/')).sort();
    expect(actual).toEqual([...EXPECTED_CANDIDATE_FILES].sort());
  });

  it('has no unguarded entry point outside the reviewed no-data allowlist', () => {
    const offenders = files
      .map((f) => {
        const rel = path.relative(ADMIN_ROOT, f).split(path.sep).join('/');
        return { rel, verdict: evaluateAdminServerFile(fs.readFileSync(f, 'utf8')) };
      })
      .filter(({ rel, verdict }) => {
        if (verdict.status === 'client' || verdict.status === 'guarded') return false;
        // 'unguarded' or 'no-entry-points': allowed ONLY via the explicit, reviewed allowlist —
        // the file's own entry points are NOT guarded, but this exact file was reviewed and its
        // unguarded entry points read no data (a redirect, a static form, ...).
        return !(rel in ADMIN_SERVER_FILES_WITHOUT_DATA);
      })
      .map(({ rel, verdict }) => `${rel}: ${verdict.status}${'reason' in verdict ? ' - ' + verdict.reason : ''}`);
    expect(offenders).toEqual([]);
  });

  describe('detector self-test: the eight round-1 evasion shapes all fail unguarded', () => {
    it('1. an imported helper read with no guard', () => {
      const src = `
        import { loadGrid } from './loader';
        export default async function Page() {
          const grid = await loadGrid();
          return null;
        }
      `;
      expect(evaluateAdminServerFile(src).status).toBe('unguarded');
    });

    it('2. a repository factory call with no guard', () => {
      const src = `
        export default async function Page() {
          const repo = getIpoRepository();
          const rows = await repo.findAll();
          return null;
        }
      `;
      expect(evaluateAdminServerFile(src).status).toBe('unguarded');
    });

    it('3. an aliased db import with no guard', () => {
      const src = `
        import { db as database } from '@/lib/db';
        export default async function Page() {
          const rows = await database.select().from(ipos);
          return null;
        }
      `;
      expect(evaluateAdminServerFile(src).status).toBe('unguarded');
    });

    it('4. an indirect default export (const P = ...; export default P;) with no guard', () => {
      const src = `
        const P = async () => {
          const rows = await db.select().from(ipos);
          return null;
        };
        export default P;
      `;
      expect(evaluateAdminServerFile(src).status).toBe('unguarded');
    });

    it('5. an anonymous arrow default export with no guard', () => {
      const src = `
        export default async () => {
          const rows = await db.select().from(ipos);
          return null;
        };
      `;
      expect(evaluateAdminServerFile(src).status).toBe('unguarded');
    });

    it('6. generateMetadata reads data with no guard, even though the page default export is guarded', () => {
      const src = `
        export default async function Page() {
          const admin = await getAdminSessionFromCookies();
          if (!admin) { redirect('/admin/login'); }
          return null;
        }
        export async function generateMetadata() {
          const rows = await db.select().from(ipos);
          return { title: String(rows.length) };
        }
      `;
      const verdict = evaluateAdminServerFile(src);
      expect(verdict.status).toBe('unguarded');
      expect((verdict as { reason: string }).reason).toContain('generateMetadata');
    });

    it('7. a module-scope read runs before any guard could apply', () => {
      const src = `
        const rows = await db.select().from(ipos);
        export default async function Page() {
          const admin = await getAdminSessionFromCookies();
          if (!admin) { redirect('/admin/login'); }
          return rows;
        }
      `;
      const verdict = evaluateAdminServerFile(src);
      expect(verdict.status).toBe('unguarded');
      expect((verdict as { reason: string }).reason).toContain('module-scope');
    });

    it("8. a 'use server' action file with an unguarded exported function", () => {
      const src = `
        'use server';
        export async function updateThing() {
          const rows = await db.update(ipos).set({});
          return rows;
        }
      `;
      expect(evaluateAdminServerFile(src).status).toBe('unguarded');
    });
  });

  describe('detector self-test: guarded shapes pass', () => {
    it('passes the real getAdminSessionFromCookies + redirect shape (page)', () => {
      const src = `
        export default async function Page() {
          const admin = await getAdminSessionFromCookies();
          if (!admin) {
            redirect('/admin/login');
          }
          const repo = new IPORepository(db, redis);
          return null;
        }
      `;
      expect(evaluateAdminServerFile(src)).toEqual({ status: 'guarded' });
    });

    it('passes requireAdminAuth + if(err) return err (route handler shape)', () => {
      const src = `
        export async function GET(req) {
          const authError = await requireAdminAuth();
          if (authError) return authError;
          return ok();
        }
      `;
      expect(evaluateAdminServerFile(src)).toEqual({ status: 'guarded' });
    });

    it('passes export const GET = withAdminAuth(...)', () => {
      const src = `export const GET = withAdminAuth(async (r, a) => ok());`;
      expect(evaluateAdminServerFile(src)).toEqual({ status: 'guarded' });
    });

    it('passes an indirect default export that IS guarded', () => {
      const src = `
        const P = async () => {
          const admin = await getAdminSessionFromCookies();
          if (!admin) { redirect('/admin/login'); }
          return null;
        };
        export default P;
      `;
      expect(evaluateAdminServerFile(src)).toEqual({ status: 'guarded' });
    });

    it('a client component has no entries to guard (its data comes from an already-guarded API route)', () => {
      const src = `
        'use client';
        export default function Page() {
          const repo = new IPORepository(db, redis);
          return null;
        }
      `;
      expect(evaluateAdminServerFile(src)).toEqual({ status: 'client' });
    });

    it('a genuinely data-free page (no entries at all) is no-entry-points, not silently guarded', () => {
      const src = `export const dynamic = 'force-dynamic';`;
      expect(evaluateAdminServerFile(src)).toEqual({ status: 'no-entry-points' });
    });

    it('does not accept a guard mentioned only in a comment', () => {
      const src = `
        // calls getAdminSessionFromCookies() before reading
        export default async function Page() {
          const repo = new IPORepository(db, redis);
          return null;
        }
      `;
      expect(evaluateAdminServerFile(src).status).toBe('unguarded');
    });
  });
});
