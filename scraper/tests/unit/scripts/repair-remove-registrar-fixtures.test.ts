import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FIXTURE_REGISTRARS,
  selectFixtureRowsForDeletion,
  type CandidateRegistrarRow,
} from '../../../scripts/repair-remove-registrar-fixtures.js';

describe('repair-remove-registrar-fixtures', () => {
  describe('FIXTURE_REGISTRARS matches the integration test file (no drift)', () => {
    it('parses the same (name, email) tuples out of registrars.integration.test.ts', () => {
      const testFilePath = path.join(
        __dirname,
        '../../../../web/tests/integration/api/registrars.integration.test.ts'
      );
      const source = readFileSync(testFilePath, 'utf-8');

      // Pull every `name: '...'` / `email: '...'` pair inside the testRegistrars
      // array literal, in source order — a lightweight parse, not a lexer, but
      // sufficient for a flat array-of-object-literals with quoted strings.
      const nameMatches = [...source.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
      const emailMatches = [...source.matchAll(/email:\s*'([^']+)'/g)].map((m) => m[1]);

      expect(nameMatches.length).toBe(FIXTURE_REGISTRARS.length);
      expect(emailMatches.length).toBe(FIXTURE_REGISTRARS.length);

      const parsedTuples = nameMatches.map((name, i) => ({ name, email: emailMatches[i] }));
      expect(parsedTuples).toEqual(FIXTURE_REGISTRARS.map((f) => ({ name: f.name, email: f.email })));
    });
  });

  describe('selectFixtureRowsForDeletion', () => {
    const rowA: CandidateRegistrarRow = { id: 'a', name: 'Alpha Registrar Services Ltd', email: 'info@alpharegistrar.com' };
    const rowB: CandidateRegistrarRow = { id: 'b', name: 'Beta Registrar Technologies', email: 'contact@betaregistrar.com' };
    const rowC: CandidateRegistrarRow = { id: 'c', name: 'Gamma Corporate Services', email: 'support@gamma.com' };

    it('selects all candidates for deletion when none are referenced', () => {
      const result = selectFixtureRowsForDeletion([rowA, rowB, rowC], new Set());
      expect(result.toDelete.map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(result.skippedReferenced).toEqual([]);
    });

    it('refuses a fixture row referenced by an ipos.registrar_id', () => {
      const result = selectFixtureRowsForDeletion([rowA, rowB, rowC], new Set(['b']));
      expect(result.toDelete.map((r) => r.id)).toEqual(['a', 'c']);
      expect(result.skippedReferenced.map((r) => r.id)).toEqual(['b']);
    });

    it('refuses every candidate when all are referenced', () => {
      const result = selectFixtureRowsForDeletion([rowA, rowB], new Set(['a', 'b']));
      expect(result.toDelete).toEqual([]);
      expect(result.skippedReferenced.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('returns empty results for an empty candidate list', () => {
      const result = selectFixtureRowsForDeletion([], new Set(['x']));
      expect(result.toDelete).toEqual([]);
      expect(result.skippedReferenced).toEqual([]);
    });
  });
});
