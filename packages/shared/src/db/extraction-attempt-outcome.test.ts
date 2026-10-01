import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCUMENT_EXTRACTION_ATTEMPT_OUTCOMES, type DocumentExtractionAttempt } from './schema';

/**
 * #1159 item 3: `document_extraction_attempts.outcome` is typed to exactly what its CHECK allows
 * (FAILED, MANUAL_REVIEW), so a write of any other status fails to compile instead of at the CHECK.
 */
describe('document_extraction_attempts.outcome (#1159)', () => {
  it('declares exactly the values the migration CHECK allows', () => {
    expect([...DOCUMENT_EXTRACTION_ATTEMPT_OUTCOMES]).toEqual(['FAILED', 'MANUAL_REVIEW']);
    const migration = readFileSync(join(__dirname, '../../../../web/drizzle/migrations/0065_document_extraction_attempts.sql'), 'utf-8');
    const list = DOCUMENT_EXTRACTION_ATTEMPT_OUTCOMES.map((v) => `'${v}'`).join(', ');
    expect(migration).toContain(`"outcome" IN (${list})`);
  });

  it('the column type refuses a status the CHECK refuses (compile-time)', () => {
    const ok: DocumentExtractionAttempt['outcome'] = 'MANUAL_REVIEW';
    // @ts-expect-error COMPLETED is a document status, never an attempt outcome
    const refused: DocumentExtractionAttempt['outcome'] = 'COMPLETED';
    expect([ok, refused]).toHaveLength(2);
  });
});
