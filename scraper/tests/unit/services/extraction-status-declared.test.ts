/**
 * #676 / #634: documents.extraction_status has ONE declared value set, and every failed
 * attempt's cause is appended rather than overwritten.
 *
 * These drive the REAL writers' pure halves: the admission stamp, the attempt-row builder the
 * status writer calls, the schema's CHECK and the migration that creates it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  DOCUMENT_EXTRACTION_STATUSES,
  documents,
  documentExtractionAttempts,
  documentTypeEnum,
} from '../../../../packages/shared/src/db/schema';
import { resolveAdmissionExtractionStatus } from '../../../src/config/document-admission-status';
import { buildExtractionAttemptRow, buildExtractionStatePatch } from '../../../src/services/extraction-state-patch';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function checkSql(table: Parameters<typeof getTableConfig>[0], name: string): string {
  const ck = getTableConfig(table).checks.find((c) => c.name === name);
  if (!ck) throw new Error(`check ${name} not declared`);
  return new PgDialect().sqlToQuery(ck.value).sql;
}
const quoted = (s: string) => [...s.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();

describe('#676: one declared extraction_status set', () => {
  it('is exactly the six measured values; the extraction_logs enum values SUCCESS/PARTIAL are not in it', () => {
    expect([...DOCUMENT_EXTRACTION_STATUSES].sort()).toEqual(
      ['COMPLETED', 'FAILED', 'IN_PROGRESS', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE', 'PENDING']
    );
    expect(DOCUMENT_EXTRACTION_STATUSES).not.toContain('SUCCESS' as never);
    expect(DOCUMENT_EXTRACTION_STATUSES).not.toContain('QUEUED_FOR_REVIEW' as never);
  });

  it('the documents CHECK is generated from the declared set, value for value', () => {
    expect(quoted(checkSql(documents, 'ck_documents_extraction_status'))).toEqual([...DOCUMENT_EXTRACTION_STATUSES].sort());
  });

  it('migration 0065 creates that same CHECK (NOT VALID) and the attempts table', () => {
    const m = readFileSync(join(ROOT, 'web/drizzle/migrations/0065_document_extraction_attempts.sql'), 'utf8');
    const line = m.split('\n').find((l) => l.includes('ADD CONSTRAINT "ck_documents_extraction_status"'));
    expect(line).toBeDefined();
    expect(line).toMatch(/NOT VALID;\s*$/);
    expect(quoted(line!)).toEqual([...DOCUMENT_EXTRACTION_STATUSES].sort());
    expect(m).toMatch(/CREATE TABLE IF NOT EXISTS "document_extraction_attempts"/);
  });

  it('the admission stamp writes only declared values, for every document type', () => {
    for (const t of [...documentTypeEnum.enumValues, '', 'SOMETHING_NEW']) {
      expect(DOCUMENT_EXTRACTION_STATUSES).toContain(resolveAdmissionExtractionStatus(t));
    }
  });

  it('every transition the state patch writes is declared', () => {
    for (const t of ['IN_PROGRESS', 'COMPLETED', 'FAILED', 'PENDING', 'MANUAL_REVIEW'] as const) {
      expect(DOCUMENT_EXTRACTION_STATUSES).toContain(buildExtractionStatePatch(t).extractionStatus as never);
    }
  });
});

describe('#634: a failed attempt appends its cause', () => {
  const now = new Date('2026-09-26T05:00:00Z');

  it('FAILED and MANUAL_REVIEW with a cause produce an attempt row carrying number, cause and time', () => {
    expect(buildExtractionAttemptRow('d1', 'FAILED', 'HARD_FAILURE:3:extractor: exited 1', 3, now)).toEqual({
      documentId: 'd1', attemptNumber: 3, outcome: 'FAILED', cause: 'HARD_FAILURE:3:extractor: exited 1', attemptedAt: now,
    });
    expect(buildExtractionAttemptRow('d1', 'MANUAL_REVIEW', 'blocked_after_10_attempts@v', 10, now)?.outcome).toBe('MANUAL_REVIEW');
  });

  it('the busy-box revert (a previous FAILED restored with no error) is NOT an attempt', () => {
    expect(buildExtractionAttemptRow('d1', 'FAILED', undefined, 4, now)).toBeNull();
  });

  it('a cleared or blank cause, and every non-failure transition, record nothing', () => {
    expect(buildExtractionAttemptRow('d1', 'FAILED', null, 1, now)).toBeNull();
    expect(buildExtractionAttemptRow('d1', 'FAILED', '   ', 1, now)).toBeNull();
    for (const t of ['IN_PROGRESS', 'COMPLETED', 'PENDING'] as const) {
      expect(buildExtractionAttemptRow('d1', t, 'x', 1, now)).toBeNull();
    }
  });

  it('the attempts table only accepts failure outcomes (its own CHECK)', () => {
    expect(quoted(checkSql(documentExtractionAttempts, 'ck_document_extraction_attempts_outcome'))).toEqual(['FAILED', 'MANUAL_REVIEW']);
  });
});
