// Behavioural tests for checkDegenerateBookbuildingBand (#597, #589).
//
// The sibling test audit-substance-plausibility.test.mjs proves the columns this
// predicate reads are SELECTed. It does not prove the predicate is right. This
// one drives the real function.
//
// Why the check was rewritten, in one line: the old rule flagged every
// `min === max` row that was not FIXED_PRICE, which on staging was 268 rows of
// which 266 were CORRECT - and those 266 false flags buried 21 real defects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDegenerateBookbuildingBand } from '../lib/substance-checks.mjs';

const DAY = 24 * 60 * 60 * 1000;
const closed = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
const openStill = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);

const row = (over = {}) => ({
  price_range_min: 136,
  price_range_max: 136,
  face_value: 10,
  issue_type: null,
  close_date: closed,
  authoritative_issue_price: null,
  ...over,
});

test('a CLOSED book-built issue with one price is NORMAL, not a defect', () => {
  // 266 of 268 staging rows are this shape. After price discovery a book-built
  // issue HAS one price, and every source publishes it that way - measured:
  // all 183 closed book-built rows at the source carry a single price.
  assert.equal(checkDegenerateBookbuildingBand(row()), null);
});

test('and it stays normal when the authoritative price AGREES', () => {
  // The 186-row population.
  assert.equal(
    checkDegenerateBookbuildingBand(row({ authoritative_issue_price: 136 })),
    null
  );
});

test('FLAGS a collapsed band whose authoritative price DISAGREES - the 21 real defects', () => {
  // ADMACH SYSTEMS: stored 227, actually priced at 239. All 21 such rows store
  // a LOWER value, none higher, average gap 8.63% - the floor-to-cap spread.
  // Control: real-band issues price at the CAP in 46 of 46.
  const msg = checkDegenerateBookbuildingBand(
    row({ price_range_min: 227, price_range_max: 227, authoritative_issue_price: 239 })
  );
  assert.ok(msg, 'must flag a stored price that disagrees with the real one');
  assert.match(msg, /227/);
  assert.match(msg, /239/);
  assert.match(msg, /5\.0% low/);
  // The message must NOT name a mechanism - see the HIGH case below.
  assert.ok(!/lost the cap/.test(msg), 'must not assert a mechanism the population does not share');
});

test('a stored price ABOVE the real one reads correctly - no negative percent, no floor story', () => {
  // NET PIX SHORTS DIGITAL MEDIA on PRODUCTION: stored 32, sold at 30. The
  // first version printed "(-6.7% high)" - a negative number labelled high -
  // and claimed the band "kept the floor and lost the cap", which is the
  // opposite of what this row did. Staging is 21 low / 0 high; production is
  // 21 low / 1 high, so the population has at least two mechanisms and the
  // message must not pick one.
  const msg = checkDegenerateBookbuildingBand(
    row({ price_range_min: 32, price_range_max: 32, authoritative_issue_price: 30 })
  );
  assert.ok(msg, 'must flag a stored price above the real one');
  assert.match(msg, /6\.7% high/);
  assert.ok(!/-/.test(msg.split('(')[1] ?? ''), 'the percentage must not be negative');
  assert.ok(!/floor/.test(msg), 'must not claim it kept a floor');
});

test('FLAGS the face value sitting in the price column', () => {
  // MUTHOOT FINCOTP 1000/1000 face 1000; STALLION 10/10 face 10. Two of these
  // are among the three rows item 14's floor check fails on.
  const msg = checkDegenerateBookbuildingBand(
    row({ price_range_min: 10, price_range_max: 10, face_value: 10 })
  );
  assert.ok(msg, 'must flag a price equal to face value');
  assert.match(msg, /face_value/);
});

test('the face-value shape is caught even on a CLOSED issue - the naive OPEN gate would have hidden it', () => {
  // This is the trap: gating the whole check on "still open" would exempt
  // STALLION and NIRBHAY, which are LISTED/CLOSED.
  const msg = checkDegenerateBookbuildingBand(
    row({ price_range_min: 10, price_range_max: 10, face_value: 10, close_date: closed })
  );
  assert.ok(msg, 'a closed issue holding its face value as a price is still a defect');
});

test('FLAGS a degenerate band while the book is STILL OPEN', () => {
  // The original rule, kept for the population it is actually true of.
  const msg = checkDegenerateBookbuildingBand(
    row({ price_range_min: 500, price_range_max: 500, face_value: 2, close_date: openStill })
  );
  assert.ok(msg, 'a live book must have floor < cap');
  assert.match(msg, /not shown to have closed/);
});

test('an ABSENT close_date is NOT treated as closed - not knowing cannot be the safe answer', () => {
  // The first version read `close === null ? false`, i.e. "we do not know when
  // this closed" became "it is closed, therefore safe". The existing
  // web/tests/unit/scripts/substance-checks.test.ts caught it: its Gabion-shape
  // rows carry no close_date and were silently passed. Costs nothing on real
  // data - zero degenerate rows lack a close_date on staging (0/268) or prod
  // (0/90) - and it is the correct default.
  const msg = checkDegenerateBookbuildingBand({
    price_range_min: 81,
    price_range_max: 81,
    issue_type: null,
  });
  assert.ok(msg, 'a row with no close_date must not be silently passed');
  assert.match(msg, /no close date on record/);
});

test('the Gabion shape from the existing suite still flags', () => {
  // Exactly the row web/tests/unit/scripts/substance-checks.test.ts asserts on.
  assert.match(
    checkDegenerateBookbuildingBand({ price_range_min: 81, price_range_max: 81, issue_type: 'BOOK_BUILDING' }),
    /degenerate/
  );
});

test('never fires on a real band', () => {
  assert.equal(
    checkDegenerateBookbuildingBand(row({ price_range_min: 85, price_range_max: 90 })),
    null
  );
});

test('still exempts a declared FIXED_PRICE issue', () => {
  assert.equal(
    checkDegenerateBookbuildingBand(row({ issue_type: 'FIXED_PRICE' })),
    null
  );
});

test('does not fire on a zero or absent band - checkPriceBand owns that shape', () => {
  assert.equal(checkDegenerateBookbuildingBand(row({ price_range_min: 0, price_range_max: 0 })), null);
  assert.equal(checkDegenerateBookbuildingBand(row({ price_range_min: null })), null);
});

test('the oracle comparison must not be fed the COALESCE alias', () => {
  // The caller also selects `issue_price` = COALESCE(lp.issue_price,
  // i.price_range_max). On a degenerate row that IS the stored value, so a
  // check reading it would compare a number to itself and never fire. This
  // asserts the predicate reads the RAW column instead.
  const src = checkDegenerateBookbuildingBand.toString();
  assert.match(src, /authoritative_issue_price/);
  assert.ok(
    !/row\.issue_price\b/.test(src),
    'must not read row.issue_price - it is coalesced to the stored value'
  );
});
