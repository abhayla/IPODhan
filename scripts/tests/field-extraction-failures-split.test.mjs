import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitExtractionFailureRows } from '../lib/field-extraction-failures-split.mjs';

// #1246 (D'): staging rule mix read 2026-10-01: NOT_PRINTED rows are recorded ABSENCES
// (the document does not print the section), not values a rule rejected.
test('#1246 NOT_PRINTED rows are absences, never counted as rejected values or against --fail-over', () => {
  const rows = [
    { rule_id: 'NOT_PRINTED', failures: 34, ipos: 15 },
    { rule_id: 'EXTRACTION_FAILED', failures: 9, ipos: 8 },
    { rule_id: 'VALIDATION_RULE_FAILED:pe_range', failures: 3, ipos: 2 },
  ];
  const { absences, rejections } = splitExtractionFailureRows(rows);
  assert.deepEqual(absences.map((r) => r.rule_id), ['NOT_PRINTED']);
  assert.deepEqual(rejections.map((r) => r.rule_id), ['EXTRACTION_FAILED', 'VALIDATION_RULE_FAILED:pe_range']);
});
