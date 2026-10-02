/**
 * Item 42 (OD-163, F-226): other-source answers for stored values written OUTSIDE the field walk.
 *
 * Before this, witnesses (`field_sources.witnesses`, OD-103 shape) were written only by the walk's
 * collect-all, so values stored by the consolidation writers (SYSTEM), the filing persister and
 * migration scripts had none: 20,008 of 20,532 stored values on staging (2026-10-02).
 *
 * One mechanism serves both halves of OD-163, by routing those values through the walk's own
 * witness collection (`askEveryListedRank`, the same asks the admin-held read makes):
 *
 * (b) the ONE answers-only round: while `ipos.answers_round_at` is NULL, every stored value of the
 *     IPO that has a plan row (Appendix A lists it) and no recorded answers gets every listed source
 *     asked once; each answer (value, abstention or failure cause) is recorded. When every such
 *     value has been asked, `answers_round_at` is stamped and the round never runs again.
 * (a) after the round, a value a non-walk writer stores later without answers (its row's
 *     `updated_at` is after the stamp) is asked the same way at the IPO's next walk, in the same
 *     cycle's remaining budget: the write goes through the walk's witness collection.
 *
 * What it never does: write a page value, a plan state, an evidence row or a hold change. It writes
 * ONLY `witnesses` + `verdict` on the EXISTING field_sources row (`updateWitnessesOnly`: never an
 * insert, never the row's source, value, author or time) and never calls the held-field hook (the
 * OD-106 exchange override is a value change). A credited answer keeps its marker and a null value
 * and never votes (computeVerdict, item 41). Only SUPPLIED answers vote (OD-60).
 *
 * Budget (run-discipline B4(a)): the round runs only AFTER the due-field walk (document cycle: after
 * every candidate IPO's walk; closed-IPO job: after that IPO's walk), inside the SAME deadline. It
 * stops at the deadline; the values not yet asked are asked next time (asked ones now carry answers
 * and are not asked again). LISTED IPOs run it only from the 22:00 closed-IPO job (OD-163(b)), so
 * they are inside that job's 10-a-day cap.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { columnToCamelCase } from '../config/field-name-case.js';
import * as schema from '@ipodhan/shared/db/schema';
import { markIpoAnswersRoundDone } from '@ipodhan/shared';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import { logger } from '../utils/logger.js';
import { computeVerdict } from './witness-verdict.js';
import {
  askEveryListedRank,
  ipoTypeResolverFor,
  mergeHeldWitnesses,
  witnessShape,
  type FieldPlanWalkBudget,
  type FieldPlanWalkDeps,
} from './field-plan-walk.js';

/** A stored value with no other-source answers yet, keyed like its plan row (snake_case field). */
export interface AnswersRoundCandidate {
  tableName: string;
  rowKey: string;
  fieldName: string;
}

export interface AnswersRoundStore {
  /** The IPO's status, offering type and round stamp; null when the row cannot be read. */
  readIpo(
    ipoId: string
  ): Promise<{ status: string | null; answersRoundAt: Date | null; offeringType?: string | null } | null>;
  /**
   * Stored values of this IPO with a plan row and no recorded answers (witnesses NULL or empty).
   * `writtenAfter` set: only values whose field_sources row was written after it (OD-163(a)).
   */
  listUnanswered(ipoId: string, writtenAfter: Date | null): Promise<AnswersRoundCandidate[]>;
  /** Stamp the round done, only if not stamped yet. True when this call stamped it. */
  markRoundDone(ipoId: string): Promise<boolean>;
}

export interface AnswersRoundOptions {
  /** OD-163(b): LISTED IPOs run the round only from the 22:00 closed-IPO job. */
  listedAllowed: boolean;
}

export type AnswersRoundResult = {
  ipoId: string;
  mode: 'ROUND' | 'AFTER_ROUND' | 'SKIPPED';
  skipReason?: string;
  asked: number;
  recorded: number;
  notRecorded: number;
  skippedNotCompared: number;
  /** Section 1.11: values whose field the manifest's `na` list excludes for this offering type; never asked. */
  skippedNotApplicable: number;
  stoppedAtDeadline: boolean;
  roundStamped: boolean;
};

/**
 * Run the answers-only round (or the after-round coverage) for one IPO. Never throws for one value:
 * a failed ask or store is logged with its cause and counted; the IPO's other values continue.
 */
export async function runAnswersOnlyRound(
  ipoId: string,
  deps: FieldPlanWalkDeps & { trackHeldFieldWitnesses: NonNullable<FieldPlanWalkDeps['trackHeldFieldWitnesses']> },
  store: AnswersRoundStore,
  budget: FieldPlanWalkBudget,
  options: AnswersRoundOptions
): Promise<AnswersRoundResult> {
  const result: AnswersRoundResult = {
    ipoId,
    mode: 'SKIPPED',
    asked: 0,
    recorded: 0,
    notRecorded: 0,
    skippedNotCompared: 0,
    skippedNotApplicable: 0,
    stoppedAtDeadline: false,
    roundStamped: false,
  };
  // Same gate as every witness write (S3b-2): flag off writes no witnesses and stamps nothing.
  if (!FEATURE_FLAGS.ENABLE_VERDICT_WRITER) return { ...result, skipReason: 'ENABLE_VERDICT_WRITER off' };
  const ipo = await store.readIpo(ipoId);
  if (!ipo) return { ...result, skipReason: 'IPO row not readable' };
  if (ipo.status === 'LISTED' && !options.listedAllowed) {
    return { ...result, skipReason: 'LISTED: runs in the 22:00 closed-IPO job (OD-163(b))' };
  }
  result.mode = ipo.answersRoundAt ? 'AFTER_ROUND' : 'ROUND';
  if (budget.now() >= budget.deadlineMs) {
    result.stoppedAtDeadline = true;
    return result;
  }

  const candidates = await store.listUnanswered(ipoId, ipo.answersRoundAt);
  const manifest = loadFieldManifest();
  const resolveIpoType = ipoTypeResolverFor(ipoId, deps);
  for (const c of candidates) {
    if (budget.now() >= budget.deadlineMs) {
      result.stoppedAtDeadline = true;
      break;
    }
    const entry = manifest.fields[`${c.tableName}.${c.fieldName}`];
    if (ipo.offeringType && (entry?.na ?? []).includes(ipo.offeringType)) {
      // #1493, section 1.11: the plan generator plans no row for a not-applicable field, but a plan row
      // written before it honoured `na` (PR #1327) can remain; the round never asks such a field.
      result.skippedNotApplicable += 1;
      continue;
    }
    const family = entry?.comparisonFamily;
    if (!family || family === 'ABSTAIN') {
      // The verdict writer stores no witnesses for a field that is never compared (same rule as the
      // walk and the held read); not asked, so no fetch is spent on it.
      result.skippedNotCompared += 1;
      continue;
    }
    result.asked += 1;
    try {
      // `held: true`: the DOC fetcher answers from the documents' own receipts, not from who owns the
      // stored value -- the value here was stored by another writer, exactly the held read's case.
      const asked = await askEveryListedRank(ipoId, { ...c, ipoId }, deps, resolveIpoType, { held: true });
      if (asked === null) {
        result.notRecorded += 1;
        continue;
      }
      const rankOrder: string[] = asked.policy.ranks.flatMap((s) => (s ? [String(s)] : []));
      const incoming = witnessShape(asked.answers);
      const stored = await deps.trackHeldFieldWitnesses({
        ipoId,
        tableName: c.tableName,
        rowKey: c.rowKey,
        fieldName: columnToCamelCase(c.fieldName),
        // Every answer is recorded, failures included (OD-163(b): value, abstention or failure
        // cause), so a value whose sources all failed is not asked again by the round.
        merge: (existing) => {
          const merged = mergeHeldWitnesses(existing, incoming, rankOrder);
          if (merged === null) return null;
          const computed = computeVerdict(
            merged.map((w) => ({ ...w, rank: rankOrder.indexOf(w.source) + 1 })),
            asked.policy.ranks.length,
            family
          );
          return { witnesses: computed.witnesses, verdict: computed.verdict };
        },
      });
      if (stored.updated) result.recorded += 1;
      else result.notRecorded += 1;
    } catch (error) {
      result.notRecorded += 1;
      logger.warn(
        { ipoId, table: c.tableName, rowKey: c.rowKey, field: c.fieldName, error: (error as Error)?.message },
        'answers-only round: asking or recording one value FAILED; the stored value is unchanged'
      );
    }
  }

  if (result.mode === 'ROUND' && !result.stoppedAtDeadline) {
    try {
      result.roundStamped = await store.markRoundDone(ipoId);
    } catch (error) {
      logger.warn({ ipoId, error: (error as Error)?.message }, 'answers-only round: stamping the round FAILED; it resumes next time');
    }
  }
  logger.info({ ...result }, 'answers-only round (OD-163): answers recorded, no page value changed');
  return result;
}

/** The real store, on the shared db (snake plan rows matched to camelCase field_sources rows). */
export function buildAnswersRoundStore(db: NodePgDatabase<typeof schema>): AnswersRoundStore {
  const { ipos, ipoFieldPlan, fieldSources } = schema;
  return {
    async readIpo(ipoId) {
      const [row] = await db
        .select({ status: ipos.status, answersRoundAt: ipos.answersRoundAt, offeringType: ipos.offeringType })
        .from(ipos)
        .where(eq(ipos.id, ipoId));
      return row
        ? {
            status: (row.status as string | null) ?? null,
            answersRoundAt: row.answersRoundAt ?? null,
            offeringType: (row.offeringType as string | null) ?? null,
          }
        : null;
    },
    async listUnanswered(ipoId, writtenAfter) {
      const plans = await db
        .select({ tableName: ipoFieldPlan.tableName, rowKey: ipoFieldPlan.rowKey, fieldName: ipoFieldPlan.fieldName })
        .from(ipoFieldPlan)
        .where(eq(ipoFieldPlan.ipoId, ipoId));
      const stored = await db
        .select({
          tableName: fieldSources.tableName,
          rowKey: fieldSources.rowKey,
          fieldName: fieldSources.fieldName,
          witnesses: fieldSources.witnesses,
          updatedAt: fieldSources.updatedAt,
        })
        .from(fieldSources)
        .where(eq(fieldSources.ipoId, ipoId));
      const unanswered = new Set<string>();
      for (const s of stored) {
        const hasAnswers = Array.isArray(s.witnesses) && s.witnesses.length > 0;
        if (hasAnswers) continue;
        if (writtenAfter && !(s.updatedAt && s.updatedAt.getTime() > writtenAfter.getTime())) continue;
        unanswered.add(`${s.tableName}|${s.rowKey ?? ''}|${s.fieldName}`);
      }
      return plans
        .filter((p) => unanswered.has(`${p.tableName}|${p.rowKey ?? ''}|${columnToCamelCase(p.fieldName)}`))
        .map((p) => ({ tableName: p.tableName, rowKey: p.rowKey ?? '', fieldName: p.fieldName }));
    },
    markRoundDone: (ipoId) => markIpoAnswersRoundDone(db, ipoId),
  };
}
