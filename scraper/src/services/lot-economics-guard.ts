/**
 * #721: the ONE lot-economics gate for the write doors that do not run the persister's merged-record
 * pass (`applyMergedRecordValidation`): the persister's create door, the consolidation
 * orchestrator's create and update doors, and the lot-size backfill script.
 *
 * It runs spec §1.2 row 4 (Rule 9, `lotEconomicsViolation` in @ipodhan/shared) on the MERGED view of
 * the stored row and the outgoing payload. The stored segment, offering type and listing exchanges
 * govern; with no segment anywhere, the §2.8 inference decides. On a violation the payload's
 * `lotSize` is removed (the lot is the suspect value, the same convention as the merged pass's
 * MERGED_RULE_FIELDS) and the stored lot stays. An ADMIN write is never refused here.
 */
import { lotEconomicsViolation, type ValidationRule } from '../utils/data-validation.js';
import logger from '../utils/logger.js';

export interface LotEconomicsGuardResult<T> {
  payload: T;
  violation: ValidationRule | null;
}

function pick(field: string, payload: Record<string, any>, stored: Record<string, any> | null, storedGoverns: boolean) {
  const s = stored?.[field];
  const p = payload[field];
  if (storedGoverns) return s ?? p ?? null;
  return p ?? s ?? null;
}

export function guardLotEconomics<T extends Record<string, any>>(
  payload: T,
  stored: Record<string, any> | null,
  ctx: { source: string; door: string; ipoId?: string | null; companyName?: string | null }
): LotEconomicsGuardResult<T> {
  if (ctx.source === 'ADMIN') return { payload, violation: null };
  const merged = {
    companyName: pick('companyName', payload, stored, false),
    segment: pick('segment', payload, stored, true),
    offeringType: pick('offeringType', payload, stored, true),
    listingExchanges: pick('listingExchanges', payload, stored, true),
    lotSize: pick('lotSize', payload, stored, false),
    priceRangeMax: pick('priceRangeMax', payload, stored, false),
  };
  const violation = lotEconomicsViolation(merged);
  if (!violation) return { payload, violation: null };
  if (!('lotSize' in payload)) return { payload, violation };
  const { lotSize: rejected, ...rest } = payload;
  logger.warn(
    {
      ipoId: ctx.ipoId ?? stored?.id ?? null,
      companyName: ctx.companyName ?? merged.companyName,
      source: ctx.source,
      door: ctx.door,
      rule: violation.rule,
      rejectedLotSize: rejected,
      keptLotSize: stored?.lotSize ?? null,
      priceRangeMax: merged.priceRangeMax,
      segment: merged.segment,
    },
    `[LotEconomicsGuard] ${violation.rule} - lotSize NOT written (#721, spec §1.2 row 4)`
  );
  return { payload: rest as T, violation };
}
