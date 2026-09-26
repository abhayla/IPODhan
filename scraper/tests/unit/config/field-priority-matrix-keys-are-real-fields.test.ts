/**
 * #754 guard: every FIELD_PRIORITY_MATRIX key must be reachable by a REAL
 * production caller.
 *
 * Class: every test (or matrix entry) that keys the priority matrix by a
 * field name production never uses. getSourcePriority()/getFieldRules()
 * (field-priority-matrix.ts:881-892) look the field up as
 * `FIELD_PRIORITY_MATRIX[toCamelKey(fieldName)] || FIELD_PRIORITY_MATRIX[fieldName]`.
 * Every real caller (data-consolidation-service.ts, writer-source-ranking.ts,
 * field-plan-walk.ts) passes a CAMELCASE field name built from `incomingData`
 * keys (the W-55 comment above `toCamelKey` names this explicitly) — never a
 * snake_case literal. `toCamelKey` only ever REMOVES underscores; it never
 * introduces one. So a snake_case matrix key can be reached ONLY if:
 *   (a) its camelCase equivalent is ALSO a matrix key (the snake_case entry
 *       is then an inert legacy duplicate — `toCamelKey` finds the camelCase
 *       one first, per the W-55 comment), or
 *   (b) something outside this file calls getSourcePriority/getFieldRules
 *       with that literal snake_case string.
 * Neither held for `min_investment` / `issue_price` / `fresh_issue_size` /
 * `offer_for_sale_size` (issue #754) — grepped across scraper/src and
 * scraper/scripts, the only callers pass a camelCase variable. This test
 * makes that class impossible to reintroduce silently: it fails and NAMES
 * any new snake_case key that has no camelCase sibling and is not on the
 * reviewed `KNOWN_DEAD_KEYS` list below.
 *
 * `KNOWN_DEAD_KEYS` is not a free pass — it is the sweep's honest finding:
 * these keys were ALREADY dead (unreachable via toCamelKey by any real
 * caller found in this sweep) before #754, and reclassifying an entry from
 * "unlisted field, default rules" to "explicit sources/confidence/validation"
 * is a production data-consolidation behaviour change that needs its own
 * defect-fix-contract round (RCA + real-data proof), not a silent rename
 * inside a test-fix PR. Removing one from this list without adding the
 * matching camelCase entry (or deleting the dead key from the matrix) will
 * fail this test — that is the intended forcing function for that follow-up.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATRIX_PATH = path.resolve(__dirname, '../../../src/config/field-priority-matrix.ts');

function toCamelKey(fieldName: string): string {
  return fieldName.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** Parse the top-level keys of `FIELD_PRIORITY_MATRIX` out of the source file. */
function extractMatrixKeys(): string[] {
  const src = fs.readFileSync(MATRIX_PATH, 'utf8');
  const start = src.indexOf('export const FIELD_PRIORITY_MATRIX');
  if (start === -1) throw new Error('FIELD_PRIORITY_MATRIX not found — matrix file restructured');
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error('Could not find the end of FIELD_PRIORITY_MATRIX');
  const body = src.slice(braceStart + 1, end);

  const keys: string[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    // Only a TOP-LEVEL key (depth 0 relative to `body`) is a field entry —
    // nested `validation: { min, max }` blocks must not be counted.
    let d = 0;
    for (let j = 0; j < m.index; j++) {
      if (body[j] === '{') d++;
      else if (body[j] === '}') d--;
    }
    if (d === 0) keys.push(m[1]);
  }
  return keys;
}

/**
 * Keys proven dead by this sweep (2026-09-26, #754): snake_case, no camelCase
 * sibling in the matrix, and grepping `getSourcePriority(`/`getFieldRules(`
 * call sites across `scraper/src` and `scraper/scripts` shows every caller
 * passes a camelCase field name. Fixing these for real (adding the matching
 * camelCase entry with correct sources/confidence/validation) is a
 * data-consolidation behaviour change — tracked as follow-up, not done here.
 */
const KNOWN_DEAD_KEYS = new Set([
  'revenue_fy1',
  'fresh_issue_size',
  'offer_for_sale_size',
  'issue_price',
  'min_investment',
  'total_subscription',
  'retail_subscription',
  'qib_subscription',
  'nii_subscription',
  'gmp_percentage',
  'expected_listing_price',
  'listing_price',
  'listing_gain_percentage',
]);

/**
 * `peer_companies` is a snake_case key whose value is a one-to-many payload
 * tracked by TABLE name (`data-consolidation-orchestrator.ts`'s
 * `'peer_companies'` union member, `filing-persister.ts`'s
 * `replaceAllowed('peer_companies', ...)`), not a camelCase scalar field —
 * `toCamelKey` does not apply to it the way it does to a column name. Kept
 * off `KNOWN_DEAD_KEYS` (it is not proven dead, it is a different shape of
 * key) and explicitly allow-listed here instead.
 */
const NON_FIELD_KEYS = new Set(['peer_companies']);

describe('#754: FIELD_PRIORITY_MATRIX has no NEW unreachable snake_case key', () => {
  it('every snake_case key either has a camelCase sibling, is a reviewed dead key, or is a declared non-field key', () => {
    const keys = extractMatrixKeys();
    expect(keys.length).toBeGreaterThan(20); // sanity: the parser actually found the object

    const keySet = new Set(keys);
    const unexplained: string[] = [];

    for (const key of keys) {
      if (!key.includes('_')) continue; // camelCase / no-underscore keys are always reachable
      if (NON_FIELD_KEYS.has(key)) continue;
      const camel = toCamelKey(key);
      const hasCamelSibling = keySet.has(camel);
      const isKnownDead = KNOWN_DEAD_KEYS.has(key);
      if (!hasCamelSibling && !isKnownDead) {
        unexplained.push(key);
      }
    }

    expect(
      unexplained,
      `New unreachable snake_case matrix key(s) found: ${unexplained.join(', ')}. ` +
        `getFieldRules()/getSourcePriority() only reach a snake_case key when its ` +
        `camelCase form is ALSO a key (toCamelKey finds that first) — every real ` +
        `caller passes camelCase. Either add the camelCase sibling entry, delete the ` +
        `dead key, or (if it is a genuinely different shape of key, like a table-name ` +
        `key) add it to NON_FIELD_KEYS with a one-line reason.`
    ).toEqual([]);
  });

  it('every KNOWN_DEAD_KEYS entry is still actually dead (still snake_case, still no camelCase sibling)', () => {
    const keys = extractMatrixKeys();
    const keySet = new Set(keys);
    const noLongerDead: string[] = [];
    const notEvenInMatrix: string[] = [];

    for (const key of KNOWN_DEAD_KEYS) {
      if (!keySet.has(key)) {
        notEvenInMatrix.push(key);
        continue;
      }
      if (keySet.has(toCamelKey(key))) {
        noLongerDead.push(key);
      }
    }

    expect(
      notEvenInMatrix,
      `KNOWN_DEAD_KEYS entries no longer in the matrix (remove them from this list): ${notEvenInMatrix.join(', ')}`
    ).toEqual([]);
    expect(
      noLongerDead,
      `KNOWN_DEAD_KEYS entries that now have a camelCase sibling — remove from this list, ` +
        `they are reachable again: ${noLongerDead.join(', ')}`
    ).toEqual([]);
  });

  it('KNOWN_DEAD_KEYS only ever shrinks (a new dead key is fixed, never added here)', () => {
    // Pinned at the #754 sweep's count. Lower this number when #1186 fixes a key;
    // raising it hides a new unreachable rule instead of fixing it.
    expect(KNOWN_DEAD_KEYS.size).toBeLessThanOrEqual(13);
  });
});
