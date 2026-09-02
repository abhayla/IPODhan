import { describe, it, expect } from 'vitest';
import {
  resolveFinalOutcome,
  EXCHANGE_FAILURE_OUTCOMES,
  MIN_RUNGS_FOR_ALL_SOURCES_FAILED,
  type ExchangeVerdict,
  type EscalationVerdict,
} from '../../../src/services/document-discovery-runner.js';
import type { AttemptOutcome } from '../../../src/services/document-state-machine.js';

/** A rung count that satisfies G4 (see MIN_RUNGS_FOR_ALL_SOURCES_FAILED below). */
const FULL_CHAIN = MIN_RUNGS_FOR_ALL_SOURCES_FAILED;
/** Fewer rungs than G4 requires — every existing matrix call defaults to this many unless stated. */
const SHORT_CHAIN = MIN_RUNGS_FOR_ALL_SOURCES_FAILED - 1;

/**
 * T-403 round 6, Class 1 (FOURTH occurrence): absence INHERITED, not minted.
 *
 * Rounds 3-5 each constrained how absence is CONSTRUCTED — the last of them made
 * the `absent` arm carry a branded response no failure path can forge. The
 * round-5 review then found a path that never constructs absence at all: with
 * every escalation rung skipped, `escalateBeyondExchanges` returns null, the
 * caller acted only on `found`/`failed`, and a pre-escalation `outcome =
 * 'no_link'` — set when the exchanges answered but could not SETTLE the type —
 * simply survived to the write. Chain
 * `EXCHANGES:no_link -> SEBI:skipped -> COMPANY:skipped -> VERIFIER:skipped`
 * wrote NOT_YET_FILED: "the company has not filed it", with no retry and no
 * alert, from four rungs of which not one answered the question.
 *
 * A structural test cannot see that: there is nothing to see. The value was not
 * built wrongly, it was merely NOT OVERWRITTEN. So the class fix is to remove
 * the mutable variable: the final outcome is DERIVED from the three facts that
 * decide it, by a pure exhaustive function, and this file pins its whole input
 * space rather than the one cell the review happened to find.
 */

const EXCHANGES: ExchangeVerdict[] = ['found', 'no_link', 'failed'];
const ESCALATIONS: EscalationVerdict[] = ['found', 'absent', 'failed', null];

// exchanges x settled x escalation, every cell named. Anything not listed here
// is a cell nobody thought about, which is how round 5 shipped. Module-scoped
// (not inside a single describe) so the r7 short-chain matrix below can assert
// against it directly, rather than re-typing a second independent copy.
const EXPECTED: Record<string, AttemptOutcome> = {
  // The exchanges found and stored the document — escalation never ran.
  'found|true|null': 'found',
  'found|false|null': 'found',
  // (found + a non-null escalation cannot happen; pinned anyway so a future
  //  refactor that reorders the calls cannot silently change the answer.)
  'found|true|found': 'found',
  'found|true|absent': 'found',
  'found|true|failed': 'found',
  'found|false|found': 'found',
  'found|false|absent': 'found',
  'found|false|failed': 'found',

  // The exchanges answered with no link.
  'no_link|true|null': 'no_link', // they can serve it and covered it: not filed yet
  'no_link|false|null': 'chain_incomplete', // NOBODY answered — the r5 blocker
  'no_link|true|found': 'found',
  'no_link|false|found': 'found',
  'no_link|true|absent': 'no_link', // a rung answered and it is not there
  'no_link|false|absent': 'no_link',
  'no_link|true|failed': 'all_sources_failed', // asked, could not answer -> retry + alert
  'no_link|false|failed': 'all_sources_failed',

  // An exchange we consulted could not answer. Never absence, in any cell.
  'failed|true|null': 'all_sources_failed',
  'failed|false|null': 'all_sources_failed',
  'failed|true|found': 'found',
  'failed|false|found': 'found',
  'failed|true|absent': 'all_sources_failed',
  'failed|false|absent': 'all_sources_failed',
  'failed|true|failed': 'all_sources_failed',
  'failed|false|failed': 'all_sources_failed',
};

describe('resolveFinalOutcome — the round-5 cell', () => {
  it('is chain_incomplete when nothing escalated and the exchanges could not settle it', () => {
    // THE BUG, in one line. Before round 6 this returned 'no_link' -> NOT_YET_FILED.
    expect(resolveFinalOutcome('no_link', false, null, FULL_CHAIN)).toBe('chain_incomplete');
  });

  it('still settles honestly when the exchanges DID cover the IPO', () => {
    // The control: `chain_incomplete` must not swallow the legitimate "the
    // exchanges answered, they can serve this type, it is not filed yet" case.
    expect(resolveFinalOutcome('no_link', true, null, FULL_CHAIN)).toBe('no_link');
  });
});

describe('resolveFinalOutcome — the full input matrix', () => {
  for (const exchanges of EXCHANGES) {
    for (const settled of [true, false]) {
      for (const escalation of ESCALATIONS) {
        const key = `${exchanges}|${settled}|${escalation ?? 'null'}`;
        it(`${key} -> ${EXPECTED[key]} (full chain)`, () => {
          expect(resolveFinalOutcome(exchanges, settled, escalation, FULL_CHAIN)).toBe(EXPECTED[key]);
        });
      }
    }
  }

  it('covers every cell of the matrix — 24 of them, none missing', () => {
    expect(Object.keys(EXPECTED).length).toBe(EXCHANGES.length * 2 * ESCALATIONS.length);
  });

  it('never returns NOT_YET_FILED’s outcome without an answer behind it', () => {
    // The class, asserted as a property rather than as cells: `no_link` (the
    // only outcome that writes NOT_YET_FILED) may be returned ONLY when the
    // exchanges settled it, or when a later rung actually answered `absent`.
    for (const exchanges of EXCHANGES) {
      for (const settled of [true, false]) {
        for (const escalation of ESCALATIONS) {
          if (resolveFinalOutcome(exchanges, settled, escalation, FULL_CHAIN) !== 'no_link') continue;
          const answered = escalation === 'absent' || (exchanges === 'no_link' && settled);
          expect(answered).toBe(true);
        }
      }
    }
  });

  it('is pure — the same inputs give the same answer, with no hidden state', () => {
    for (const exchanges of EXCHANGES) {
      for (const escalation of ESCALATIONS) {
        const a = resolveFinalOutcome(exchanges, false, escalation, FULL_CHAIN);
        const b = resolveFinalOutcome(exchanges, false, escalation, FULL_CHAIN);
        expect(a).toBe(b);
      }
    }
  });
});

/**
 * T-403 round 7, item 4: the G4 short-chain downgrade folded INTO
 * `resolveFinalOutcome` via a `rungCount` argument, so the caller's `outcome`
 * local can be a `const`. This matrix is written by hand, cell by cell — NOT
 * derived by transforming `EXPECTED` above — so a refactor that accidentally
 * changes both the fold and its mechanical inverse still gets caught.
 *
 * THE RULE: every cell that would be `all_sources_failed` on a full chain
 * downgrades to `chain_incomplete` when fewer than
 * `MIN_RUNGS_FOR_ALL_SOURCES_FAILED` rungs were consulted; every other cell
 * (found / no_link / already-chain_incomplete) is UNCHANGED by chain length —
 * a short chain never manufactures a `found` or a `no_link` it did not earn.
 */
describe('resolveFinalOutcome — G4 short-chain downgrade (r7)', () => {
  const EXPECTED_SHORT_CHAIN: Record<string, AttemptOutcome> = {
    'found|true|null': 'found',
    'found|false|null': 'found',
    'found|true|found': 'found',
    'found|true|absent': 'found',
    'found|true|failed': 'found',
    'found|false|found': 'found',
    'found|false|absent': 'found',
    'found|false|failed': 'found',

    'no_link|true|null': 'no_link',
    'no_link|false|null': 'chain_incomplete',
    'no_link|true|found': 'found',
    'no_link|false|found': 'found',
    'no_link|true|absent': 'no_link',
    'no_link|false|absent': 'no_link',
    'no_link|true|failed': 'chain_incomplete', // was all_sources_failed on a full chain
    'no_link|false|failed': 'chain_incomplete', // was all_sources_failed on a full chain

    'failed|true|null': 'chain_incomplete', // was all_sources_failed on a full chain
    'failed|false|null': 'chain_incomplete', // was all_sources_failed on a full chain
    'failed|true|found': 'found',
    'failed|false|found': 'found',
    'failed|true|absent': 'chain_incomplete', // was all_sources_failed on a full chain
    'failed|false|absent': 'chain_incomplete', // was all_sources_failed on a full chain
    'failed|true|failed': 'chain_incomplete', // was all_sources_failed on a full chain
    'failed|false|failed': 'chain_incomplete', // was all_sources_failed on a full chain
  };

  for (const exchanges of EXCHANGES) {
    for (const settled of [true, false]) {
      for (const escalation of ESCALATIONS) {
        const key = `${exchanges}|${settled}|${escalation ?? 'null'}`;
        it(`${key} -> ${EXPECTED_SHORT_CHAIN[key]} (short chain, rungCount=${SHORT_CHAIN})`, () => {
          expect(resolveFinalOutcome(exchanges, settled, escalation, SHORT_CHAIN)).toBe(
            EXPECTED_SHORT_CHAIN[key]
          );
        });
      }
    }
  }

  it('covers every cell — 24 of them, none missing', () => {
    expect(Object.keys(EXPECTED_SHORT_CHAIN).length).toBe(EXCHANGES.length * 2 * ESCALATIONS.length);
  });

  it('never downgrades a cell that was not all_sources_failed on a full chain', () => {
    for (const key of Object.keys(EXPECTED)) {
      if (EXPECTED[key] === 'all_sources_failed') continue;
      expect(EXPECTED_SHORT_CHAIN[key]).toBe(EXPECTED[key]);
    }
  });

  it('a chain exactly at the minimum still permits all_sources_failed (boundary)', () => {
    expect(resolveFinalOutcome('failed', true, null, MIN_RUNGS_FOR_ALL_SOURCES_FAILED)).toBe(
      'all_sources_failed'
    );
    expect(resolveFinalOutcome('failed', true, null, MIN_RUNGS_FOR_ALL_SOURCES_FAILED - 1)).toBe(
      'chain_incomplete'
    );
  });
});

describe('the exchange-failure set is pinned, not just imported', () => {
  it('is exactly the five outcomes that mean "asked and could not answer"', () => {
    // r6 item 5: A4 in the acceptance harness imports this constant so the two
    // can never drift. That makes a SILENT weakening possible — delete an entry
    // and A4 keeps passing while the runner stops treating that outcome as a
    // failure. The literal below is the second opinion.
    expect([...EXCHANGE_FAILURE_OUTCOMES].sort()).toEqual(
      ['board_unavailable', 'http_error', 'no_detail_row', 'shape_error', 'timeout'].sort()
    );
    // `not_on_board` / `no_symbol` are facts, not failures (F13) — an exchange
    // that does not carry this issue answered us truthfully.
    expect(EXCHANGE_FAILURE_OUTCOMES).not.toContain('not_on_board');
    expect(EXCHANGE_FAILURE_OUTCOMES).not.toContain('no_symbol');
    expect(EXCHANGE_FAILURE_OUTCOMES).not.toContain('ok');
  });
});
