import { describe, it, expect } from 'vitest';
import { uncheckableUniqueIndexRefusal } from './ipo-merge-restore';

// Item 19 / OD-92 (spec §2.3.3.3): the unmerge's unique pre-check refuses, by name, an index it
// cannot evaluate as plain column equality instead of skipping it.
describe('uncheckableUniqueIndexRefusal', () => {
  it('refuses a partial or expression unique index by name', () => {
    expect(uncheckableUniqueIndexRefusal({ table: 'documents', name: 'uq_doc_live', complex: true, nullsNotDistinct: false })).toBe(
      'refused: documents has unique index uq_doc_live the pre-check cannot evaluate'
    );
  });
  it('refuses a NULLS NOT DISTINCT unique index by name', () => {
    expect(
      uncheckableUniqueIndexRefusal({ table: 'ipo_source_keys', name: 'uq_binding', complex: false, nullsNotDistinct: true })
    ).toBe('refused: ipo_source_keys has unique index uq_binding the pre-check cannot evaluate');
  });
  it('lets a plain unique index through to the equality check', () => {
    expect(uncheckableUniqueIndexRefusal({ table: 'documents', name: 'unique_url', complex: false, nullsNotDistinct: false })).toBeNull();
  });
});
