// Mutation-proof self-tests for scripts/lib/document-state-checks.mjs (T-403).
//
// Imports the ACTUAL predicates — not a re-implementation — so weakening or
// deleting a check turns its fixture RED. Each check has a fixture matching the
// failure SHAPE it exists to catch (which MUST fail) and a clean fixture (which
// MUST pass). Run: node --test scripts/tests/document-state-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBlockedAllAge,
  checkFoundNotExtracted,
  checkLiveIpoHasStateRows,
  checkExtractFailed,
  checkLeadManagerCount,
  checkDocumentTypeMatchesClassifier,
  checkNotYetFiledAge,
  checkAbsenceWithoutEvidence,
  answeredRungsIn,
  chainFromLastAttempt,
  EXCHANGE_UNSERVED_DOC_TYPES,
  NOT_YET_FILED_MAX_DAYS,
  countBsePayloadLeadManagers,
  BLOCKED_ALL_MAX_HOURS,
  FOUND_UNREAD_MAX_HOURS,
} from '../lib/document-state-checks.mjs';

const NOW = '2026-08-28T06:00:00Z';
const hoursAgo = (h) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

// --- 60: BLOCKED_ALL > 24h --------------------------------------------------

test('60 FAILs a document blocked on every source for over 24h', () => {
  const violation = checkBlockedAllAge(
    { docType: 'RHP', state: 'BLOCKED_ALL', blockedSinceAt: hoursAgo(30), lastAttemptAt: hoursAgo(0.2) },
    NOW
  );
  assert.match(violation, /BLOCKED_ALL for 30\.0h/);
});

test('60b ages from blockedSinceAt, NOT lastAttemptAt', () => {
  // A row retried every 30 min has a fresh last-attempt forever, so measuring
  // from it would mean this check could never fire. That is the mutation.
  const row = { docType: 'RHP', state: 'BLOCKED_ALL', blockedSinceAt: hoursAgo(72), lastAttemptAt: hoursAgo(0.1) };
  assert.ok(checkBlockedAllAge(row, NOW), 'a 3-day outage must fail despite a fresh attempt');
});

test('60c PASSes a fresh block and any non-blocked state', () => {
  assert.equal(
    checkBlockedAllAge({ docType: 'RHP', state: 'BLOCKED_ALL', blockedSinceAt: hoursAgo(2) }, NOW),
    null
  );
  assert.equal(checkBlockedAllAge({ docType: 'RHP', state: 'FOUND' }, NOW), null);
  assert.equal(checkBlockedAllAge({ docType: 'RHP', state: 'NOT_YET_FILED' }, NOW), null);
  assert.equal(BLOCKED_ALL_MAX_HOURS, 24);
});

// --- 61: FOUND but unread > 48h --------------------------------------------

test('61 FAILs a document found over 48h ago and never extracted', () => {
  const violation = checkFoundNotExtracted(
    { docType: 'RHP', state: 'FOUND', lastAttemptAt: hoursAgo(60) },
    NOW,
    true
  );
  assert.match(violation, /FOUND but unread for 60\.0h/);
  assert.equal(FOUND_UNREAD_MAX_HOURS, 48);
});

test('61b is INERT until the extractor is wired (WP C)', () => {
  // While extraction is off, FOUND is terminal by design — firing here would
  // fail every row on day one and train everyone to ignore the check.
  assert.equal(
    checkFoundNotExtracted({ docType: 'RHP', state: 'FOUND', lastAttemptAt: hoursAgo(500) }, NOW, false),
    null
  );
});

test('61c PASSes a recently found document and an already-extracted one', () => {
  assert.equal(
    checkFoundNotExtracted({ docType: 'RHP', state: 'FOUND', lastAttemptAt: hoursAgo(3) }, NOW, true),
    null
  );
  assert.equal(
    checkFoundNotExtracted({ docType: 'RHP', state: 'EXTRACTED', lastAttemptAt: hoursAgo(500) }, NOW, true),
    null
  );
});

// --- 62: a live IPO with no state rows --------------------------------------

test('62 FAILs an OPEN IPO with zero state rows — the job forgot it', () => {
  const violation = checkLiveIpoHasStateRows({
    companyName: 'Skyways Air Services Ltd.',
    status: 'OPEN',
    stateRowCount: 0,
  });
  assert.match(violation, /0 document_fetch_state rows/);
});

test('62b covers UPCOMING and CLOSED too — a DRHP and a Prospectus are due there', () => {
  for (const status of ['UPCOMING', 'CLOSED']) {
    assert.ok(checkLiveIpoHasStateRows({ companyName: 'X', status, stateRowCount: 0 }));
  }
});

test('62c PASSes a live IPO with rows, and ignores LISTED/WITHDRAWN', () => {
  assert.equal(checkLiveIpoHasStateRows({ companyName: 'X', status: 'OPEN', stateRowCount: 6 }), null);
  assert.equal(checkLiveIpoHasStateRows({ companyName: 'X', status: 'LISTED', stateRowCount: 0 }), null);
  assert.equal(checkLiveIpoHasStateRows({ companyName: 'X', status: 'WITHDRAWN', stateRowCount: 0 }), null);
});

// --- 63: EXTRACT_FAILED (WARN) ----------------------------------------------

test('63 WARNs on EXTRACT_FAILED and names the extractor version', () => {
  const violation = checkExtractFailed({ docType: 'RHP', state: 'EXTRACT_FAILED', extractorVersion: 'v3' });
  assert.match(violation, /EXTRACT_FAILED/);
  assert.match(violation, /v3/);
  assert.equal(checkExtractFailed({ docType: 'RHP', state: 'FOUND' }), null);
});

// --- 64: BRLM count vs the BSE payload --------------------------------------

test('64 FAILs when fewer lead managers are stored than BSE lists (the F17 class)', () => {
  // The exact live defect: Skyways' payload lists 3, the old parser stored 2,
  // and nothing compared the two numbers, so it was invisible for as long as it
  // existed. This check is the detection upgrade for that class.
  const violation = checkLeadManagerCount({
    companyName: 'Skyways Air Services Ltd.',
    storedLeadManagerCount: 2,
    bsePayloadLeadManagerCount: 3,
  });
  assert.match(violation, /2 lead manager\(s\) stored but the BSE payload lists 3/);
});

test('64b PASSes an exact match, and does NOT flag storing MORE than BSE lists', () => {
  assert.equal(
    checkLeadManagerCount({ companyName: 'X', storedLeadManagerCount: 3, bsePayloadLeadManagerCount: 3 }),
    null
  );
  // Other sources legitimately add managers BSE omits.
  assert.equal(
    checkLeadManagerCount({ companyName: 'X', storedLeadManagerCount: 4, bsePayloadLeadManagerCount: 3 }),
    null
  );
  // No BSE payload to compare against is not a violation.
  assert.equal(
    checkLeadManagerCount({ companyName: 'X', storedLeadManagerCount: 0, bsePayloadLeadManagerCount: 0 }),
    null
  );
});

test('64c counts the REAL Skyways payload as 3 lead managers', () => {
  // Verbatim from api.bseindia.com GetMkt_ISSUE_BBS_IPO/w?IPO_NO=7903, 2026-08-28.
  const brlm = 'Holani Consultants Private Limited^||||||||ipo@holaniconsultants.co.in|Payal Jain';
  const co =
    'Shannon Advisors Private Limited^||||||||pavan@shannon.co.in' +
    '#Dolat Finserv Private Limited^||||||||skyways.ipo@dolatfinserv.com';
  assert.equal(countBsePayloadLeadManagers(brlm, co), 3);
  assert.equal(countBsePayloadLeadManagers(brlm, ''), 1);
  assert.equal(countBsePayloadLeadManagers('', ''), 0);
});

// --- M6: stored type vs the classifier -------------------------------------

const REFINEMENTS = {
  RHP: ['PROSPECTUS'],
  ADDENDUM: ['CORRIGENDUM', 'PRICE_BAND_AD'],
  BASIS_OF_ALLOTMENT: ['BASIS_OF_ALLOTMENT_AD'],
};
const classify = (url, title) => {
  const text = `${url} ${title}`.toLowerCase();
  if (text.includes('price band')) return 'PRICE_BAND_AD';
  if (text.includes('corrigendum')) return 'CORRIGENDUM';
  if (text.includes('red herring') || text.includes('rhp')) return 'RHP';
  if (text.includes('prospectus')) return 'PROSPECTUS';
  return null;
};

test('65 FAILs a final Prospectus still stored as RHP (the forward-only gap)', () => {
  const violation = checkDocumentTypeMatchesClassifier(
    { url: 'https://x/Prospectus_Skyways.pdf', title: 'Prospectus', type: 'RHP' },
    classify,
    REFINEMENTS
  );
  assert.match(violation, /stored as RHP but classifies as PROSPECTUS/);
});

test('65b FAILs a corrigendum and a price-band ad still stored as ADDENDUM', () => {
  assert.ok(
    checkDocumentTypeMatchesClassifier(
      { url: 'https://x/CorrigendumofRHP.pdf', title: 'Corrigendum', type: 'ADDENDUM' },
      classify,
      REFINEMENTS
    )
  );
  assert.ok(
    checkDocumentTypeMatchesClassifier(
      { url: 'https://x/a.pdf', title: 'Price Band Advertisement', type: 'ADDENDUM' },
      classify,
      REFINEMENTS
    )
  );
});

test('65c PASSes a correctly-typed row', () => {
  assert.equal(
    checkDocumentTypeMatchesClassifier(
      { url: 'https://x/RHP_SKYWAYS.zip', title: 'Red Herring Prospectus', type: 'RHP' },
      classify,
      REFINEMENTS
    ),
    null
  );
});

test('65d does NOT page nightly for an UNRELATED reclassification', () => {
  // That is a source or classifier change for a human, surfaced by the re-type
  // script — not something to page about every night.
  assert.equal(
    checkDocumentTypeMatchesClassifier(
      { url: 'https://x/anchor.zip', title: 'Anchor Allocation Report', type: 'BIDDING_CENTERS' },
      classify,
      REFINEMENTS
    ),
    null
  );
});

test('65e never degrades: PROSPECTUS stored, RHP suggested, is not a FAIL', () => {
  assert.equal(
    checkDocumentTypeMatchesClassifier(
      { url: 'https://x/RHP.pdf', title: 'rhp', type: 'PROSPECTUS' },
      classify,
      REFINEMENTS
    ),
    null
  );
});

// --- M-4: NOT_YET_FILED age --------------------------------------------------

test('66 FAILs a DRHP still NOT_YET_FILED 14+ days after first sight (the B-1 shape)', () => {
  // This is the exact shape T-403's B-1 produced: the SEBI rung could never fire
  // for a DRHP, so it sat NOT_YET_FILED for the life of the IPO and NOTHING
  // would have noticed. That is why this check exists.
  const violation = checkNotYetFiledAge(
    { state: 'NOT_YET_FILED', docType: 'DRHP', companyName: 'Acme Ltd', firstSeenAt: hoursAgo(24 * 20) },
    NOW
  );
  assert.match(violation, /DRHP still NOT_YET_FILED/);
  assert.match(violation, /limit 14d/);
});

test('66b FAILs an RHP still unfiled 2 days past open, and a Prospectus 3 days past close', () => {
  assert.ok(
    checkNotYetFiledAge(
      { state: 'NOT_YET_FILED', docType: 'RHP', companyName: 'A', openDate: hoursAgo(24 * 5) },
      NOW
    )
  );
  assert.ok(
    checkNotYetFiledAge(
      { state: 'NOT_YET_FILED', docType: 'PROSPECTUS', companyName: 'A', closeDate: hoursAgo(24 * 6) },
      NOW
    )
  );
  assert.ok(
    checkNotYetFiledAge(
      { state: 'NOT_YET_FILED', docType: 'ANCHOR_ALLOCATION_REPORT', companyName: 'A', openDate: hoursAgo(24 * 3) },
      NOW
    )
  );
});

test('66c PASSes inside the filing window — NOT_YET_FILED is normal there', () => {
  assert.equal(
    checkNotYetFiledAge(
      { state: 'NOT_YET_FILED', docType: 'RHP', companyName: 'A', openDate: hoursAgo(12) },
      NOW
    ),
    null
  );
  assert.equal(
    checkNotYetFiledAge(
      { state: 'NOT_YET_FILED', docType: 'DRHP', companyName: 'A', firstSeenAt: hoursAgo(24 * 3) },
      NOW
    ),
    null
  );
});

test('66d SKIPS rather than guesses when the governing date is missing', () => {
  // Firing on absent data would train everyone to ignore this check.
  assert.equal(
    checkNotYetFiledAge({ state: 'NOT_YET_FILED', docType: 'RHP', companyName: 'A', openDate: null }, NOW),
    null
  );
  assert.equal(
    checkNotYetFiledAge({ state: 'NOT_YET_FILED', docType: 'PROSPECTUS', companyName: 'A' }, NOW),
    null
  );
});

test('66e ignores states that are not NOT_YET_FILED, and untracked types', () => {
  assert.equal(
    checkNotYetFiledAge({ state: 'FOUND', docType: 'DRHP', companyName: 'A', firstSeenAt: hoursAgo(24 * 99) }, NOW),
    null
  );
  assert.equal(
    checkNotYetFiledAge(
      { state: 'NOT_YET_FILED', docType: 'BIDDING_CENTERS', companyName: 'A', openDate: hoursAgo(24 * 99) },
      NOW
    ),
    null
  );
});

test('66f the thresholds are the filing calendar, and are pinned', () => {
  assert.deepEqual(NOT_YET_FILED_MAX_DAYS, {
    DRHP: 14,
    RHP: 2,
    PROSPECTUS: 3,
    ANCHOR_ALLOCATION_REPORT: 1,
  });
});

// --- 67: m_absence_without_evidence (T-403 r6) -------------------------------
//
// THE SHAPE THIS CATCHES. A row settles NOT_YET_FILED — "the company has not
// filed it" — on a chain in which not one rung ANSWERED. That is what the
// round-5 review found in production shape: for a type the exchanges cannot
// serve, `EXCHANGES:no_link` was carried through an escalation whose every rung
// was skipped, and the row was written as an absence nobody observed. The code
// fix makes it unconstructible; this check makes it visible if it ever returns
// through another door (a backfill, a different writer, a rolled-back deploy).

const CHAIN_NOBODY_ANSWERED =
  'rungs[DRHP]: EXCHANGES:no_link -> SEBI:skipped:not_served_by_sebi -> ' +
  'COMPANY:skipped:no_company_url -> VERIFIER:skipped:no_verifier_url';
const CHAIN_SEBI_ANSWERED =
  'rungs[DRHP]: EXCHANGES:no_link -> SEBI:not_listed -> ' +
  'COMPANY:skipped:no_company_url -> VERIFIER:skipped:no_verifier_url';
const CHAIN_ONLY_FAILURES =
  'rungs[DRHP]: EXCHANGES:no_link -> SEBI:failed:http_error -> ' +
  'COMPANY:failed:no_page -> VERIFIER:failed:budget';

const drhpRow = (chain) => ({
  state: 'NOT_YET_FILED',
  docType: 'DRHP',
  companyName: 'Nowhere Industries Limited',
  chain,
});

test('67 FAILs NOT_YET_FILED whose chain has no answered rung', () => {
  const violation = checkAbsenceWithoutEvidence(drhpRow(CHAIN_NOBODY_ANSWERED));
  assert.ok(violation, 'an absence nobody observed must FAIL');
  assert.match(violation, /DRHP/);
});

test('67a FAILs when every rung was asked and every one of them failed', () => {
  // A failure is not an answer either — that is the r4 rule, checked nightly.
  assert.ok(checkAbsenceWithoutEvidence(drhpRow(CHAIN_ONLY_FAILURES)));
});

test('67b PASSes when a rung actually answered', () => {
  assert.equal(checkAbsenceWithoutEvidence(drhpRow(CHAIN_SEBI_ANSWERED)), null);
});

test('67c ignores non-NOT_YET_FILED states, and scopes by CHAIN SHAPE not doc type', () => {
  assert.equal(
    checkAbsenceWithoutEvidence({ ...drhpRow(CHAIN_NOBODY_ANSWERED), state: 'WANTED' }),
    null
  );
  // r7: the check used to exempt every non-DRHP doc type outright. A
  // CORRIGENDUM whose non-EXCHANGES rungs all skipped/failed is the exact same
  // unobserved-absence shape and must FAIL too.
  const corrigendumViolation = checkAbsenceWithoutEvidence({
    ...drhpRow(CHAIN_NOBODY_ANSWERED),
    docType: 'CORRIGENDUM',
  });
  assert.ok(corrigendumViolation, 'a non-DRHP type with the same unanswered chain must FAIL');
  assert.match(corrigendumViolation, /CORRIGENDUM/);
});

test('67g PASSes when the exchanges settled it and everything else stood down on purpose', () => {
  // Mirrors document-discovery-runner.ts:1708-1710 — once EXCHANGES answers,
  // SEBI/COMPANY/VERIFIER are skipped with this exact label, on purpose, and
  // that is the evidence, not a gap.
  const CHAIN_EXCHANGES_SETTLED_IT =
    'rungs[RHP]: EXCHANGES:no_link -> SEBI:skipped:exchanges_settled_it -> ' +
    'COMPANY:skipped:exchanges_settled_it -> VERIFIER:skipped:exchanges_settled_it';
  assert.equal(
    checkAbsenceWithoutEvidence({
      state: 'NOT_YET_FILED',
      docType: 'RHP',
      companyName: 'Nowhere Industries Limited',
      chain: CHAIN_EXCHANGES_SETTLED_IT,
    }),
    null
  );
});

test('67d SKIPS rather than guesses when no chain was recorded', () => {
  assert.equal(checkAbsenceWithoutEvidence(drhpRow(null)), null);
  assert.equal(checkAbsenceWithoutEvidence({ ...drhpRow(null), lastAttempt: [] }), null);
});

test('67e reads the chain for THIS doc type out of last_attempt', () => {
  const lastAttempt = [
    { source: 'NSE', outcome: 'ok' },
    { source: 'CHAIN', outcome: 'rungs[RHP]: EXCHANGES:no_link -> SEBI:not_listed' },
    { source: 'CHAIN', outcome: CHAIN_NOBODY_ANSWERED },
  ];
  assert.equal(chainFromLastAttempt(lastAttempt, 'DRHP'), CHAIN_NOBODY_ANSWERED);
  assert.equal(chainFromLastAttempt(lastAttempt, 'CORRIGENDUM'), null);
  // Postgres hands jsonb back as a string in some drivers; both shapes work.
  assert.equal(chainFromLastAttempt(JSON.stringify(lastAttempt), 'DRHP'), CHAIN_NOBODY_ANSWERED);
  assert.ok(
    checkAbsenceWithoutEvidence({
      state: 'NOT_YET_FILED',
      docType: 'DRHP',
      companyName: 'X',
      lastAttempt,
    })
  );
});

test('67h answeredRungsIn requires an explicit answered label — an unknown label is NOT an answer', () => {
  // r6's shape counted anything that wasn't `failed*`/`skipped*` as answered —
  // a false-PASS trap: a typo'd or renamed verdict silently started passing.
  // r7 inverts to an allow-list: an unrecognised verdict must NOT count.
  const chainWithUnknownVerdict =
    'rungs[DRHP]: EXCHANGES:no_link -> SEBI:some_new_unlisted_verdict -> ' +
    'COMPANY:skipped:no_company_url -> VERIFIER:skipped:no_verifier_url';
  assert.deepEqual(answeredRungsIn(chainWithUnknownVerdict), []);
  // But every currently-real answered label from the runner IS recognised.
  for (const verdict of ['found', 'not_listed', 'no_link', 'found_via_corrected_link', 'no_new_link']) {
    const chain = `rungs[DRHP]: SEBI:${verdict}`;
    assert.equal(answeredRungsIn(chain).length, 1, `${verdict} must count as answered`);
  }
});

test('67f the exchange-unserved set mirrors the runner and is pinned', () => {
  // scraper/src/services/document-types.ts: EXCHANGE_SERVED_TYPES is every type
  // EXCEPT the DRHP — the exchanges list an issue once it reaches a board, and
  // the DRHP predates that. The audit runs as plain Node on the box with no TS
  // toolchain, so the constant is mirrored; this pins the mirror.
  assert.deepEqual([...EXCHANGE_UNSERVED_DOC_TYPES], ['DRHP']);
});
