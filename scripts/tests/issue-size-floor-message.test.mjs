// checkIssueSizeSegmentFloor must not claim a price band it does not have.
//
// Item 14's floor check gates on "is the price column non-null", then its
// message asserts "a price band (N) is on record". When that column holds the
// FACE VALUE (the #515 shape) the row has no price at all, and the message was
// telling a triager otherwise. NIRBHAY COLOURS on production is exactly that
// row: issue_size 14,797,000, price column 10, face_value 10.
//
// The FLAG is correct and stays - Rs1.48 crore really is below the MAINBOARD
// floor. Only the explanation changes, because you cannot decide whether
// issue_size is rupees or a share count until you have a real price to multiply
// by, and a message that invents one sends the reader down the wrong path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIssueSizeSegmentFloor } from '../lib/substance-checks.mjs';

test('still FLAGS a below-floor MAINBOARD size when the price column holds the face value', () => {
  const msg = checkIssueSizeSegmentFloor({
    issue_size: 14797000,
    price_range_min: 10,
    price_range_max: 10,
    face_value: 10,
    segment: 'MAINBOARD',
  });
  assert.ok(msg, 'the floor breach is real and must still be reported');
  assert.match(msg, /14797000/);
});

test('and says the column holds a FACE VALUE rather than claiming a price band', () => {
  const msg = checkIssueSizeSegmentFloor({
    issue_size: 14797000,
    price_range_min: 10,
    price_range_max: 10,
    face_value: 10,
    segment: 'MAINBOARD',
  });
  assert.match(msg, /FACE VALUE/);
  assert.ok(
    !/a price band \(10\) is on record/.test(msg),
    'must not assert a price band when the column holds the face value'
  );
  assert.ok(
    !/looks like a share count/.test(msg),
    'cannot claim it looks like a share count without a real price to test that against'
  );
});

test('keeps the original share-count wording when there IS a real price', () => {
  // PIYUSH LIMITED on production: band 668, face_value 10 - a genuine price,
  // so the share-count reading is a legitimate hypothesis for that row.
  const msg = checkIssueSizeSegmentFloor({
    issue_size: 7007320,
    price_range_min: 668,
    price_range_max: 668,
    face_value: 10,
    segment: 'MAINBOARD',
  });
  assert.ok(msg);
  assert.match(msg, /a price band \(668\) is on record/);
  assert.match(msg, /looks like a share count/);
});

test('silent when the size clears the floor', () => {
  assert.equal(
    checkIssueSizeSegmentFloor({
      issue_size: 1990000000,
      price_range_min: 85,
      price_range_max: 90,
      face_value: 10,
      segment: 'MAINBOARD',
    }),
    null
  );
});

test('silent with no price column at all - the check already declines that', () => {
  assert.equal(
    checkIssueSizeSegmentFloor({
      issue_size: 14797000,
      price_range_min: null,
      price_range_max: null,
      face_value: 10,
      segment: 'MAINBOARD',
    }),
    null
  );
});

test('silent when the segment carries no floor', () => {
  assert.equal(
    checkIssueSizeSegmentFloor({
      issue_size: 1000,
      price_range_min: 100,
      price_range_max: 100,
      face_value: 10,
      segment: null,
    }),
    null
  );
});

test('an absent face_value cannot make the band look like one', () => {
  const msg = checkIssueSizeSegmentFloor({
    issue_size: 14797000,
    price_range_min: 10,
    price_range_max: 10,
    face_value: null,
    segment: 'MAINBOARD',
  });
  assert.ok(msg);
  assert.match(msg, /a price band \(10\) is on record/);
});
