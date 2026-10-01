import { describe, it, expect } from 'vitest';

describe('#1300 field suggestion origins are the two origin constants', () => {
  it('FIELD_SUGGESTION_ORIGINS = [NEWER_DOCUMENT_ORIGIN, CORRIGENDUM_ORIGIN]', async () => {
    const { FIELD_SUGGESTION_ORIGINS } = await import('./suggestion-admin-save-close');
    const { NEWER_DOCUMENT_ORIGIN, CORRIGENDUM_ORIGIN } = await import('./corrigendum-suggestions');
    expect([...FIELD_SUGGESTION_ORIGINS].sort()).toEqual([NEWER_DOCUMENT_ORIGIN, CORRIGENDUM_ORIGIN].sort());
  });
});
