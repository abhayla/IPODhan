/**
 * Regression test for T-223 — the Windows CLI-entry-guard bug shipped in PR #116.
 *
 * `if (import.meta.url === \`file://${process.argv[1]}\`)` silently never matches on
 * Windows: import.meta.url is `file:///C:/...` (three slashes, forward slashes) while
 * process.argv[1] is `C:\...` (backslashes). The guard fails closed, so `main()` is
 * never called, the process exits 0/0 lines, and every layer above it (PM2, the
 * cron, the freshness watchdog running inside it) sees a clean completion.
 *
 * `pathToFileURL(process.argv[1]).href` is Node's own path-to-URL conversion — it MUST
 * be used instead of hand-rolled slash replacement (a prior fix attempt in
 * backfill-lot-size-from-chittorgarh.ts did `argv[1].replace(/\\/g, '/')`, which is
 * still wrong: it produces `file://C:/...` — two slashes before the drive letter,
 * not the three Node actually emits for a Windows absolute path).
 *
 * `{ windows: true/false }` is an explicit option on Node's pathToFileURL (available
 * since Node 20.9) used here ONLY to make this test deterministic regardless of the
 * OS running the suite — production code passes no such option, since both the dev
 * machine and the deploy target (the Windows VPS) are win32 natively.
 */

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';

describe('CLI entry guard — Windows path bug (T-223 / PR #116)', () => {
  // Real values observed on the Windows VPS: process.argv[1] uses backslashes,
  // import.meta.url is what Node's ESM loader actually produces for that same file.
  const windowsArgv1 = String.raw`C:\Apps\IPODhan\current\scraper\src\index.ts`;
  const windowsImportMetaUrl = 'file:///C:/Apps/IPODhan/current/scraper/src/index.ts';

  it('FAILS with the old broken pattern — proves the bug', () => {
    // This is exactly what shipped in PR #116: `file://${process.argv[1]}`
    const oldPatternResult = `file://${windowsArgv1}`;

    expect(oldPatternResult).not.toBe(windowsImportMetaUrl);
    // Never matches on Windows -> main() is never called -> silent exit 0.
    expect(oldPatternResult === windowsImportMetaUrl).toBe(false);
  });

  it('PASSES with pathToFileURL — proves the fix', () => {
    const newPatternResult = pathToFileURL(windowsArgv1, { windows: true }).href;

    expect(newPatternResult).toBe(windowsImportMetaUrl);
    expect(newPatternResult === windowsImportMetaUrl).toBe(true);
  });

  it('a hand-rolled backslash replace is ALSO wrong — do not reintroduce it', () => {
    // A prior fix attempt (backfill-lot-size-from-chittorgarh.ts, pre-T-223) did this.
    // It fixes the slashes but still produces only two slashes before the drive
    // letter instead of the three Node's own converter emits.
    const handRolledResult = `file://${windowsArgv1.replace(/\\/g, '/')}`;

    expect(handRolledResult).not.toBe(windowsImportMetaUrl);
  });

  it('still matches correctly on POSIX-style paths (no regression for prod deploy targets)', () => {
    const posixArgv1 = '/app/scraper/src/index.ts';
    const posixImportMetaUrl = 'file:///app/scraper/src/index.ts';

    expect(pathToFileURL(posixArgv1, { windows: false }).href).toBe(posixImportMetaUrl);
  });
});
