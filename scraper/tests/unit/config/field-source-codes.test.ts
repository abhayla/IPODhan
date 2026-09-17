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

/** Extracts the value array from a `pgEnum('scraper_source', [...])` call in schema.ts source text. */
function extractPgEnumValues(filePath: string, enumName: string): Set<string> {
  const src = fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
  const re = new RegExp(`pgEnum\\('${enumName}',\\s*\\[([\\s\\S]*?)\\]\\)`);
  const match = src.match(re);
  if (!match) {
    throw new Error(`could not find "pgEnum('${enumName}', [...])" in ${filePath}`);
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

  it('ScraperSourceValue (backed by the DB-persisted pg enum scraper_source, schema.ts:121) is EQUAL to the writer union (S0d)', () => {
    // scraper_source is a real Postgres enum (packages/shared/src/db/schema.ts:121),
    // also typing field_sources.source (schema.ts:1483) and data_conflicts.source1/
    // source2/resolved_source (schema.ts:1549-1555). S0d widened the pg enum to match
    // the writer union, so ScraperSourceValue must now be EQUAL to it, not a lagging
    // subset — a future widening of the writer union without a matching migration
    // must go red here.
    const dbTypes = extractUnionMembers('packages/shared/src/db/types.ts', 'ScraperSource');
    const failuresRepo = extractUnionMembers(
      'packages/shared/src/repositories/field-extraction-failures-repository.ts',
      'ScraperSourceValue'
    );

    expect(failuresRepo.size).toBeGreaterThan(0);
    expect([...failuresRepo].sort()).toEqual([...dbTypes].sort());

    expect(failuresRepo.has('INVESTORGAIN_GMP')).toBe(true);
    expect(failuresRepo.has('REG')).toBe(true);
  });

  it('the pg enum scraper_source (schema.ts) is EQUAL to the writer union (S0d closes the enum-widening gap)', () => {
    const dbTypes = extractUnionMembers('packages/shared/src/db/types.ts', 'ScraperSource');
    const pgEnumValues = extractPgEnumValues('packages/shared/src/db/schema.ts', 'scraper_source');

    expect(pgEnumValues.size).toBeGreaterThan(0);
    expect([...pgEnumValues].sort()).toEqual([...dbTypes].sort());

    expect(pgEnumValues.has('INVESTORGAIN_GMP')).toBe(true);
    expect(pgEnumValues.has('REG')).toBe(true);
  });

  it('does NOT widen the health unions (types/types.ts, web/lib/db/types.ts) with REG', () => {
    const healthUnion = extractUnionMembers('packages/shared/src/types/types.ts', 'ScraperSource');
    expect(healthUnion.has('REG')).toBe(false);
  });
});
