/**
 * Which unresolved data_conflicts rows are NOT disagreements under the spec's own definitions
 * (spec §9.4, F-173). Such a row is never deleted and never hidden: it stays in the admin queue
 * with the rule that took it off the disagreement list, so an admin can still see it.
 *
 *   OD-75  a source changing a value IT set earlier (source1 = source2, or the named
 *          SOURCE_CHANGED_OWN_VALUE / OVERRIDE_SOURCE_LOST_TO_PRIORITY reasons) — its own reason.
 *   OD-60  one side returned zero, null or an empty value — an abstention, not a vote.
 *   OD-59  the two values are equal in MEANING (same number written differently, same calendar
 *          day, same company name after folding corporate forms).
 *   F-181  a column the writer stamps itself (lastScrapedAt …) can never be a disagreement.
 *
 * Reuse, not re-implementation: the OD-75 reasons and the F-181 bookkeeping list come from
 * `@ipodhan/shared/utils/conflict-reasons`; names fold through `foldCompanyIdentity` and dates read
 * through `isoDay` (`@ipodhan/shared/utils/company-identity-fold`). OD-59 itself is the scraper's
 * own family-aware comparator (`areEquivalent`, now in `@ipodhan/shared/utils/value-equivalence`,
 * one implementation), given the field's family from the field manifest (comparison-families.ts):
 * money within 0.5% agrees. With no family known, only the narrow family-free checks below apply
 * and a pair within 0.5% stays on the disagreement list (shown, never hidden) — the safe direction.
 */
import {
  ADMIN_LIST_SUGGESTION,
  ADMIN_ONLY_CONFLICT_REASONS,
  SOURCE_NO_LONGER_FIRST,
  isWriterBookkeepingField,
} from '@ipodhan/shared/utils/conflict-reasons';
import { foldCompanyIdentity, isoDay } from '@ipodhan/shared/utils/company-identity-fold';
import { areEquivalent, type ComparisonFamily } from '@ipodhan/shared/utils/value-equivalence';

export type RuleFilter = 'OD-107' | 'OD-142' | 'OD-75' | 'OD-60' | 'OD-59' | 'F-181';

/** Plain-words label shown to the admin for each rule. */
export const RULE_FILTER_LABELS: Record<RuleFilter, string> = {
  'OD-107': 'a document brought a different list for a list you own (OD-107) — a suggestion of rows to add or remove, not a disagreement',
  'OD-142': 'source no longer first (OD-142) — a type correction moved this field to a new first source; the value shown is kept until that source answers',
  'OD-75': 'a source changed its own earlier value (OD-75) — not a disagreement',
  'OD-60': 'one source gave no value (OD-60) — an abstention, not a disagreement',
  'OD-59': 'the values mean the same (OD-59) — not a disagreement',
  'F-181': 'a column the pipeline stamps itself (F-181) — never a disagreement',
};

/** OD-59: identifiers must match EXACTLY — there is no close-enough for an identifier. */
const IDENTIFIER_FIELDS = new Set(['isin', 'cin', 'symbol', 'pan', 'sebiRegNo', 'nseSymbol', 'bseCode']);

/** OD-59: names compare after folding corporate forms ("Pvt Ltd" = "Private Limited"). */
const NAME_FIELDS = new Set(['companyName', 'registrar', 'name', 'brlmName', 'shortName']);

export interface ConflictForRules {
  fieldName: string;
  source1: string;
  source2: string;
  value1: string | null;
  value2: string | null;
  resolutionReason: string | null;
  /** The field's OD-59 comparison family (field manifest); undefined = unknown. */
  family?: string;
}

function isAbstention(v: string | null): boolean {
  if (v === null) return true;
  const t = v.trim();
  if (t === '' || t === 'null' || t === '""' || t === '[]' || t === '{}') return true;
  const n = asNumber(t);
  return n === 0;
}

function asNumber(v: string): number | null {
  const cleaned = v.replace(/^"|"$/g, '').replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function lettersAndDigits(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A stored conflict value as the comparator reads it: a number, a JSON array or string, or the text. */
function comparable(v: string): unknown {
  const t = v.trim();
  const n = asNumber(t);
  if (n !== null) return n;
  if (t.startsWith('[') || t.startsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
}

/** OD-59: equal in meaning. With a family, the shared comparator decides (money within 0.5%). */
export function equalInMeaning(fieldName: string, a: string, b: string, family?: string): boolean {
  if (a === b) return true;
  if (IDENTIFIER_FIELDS.has(fieldName) || family === 'IDENTIFIER') return false;
  if (family && family !== 'ABSTAIN' && areEquivalent(comparable(a), comparable(b), { family: family as ComparisonFamily })) {
    return true;
  }
  const na = asNumber(a.trim());
  const nb = asNumber(b.trim());
  if (na !== null && nb !== null) return na === nb;
  const da = /^"?\d{4}-\d{2}-\d{2}/.test(a) ? isoDay(a.replace(/^"/, '')) : null;
  const db = /^"?\d{4}-\d{2}-\d{2}/.test(b) ? isoDay(b.replace(/^"/, '')) : null;
  if (da !== null && db !== null) return da === db;
  if (NAME_FIELDS.has(fieldName)) {
    const fa = foldCompanyIdentity(a);
    return fa !== '' && fa === foldCompanyIdentity(b);
  }
  const la = lettersAndDigits(a);
  return la !== '' && la === lettersAndDigits(b);
}

/**
 * The rule that takes this conflict off the disagreement list, or null when it is a real
 * disagreement an admin must decide. Order matters only for the label: OD-75 first (a row can be a
 * self-change AND carry an empty side; the self-change is the more specific reason).
 */
export function ruleFilterFor(c: ConflictForRules): RuleFilter | null {
  // §9.2 items 8, 9 (OD-107): a list suggestion is never a dispute; it is its own queue item.
  if (c.resolutionReason === ADMIN_LIST_SUGGESTION) return 'OD-107';
  // OD-142 (§2.8, §9.2 item 18): a type correction's kept value, waiting for its new rank-1 source.
  if (c.resolutionReason === SOURCE_NO_LONGER_FIRST) return 'OD-142';
  if (c.source1 === c.source2) return 'OD-75';
  if (c.resolutionReason !== null && ADMIN_ONLY_CONFLICT_REASONS.includes(c.resolutionReason)) return 'OD-75';
  if (isWriterBookkeepingField(c.fieldName)) return 'F-181';
  if (isAbstention(c.value1) || isAbstention(c.value2)) return 'OD-60';
  if (equalInMeaning(c.fieldName, c.value1 as string, c.value2 as string, c.family)) return 'OD-59';
  return null;
}
