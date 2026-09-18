import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #783: the manifest's `comparisonFamily` enum allowed 8 values while
 * `areEquivalent`'s `ComparisonFamily` union implemented 5. SET, BOOLEAN and
 * ABSTAIN -- 24 of 190 fields -- therefore fell through to the generic STRING
 * comparison, which is exactly the behaviour OD-59 exists to remove.
 *
 * Nothing compared the two lists, which is why widening one went unnoticed.
 * This test IS that comparison. It reads both definitions as text rather than
 * importing them, because the failure being guarded against is a mismatch
 * between two source files, and a type import would make the two agree by
 * construction and prove nothing.
 */
const ROOT = join(__dirname, '..', '..', '..');

function manifestFamilies(): Set<string> {
  const src = readFileSync(join(ROOT, 'src', 'config', 'field-manifest-schema.ts'), 'utf8');
  const m = src.match(/comparisonFamily:\s*z\.enum\(\[([^\]]+)\]\)/);
  if (!m) throw new Error('could not find the comparisonFamily z.enum in field-manifest-schema.ts');
  return new Set([...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]));
}

function comparatorFamilies(): Set<string> {
  const src = readFileSync(join(ROOT, 'src', 'services', 'normalization-engine.ts'), 'utf8');
  const m = src.match(/export type ComparisonFamily =([^;]+);/);
  if (!m) throw new Error('could not find the ComparisonFamily union in normalization-engine.ts');
  return new Set([...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]));
}

/**
 * ABSTAIN is the ONE deliberate difference, and it is a difference in kind:
 * every other value tells the comparator HOW to compare two answers, while
 * ABSTAIN tells the VERDICT WRITER not to compare them at all. There is no
 * sensible `areEquivalent(a, b, { family: 'ABSTAIN' })`, so it must be in the
 * manifest and must NOT be in the comparator.
 */
const WRITER_ONLY = new Set(['ABSTAIN']);

describe('comparisonFamily parity between the manifest and the comparator (#783)', () => {
  it('every manifest family except the writer-only ones is implemented by the comparator', () => {
    const missing = [...manifestFamilies()].filter(
      (f) => !WRITER_ONLY.has(f) && !comparatorFamilies().has(f)
    );
    expect(missing).toEqual([]);
  });

  it('the comparator implements no family the manifest cannot produce', () => {
    const extra = [...comparatorFamilies()].filter((f) => !manifestFamilies().has(f));
    expect(extra).toEqual([]);
  });

  it('ABSTAIN is in the manifest and deliberately NOT in the comparator', () => {
    expect(manifestFamilies().has('ABSTAIN')).toBe(true);
    expect(comparatorFamilies().has('ABSTAIN')).toBe(false);
  });

  // Guards the guard: if either regex stops matching, the two sets go empty
  // and every assertion above passes vacuously.
  it('both definitions were actually parsed (a vacuous pass is not a pass)', () => {
    expect(manifestFamilies().size).toBeGreaterThanOrEqual(8);
    expect(comparatorFamilies().size).toBeGreaterThanOrEqual(7);
  });
});
