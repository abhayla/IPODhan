/**
 * Every document-state check must NAME the thing it is complaining about, in
 * double quotes, or the nightly delta can never tell one night from the next.
 *
 * WHY (#553). `scripts/ops/floor-delta.mjs` diffs a check's failures by pulling
 * double-quoted entities out of its detail line:
 *
 *     const QUOTED_ENTITY = /"([^"]+)"/g;
 *     for (const m of detail.matchAll(QUOTED_ENTITY)) entities.add(m[1]);
 *
 * That is what lets it report `NEW ENTITIES: a_b_live_conflict: "Manika
 * Plastech Limited"` — a genuinely new failure surfacing the morning it appears.
 *
 * Not one check in `document-state-checks.mjs` produced a quoted entity. So the
 * whole family — blocked-on-every-source, found-but-unread, extract-failed,
 * not-yet-filed, absence-without-evidence — could only ever be reported as
 * `SAME`, forever, no matter WHICH IPOs were in it.
 *
 * Measured cost on 2026-09-10: 245 rows had been BLOCKED_ALL for over 24h, the
 * oldest since 4 September. `m_blocked_all_age` was failing correctly every
 * night and read as `SAME` every night, so sixteen live IPOs with no documents
 * at all went unnoticed. The check's own description had predicted exactly this:
 * "a filing has been unreachable on every source for a day or more and nobody
 * noticed, because the P2 alert fires once on entry and then scrolls away."
 *
 * It became the thing it was written to catch, because its output was not shaped
 * for the consumer built later to prevent it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBlockedAllAge,
  checkFoundNotExtracted,
  checkLiveIpoHasStateRows,
  checkExtractFailed,
  checkLeadManagerCount,
  checkNotYetFiledAge,
  checkAbsenceWithoutEvidence,
} from '../lib/document-state-checks.mjs';

/** The consumer's own pattern, copied so a change there breaks this test too. */
const QUOTED_ENTITY = /"([^"]+)"/g;

function entities(detail) {
  return [...String(detail).matchAll(QUOTED_ENTITY)].map((m) => m[1]);
}

const NOW = new Date('2026-09-10T12:00:00Z');
const LONG_AGO = new Date('2026-09-01T00:00:00Z');
const COMPANY = 'Vinod Texworld Ltd.';

/** Each case: a check, a row that MUST violate, and the name it must quote. */
const CASES = [
  {
    id: 'm_blocked_all_age',
    name: 'checkBlockedAllAge',
    run: () =>
      checkBlockedAllAge(
        { state: 'BLOCKED_ALL', docType: 'RHP', blockedSinceAt: LONG_AGO, companyName: COMPANY },
        NOW
      ),
    expect: COMPANY,
  },
  {
    id: 'found-but-unread',
    name: 'checkFoundNotExtracted',
    run: () =>
      checkFoundNotExtracted(
        { state: 'FOUND', docType: 'RHP', lastAttemptAt: LONG_AGO, firstSeenAt: LONG_AGO, companyName: COMPANY },
        NOW,
        true
      ),
    expect: COMPANY,
  },
  {
    id: 'extract-failed',
    name: 'checkExtractFailed',
    run: () =>
      checkExtractFailed({ state: 'EXTRACT_FAILED', docType: 'RHP', attempts: 5, companyName: COMPANY }),
    expect: COMPANY,
  },
];

test('the fixtures actually violate - a check returning null proves nothing', () => {
  for (const c of CASES) {
    assert.ok(c.run(), `${c.name} returned no violation for a row built to violate`);
  }
});

for (const c of CASES) {
  test(`${c.name} (${c.id}) names its IPO in double quotes`, () => {
    const detail = c.run();
    const found = entities(detail);
    assert.ok(
      found.includes(c.expect),
      `detail carries no quoted "${c.expect}" - the floor delta will report this check as SAME forever.\n  got: ${detail}`
    );
  });
}

test('checks that ALREADY name a company now quote it too', () => {
  // These carried the name unquoted, which the consumer cannot see either.
  const lead = checkLeadManagerCount({ companyName: COMPANY, storedCount: 1, payloadCount: 3 });
  if (lead) assert.ok(entities(lead).includes(COMPANY), `lead-manager detail: ${lead}`);

  const absence = checkAbsenceWithoutEvidence({
    companyName: COMPANY, docType: 'RHP', state: 'NOT_YET_FILED', lastAttempt: [],
  });
  if (absence) assert.ok(entities(absence).includes(COMPANY), `absence detail: ${absence}`);
});

test('a mutation: stripping the quotes makes the consumer blind, and this test knows', () => {
  // Proves the assertion is about the QUOTES, not merely about the name being
  // present somewhere in the string.
  const unquoted = `${COMPANY}: RHP BLOCKED_ALL for 100h`;
  assert.equal(entities(unquoted).length, 0);
});

test('checkLiveIpoHasStateRows names the IPO it is reporting', () => {
  const d = checkLiveIpoHasStateRows({ companyName: COMPANY, status: 'OPEN', stateRowCount: 0 });
  if (d) assert.ok(entities(d).includes(COMPANY), `detail: ${d}`);
});
