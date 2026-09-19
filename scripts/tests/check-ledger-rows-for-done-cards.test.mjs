// Fixture-driven unit test for the pure comparator behind check-dod.mjs's
// "DONE card has a filled ledger row" item. A fixture, not the live ledger, proves RED: the
// real docs/design/stage-3-ledger.md is filled as of this change, so only a synthetic
// "queued, empty cells" row can show the check catching the incident it targets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLedgerRowsForDoneCards } from '../../docs/design/check-ledger-rows-for-done-cards.mjs';

const HEADER =
  '| Slice | Tier | Card | PR | Merged sha | Review verdict | Staging proof (identity, cycle) | Gate run (date, PASS/total) | Board | Status |\r\n' +
  '|---|---|---|---|---|---|---|---|---|---|\r\n';

test('RED: a DONE card whose ledger row is still queued with an empty PR cell fails', () => {
  const cardStatusByFile = {
    'item-03-s1d-matrix-shim-and-provenance.md': 'Status: DONE 2026-09-17 PRs #753 proof 2026-09-19 board',
  };
  const ledger =
    HEADER +
    '| S1d | A | item-03-s1d-matrix-shim-and-provenance.md | | | | | | | queued |\r\n';

  const result = checkLedgerRowsForDoneCards(cardStatusByFile, ledger);

  assert.equal(result.ok, false, 'a DONE card with an empty-PR ledger row must fail the check');
  assert.equal(result.doneCards, 1);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].card, 'item-03-s1d-matrix-shim-and-provenance.md');
  assert.match(result.violations[0].reason, /empty|queued/);
});

test('RED: a DONE card with no ledger row at all fails', () => {
  const cardStatusByFile = {
    'item-03-s9-nonexistent.md': 'Status: DONE 2026-09-19 PRs #999',
  };
  const ledger = HEADER + '| S1d | A | item-03-s1d-matrix-shim-and-provenance.md | #753 | abcdef01 | | | | | landed |\r\n';

  const result = checkLedgerRowsForDoneCards(cardStatusByFile, ledger);

  assert.equal(result.ok, false);
  assert.equal(result.violations[0].card, 'item-03-s9-nonexistent.md');
  assert.match(result.violations[0].reason, /no ledger row/);
});

test('GREEN: a DONE card whose ledger row names it and carries a non-empty PR cell passes', () => {
  const cardStatusByFile = {
    'item-03-s1d-matrix-shim-and-provenance.md': 'Status: DONE 2026-09-17 PRs #753 proof 2026-09-19 board',
  };
  const ledger =
    HEADER +
    '| S1d | A | item-03-s1d-matrix-shim-and-provenance.md | #753 | abcdef01 | Tier A | proof line | 2026-09-19, 6/6 | item-03 | landed |\r\n';

  const result = checkLedgerRowsForDoneCards(cardStatusByFile, ledger);

  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('a card whose Status line is not DONE (e.g. NOT STARTED, queued) is not checked at all', () => {
  const cardStatusByFile = {
    'item-33-repoint-check-dod.md': 'Status: NOT STARTED',
  };
  const ledger = HEADER; // no rows at all — still fine, this card is out of population

  const result = checkLedgerRowsForDoneCards(cardStatusByFile, ledger);

  assert.equal(result.ok, true);
  assert.equal(result.doneCards, 0);
});

test('a DONE-with-caveats status line ("DONE ... proof owed") still counts as DONE for this check', () => {
  const cardStatusByFile = {
    'item-03-s4-override-layer.md': 'Status: DONE 2026-09-18 PRs #760 proof owed (board: merged, proof owed)',
  };
  const ledger = HEADER + '| S4 | A | item-03-s4-override-layer.md | | | | | | | queued |\r\n';

  const result = checkLedgerRowsForDoneCards(cardStatusByFile, ledger);

  assert.equal(result.ok, false, 'DONE-with-a-caveat is still DONE; an empty ledger row must still fail');
});
