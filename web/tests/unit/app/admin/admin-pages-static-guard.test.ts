/**
 * Class guard: every SERVER page under app/admin/** that reads data (a `db.` property access or
 * constructs a `*Repository(`) calls getAdminSessionFromCookies and redirects away before that
 * read runs.
 *
 * app/admin/layout.tsx is a CLIENT component — it redirects in the browser, after the server has
 * already run the page below it. It protects nothing server-side. The only thing that can stop an
 * anonymous request from reaching admin data is the page's OWN server-side check. A page that
 * forgets it is the `2026-09-24 admin-route auth-hole` class (#1322): web/app/admin/pipeline/page.tsx
 * was exactly this — it read the pipeline repository with no session check at all.
 *
 * The detector parses each file with the TypeScript compiler (see ./admin-page-guard-detector.ts)
 * rather than matching text, so a guard mentioned only in a comment or a string, or one whose
 * result is discarded, is NOT accepted.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateAdminPageGuard } from './admin-page-guard-detector';

const ADMIN_ROOT = path.resolve(__dirname, '../../../../app/admin');

function listPageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listPageFiles(full));
    else if (entry.name === 'page.tsx' || entry.name === 'page.ts') out.push(full);
  }
  return out;
}

// The exact set of app/admin/** page files. An exact list (not a count floor) fails on any add,
// remove or rename, so every change to the admin page surface is reviewed here — same reasoning
// as EXPECTED_ADMIN_ROUTES in admin-routes-static-guard.test.ts.
const EXPECTED_ADMIN_PAGES = [
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
  'login/page.tsx',
  'metrics/page.tsx',
  'notifications/page.tsx',
  'page.tsx',
  'pipeline/page.tsx',
  'settings/page.tsx',
];

describe('every data-reading admin page verifies the session on the server', () => {
  const files = listPageFiles(ADMIN_ROOT);

  it('finds exactly the expected admin page files', () => {
    const actual = files.map((f) => path.relative(ADMIN_ROOT, f).split(path.sep).join('/')).sort();
    expect(actual).toEqual([...EXPECTED_ADMIN_PAGES].sort());
  });

  it('has no server page that reads data without a preceding session guard', () => {
    const offenders = files
      .map((f) => ({
        file: path.relative(ADMIN_ROOT, f).split(path.sep).join('/'),
        verdict: evaluateAdminPageGuard(fs.readFileSync(f, 'utf8')),
      }))
      .filter((r) => r.verdict.status === 'unguarded')
      .map((r) => `${r.file}: ${(r.verdict as { reason: string }).reason}`);
    expect(offenders).toEqual([]);
  });

  describe('detector self-test', () => {
    it('flags a data-reading server page with no guard at all', () => {
      const src = `
        import { db } from '@/lib/db/index';
        export default async function Page() {
          const rows = await db.select().from(ipos);
          return null;
        }
      `;
      expect(evaluateAdminPageGuard(src)).toEqual({
        status: 'unguarded',
        reason: 'no getAdminSessionFromCookies() + redirect guard found before the data read',
      });
    });

    it('flags a guard mentioned only in a comment', () => {
      const src = `
        export default async function Page() {
          // calls getAdminSessionFromCookies() before reading
          const repo = new IPORepository(db, redis);
          return null;
        }
      `;
      expect(evaluateAdminPageGuard(src).status).toBe('unguarded');
    });

    it('flags getAdminSessionFromCookies() called but its result never checked', () => {
      const src = `
        export default async function Page() {
          const admin = await getAdminSessionFromCookies();
          const repo = new IPORepository(db, redis);
          return null;
        }
      `;
      expect(evaluateAdminPageGuard(src).status).toBe('unguarded');
    });

    it('flags the guard running AFTER the data read', () => {
      const src = `
        export default async function Page() {
          const repo = new IPORepository(db, redis);
          const admin = await getAdminSessionFromCookies();
          if (!admin) { redirect('/admin/login'); }
          return null;
        }
      `;
      const verdict = evaluateAdminPageGuard(src);
      expect(verdict).toEqual({ status: 'unguarded', reason: 'the session guard runs AFTER a data read' });
    });

    it('passes the real guard shape (guard before the repository read)', () => {
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
      expect(evaluateAdminPageGuard(src)).toEqual({ status: 'guarded' });
    });

    it('treats a page with no data access at all as no-data-access (redirect-only page)', () => {
      const src = `
        export default async function Page({ params }) {
          const { table } = await params;
          redirect(\`/admin/dynamic/\${table}/list\`);
        }
      `;
      expect(evaluateAdminPageGuard(src)).toEqual({ status: 'no-data-access' });
    });

    it('treats a client component as no-data-access (its server data comes from an already-guarded API route)', () => {
      const src = `
        'use client';
        export default function Page() {
          const repo = new IPORepository(db, redis);
          return null;
        }
      `;
      expect(evaluateAdminPageGuard(src)).toEqual({ status: 'no-data-access' });
    });
  });
});
