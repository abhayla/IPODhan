// #983: d_delisted_reads predicate. Discrimination: the row the price job writes passes; every
// shape a delisting NOT made by the three-read rule takes fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDelistedRow, describeDelistedRow } from '../lib/delisting-checks.mjs';

const reads = [
  { at: '2026-09-28T04:30:00.000Z', exchange: 'NSE', detail: 'series EQ: secStatus Permanent Suspended' },
  { at: '2026-09-28T05:00:00.000Z', exchange: 'NSE', detail: 'series EQ: secStatus Permanent Suspended' },
  { at: '2026-09-28T05:15:00.000Z', exchange: 'NSE', detail: 'series EQ: secStatus Permanent Suspended' },
];
const good = { slug: 'x-ltd', strikes: 3, reads, delistedAt: '2026-09-28 05:15:00' };

test('the row the price job writes (same shape as the ipodhan_test integration row) passes and is described with its three reads', () => {
  assert.equal(checkDelistedRow(good), null);
  assert.equal(describeDelistedRow(good), 'x-ltd delisted_at=2026-09-28 05:15:00 reads=[NSE 2026-09-28T04:30:00.000Z, NSE 2026-09-28T05:00:00.000Z, NSE 2026-09-28T05:15:00.000Z]');
});

test('a DELISTED row set by anything else fails', () => {
  assert.match(checkDelistedRow({ ...good, reads: null }), /no delisting_strike_reads/);
  assert.match(checkDelistedRow({ ...good, reads: reads.slice(0, 2) }), /2 read\(s\), not 3/);
  assert.match(checkDelistedRow({ ...good, reads: [reads[0], reads[2], reads[1]] }), /not in time order/);
  assert.match(checkDelistedRow({ ...good, reads: [reads[0], reads[1], { ...reads[2], at: 'x' }] }), /no valid instant/);
  assert.match(checkDelistedRow({ ...good, strikes: 1 }), /delisting_strikes=1/);
  assert.match(checkDelistedRow({ ...good, delistedAt: null }), /delisted_at NULL/);
  assert.match(checkDelistedRow({ ...good, delistedAt: '2026-09-28 10:45:00' }), /is not the third read/);
});
