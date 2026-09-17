import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceCodeSchema } from '../../../src/config/field-manifest-schema.js';
import {
  MANIFEST_TO_WRITER,
  mapManifestSourceToScraperSource,
  writerSourceToManifestCode,
} from '../../../src/config/field-source-codes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../');

/** Extracts the union members from a TS union-type declaration's source text. */
function extractUnionMembers(filePath: string, typeName: string): Set<string> {
  const src = fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
  const re = new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`);
  const match = src.match(re);
  if (!match) {
    throw new Error(`could not find "export type ${typeName} = ..." in ${filePath}`);
  }
  const body = match[1];
  const members = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  return new Set(members);
}


describe('field-source-codes', () => {
  it('maps every sourceCodeSchema value to a writer source', () => {
    for (const code of sourceCodeSchema.options) {
      expect(MANIFEST_TO_WRITER[code], `missing mapping for manifest code ${code}`).toBeDefined();
      expect(typeof MANIFEST_TO_WRITER[code].writerSource).toBe('string');
    }
  });

  it('maps DOC to the writer source DRHP', () => {
    expect(mapManifestSourceToScraperSource('DOC')).toBe('DRHP');
  });

  it('maps every filing document-type code to DRHP', () => {
    for (const code of ['DRHP', 'RHP', 'PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD']) {
      expect(mapManifestSourceToScraperSource(code)).toBe('DRHP');
    }
  });

  it('maps REG identity (writer now has a REG source)', () => {
    expect(mapManifestSourceToScraperSource('REG')).toBe('REG');
  });

  it('is a left-inverse: writerSourceToManifestCode(mapManifestSourceToScraperSource(x)) round-trips for non-document codes', () => {
    for (const code of ['NSE', 'BSE', 'CHITTORGARH', 'MONEYCONTROL', 'INVESTORGAIN_GMP', 'ADMIN', 'REG']) {
      const writer = mapManifestSourceToScraperSource(code);
      expect(writerSourceToManifestCode(writer)).toBe(code);
    }
  });

  it('round-trips DRHP writer source back through docType', () => {
    expect(writerSourceToManifestCode('DRHP', 'RHP')).toBe('RHP');
    expect(writerSourceToManifestCode('DRHP', 'PRICE_BAND_AD')).toBe('PRICE_BAND_AD');
    expect(writerSourceToManifestCode('DRHP')).toBe('DOC');
  });

  it('the two pure-TS writer-source unions are equal sets (db/types.ts, field-priority-matrix.ts)', () => {
    const dbTypes = extractUnionMembers('packages/shared/src/db/types.ts', 'ScraperSource');
    const priorityMatrix = extractUnionMembers(
      'scraper/src/config/field-priority-matrix.ts',
      'ScraperSource'
    );

    expect(dbTypes.size).toBeGreaterThan(0);
    expect(priorityMatrix.size).toBeGreaterThan(0);

    expect([...dbTypes].sort()).toEqual([...priorityMatrix].sort());

    // REG must be present in both pure-TS writer unions after this slice.
    expect(dbTypes.has('REG')).toBe(true);
  });

  it('ScraperSourceValue (backed by the DB-persisted pg enum scraper_source, schema.ts:121) is a SUBSET of the writer union, not required to be equal', () => {
    // scraper_source is a real Postgres enum (packages/shared/src/db/schema.ts:121),
    // also typing field_sources.source (schema.ts:1483) and data_conflicts.source1/
    // source2/resolved_source (schema.ts:1549-1555). Widening it needs a migration —
    // that is slice S0d (Tier A), not this slice. ScraperSourceValue therefore stays
    // a SUBSET of the writer union until S0d lands; it must never gain a member the
    // writer union lacks, but it is allowed to lag (missing INVESTORGAIN_GMP/REG).
    const dbTypes = extractUnionMembers('packages/shared/src/db/types.ts', 'ScraperSource');
    const failuresRepo = extractUnionMembers(
      'packages/shared/src/repositories/field-extraction-failures-repository.ts',
      'ScraperSourceValue'
    );

    expect(failuresRepo.size).toBeGreaterThan(0);
    for (const value of failuresRepo) {
      expect(dbTypes.has(value), `ScraperSourceValue member ${value} not in writer union`).toBe(true);
    }

    // Documents the current lag (S0d closes this gap); not a widening of scope here.
    expect(failuresRepo.has('INVESTORGAIN_GMP')).toBe(false);
    expect(failuresRepo.has('REG')).toBe(false);
  });

  it('does NOT widen the health unions (types/types.ts, web/lib/db/types.ts) with REG', () => {
    const healthUnion = extractUnionMembers('packages/shared/src/types/types.ts', 'ScraperSource');
    expect(healthUnion.has('REG')).toBe(false);
  });
});
