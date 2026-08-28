import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCUMENT_TYPES,
  PRE_0035_DOCUMENT_TYPES,
  toPre0035DocumentType,
} from '../../../src/services/document-types.js';
import { parseNSEDocuments } from '../../../src/services/primary-source-discovery.js';

/**
 * T-403 M5. The classifier fix is NOT behind ENABLE_DOCUMENT_STATE_MACHINE — it
 * lives in primary-source-discovery.ts, which the flag-OFF legacy backfill also
 * calls. So the legacy path could emit CORRIGENDUM / PRICE_BAND_AD /
 * BASIS_OF_ALLOTMENT_AD into a database whose enum predates migration 0035, and
 * the insert would fail at runtime. These tests pin the guard.
 */
const FIXTURES = join(__dirname, '../../fixtures/documents');
const fixture = (n: string) => JSON.parse(readFileSync(join(FIXTURES, n), 'utf8'));

describe('M5 — the legacy path cannot emit a post-0035 enum value', () => {
  it('names exactly the three values migration 0035 adds', () => {
    const added = DOCUMENT_TYPES.filter((t) => !PRE_0035_DOCUMENT_TYPES.includes(t));
    expect(added.sort()).toEqual(['BASIS_OF_ALLOTMENT_AD', 'CORRIGENDUM', 'PRICE_BAND_AD']);
  });

  it('downgrades each new value to what the pre-0035 enum would have held', () => {
    expect(toPre0035DocumentType('CORRIGENDUM')).toBe('ADDENDUM');
    expect(toPre0035DocumentType('PRICE_BAND_AD')).toBe('ADDENDUM');
    expect(toPre0035DocumentType('BASIS_OF_ALLOTMENT_AD')).toBe('BASIS_OF_ALLOTMENT');
  });

  it('leaves every pre-existing value untouched', () => {
    for (const t of DOCUMENT_TYPES) {
      const mapped = toPre0035DocumentType(t);
      expect(PRE_0035_DOCUMENT_TYPES).toContain(mapped);
      if (PRE_0035_DOCUMENT_TYPES.includes(t)) expect(mapped).toBe(t);
    }
  });

  it('the legacy backfill emits ONLY pre-0035 values for the real NSE payloads', () => {
    for (const f of ['nse-skyways.json', 'nse-madhurknit.json']) {
      const docs = parseNSEDocuments(fixture(f).issueInfo, 'X');
      expect(docs.length).toBeGreaterThan(0);
      for (const d of docs) {
        expect(PRE_0035_DOCUMENT_TYPES).toContain(toPre0035DocumentType(d.type));
      }
    }
  });

  it('a corrigendum-titled NSE row would be a NEW value, and is downgraded', () => {
    // The regression this guards: a title NSE could publish tomorrow.
    const docs = parseNSEDocuments(
      { dataList: [{ title: 'Corrigendum to RHP', value: 'https://x/CORR.zip' }] },
      'X'
    );
    expect(docs[0].type).toBe('CORRIGENDUM');
    expect(PRE_0035_DOCUMENT_TYPES).not.toContain(docs[0].type);
    expect(toPre0035DocumentType(docs[0].type)).toBe('ADDENDUM');
  });

  it('the schema and the migration both carry the three new values', () => {
    const repoRoot = join(__dirname, '../../../..');
    const schema = readFileSync(join(repoRoot, 'packages/shared/src/db/schema.ts'), 'utf8');
    const migration = readFileSync(
      join(repoRoot, 'web/drizzle/migrations/0035_add_document_fetch_state.sql'),
      'utf8'
    );
    for (const value of ['PRICE_BAND_AD', 'CORRIGENDUM', 'BASIS_OF_ALLOTMENT_AD']) {
      expect(schema).toContain(`'${value}'`);
      expect(migration).toContain(`ADD VALUE IF NOT EXISTS '${value}'`);
    }
  });
});
