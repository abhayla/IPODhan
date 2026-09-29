/**
 * OD-106 / OD-117 plugged into the field-plan walk's held-field seam (`onHeldFieldAnswers`,
 * field-plan-walk.ts): after the walk reads an admin-held field's sources, a NEWER, different NSE
 * or BSE answer on an E-1 field replaces the admin value (`applyExchangeOverride`, one transaction)
 * and the admin is told which IPO and both values.
 *
 * Alert (OD-112, §9.2 items 16 and 25; OD-93 shape): sent only AFTER the release committed, instant
 * only for an UPCOMING or OPEN IPO, through the Notifier gateway (`sendOwnerAlert`, fail-open, 2 s),
 * deduplicated per IPO, field and IST day with dedupeKey `admin-od106:<env>:<ipoId>:<field>:<day>`;
 * the Redis claim is written only after the Notifier accepted it. Any other status is recorded for
 * the 09:00 IST digest (item 16, not built yet): the audit row (actor SYSTEM, reason OD-106) and a
 * log line carry it.
 */
import { applyExchangeOverride, type ExchangeOverrideInput, type ExchangeOverrideResult } from '@ipodhan/shared/services/exchange-override';
import {
  exchangeOverrideDedupeKey,
  isExchangeOverrideField,
  isInstantAlertStatus,
} from '@ipodhan/shared/services/exchange-override-rule';
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { logger } from '../utils/logger.js';
import type { OwnerAlertResult } from './owner-notify.js';
import type { HeldFieldAnswers, HeldFieldHookOutcome } from './field-plan-walk.js';

export interface ExchangeOverrideHookDeps {
  apply: (input: ExchangeOverrideInput) => Promise<ExchangeOverrideResult>;
  send: (severity: 'P2', title: string, opts: { body?: string; type?: string; dedupeKey?: string }) => Promise<OwnerAlertResult>;
  isClaimed: (key: string) => Promise<boolean>;
  /** Written only after the alert it records was accepted. */
  claim: (key: string) => Promise<void>;
  /**
   * Drops the IPO's cached reads after a committed replacement, as every other IPO write does
   * (production: `invalidateIPOCaches` in cache-invalidator.ts, keys from `getIPOInvalidationKeys`).
   */
  invalidateCaches?: (ipoId: string, slug: string) => Promise<void>;
  /** DEPLOY_SLOT ('staging' | 'prod'); named in every title and key. */
  env?: string;
  now?: () => Date;
}

const show = (v: unknown): string => (v === null || v === undefined || v === '' ? 'empty' : v instanceof Date ? v.toISOString() : String(v));

export function buildExchangeOverrideHook(deps: ExchangeOverrideHookDeps) {
  return async function onHeldFieldAnswersOd106(
    ipoId: string,
    tableName: string,
    rowKey: string,
    fieldName: string,
    answers: HeldFieldAnswers
  ): Promise<HeldFieldHookOutcome> {
    const field = columnToCamelCase(fieldName);
    if ((rowKey ?? '') !== '' || !isExchangeOverrideField(tableName, field)) return { holdReleased: false };
    const now = deps.now?.() ?? new Date();
    const result = await deps.apply({ ipoId, tableName, rowKey: rowKey ?? '', fieldName: field, answers, now });
    if (result.kind !== 'REPLACED') {
      if (result.baselineRecorded) {
        logger.info(
          { ipoId, table: tableName, field, baseline: result.baselineRecorded },
          'OD-106: hold saved without an exchange baseline; this held read recorded it (no replacement on this read)'
        );
      } else {
        logger.debug({ ipoId, table: tableName, field, reason: result.reason }, 'OD-106: admin-held E-1 field kept');
      }
      return { holdReleased: false };
    }
    if (deps.invalidateCaches) {
      try {
        await deps.invalidateCaches(ipoId, result.slug);
      } catch (error) {
        logger.warn(
          { ipoId, slug: result.slug, error: error instanceof Error ? error.message : String(error) },
          'OD-106: cache drop after the committed replacement failed; readers catch up at the TTL'
        );
      }
    }

    const env = deps.env ?? process.env.DEPLOY_SLOT ?? 'unknown-env';
    const facts = {
      ipoId,
      slug: result.slug,
      table: tableName,
      field,
      source: result.source,
      adminValue: show(result.adminValue),
      exchangeValue: show(result.exchangeValue),
      status: result.status,
      auditId: result.auditId,
    };
    logger.info(facts, 'OD-106: a newer exchange value replaced an admin-held E-1 value; the hold is released');

    if (!isInstantAlertStatus(result.status)) {
      logger.info(
        facts,
        'OD-106: not a live IPO, no instant alert (OD-112); recorded for the 09:00 IST digest (§9.2 item 16) by its audit row'
      );
      return { holdReleased: true };
    }
    const key = exchangeOverrideDedupeKey(env, ipoId, field, now);
    try {
      if (await deps.isClaimed(key)) {
        logger.info({ ...facts, key }, 'OD-106: admin alert already sent today for this IPO and field');
        return { holdReleased: true };
      }
      const title = `[${env}] ${result.companyName}: ${result.source} replaced the admin's ${tableName}.${field}`;
      const body =
        `${result.companyName} (${result.slug}, ${result.status}): ${result.source} now says ${tableName}.${field} = ` +
        `${facts.exchangeValue}; the admin had ${facts.adminValue}. The exchange value is live and the admin hold ` +
        `is released (spec OD-106). Audit row ${result.auditId}.`;
      const out = await deps.send('P2', title, { body, type: 'admin-od106', dedupeKey: key });
      if (!out.sent) {
        logger.warn({ ...facts, key, reason: out.reason }, 'OD-106: admin alert NOT sent; the audit row keeps the change for the digest');
        return { holdReleased: true };
      }
      await deps.claim(key);
      logger.info({ ...facts, key }, 'OD-106: admin alert sent');
    } catch (error) {
      logger.warn(
        { ...facts, key, error: error instanceof Error ? error.message : String(error) },
        'OD-106: admin alert step failed; the release is committed and its audit row stands'
      );
    }
    return { holdReleased: true };
  };
}
