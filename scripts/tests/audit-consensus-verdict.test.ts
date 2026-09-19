// Mutation-proof self-test for scripts/audit-consensus-verdict.ts (S7 — nightly consensus check,
// docs/design/s7-consensus-check-plan.md). Imports the ACTUAL exported functions under test
// (expectedVerdictForRow / auditRows), which themselves import the REAL computeVerdict
// (scraper/src/services/witness-verdict.ts) -- not a re-implementation. No DB needed: these are
// pure-function fixtures over FieldSourceRow shapes, so they run fast and can't drift from the
// live database's actual contents.
//
// Run: npx tsx --test scripts/tests/audit-consensus-verdict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditRows, decideExit, expectedVerdictForRow, type FieldSourceRow } from '../audit-consensus-verdict.ts';
import { loadFieldManifest } from '../../scraper/src/config/field-manifest-loader.ts';

const manifest = loadFieldManifest();

function mainboardRow(overrides: Partial<FieldSourceRow>): FieldSourceRow {
  return {
    ipoId: '00000000-0000-4000-8000-000000000001',
    companyName: 'Fixture Ltd.',
    segment: 'MAINBOARD',
    listingExchanges: ['NSE', 'BSE'],
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'issueSize', // camelCase -- field_sources.field_name's real spelling
    verdict: null,
    witnesses: [],
    ...overrides,
  };
}

test('plant: CONFIRMED stored on two witnesses that actually DISAGREE -> RED (mismatch found)', () => {
  const row = mainboardRow({
    verdict: 'CONFIRMED',
    witnesses: [
      { source: 'DOC', value: 100_000_000, at: '2026-09-19T00:00:00.000Z' },
      { source: 'NSE', value: 200_000_000, at: '2026-09-19T00:00:00.000Z' }, // 100% apart -- MONEY tolerance is 0.5%
    ],
  });
  const { mismatches } = auditRows([row], manifest);
  assert.equal(mismatches.length, 1, 'a false CONFIRMED on disagreeing witnesses must be caught');
  assert.equal(mismatches[0].expectedVerdict, 'DISPUTED');
  assert.equal(mismatches[0].storedVerdict, 'CONFIRMED');
  assert.equal(mismatches[0].fieldName, 'issueSize');
  assert.equal(mismatches[0].ipoId, row.ipoId, 'reported BY IDENTITY, not as a count');
});

test('plant: DISPUTED stored where only ONE witness answered (the rest abstained, OD-60) -> RED', () => {
  // OD-60: an abstention (NOT_PRINTED / source never answered this pass) never reaches
  // `witnesses` as an entry at all (S3a's suppliedAnswers filters abstentions out before this
  // module ever sees them -- computeVerdict's own doc comment). So the shape of "one real answer
  // plus abstention(s) on a 2+-capable-source field" is a witnesses array with exactly ONE
  // element, not a null-valued second element. That row must be UNCONFIRMED, never DISPUTED --
  // a single witness has nothing to disagree WITH.
  const row = mainboardRow({
    verdict: 'DISPUTED',
    witnesses: [{ source: 'DOC', value: 100_000_000, at: '2026-09-19T00:00:00.000Z' }],
  });
  const { mismatches } = auditRows([row], manifest);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].expectedVerdict, 'UNCONFIRMED', 'a single real answer must never be re-derived as DISPUTED');
});

test('clean: CONFIRMED stored on witnesses that genuinely agree (within MONEY tolerance) -> GREEN', () => {
  const row = mainboardRow({
    verdict: 'CONFIRMED',
    witnesses: [
      { source: 'DOC', value: 1_249_970_000, at: '2026-09-19T00:00:00.000Z' },
      { source: 'NSE', value: 1_250_000_000, at: '2026-09-19T00:00:00.000Z' }, // 0.0024% apart
    ],
  });
  const { mismatches } = auditRows([row], manifest);
  assert.equal(mismatches.length, 0);
});

test('ABSTAIN field: a null verdict is CORRECT by design, never a finding', () => {
  const abstainKey = Object.entries(manifest.fields).find(([, e]) => e.comparisonFamily === 'ABSTAIN')?.[0];
  assert.ok(abstainKey, 'the manifest must have at least one ABSTAIN field for this fixture to be real');
  const [table, ...rest] = abstainKey!.split('.');
  const columnSnake = rest.join('.');
  // Reverse the snake->camel step the real join does, so this fixture matches a real
  // field_sources.field_name spelling rather than the manifest's own snake_case key.
  const camel = columnSnake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const row = mainboardRow({
    tableName: table,
    fieldName: camel,
    verdict: null,
    witnesses: [{ source: 'DOC', value: 'some free text', at: '2026-09-19T00:00:00.000Z' }],
  });
  const derived = expectedVerdictForRow(row, manifest);
  assert.equal(derived, null, 'ABSTAIN fields are excluded from the population entirely');
  const { mismatches, eligibleCount } = auditRows([row], manifest);
  assert.equal(eligibleCount, 0);
  assert.equal(mismatches.length, 0, 'a null verdict on an ABSTAIN field must never be reported');
});

test('non-ABSTAIN field, 2+ capable sources, null verdict -> a FINDING (writer should have computed one)', () => {
  const row = mainboardRow({
    verdict: null, // WRITER_DORMANT case: verdict column empty, but a real answer set exists
    witnesses: [
      { source: 'DOC', value: 1_250_000_000, at: '2026-09-19T00:00:00.000Z' },
      { source: 'NSE', value: 1_250_000_000, at: '2026-09-19T00:00:00.000Z' },
    ],
  });
  const { mismatches, writtenCount, eligibleCount } = auditRows([row], manifest);
  assert.equal(eligibleCount, 1);
  assert.equal(writtenCount, 0, 'a null verdict must not be counted as written');
  assert.equal(mismatches.length, 1, 'null on a 2+-witness non-ABSTAIN field is a finding, not a pass');
  assert.equal(mismatches[0].expectedVerdict, 'CONFIRMED');
});

test('field-name-case: field_sources.field_name (camelCase) must resolve against the snake_case manifest key', () => {
  // Regression for the exact bug this check itself hit while being built: joining fieldName
  // directly (without fieldNameToColumn) against the manifest silently matched nothing, and
  // auditRows reported eligibleCount === 0 even with real, mapped rows present.
  const row = mainboardRow({ fieldName: 'issueSize' });
  const derived = expectedVerdictForRow(row, manifest);
  assert.notEqual(derived, null, 'ipos.issueSize (camelCase) must map to the manifest\'s ipos.issue_size entry');
});

test('SINGLE_SOURCE / NO_WITNESS are resolved PER SEGMENT, not from a static list', () => {
  // A field with exactly 1 capable MAINBOARD source but 0 for SME_NSE (or vice versa) must be
  // judged against THIS row's own segment -- never a hardcoded population.
  const singleSourceKey = Object.entries(manifest.fields).find(
    ([, e]) => e.comparisonFamily !== 'ABSTAIN' && (e.rank.MAINBOARD?.length ?? 0) === 1
  )?.[0];
  assert.ok(singleSourceKey, 'the manifest must have at least one MAINBOARD single-source field');
  const [table, ...rest] = singleSourceKey!.split('.');
  const camel = rest.join('.').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const row = mainboardRow({
    tableName: table,
    fieldName: camel,
    segment: 'MAINBOARD',
    verdict: 'SINGLE_SOURCE',
    witnesses: [{ source: 'DOC', value: 'x', at: '2026-09-19T00:00:00.000Z' }],
  });
  const { mismatches } = auditRows([row], manifest);
  assert.equal(mismatches.length, 0, 'SINGLE_SOURCE on a genuinely 1-capable-source MAINBOARD field must be accepted');
});

test('WRITER_DORMANT: 0 rows total is distinguished from "verified clean" (eligibleCount, not a bare pass)', () => {
  const { mismatches, eligibleCount, writtenCount } = auditRows([], manifest);
  assert.equal(mismatches.length, 0);
  assert.equal(eligibleCount, 0);
  assert.equal(writtenCount, 0);
});

// ---------------------------------------------------------------------------
// #794: WRITER_DORMANT must be a terminal PASS, not a FATAL.
//
// Before this fix the dormant branch PRINTED "WRITER_DORMANT ... ENABLE_VERDICT_WRITER
// is off" and then fell through to the unconditional `mismatches.length > 0` FATAL, so
// the check exited 1 with a mismatch count exactly equal to its eligible population —
// 6715 of 6715 on staging, 2026-09-19. A gate whose only possible output is FATAL
// carries no information: it cannot distinguish "the writer is off" (expected, and the
// state in every environment) from "the writer is on and computing wrong verdicts",
// which is the single case this check exists to catch.
// ---------------------------------------------------------------------------

test('#794 dormant writer: 0 written verdicts is a PASS, however many re-derivations differ', () => {
  const rows = [
    mainboardRow({
      verdict: null,
      witnesses: [
        { source: 'DOC', value: 1_250_000_000, at: '2026-09-19T00:00:00.000Z' },
        { source: 'NSE', value: 1_250_000_000, at: '2026-09-19T00:00:00.000Z' },
      ],
    }),
  ];
  const { mismatches, writtenCount, eligibleCount } = auditRows(rows, manifest);
  assert.equal(writtenCount, 0, 'precondition: the writer is dormant');
  assert.ok(mismatches.length > 0, 'precondition: re-derivation still differs from an empty column');

  const decision = decideExit({ mismatches, writtenCount, eligibleCount });
  assert.equal(decision.code, 0, 'a dormant writer must NOT exit non-zero');
  assert.equal(decision.status, 'PASS');
  assert.match(decision.detail, /WRITER_DORMANT/, 'the reason must name the dormant state');
});

test('#794 the FATAL path still fires when verdicts ARE written and one is wrong', () => {
  const decision = decideExit({
    mismatches: [
      { ipoId: 'x', companyName: 'T', tableName: 'ipos', fieldName: 'issueSize',
        reason: 'stored DISPUTED, re-derived CONFIRMED', expectedVerdict: 'CONFIRMED' } as never,
    ],
    writtenCount: 5,
    eligibleCount: 10,
  });
  assert.equal(decision.code, 1, 'a real wrong verdict must still be FATAL');
  assert.equal(decision.status, 'FAIL');
});
