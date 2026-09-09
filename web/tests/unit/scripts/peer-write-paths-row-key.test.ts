// implements: R-158
/**
 * Row-key coverage for the remaining web-side peer_companies write paths
 * (item 01 slice s1b).
 *
 * `seed-data.ts` and `seed-peer-companies.ts` connect to a real database and
 * call `process.exit()` at import time (they run their seed function as a
 * side effect of being loaded) — they cannot be `import`-ed inside a test
 * process. The two integration test factories
 * (`slug.integration.test.ts`, `calculate-ratings.integration.test.ts`)
 * require a live Postgres + Redis and are exercised by `test:integration`,
 * not this unit suite.
 *
 * This test instead pins the SOURCE TEXT of all four files: each must
 * import the shared `rowKeyForName` function and pass its result as
 * `normalizedName` on every `peerCompanies`/`peer_companies` insert. Delete
 * or bypass the call in any one file and this test goes red — the same
 * mutation-provable guarantee `update-field-record-cache-key.test.ts` gives
 * the admin routes.
 *
 * Under slice s2's `UNIQUE (ipo_id, normalized_name)` constraint, every one
 * of these paths inserts 2+ peers per IPO with the schema's `''` default
 * left unset — the second peer's insert would violate the constraint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const WEB_ROOT = join(__dirname, '../../..');

const FILES_REQUIRING_ROW_KEY = [
  'scripts/seed-data.ts',
  'scripts/seed-peer-companies.ts',
  'tests/integration/api/ipos/slug.integration.test.ts',
  'tests/integration/lib/scripts/calculate-ratings.integration.test.ts',
];

const IMPORTS_ROW_KEY_FN = /rowKeyForName/;
const IMPORTS_FROM_SHARED_NORMALIZER =
  /from\s+['"]@ipodhan\/shared\/utils\/company-name-normalizer['"]/;
// Every `normalizedName` written on a peer_companies insert in these files
// must trace to a `rowKeyForName(...)` call — either inline
// (`normalizedName: rowKeyForName(...)`) or via a same-named local variable
// assigned from it (`const normalizedName = rowKeyForName(...)`, used as
// object-shorthand `normalizedName,` on the insert) — never a bare string,
// never omitted entirely.
const ASSIGNS_ROW_KEY_INLINE = /normalizedName\s*:\s*[^,}\n]*rowKeyForName/;
const DECLARES_ROW_KEY_LOCAL_VAR = /const\s+normalizedName\s*=\s*rowKeyForName\(/;

// A local-var declaration is only proof once the variable is actually
// PASSED into the `.insert(peerCompanies).values(...)` call — declaring it
// and never using it (the gap a first draft of this test missed: deleting
// only the `normalizedName,` shorthand property left the declaration-only
// regex green) must go red. Find each `.values(` call that follows an
// `insert(peerCompanies)`/`insert(schema.peerCompanies)` on a nearby
// earlier line, and require the bare `normalizedName` token inside its
// argument object.
const INSERT_PEER_COMPANIES_VALUES_BLOCK =
  /insert\(\s*(?:schema\.)?peerCompanies\s*\)[\s\S]{0,80}?\.values\(([\s\S]*?)\)(?=\s*[;.\n])/g;
const BARE_NORMALIZED_NAME_TOKEN = /(^|[^.\w])normalizedName(\s*[,:}]|\s*$)/m;

function insertUsesRowKeyLocalVar(src: string): boolean {
  const matches = [...src.matchAll(INSERT_PEER_COMPANIES_VALUES_BLOCK)];
  if (matches.length === 0) return false;
  return matches.some(([, valuesArg]) => BARE_NORMALIZED_NAME_TOKEN.test(valuesArg));
}

describe('web-side peer_companies write paths derive normalizedName via rowKeyForName', () => {
  it.each(FILES_REQUIRING_ROW_KEY)('%s imports the shared rowKeyForName function', (relPath) => {
    const src = readFileSync(join(WEB_ROOT, relPath), 'utf-8');
    expect(IMPORTS_ROW_KEY_FN.test(src)).toBe(true);
    expect(IMPORTS_FROM_SHARED_NORMALIZER.test(src)).toBe(true);
  });

  it.each(FILES_REQUIRING_ROW_KEY)(
    '%s assigns normalizedName from rowKeyForName on the peer_companies insert',
    (relPath) => {
      const src = readFileSync(join(WEB_ROOT, relPath), 'utf-8');
      const inline = ASSIGNS_ROW_KEY_INLINE.test(src);
      const viaLocalVar =
        DECLARES_ROW_KEY_LOCAL_VAR.test(src) && insertUsesRowKeyLocalVar(src);
      expect(inline || viaLocalVar).toBe(true);
    }
  );
});
