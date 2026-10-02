// OD-141 / OD-145 release semantics now that BSE serves openDate and closeDate (PR #1466).
// Before #1466 BSE answered CHECK_FAILED (UNKNOWN) for every date, so BSE could never release an
// admin hold on a date. Now it answers SUPPLIED with the board's Start_Dt / End_Dt, so these cases
// pin which BSE answers release a hold and which only reach the admin queue.
//
// Driven through the REAL hook (`buildExchangeOverrideHook`, its E-1 field gate) and the REAL
// decision (`decideExchangeOverride`). Only the database half of `applyExchangeOverride` is
// replaced: it reads the admin value and baseline, calls `decideExchangeOverride`, and maps the
// decision to its result, which is what the stub below does with fixed rows.
import { describe, it, expect, vi } from 'vitest';
import { buildExchangeOverrideHook } from '../../../src/services/exchange-override-hook.js';
import { BSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-bse-fetcher.js';
import {
  decideExchangeOverride,
  isExchangeOverrideField,
  type ExchangeBaseline,
} from '@ipodhan/shared/services/exchange-override-rule';
import type { ExchangeOverrideInput, ExchangeOverrideResult } from '@ipodhan/shared/services/exchange-override';
import type { Witness, WitnessOutcome } from '../../../src/services/witness-verdict.js';

const NOW = new Date('2026-10-02T05:00:00Z'); // 10:30 IST
const ADMIN = '2026-10-06'; // the open date the admin saved
const AT_SAVE = '2026-10-03'; // what the exchanges stated when the admin saved (the value the admin replaced)
const NEWER = '2026-10-08'; // a newer, different exchange date

const w = (source: 'NSE' | 'BSE', value: unknown, outcome: WitnessOutcome = 'SUPPLIED'): Witness => ({
  source,
  value,
  outcome,
  at: NOW.toISOString(),
});

/** The held row: the admin value and the per-exchange baseline recorded at save. */
function harness(row: { adminValue: unknown; exchangeAtSave: ExchangeBaseline }) {
  const apply = vi.fn(async (input: ExchangeOverrideInput): Promise<ExchangeOverrideResult> => {
    const d = decideExchangeOverride({ adminValue: row.adminValue, exchangeAtSave: row.exchangeAtSave, answers: input.answers });
    if (d.kind === 'REPLACE') {
      return {
        kind: 'REPLACED',
        ipoId: input.ipoId,
        slug: 'bse-dates-proof',
        companyName: 'BSE Dates Proof Limited',
        status: 'CLOSED', // not live: no Notifier call needed
        tableName: input.tableName,
        fieldName: input.fieldName,
        source: d.source,
        adminValue: row.adminValue,
        exchangeValue: d.value,
        exchangeAtSave: row.exchangeAtSave,
        auditId: 'audit-1',
      };
    }
    return {
      kind: 'SKIPPED',
      reason: d.reason,
      ...(d.baseline ? { baselineRecorded: d.baseline } : {}),
      ...(d.lowerRankDisagreement
        ? {
            disagreement: {
              source: d.lowerRankDisagreement.source,
              value: String(d.lowerRankDisagreement.value),
              topSource: d.lowerRankDisagreement.topSource,
              conflictId: 'conflict-1',
            },
          }
        : {}),
    };
  });
  const hook = buildExchangeOverrideHook({
    apply,
    send: vi.fn(async () => ({ sent: true })),
    isClaimed: vi.fn(async () => false),
    claim: vi.fn(async () => {}),
    env: 'staging',
    now: () => NOW,
  });
  return { hook, apply, last: async () => apply.mock.results[apply.mock.results.length - 1]?.value as Promise<ExchangeOverrideResult> };
}

describe('PR #1466: BSE now serves the E-1 dates, the price band is not E-1', () => {
  it('BSE serves openDate and closeDate; both are override fields, priceRangeMax is not', () => {
    expect(BSE_SERVEABLE_FIELDS.has('ipos.openDate')).toBe(true);
    expect(BSE_SERVEABLE_FIELDS.has('ipos.closeDate')).toBe(true);
    expect(isExchangeOverrideField('ipos', 'openDate')).toBe(true);
    expect(isExchangeOverrideField('ipos', 'closeDate')).toBe(true);
    expect(isExchangeOverrideField('ipos', 'priceRangeMax')).toBe(false);
  });
});

describe('OD-141 / OD-145: which exchange answer releases an admin-held openDate', () => {
  it('(a) NSE states a newer, different date -> released by NSE', async () => {
    const h = harness({ adminValue: ADMIN, exchangeAtSave: { NSE: AT_SAVE, BSE: AT_SAVE } });
    expect(await h.hook('ipo-1', 'ipos', '', 'open_date', [w('NSE', NEWER), w('BSE', AT_SAVE)])).toEqual({ holdReleased: true });
    expect(await h.last()).toMatchObject({ kind: 'REPLACED', source: 'NSE', exchangeValue: NEWER });
  });

  it('(b) NSE answers an explicit NOT_PRINTED, BSE states a newer date than its baseline -> released by BSE (top stating exchange)', async () => {
    const h = harness({ adminValue: ADMIN, exchangeAtSave: { NSE: null, BSE: AT_SAVE } });
    expect(
      await h.hook('ipo-1', 'ipos', '', 'open_date', [w('NSE', null, 'NOT_PRINTED'), w('BSE', NEWER)])
    ).toEqual({ holdReleased: true });
    expect(await h.last()).toMatchObject({ kind: 'REPLACED', source: 'BSE', exchangeValue: NEWER });
  });

  for (const outcome of ['FAILED', 'CHECK_FAILED', 'NOT_AVAILABLE_YET'] as const) {
    it(`(c) NSE ${outcome} (UNKNOWN), BSE states a newer date -> KEPT, BSE queued as a disagreement, no NSE baseline recorded`, async () => {
      // NSE's baseline is absent (unknown): an UNKNOWN read must not record one (OD-145).
      const h = harness({ adminValue: ADMIN, exchangeAtSave: { BSE: AT_SAVE } });
      expect(await h.hook('ipo-1', 'ipos', '', 'open_date', [w('NSE', null, outcome), w('BSE', NEWER)])).toEqual({
        holdReleased: false,
      });
      const r = await h.last();
      expect(r).toEqual({
        kind: 'SKIPPED',
        reason: 'TOP_EXCHANGE_UNKNOWN',
        disagreement: { source: 'BSE', value: NEWER, topSource: 'NSE', conflictId: 'conflict-1' },
      });
    });
  }

  it('(d) NSE states its at-save date unchanged, BSE states a different date -> KEPT (lower rank alone never releases), BSE queued', async () => {
    const h = harness({ adminValue: ADMIN, exchangeAtSave: { NSE: AT_SAVE, BSE: AT_SAVE } });
    expect(await h.hook('ipo-1', 'ipos', '', 'open_date', [w('NSE', AT_SAVE), w('BSE', NEWER)])).toEqual({ holdReleased: false });
    expect(await h.last()).toEqual({
      kind: 'SKIPPED',
      reason: 'EXCHANGE_UNCHANGED_SINCE_SAVE',
      disagreement: { source: 'BSE', value: NEWER, topSource: 'NSE', conflictId: 'conflict-1' },
    });
  });

  it('(e) admin-held priceRangeMax with BSE stating a different price -> never released (not an E-1 field)', async () => {
    const h = harness({ adminValue: '75', exchangeAtSave: { NSE: null, BSE: '72' } });
    expect(
      await h.hook('ipo-1', 'ipos', '', 'price_range_max', [w('NSE', null, 'NOT_PRINTED'), w('BSE', '80')])
    ).toEqual({ holdReleased: false });
    expect(h.apply).not.toHaveBeenCalled();
  });
});
