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

/**
 * Conflict resolution options
 */
export interface ResolveConflictOptions {
  /** Which source won (ADMIN, DRHP, NSE, BSE, etc.) */
  resolvedSource: 'ADMIN' | 'DRHP' | 'NSE' | 'BSE' | 'API_FALLBACK' | 'MONEYCONTROL' | 'CHITTORGARH';

  /** Reason for choosing this source */
  resolutionReason: string;

  /** Admin user who resolved (email or ID) */
  resolvedBy: string;

  /** Optional admin notes */
  adminNote?: string;

  /** Whether to apply winning value to database */
  applyToDatabase: boolean;

  /** Whether to protect field from future overwrites */
  protectField?: boolean;
}

/**
 * Conflict with IPO details (for UI display)
 */
export interface EnrichedConflict extends DataConflictRecord {
  ipoName: string;
  ipoSlug: string;
  ipoStatus: string;
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
    const conflicts = filters?.severity
      ? await this.conflictsRepo.findBySeverity(filters.severity, filters.limit)
      : await this.conflictsRepo.findUnresolved(filters?.limit);

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

    return conflicts.map(conflict => ({
      ...conflict,
      ipoName: ipo.companyName,
      ipoSlug: ipo.slug,
      ipoStatus: ipo.status,
    }));
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

      // Determine which value to apply based on resolved source
      const appliedValue = options.resolvedSource === conflict.source1
        ? conflict.value1
        : conflict.value2;

      // Apply value to database if requested
      if (options.applyToDatabase && conflict.tableName === 'ipos') {
        await this.applyValueToIPO(
          conflict.ipoId,
          conflict.fieldName,
          appliedValue
        );
      }

      // Protect field if requested
      let fieldProtected = false;
      if (options.protectField) {
        await this.protectionRepo.protect({
          ipoId: conflict.ipoId,
          tableName: conflict.tableName,
          fieldName: conflict.fieldName,
          protectedBy: options.resolvedBy,
          protectionReason: `Admin resolution: ${options.resolutionReason}`,
        });
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

  /**
   * Bulk resolve conflicts (choose one source for multiple conflicts)
   */
  async bulkResolve(
    conflictIds: string[],
    options: Omit<ResolveConflictOptions, 'adminNote'>
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
      });
      results.push(result);
    }

    return {
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
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
   * Apply a value to IPO field
   * Private helper for database updates
   */
  private async applyValueToIPO(
    ipoId: string,
    fieldName: string,
    value: string | null
  ): Promise<void> {
    // Parse value to appropriate type
    const parsedValue = this.parseFieldValue(fieldName, value);

    // Build update object dynamically
    const updateData: Record<string, any> = {
      [fieldName]: parsedValue,
      updatedAt: new Date(),
    };

    // Update IPO
    await db
      .update(ipos)
      .set(updateData)
      .where(eq(ipos.id, ipoId));
  }

  /**
   * Parse field value to appropriate type
   */
  private parseFieldValue(fieldName: string, value: string | null): any {
    if (value === null || value === 'null') {
      return null;
    }

    // Number fields
    const numberFields = [
      'issueSize',
      'lotSize',
      'minInvestment',
      'employeeDiscount',
      'employeeReservation',
      'shareholderReservation',
      'revenuefy2024',
      'profitfy2024',
      'roce',
      'roe',
    ];

    if (numberFields.includes(fieldName)) {
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    }

    // Date fields
    const dateFields = [
      'openDate',
      'closeDate',
      'listingDate',
      'allotmentDate',
      'refundDate',
    ];

    if (dateFields.includes(fieldName)) {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    // Boolean fields
    const booleanFields = ['isListed'];

    if (booleanFields.includes(fieldName)) {
      return value === 'true' || value === '1';
    }

    // String fields (default)
    return value;
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
      // Auto-resolve if source1 or source2 is ADMIN
      if (conflict.source1 === 'ADMIN') {
        if (!options.dryRun) {
          await this.resolveConflict(conflict.id, {
            resolvedSource: 'ADMIN',
            resolutionReason: 'Auto-resolved: ADMIN source always wins',
            resolvedBy: 'system',
            applyToDatabase: true,
            protectField: true,
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
            applyToDatabase: true,
            protectField: true,
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
