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
