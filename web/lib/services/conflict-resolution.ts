/**
 * Conflict Resolution Service
 * Business logic for resolving data conflicts between scrapers
 *
 * Purpose:
 * - Provides admin-facing API for conflict management
 * - Resolves conflicts by applying chosen value to database
 * - Maintains complete audit trail
 * - Protects fields from future overwrites
 *
 * Workflow:
 * 1. Admin views unresolved conflicts
 * 2. Admin selects winning source/value
 * 3. Service updates IPO with chosen value
 * 4. Service marks conflict as resolved
 * 5. Service protects field (optional)
 *
 * Usage:
 * ```typescript
 * const service = new ConflictResolutionService();
 * await service.resolveConflict('conflict-123', {
 *   resolvedSource: 'DRHP',
 *   resolutionReason: 'DRHP is authoritative for financial data',
 *   resolvedBy: 'admin@ipodhan.com',
 *   applyToDatabase: true,
 *   protectField: true
 * });
 * ```
 */

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos } from '@/lib/db';
import { DataConflictsRepository, type DataConflictRecord, type ConflictStats } from '@ipodhan/shared/repositories/data-conflicts-repository';
import { FieldProtectionRepository } from '@/lib/repositories/field-protection-repository';
import { saveAdminFieldValue } from '@/lib/admin/admin-field-save';
import {
  readAdminFieldVersion,
  STALE_EDITOR_REASON,
  type AdminFieldWriteResult,
} from '@ipodhan/shared/services/admin-field-write';
import type { ScraperSource } from '@ipodhan/shared/db/types';
import {
  acceptCorrigendumSuggestion,
  dismissCorrigendumSuggestion,
  isCorrigendumSuggestion,
} from '@ipodhan/shared/services/corrigendum-suggestions';

/**
 * Conflict resolution options
 */
export interface ResolveConflictOptions {
  /** Which source won (ADMIN, DRHP, NSE, BSE, etc.) */
  resolvedSource: ScraperSource;

  /** Reason for choosing this source */
  resolutionReason: string;

  /** Admin user who resolved (email or ID) */
  resolvedBy: string;
  /**
   * OD-104: the resolving admin's account id (withAdminAuth context), stored with every admin write.
   * Absent only on a SYSTEM action that writes no admin value; the ONE write refuses a write without it.
   */
  adminId?: string;

  /** Optional admin notes */
  adminNote?: string;

  /** Whether to apply winning value to database */
  applyToDatabase: boolean;

  /** Whether to protect field from future overwrites */
  protectField?: boolean;

  /** §9.2 item 20: the field's version token when the admin opened the queue row. */
  expectedVersion?: string;
}

/**
 * Conflict with IPO details (for UI display)
 */
export interface EnrichedConflict extends DataConflictRecord {
  ipoName: string;
  ipoSlug: string;
  ipoStatus: string;
  /** §9.2 item 20: the field's version token as the queue shows it; the resolve call sends it back. */
  version: string | null;
}

/**
 * Resolution result
 */
export interface ResolutionResult {
  success: boolean;
  conflictId: string;
  ipoId: string;
  fieldName: string;
  appliedValue: string | null;
  fieldProtected: boolean;
  error?: string;
  /** Set when the shared admin write refused (INVALID / NOT_FOUND / CONFLICT) — routes map it to 400/404/409. */
  writeResult?: AdminFieldWriteResult;
}

/**
 * Conflict Resolution Service
 * Handles admin conflict resolution with database updates
 */
export class ConflictResolutionService {
  private conflictsRepo: DataConflictsRepository;
  private protectionRepo: FieldProtectionRepository;

  constructor() {
    const redis = getRedisClient();
    this.conflictsRepo = new DataConflictsRepository(db, redis);
    this.protectionRepo = new FieldProtectionRepository(db, redis);
  }

  /**
   * Get all unresolved conflicts with IPO details
   * Sorted by severity (CRITICAL first) then by date
   */
  async getUnresolvedConflicts(
    filters?: {
      severity?: 'INFO' | 'WARNING' | 'CRITICAL';
      limit?: number;
    }
  ): Promise<EnrichedConflict[]> {
    const allConflicts = filters?.severity
      ? await this.conflictsRepo.findBySeverity(filters.severity, true)
      : await this.conflictsRepo.findUnresolved(filters?.limit);

    // Apply limit to severity-filtered results
    const conflicts = filters?.limit && filters?.severity
      ? allConflicts.slice(0, filters.limit)
      : allConflicts;

    // Enrich with IPO details
    const enriched: EnrichedConflict[] = [];

    for (const conflict of conflicts) {
      const [ipo] = await db
        .select({
          companyName: ipos.companyName,
          slug: ipos.slug,
          status: ipos.status,
        })
        .from(ipos)
        .where(eq(ipos.id, conflict.ipoId))
        .limit(1);

      if (ipo) {
        enriched.push({
          ...conflict,
          ipoName: ipo.companyName,
          ipoSlug: ipo.slug,
          ipoStatus: ipo.status,
          version: await this.versionOf(conflict),
        });
      }
    }

    return enriched;
  }

  /**
   * Get unresolved conflicts for a specific IPO
   */
  async getConflictsForIPO(ipoId: string): Promise<EnrichedConflict[]> {
    const conflicts = await this.conflictsRepo.findUnresolvedForIPO(ipoId);

    const [ipo] = await db
      .select({
        companyName: ipos.companyName,
        slug: ipos.slug,
        status: ipos.status,
      })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);

    if (!ipo) {
      return [];
    }

    const out: EnrichedConflict[] = [];
    for (const conflict of conflicts) {
      out.push({
        ...conflict,
        ipoName: ipo.companyName,
        ipoSlug: ipo.slug,
        ipoStatus: ipo.status,
        version: await this.versionOf(conflict),
      });
    }
    return out;
  }

  /** The token the queue row opens with (null for a table the admin write does not cover). */
  /** m8: a row table's conflict names its row (rowKey); the token is per row, not per table. */
  async versionOf(conflict: Pick<DataConflictRecord, 'ipoId' | 'tableName' | 'fieldName' | 'rowKey'>): Promise<string | null> {
    const row = conflict.rowKey ? { rowKey: conflict.rowKey } : undefined;
    return (await readAdminFieldVersion(db as never, conflict.ipoId, conflict.tableName, conflict.fieldName, row))?.version ?? null;
  }

  /**
   * Resolve a conflict
   * Optionally applies winning value to database and protects field
   */
  async resolveConflict(
    conflictId: string,
    options: ResolveConflictOptions
  ): Promise<ResolutionResult> {
    try {
      // Get conflict details
      const conflicts = await this.conflictsRepo.findUnresolved();
      const conflict = conflicts.find(c => c.id === conflictId);

      if (!conflict) {
        return {
          success: false,
          conflictId,
          ipoId: '',
          fieldName: '',
          appliedValue: null,
          fieldProtected: false,
          error: 'Conflict not found or already resolved',
        };
      }

      // OD-90 (item 9): a corrigendum SUGGESTION is resolved only one of two ways. Choosing ADMIN
      // accepts it — the proposed value is written as an ADMIN value (provenance + protection).
      // Any other choice dismisses it and writes nothing. It never takes the generic path below,
      // which writes only `ipos` columns and records no ADMIN provenance.
      if (isCorrigendumSuggestion(conflict)) {
        if (options.resolvedSource === 'ADMIN' && !options.expectedVersion) return this.staleEditor(conflictId, conflict);
        const decision =
          options.resolvedSource === 'ADMIN'
            ? await acceptCorrigendumSuggestion(db as never, conflictId, options.resolvedBy, options.adminNote, options.expectedVersion!, options.adminId ?? '')
            : await dismissCorrigendumSuggestion(db as never, conflictId, options.resolvedBy, options.adminNote);
        await this.clearCachesAfterSuggestionDecision(conflict.ipoId);
        return {
          success: decision.ok,
          conflictId,
          ipoId: conflict.ipoId,
          fieldName: conflict.fieldName,
          appliedValue: decision.appliedValue ?? null,
          fieldProtected: decision.ok && options.resolvedSource === 'ADMIN',
          error: decision.error,
          writeResult: decision.writeResult,
        };
      }

      // The reader line names the picked source (OD-109), so a pick must name one of the two
      // sources this conflict row actually holds; any other label would be a false source.
      if (
        options.applyToDatabase &&
        options.resolvedSource !== conflict.source1 &&
        options.resolvedSource !== conflict.source2
      ) {
        return this.unknownSource(conflictId, conflict, options.resolvedSource);
      }

      // Determine which value to apply based on resolved source
      const appliedValue = options.resolvedSource === conflict.source1
        ? conflict.value1
        : conflict.value2;

      // Apply value to database if requested — through the ONE admin write (spec §9.2 item 11):
      // any admin-writable table, not only `ipos` (F-169), with ADMIN provenance, protection,
      // audit row and the version check, then the cache drop.
      let fieldProtected = false;
      if (options.applyToDatabase) {
        // §9.2 item 20: the token comes from the client that opened the row, never read here.
        if (!options.expectedVersion) return this.staleEditor(conflictId, conflict);
        const expectedVersion = options.expectedVersion;
        const write = await saveAdminFieldValue({
          ipoId: conflict.ipoId,
          tableName: conflict.tableName,
          fieldName: conflict.fieldName,
          value: appliedValue,
          empty: appliedValue === null ? { reason: options.adminNote || `Conflict resolved to ${options.resolvedSource}, which has no value` } : undefined,
          // The value is the stored data_conflicts row's, chosen server-side by resolvedSource.
          mode: {
            kind: 'storedPick',
            sourceLabel: options.resolvedSource,
            readDate: conflict.detectedAt ? new Date(conflict.detectedAt).toISOString() : null,
            value: appliedValue,
          },
          expectedVersion,
          actor: { name: options.resolvedBy, adminId: options.adminId ?? '' },
          row: conflict.rowKey ? { rowKey: conflict.rowKey } : undefined,
          entryPoint: 'api/admin/conflicts/resolve',
        });
        if (write.kind !== 'OK') {
          return {
            success: false,
            conflictId,
            ipoId: conflict.ipoId,
            fieldName: conflict.fieldName,
            appliedValue: null,
            fieldProtected: false,
            error: write.kind === 'CONFLICT' ? 'CONFLICT: the field changed after the queue was opened' : `${write.kind}: ${write.reason}`,
            writeResult: write,
          };
        }
        fieldProtected = true;
      } else if (options.protectField) {
        // OD-121, §9.2 item 11: "protect without applying" used to set a hold with no value. A hold
        // is always an admin value, so it is now an admin PICK of the value the queue row showed,
        // from the source that supplied it, through the ONE write (value, ADMIN provenance, hold,
        // audit, version check). Nothing shown -> refused, the admin uses the editor.
        if (!options.expectedVersion) return this.staleEditor(conflictId, conflict);
        const hold = await saveAdminFieldValue({
          ipoId: conflict.ipoId,
          tableName: conflict.tableName,
          row: conflict.rowKey ? { rowKey: conflict.rowKey } : undefined,
          fieldName: conflict.fieldName,
          mode: { kind: 'holdShown' },
          expectedVersion: options.expectedVersion,
          actor: { name: options.resolvedBy, adminId: options.adminId ?? '' },
          entryPoint: 'api/admin/conflicts (protect without applying)',
          detail: { conflictId, resolutionReason: options.resolutionReason },
        });
        if (hold.kind !== 'OK') {
          return {
            success: false,
            conflictId,
            ipoId: conflict.ipoId,
            fieldName: conflict.fieldName,
            appliedValue: null,
            fieldProtected: false,
            error: hold.kind === 'CONFLICT' ? 'CONFLICT: the field changed after the queue was opened' : `${hold.kind}: ${hold.reason}`,
            writeResult: hold,
          };
        }
        fieldProtected = true;
      }

      // Mark conflict as resolved
      await this.conflictsRepo.resolveConflict(conflictId, {
        resolvedSource: options.resolvedSource,
        resolutionReason: options.resolutionReason,
        resolvedBy: options.resolvedBy,
        adminNote: options.adminNote,
      });

      return {
        success: true,
        conflictId,
        ipoId: conflict.ipoId,
        fieldName: conflict.fieldName,
        appliedValue,
        fieldProtected,
      };
    } catch (error) {
      return {
        success: false,
        conflictId,
        ipoId: '',
        fieldName: '',
        appliedValue: null,
        fieldProtected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private unknownSource(conflictId: string, conflict: DataConflictRecord, source: string): ResolutionResult {
    const reason = `resolvedSource "${source}" is neither of this conflict's sources (${conflict.source1}, ${conflict.source2})`;
    return {
      success: false,
      conflictId,
      ipoId: conflict.ipoId,
      fieldName: conflict.fieldName,
      appliedValue: null,
      fieldProtected: false,
      error: reason,
      writeResult: { kind: 'INVALID', reason },
    };
  }

  private staleEditor(conflictId: string, conflict: DataConflictRecord): ResolutionResult {
    return {
      success: false,
      conflictId,
      ipoId: conflict.ipoId,
      fieldName: conflict.fieldName,
      appliedValue: null,
      fieldProtected: false,
      error: STALE_EDITOR_REASON,
      writeResult: { kind: 'INVALID', reason: STALE_EDITOR_REASON },
    };
  }

  /**
   * Bulk resolve conflicts (choose one source for multiple conflicts). Each item carries the token
   * its queue row was opened with (§9.2 item 20): `versions[conflictId]`.
   */
  async bulkResolve(
    conflictIds: string[],
    options: Omit<ResolveConflictOptions, 'adminNote' | 'expectedVersion'>,
    versions: Record<string, string | undefined> = {}
  ): Promise<{
    successful: number;
    failed: number;
    results: ResolutionResult[];
  }> {
    const results: ResolutionResult[] = [];

    for (const id of conflictIds) {
      const result = await this.resolveConflict(id, {
        ...options,
        adminNote: undefined,
        expectedVersion: versions[id],
      });
      results.push(result);
    }

    return {
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }

  /** OD-90: the list and the IPO page must not serve the pre-decision state from cache. */
  private async clearCachesAfterSuggestionDecision(ipoId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const keys = [...(await redis.keys('conflicts:*')), ...(await redis.keys('ipo:*'))];
      if (keys.length > 0) await redis.del(...keys);
    } catch (error) {
      console.warn(`[Conflicts] cache invalidation after a corrigendum decision failed for ${ipoId}:`, error);
    }
  }

  /**
   * Get conflict statistics
   */
  async getConflictStats(ipoId?: string): Promise<ConflictStats> {
    return await this.conflictsRepo.getConflictStats(ipoId);
  }

  /**
   * Get most problematic fields (fields with most conflicts)
   */
  async getProblematicFields(limit: number = 10): Promise<Array<{
    fieldName: string;
    conflictCount: number;
  }>> {
    return await this.conflictsRepo.getMostProblematicFields(limit);
  }

  /**
   * Auto-resolve conflicts using priority matrix
   * Resolves obvious conflicts automatically (e.g., ADMIN always wins)
   */
  async autoResolve(options: {
    maxConflicts?: number;
    dryRun?: boolean;
  } = {}): Promise<{
    resolved: number;
    skipped: number;
    details: Array<{
      conflictId: string;
      fieldName: string;
      chosenSource: string;
      reason: string;
    }>;
  }> {
    const conflicts = await this.conflictsRepo.findUnresolved(options.maxConflicts);

    const result = {
      resolved: 0,
      skipped: 0,
      details: [] as Array<{
        conflictId: string;
        fieldName: string;
        chosenSource: string;
        reason: string;
      }>,
    };

    for (const conflict of conflicts) {
      // OD-90: a corrigendum suggestion is never auto-resolved — only the admin decides it.
      if (isCorrigendumSuggestion(conflict)) {
        result.skipped++;
        continue;
      }

      // Auto-resolve if source1 or source2 is ADMIN
      if (conflict.source1 === 'ADMIN') {
        if (!options.dryRun) {
          await this.resolveConflict(conflict.id, {
            resolvedSource: 'ADMIN',
            resolutionReason: 'Auto-resolved: ADMIN source always wins',
            resolvedBy: 'system',
            // A SYSTEM action never writes an admin value or a hold (§9.2 items 3, 11): the ADMIN
            // side is already the stored, protected value, so auto-resolve only closes the queue row.
            applyToDatabase: false,
            protectField: false,
          });
        }

        result.resolved++;
        result.details.push({
          conflictId: conflict.id,
          fieldName: conflict.fieldName,
          chosenSource: 'ADMIN',
          reason: 'ADMIN has highest priority',
        });
        continue;
      }

      if (conflict.source2 === 'ADMIN') {
        if (!options.dryRun) {
          await this.resolveConflict(conflict.id, {
            resolvedSource: 'ADMIN',
            resolutionReason: 'Auto-resolved: ADMIN source always wins',
            resolvedBy: 'system',
            // A SYSTEM action never writes an admin value or a hold (§9.2 items 3, 11): the ADMIN
            // side is already the stored, protected value, so auto-resolve only closes the queue row.
            applyToDatabase: false,
            protectField: false,
          });
        }

        result.resolved++;
        result.details.push({
          conflictId: conflict.id,
          fieldName: conflict.fieldName,
          chosenSource: 'ADMIN',
          reason: 'ADMIN has highest priority',
        });
        continue;
      }

      // Skip other conflicts (require manual review)
      result.skipped++;
    }

    return result;
  }
}

/**
 * Factory function for dependency injection
 */
export function createConflictResolutionService(): ConflictResolutionService {
  return new ConflictResolutionService();
}
