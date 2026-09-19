// Pure comparator for the DoD item "every DONE build card has a filled ledger row" —
// extracted from docs/design/check-dod.mjs so it can be unit-tested against fixtures without
// building a full fixture repo root (the real ledger on origin/main is filled right now, so a
// RED proof needs a synthetic "queued" row, not the live file).
//
// Incident this guards against (2026-09-17..20): five stage-3 slices (S1d #753, S2 #757, S3
// #756, S6 #758, S4 #760) were merged and their cards marked `Status: DONE`, but
// docs/design/stage-3-ledger.md kept showing all five as `queued` with empty PR / merged-sha /
// status cells for three days. Nothing asserted the two artifacts agreed, so a supervisor
// resuming from the ledger table alone would have re-dispatched builders for finished work.

/**
 * @param {Record<string,string>} cardStatusByFile  card filename -> full text of its Status: line
 * @param {string} ledgerMarkdown  raw contents of docs/design/stage-3-ledger.md
 * @returns {{ ok: boolean, doneCards: number, violations: Array<{card: string, reason: string}> }}
 */
export function checkLedgerRowsForDoneCards(cardStatusByFile, ledgerMarkdown, cardPrefix = 'item-03-') {
  // Scope: only the cards THIS ledger claims to cover. docs/design/stage-3-ledger.md is the
  // stage 3 ("one source table") ledger and carries rows for item-03 slices only, so a DONE
  // card from another item (item-24, item-30) is not a violation of it -- it is outside its
  // scope. Without this filter the item exits 1 on main the day it merges, and a gate that is
  // red on main is a gate everyone learns to ignore (#821 is exactly that, for
  // check-stage3-dod.mjs). A general "every DONE card is recorded somewhere" check needs a
  // register that claims that job; this is not it.
  const doneCards = Object.entries(cardStatusByFile)
    .filter(([file, statusLine]) => file.startsWith(cardPrefix) && /\bDONE\b/.test(statusLine))
    .map(([file]) => file);

  // Table rows only: lines starting with "|", strip a trailing \r (CRLF source), skip the
  // header and the "|---|" separator row.
  const rows = ledgerMarkdown
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.startsWith('|') && !/^\|\s*-+\s*\|/.test(l) && !l.startsWith('| Slice |'));

  const violations = [];
  for (const card of doneCards) {
    const row = rows.find((r) => r.includes(card));
    if (!row) {
      violations.push({ card, reason: 'no ledger row names this card file' });
      continue;
    }
    const cells = row.split('|').map((c) => c.trim());
    // cells[0] is '' (text before the leading |); PR is the 4th data column: Slice, Tier, Card, PR
    const prCell = cells[4] ?? '';
    if (prCell === '') {
      violations.push({ card, reason: 'ledger row PR cell is empty (row still reads as queued)' });
    }
  }

  return { ok: violations.length === 0, doneCards: doneCards.length, violations };
}
