/**
 * Item 21 slice 4. The block-to-field map is hand-written — nothing in the
 * codebase knows which UI block renders which column — so the only thing that
 * stops it rotting is a test that reads the manifest itself.
 *
 * Same technique as page-revalidation-targets (item 21 slice 3b): classify
 * EVERY member of the real population, with a reason for each exclusion, and
 * fail when a new member is neither. A map that silently drops a field does not
 * throw; it just stops showing a provenance line, which looks exactly like an
 * IPO that has no provenance yet.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROVENANCE_FIELD_GROUPS,
  NOT_IN_ANY_BLOCK,
} from '@/lib/services/provenance-field-groups';

function manifestFieldKeys(): string[] {
  const file = path.join(process.cwd(), '..', 'scraper', 'config', 'field-manifest.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { fields: Record<string, unknown> };
  return Object.keys(raw.fields);
}

describe('provenance field groups', () => {
  it('reads a real manifest, not an empty one — the population must be able to fail this test', () => {
    expect(manifestFieldKeys().length).toBeGreaterThan(5);
  });

  it('classifies every manifest field as rendered in a block or explicitly not', () => {
    const grouped = new Set(Object.values(PROVENANCE_FIELD_GROUPS).flat());
    const unclassified = manifestFieldKeys().filter(
      (key) => !grouped.has(key) && !(key in NOT_IN_ANY_BLOCK)
    );
    expect(unclassified).toEqual([]);
  });

  it('names no field that the manifest does not have — a typo here shows nothing, silently', () => {
    const known = new Set(manifestFieldKeys());
    const unknown = [
      ...Object.values(PROVENANCE_FIELD_GROUPS).flat(),
      ...Object.keys(NOT_IN_ANY_BLOCK),
    ].filter((key) => !known.has(key));
    expect(unknown).toEqual([]);
  });

  it('gives every exclusion a real reason, not a placeholder', () => {
    for (const [key, reason] of Object.entries(NOT_IN_ANY_BLOCK)) {
      expect(reason.length, `${key} has no usable reason`).toBeGreaterThan(20);
    }
  });

  it('uses table.column keys, matching the manifest and ipo_field_plan, not camelCase', () => {
    for (const key of Object.values(PROVENANCE_FIELD_GROUPS).flat()) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });
});
