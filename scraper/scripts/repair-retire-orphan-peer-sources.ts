/**
 * OD-157 repair (#1166 round 2): move the live field_sources records of peer_companies rows that
 * were deleted BEFORE OD-157 shipped into field_sources_retired, reason 'pre-OD-157 orphan'.
 *
 * The live path (PeerCompanyRepository.replaceForIpo) retires a deleted row's records in the same
 * transaction from OD-157 on; this tool repairs the rows deleted before it. It finds orphans the way
 * the nightly check `r_child_provenance_orphan` does (a peer_companies record whose row key names
 * no stored peer row) and retires them through the same `retireChildRowSources` the live path uses
 * (scraper/src/services/orphan-peer-sources.ts), one IPO per transaction under the IPO's lock.
 * Nothing is deleted: every record is kept, whole, in field_sources_retired.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-retire-orphan-peer-sources.ts --expect-db ipodhan_test               # dry run
 *   npx tsx scripts/repair-retire-orphan-peer-sources.ts --expect-db ipodhan_staging --apply   # apply
 *   ... --ipo <uuid>[,<uuid>]   scope to some IPOs
 * --apply needs --expect-db; prod (ipodhan) is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db, getRedisClient } from '@ipodhan/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldSourceCacheKeys } from '@ipodhan/shared/repositories/field-sources-repository';
import {
  guardCacheInvalidation,
  openRepairDb,
  readExpectDbFlag,
  resolveIpoScope,
  writeLedgerFile,
  type ExecuteLike,
  type RepairLedgerFieldChange,
} from './lib/repair-tool';
import {
  PRE_OD157_ORPHAN_REASON,
  findOrphanPeerSourceKeys,
  retireOrphanPeerSources,
} from '../src/services/orphan-peer-sources';

const TOOL = 'repair-retire-orphan-peer-sources';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const allowProd = argv.includes('--allow-prod');
  const expectDb = readExpectDbFlag(argv);
  const scope = resolveIpoScope(argv);
  if (scope.invalid.length > 0 || scope.unusable) {
    console.error(`${TOOL}: --ipo is not usable (${scope.invalid.join(', ') || 'no value'}); refusing to run unscoped.`);
    process.exit(2);
  }
  if (apply && !expectDb) {
    console.error(`${TOOL}: --apply needs --expect-db <name>; refusing to guess the target database.`);
    process.exit(1);
  }
  const { dbName } = await openRepairDb(db as ExecuteLike, { apply, allowProd, toolName: TOOL, expectDb });

  const ipoIds = scope.ipoIds.length > 0 ? scope.ipoIds : null;
  const orphans = await findOrphanPeerSourceKeys(db as never, ipoIds);
  const records = orphans.reduce((n, o) => n + o.records, 0);
  console.log(`\n${TOOL}: ${orphans.length} orphan peer row key(s), ${records} live record(s), in "${dbName}"${ipoIds ? ` (scoped to ${ipoIds.length} IPO(s))` : ''}.`);
  for (const o of orphans) console.log(`  ${o.ipoId} | '${o.rowKey}' | ${o.records} record(s)`);

  const changes: RepairLedgerFieldChange[] = [];
  let retiredCount = 0;
  if (apply) {
    const results = await retireOrphanPeerSources(db as never, orphans, PRE_OD157_ORPHAN_REASON);
    for (const r of results) {
      for (const ref of r.retired) {
        changes.push({
          table: 'field_sources',
          rowKey: { ipoId: r.ipoId, tableName: ref.tableName, rowKey: ref.rowKey, fieldName: ref.fieldName },
          field: 'location',
          before: 'field_sources',
          after: 'field_sources_retired',
        });
      }
      retiredCount += r.retired.length;
      const skipped = r.scanned.filter((k) => !r.retiredKeys.includes(k));
      if (skipped.length > 0) console.log(`  ${r.ipoId}: kept ${skipped.length} key(s) that gained a peer row meanwhile: ${skipped.join(', ')}`);
    }
    const keys = [
      ...new Set(results.flatMap((r) => r.retired.map((ref) => fieldSourceCacheKeys(r.ipoId, ref.tableName, ref.fieldName, ref.rowKey)).flat())),
    ];
    if (keys.length > 0 && !guardCacheInvalidation({ dbName, toolName: TOOL, keys }).blocked) {
      await getRedisClient().del(...keys);
    }
    console.log(`${TOOL}: retired ${retiredCount} record(s) to field_sources_retired (reason '${PRE_OD157_ORPHAN_REASON}').`);
  } else {
    for (const o of orphans) {
      changes.push({
        table: 'field_sources',
        rowKey: { ipoId: o.ipoId, tableName: 'peer_companies', rowKey: o.rowKey, records: o.records },
        field: 'location',
        before: 'field_sources',
        after: 'field_sources_retired',
      });
    }
  }

  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    {
      tool: TOOL,
      mode: apply ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      changes,
      database: dbName,
      reason: PRE_OD157_ORPHAN_REASON,
      orphanKeys: orphans.length,
      liveRecords: records,
      retiredRecords: retiredCount,
    }
  );
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);
  if (!apply) console.log(`${TOOL}: DRY RUN — nothing was written.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`${TOOL}: FAILED — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
