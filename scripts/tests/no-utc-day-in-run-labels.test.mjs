// scripts/tests/no-utc-day-in-run-labels.test.mjs — #687 slice 1 regrowth
// guard. These five files derive a run label / state-file name / dedupe key
// from "today" and MUST use the IST day (scripts/lib/ist-day.mjs istDayIso,
// or scraper's own istDateIso), never the UTC calendar day. This test fails
// if the UTC-day pattern reappears in any of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const GUARDED_FILES = [
  'scripts/audit-detection-floor.mjs',
  'scripts/audit-findings-to-issues.mjs',
  'scripts/audit-prod.mjs',
  'scripts/ops/floor-delta.mjs',
  'scraper/src/services/cross-source-disagreement-monitor.ts',
  // #687 slice 2: the exchange scrapers + description backfill's `today`.
  'scraper/src/scrapers/bse-api-scraper.ts',
  'scraper/src/scrapers/nse-api-client.ts',
  'scraper/src/scrapers/nse-scraper.ts',
  'scraper/src/services/description-backfill.ts',
];

// Matches `new Date().toISOString().slice(0, 10)` and
// `new Date().toISOString().split('T')[0]` — a FRESH clock read, which is
// the UTC calendar day (the class this guard exists to stop regrowing; see
// scripts/lib/ist-day.mjs / scraper's istDateIso for the IST-day
// replacement). Deliberately narrower than "any expr before .toISOString()"
// (#687 slice 2): several guarded files also call `.toISOString()` on an
// already-PARSED date variable (e.g. `date.toISOString().split('T')[0]`
// inside a date-string parser) — a different class (F-104, formatting a
// known date, not deriving "today") that this guard must NOT flag.
const UTC_DAY_PATTERN =
  /new Date\(\)\.toISOString\(\)\.(slice\(0,\s*10\)|split\(['"]T['"]\)\[0\])/;

for (const relPath of GUARDED_FILES) {
  test(`no UTC-day derivation in ${relPath}`, () => {
    const contents = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    const match = contents.match(UTC_DAY_PATTERN);
    assert.equal(
      match,
      null,
      `${relPath} still derives a day from new Date().toISOString() (UTC calendar day) — ` +
        `found: "${match?.[0]}". Use istDayIso()/istDateIso() (IST) for any run label, ` +
        `state-file name or dedupe key. See #687.`
    );
  });
}
