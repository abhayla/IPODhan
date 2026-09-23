/**
 * #869 — `extraction_status = 'PENDING'` carries two opposite meanings, and
 * nothing distinguishes them:
 *   - "will be processed": the type is in AUTO_PERSIST_DOC_TYPES;
 *   - "can never be processed": every other type. The consumer dispatches on
 *     type and silently skips what it does not recognise, so the row is
 *     admitted, stamped PENDING, skipped on every pass, and stays PENDING
 *     forever.
 *
 * Measured on ipodhan_staging 2026-09-23 (re-measured; the issue's original
 * count of 65 was taken on 09-20 and has since grown):
 *
 *   type                          total  pending  completed  newest
 *   RATIOS_BASIS_ISSUE_PRICE         49       49          0  2026-09-22
 *   SAMPLE_APPLICATION_FORMS          6        6          0  2026-06-19
 *   SECURITY_PARAMS_PRE_ANCHOR        6        6          0  2026-06-19
 *   SECURITY_PARAMS_POST_ANCHOR       3        3          0  2026-06-19
 *   BIDDING_CENTERS                   3        3          0  2026-06-19
 *   CORRIGENDUM                       2        2          0  2026-09-08
 *   BASIS_OF_ALLOTMENT_AD             1        1          0  2026-09-07
 *   ADDENDUM                          1        1          0  2026-09-05
 *                                    71       71          0
 *
 * 100% PENDING with zero COMPLETED across 8 types is the signature of "no
 * handler exists", not of load — a type that is sometimes processed shows a
 * mix. RATIOS_BASIS_ISSUE_PRICE grew 43 -> 49 between the two measurements,
 * with a row written the same day, so this is an open tap and not a backlog.
 *
 * OWNER DECISION 2026-09-23, option A: stamp a terminal, honest status at
 * ADMISSION rather than building eight extractors. The check is set membership
 * against `isExtractableDocType` — the SAME predicate the consumer dispatches
 * on and the nightly `not_applicable_documents_named` check already reads — so
 * the two cannot drift.
 *
 * These tests are red before the change: `resolveAdmissionExtractionStatus`
 * does not exist.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveAdmissionExtractionStatus,
  NOT_EXTRACTABLE_STATUS,
  isExtractableDocType,
  AUTO_PERSIST_DOC_TYPES,
} from '../../../src/services/filing-auto-persist.js';

describe('resolveAdmissionExtractionStatus', () => {
  it('admits an extractable type as PENDING — it really is queued', () => {
    for (const t of AUTO_PERSIST_DOC_TYPES) {
      expect(resolveAdmissionExtractionStatus(t)).toBe('PENDING');
    }
  });

  it('admits a type with NO extractor as NOT_EXTRACTABLE, not PENDING', () => {
    // Every type measured at 100% PENDING on staging.
    for (const t of [
      'RATIOS_BASIS_ISSUE_PRICE',
      'SAMPLE_APPLICATION_FORMS',
      'SECURITY_PARAMS_PRE_ANCHOR',
      'SECURITY_PARAMS_POST_ANCHOR',
      'BIDDING_CENTERS',
      'CORRIGENDUM',
      'BASIS_OF_ALLOTMENT_AD',
      'ADDENDUM',
    ]) {
      expect(resolveAdmissionExtractionStatus(t)).toBe(NOT_EXTRACTABLE_STATUS);
    }
  });

  it('is case-insensitive, like the predicate it delegates to', () => {
    expect(resolveAdmissionExtractionStatus('rhp')).toBe('PENDING');
    expect(resolveAdmissionExtractionStatus('ratios_basis_issue_price')).toBe(NOT_EXTRACTABLE_STATUS);
  });

  it('treats an unknown/ninth type as NOT_EXTRACTABLE — the class, not the eight', () => {
    // The point of deciding by set membership: a type nobody has seen yet gets
    // the honest status on the day it first appears, with no code change.
    expect(resolveAdmissionExtractionStatus('SOME_TYPE_INVENTED_TOMORROW')).toBe(NOT_EXTRACTABLE_STATUS);
  });

  it('treats a null/empty/undefined type as NOT_EXTRACTABLE, never PENDING', () => {
    // Defaulting an unknown shape to PENDING would re-create the bug for the
    // one case least likely to have an extractor.
    expect(resolveAdmissionExtractionStatus('')).toBe(NOT_EXTRACTABLE_STATUS);
    expect(resolveAdmissionExtractionStatus(null as unknown as string)).toBe(NOT_EXTRACTABLE_STATUS);
    expect(resolveAdmissionExtractionStatus(undefined as unknown as string)).toBe(NOT_EXTRACTABLE_STATUS);
  });

  it('agrees with isExtractableDocType for every type — one source of truth', () => {
    // The drift guard. If someone adds an extractor and updates only one of the
    // two, this fails. Checks the union of the real extractable set and the
    // eight measured non-extractable types.
    const types = [...AUTO_PERSIST_DOC_TYPES, 'RATIOS_BASIS_ISSUE_PRICE', 'CORRIGENDUM', 'ADDENDUM'];
    for (const t of types) {
      const expected = isExtractableDocType(t) ? 'PENDING' : NOT_EXTRACTABLE_STATUS;
      expect(resolveAdmissionExtractionStatus(t), `disagreement on ${t}`).toBe(expected);
    }
  });

  it('NOT_EXTRACTABLE_STATUS fits the column and is not an existing status', () => {
    // extraction_status is varchar(50); the values in use on staging are
    // PENDING, COMPLETED, MANUAL_REVIEW, FAILED. A new value must not collide
    // with one of those or it inherits its meaning.
    expect(NOT_EXTRACTABLE_STATUS.length).toBeLessThanOrEqual(50);
    expect(['PENDING', 'COMPLETED', 'MANUAL_REVIEW', 'FAILED', 'IN_PROGRESS'])
      .not.toContain(NOT_EXTRACTABLE_STATUS);
  });
});

describe('the admission site actually uses the predicate', () => {
  it('document-discovery-runner admits with resolveAdmissionExtractionStatus, not a literal', async () => {
    // The predicate passing proves nothing about the CALL SITE. Before this
    // change `document-discovery-runner.ts` wrote `extractionStatus: 'PENDING'`
    // unconditionally; a correct predicate that nothing calls fixes nothing.
    // Asserted on the source so the wiring cannot be quietly reverted.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, '..', '..', '..', 'src', 'services', 'document-discovery-runner.ts'),
      'utf8'
    );

    expect(src).toMatch(/extractionStatus:\s*resolveAdmissionExtractionStatus\(/);
    // And no live admission may hard-code PENDING again.
    const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const hardCoded = codeLines.filter((l) => /extractionStatus:\s*'PENDING'/.test(l));
    expect(hardCoded, 'an admission still hard-codes PENDING: ' + hardCoded.join(' | ')).toEqual([]);
  });
});
