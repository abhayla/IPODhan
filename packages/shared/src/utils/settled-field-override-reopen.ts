/**
 * #968 (OD-95, spec §2.3.5 + OD-73): when an admin override makes a SETTLED
 * (SUPPLIED) plan row askable again, and how that reopening ends.
 *
 * OD-73: a settled field changes only via a HIGHER-ranked source. Under an
 * active override, "higher-ranked" means higher in the override's effective
 * order (OD-95). This module is the ONE rule, pure, used by the plan pass
 * (repository `reconcileSettledToOverrides`) and by the walk (the narrowing).
 *
 * Why the rule is shaped this way (the #967 failure it replaces): #967 reopened
 * a SUPPLIED row whenever its chosen source was rank 2 or 3 of the incoming
 * order. With NO override every such row re-planned with the same order every
 * slot, so it reopened on every pass (24 staging rows looping). Here a reopen
 * needs ALL of:
 *   1. the incoming order comes from an override (a registry re-plan never
 *      reopens a SUPPLIED row, as before item 3),
 *   2. the incoming policy_origin differs from the one the row recorded, so the
 *      effective order actually CHANGED since the row was settled/planned, and
 *   3. the new order puts a source ABOVE the settling source that was not
 *      already above it in the row's recorded order (a source that was already
 *      above it was already asked and did not answer).
 * A reopened row carries `reopened_under_policy`; that stored marker is the
 * narrowing (only sources above the settling source are asked), so it survives
 * any number of plan passes.
 */

export interface SettledPlanRowView {
  state: string;
  chosenSource: string | null;
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  policyOrigin: string | null;
  reopenedUnderPolicy: string | null;
}

export interface IncomingPlanOrder {
  rank1Source: string | null;
  rank2Source: string | null;
  rank3Source: string | null;
  policyOrigin: string;
}

/** REOPEN: SUPPLIED -> PENDING under this override. RETARGET: already reopened, the
 *  override changed and the new one still outranks the settling source. RESTORE: the
 *  override that reopened it is gone and the row was not re-supplied -> back to SUPPLIED. */
export type SettledOverrideDecision =
  | { action: 'NONE' }
  | { action: 'REOPEN'; underPolicy: string }
  | { action: 'RETARGET'; underPolicy: string }
  | { action: 'RESTORE' };

/** ADMIN is layer 3 (field protection); an override never reopens an admin value. */
const NEVER_REOPENED_SOURCES = new Set(['ADMIN']);

export function isOverrideOrigin(origin: string | null | undefined): boolean {
  return typeof origin === 'string' && origin.startsWith('override:');
}

/**
 * The sources ranked above `source` in `order` (nulls skipped). A source absent from
 * the order is outranked by every source in it: the order does not rank it at all.
 */
export function sourcesAbove(order: ReadonlyArray<string | null>, source: string): string[] {
  const present = order.filter((s): s is string => typeof s === 'string' && s.length > 0);
  const idx = present.indexOf(source);
  return idx === -1 ? present : present.slice(0, idx);
}

function outranksAnew(row: SettledPlanRowView, incoming: IncomingPlanOrder): boolean {
  const chosen = row.chosenSource;
  if (!chosen || NEVER_REOPENED_SOURCES.has(chosen)) return false;
  const newAbove = sourcesAbove([incoming.rank1Source, incoming.rank2Source, incoming.rank3Source], chosen);
  const oldAbove = new Set(sourcesAbove([row.rank1Source, row.rank2Source, row.rank3Source], chosen));
  return newAbove.some((s) => !oldAbove.has(s));
}

export function decideSettledOverride(row: SettledPlanRowView, incoming: IncomingPlanOrder): SettledOverrideDecision {
  if (row.reopenedUnderPolicy) {
    if (row.state === 'SUPPLIED') return { action: 'NONE' };
    if (incoming.policyOrigin === row.reopenedUnderPolicy) return { action: 'NONE' };
    if (isOverrideOrigin(incoming.policyOrigin) && outranksAnew(row, incoming)) {
      return { action: 'RETARGET', underPolicy: incoming.policyOrigin };
    }
    return { action: 'RESTORE' };
  }
  if (row.state !== 'SUPPLIED') return { action: 'NONE' };
  if (!isOverrideOrigin(incoming.policyOrigin)) return { action: 'NONE' };
  if (incoming.policyOrigin === row.policyOrigin) return { action: 'NONE' };
  if (!outranksAnew(row, incoming)) return { action: 'NONE' };
  return { action: 'REOPEN', underPolicy: incoming.policyOrigin };
}

/**
 * The walk's narrowing for a reopened row: ask only the sources ranked above the
 * settling source in the CURRENT effective order. Always a prefix of `ranks`, so each
 * source keeps its rank number, and a source ranked at or below the settling one is
 * never asked, so it can never overwrite the settled value (OD-73).
 */
export function narrowRanksForReopen(ranks: ReadonlyArray<string>, settlingSource: string): string[] {
  const idx = ranks.indexOf(settlingSource);
  return idx === -1 ? [...ranks] : ranks.slice(0, idx);
}
