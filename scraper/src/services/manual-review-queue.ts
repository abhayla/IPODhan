/**
 * Manual Review Queue Service
 * Manages queue of failed/low-confidence DRHP extractions for human review
 *
 * Core Responsibilities:
 * 1. Queue failed extractions automatically
 * 2. Store extraction results for admin review
 * 3. Track retry attempts
 * 4. Provide API for admin interface
 * 5. Mark items as reviewed/resolved
 *
 * Architecture:
 * - Database-backed queue (persistent)
 * - Priority-based ordering
 * - Automatic cleanup of old items
 * - Full audit trail
 *
 * Performance:
 * - Target: <100ms per queue operation
 * - Auto-cleanup after 30 days
 * - Pagination support for large queues
 */

import type { DRHPExtraction } from './drhp-extractor';

/**
 * Queue item priority levels
 */
export enum ReviewPriority {
  LOW = 'LOW',       // Successful extraction but low confidence (60-75%)
  MEDIUM = 'MEDIUM', // Failed extraction, non-critical
  HIGH = 'HIGH',     // Timeout or critical extraction failure
  URGENT = 'URGENT', // Multiple retry failures
}

/**
 * Queue item status
 */
export enum ReviewStatus {
  PENDING = 'PENDING',       // Awaiting review
  IN_REVIEW = 'IN_REVIEW',   // Admin is reviewing
  APPROVED = 'APPROVED',     // Admin approved the extraction
  REJECTED = 'REJECTED',     // Admin rejected, needs re-extraction
  RESOLVED = 'RESOLVED',     // Issue resolved (data manually entered)
}

/**
 * Manual review queue item
 */
export interface ReviewQueueItem {
  id: string;
  ipoId: string;
  ipoName?: string;
  pdfPath: string;
  reason: string;
  priority: ReviewPriority;
  status: ReviewStatus;

  // Extraction data (if available)
  extractionResult: DRHPExtraction | null;
  confidence?: number;

  // Metadata
  queuedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNotes?: string;
  retryCount: number;

  // For tracking
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for adding item to queue
 */
export interface AddToQueueOptions {
  ipoId: string;
  pdfPath: string;
  reason: string;
  extractionResult?: DRHPExtraction | null;
  priority?: ReviewPriority;
  queuedAt?: Date;
}

/**
 * Queue filter options
 */
export interface QueueFilterOptions {
  status?: ReviewStatus | ReviewStatus[];
  priority?: ReviewPriority | ReviewPriority[];
  ipoId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'priority' | 'queuedAt' | 'confidence';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Manual Review Queue Service
 * Manages extraction review workflow
 */
export class ManualReviewQueueService {
  // In-memory queue for development/testing
  // In production, this should be backed by a database table
  private queue: Map<string, ReviewQueueItem> = new Map();
  private idCounter = 1;

  constructor(
    private queueRepository?: any // ManualReviewQueueRepository (optional for testing)
  ) {
    console.log('[ManualReviewQueue] Service initialized');
  }

  /**
   * Add extraction to manual review queue
   * Main entry point from DRHP extractor
   */
  async addToQueue(options: AddToQueueOptions): Promise<ReviewQueueItem> {
    const id = this.generateId();

    // Calculate priority if not provided
    const priority = options.priority || this.calculatePriority(options);

    // Calculate confidence from extraction result
    const confidence = options.extractionResult?.metadata?.confidence_score;

    const item: ReviewQueueItem = {
      id,
      ipoId: options.ipoId,
      pdfPath: options.pdfPath,
      reason: options.reason,
      priority,
      status: ReviewStatus.PENDING,
      extractionResult: options.extractionResult || null,
      confidence,
      queuedAt: options.queuedAt || new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store in queue
    if (this.queueRepository) {
      await this.queueRepository.create(item);
    } else {
      // In-memory fallback
      this.queue.set(id, item);
    }

    console.log(
      `[ManualReviewQueue] Added item ${id}: ${options.reason} (priority: ${priority})`
    );

    return item;
  }

  /**
   * Get items from queue with filtering
   */
  async getQueue(options?: QueueFilterOptions): Promise<ReviewQueueItem[]> {
    let items: ReviewQueueItem[];

    if (this.queueRepository) {
      items = await this.queueRepository.findAll(options);
    } else {
      // In-memory fallback
      items = Array.from(this.queue.values());

      // Apply filters
      if (options?.status) {
        const statuses = Array.isArray(options.status) ? options.status : [options.status];
        items = items.filter((item) => statuses.includes(item.status));
      }

      if (options?.priority) {
        const priorities = Array.isArray(options.priority) ? options.priority : [options.priority];
        items = items.filter((item) => priorities.includes(item.priority));
      }

      if (options?.ipoId) {
        items = items.filter((item) => item.ipoId === options.ipoId);
      }

      // Sort
      if (options?.sortBy) {
        items = this.sortItems(items, options.sortBy, options.sortOrder);
      }

      // Pagination
      if (options?.offset !== undefined) {
        items = items.slice(options.offset);
      }

      if (options?.limit !== undefined) {
        items = items.slice(0, options.limit);
      }
    }

    return items;
  }

  /**
   * Get single queue item by ID
   */
  async getItem(id: string): Promise<ReviewQueueItem | null> {
    if (this.queueRepository) {
      return await this.queueRepository.findById(id);
    } else {
      return this.queue.get(id) || null;
    }
  }

  /**
   * Update queue item status
   */
  async updateStatus(
    id: string,
    status: ReviewStatus,
    options?: {
      reviewedBy?: string;
      reviewNotes?: string;
    }
  ): Promise<ReviewQueueItem> {
    const item = await this.getItem(id);

    if (!item) {
      throw new Error(`Queue item not found: ${id}`);
    }

    // Update item
    item.status = status;
    item.updatedAt = new Date();

    if (status === ReviewStatus.IN_REVIEW ||
        status === ReviewStatus.APPROVED ||
        status === ReviewStatus.REJECTED ||
        status === ReviewStatus.RESOLVED) {
      item.reviewedAt = new Date();
      item.reviewedBy = options?.reviewedBy;
      item.reviewNotes = options?.reviewNotes;
    }

    if (this.queueRepository) {
      await this.queueRepository.update(id, item);
    } else {
      this.queue.set(id, item);
    }

    console.log(`[ManualReviewQueue] Updated item ${id} status to ${status}`);

    return item;
  }

  /**
   * Increment retry count for an item
   */
  async incrementRetry(id: string): Promise<ReviewQueueItem> {
    const item = await this.getItem(id);

    if (!item) {
      throw new Error(`Queue item not found: ${id}`);
    }

    item.retryCount++;
    item.updatedAt = new Date();

    // Auto-escalate priority after multiple retries
    if (item.retryCount >= 3 && item.priority !== ReviewPriority.URGENT) {
      item.priority = ReviewPriority.URGENT;
      console.log(`[ManualReviewQueue] Escalated item ${id} to URGENT (${item.retryCount} retries)`);
    }

    if (this.queueRepository) {
      await this.queueRepository.update(id, item);
    } else {
      this.queue.set(id, item);
    }

    return item;
  }

  /**
   * Delete queue item
   */
  async deleteItem(id: string): Promise<void> {
    if (this.queueRepository) {
      await this.queueRepository.delete(id);
    } else {
      this.queue.delete(id);
    }

    console.log(`[ManualReviewQueue] Deleted item ${id}`);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    totalPending: number;
    totalInReview: number;
    totalApproved: number;
    totalRejected: number;
    byPriority: Record<ReviewPriority, number>;
    averageConfidence: number;
    oldestPendingDays: number;
  }> {
    const items = await this.getQueue();

    const stats = {
      totalPending: items.filter((i) => i.status === ReviewStatus.PENDING).length,
      totalInReview: items.filter((i) => i.status === ReviewStatus.IN_REVIEW).length,
      totalApproved: items.filter((i) => i.status === ReviewStatus.APPROVED).length,
      totalRejected: items.filter((i) => i.status === ReviewStatus.REJECTED).length,
      byPriority: {
        [ReviewPriority.LOW]: items.filter((i) => i.priority === ReviewPriority.LOW).length,
        [ReviewPriority.MEDIUM]: items.filter((i) => i.priority === ReviewPriority.MEDIUM).length,
        [ReviewPriority.HIGH]: items.filter((i) => i.priority === ReviewPriority.HIGH).length,
        [ReviewPriority.URGENT]: items.filter((i) => i.priority === ReviewPriority.URGENT).length,
      },
      averageConfidence: 0,
      oldestPendingDays: 0,
    };

    // Calculate average confidence
    const itemsWithConfidence = items.filter((i) => i.confidence !== undefined);
    if (itemsWithConfidence.length > 0) {
      const totalConfidence = itemsWithConfidence.reduce((sum, i) => sum + (i.confidence || 0), 0);
      stats.averageConfidence = Math.round((totalConfidence / itemsWithConfidence.length) * 10) / 10;
    }

    // Calculate oldest pending
    const pendingItems = items.filter((i) => i.status === ReviewStatus.PENDING);
    if (pendingItems.length > 0) {
      const oldest = pendingItems.reduce((min, i) => {
        return i.queuedAt < min ? i.queuedAt : min;
      }, pendingItems[0].queuedAt);

      const daysDiff = (Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24);
      stats.oldestPendingDays = Math.round(daysDiff * 10) / 10;
    }

    return stats;
  }

  /**
   * Cleanup old resolved items
   * Remove items resolved more than 30 days ago
   */
  async cleanup(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const items = await this.getQueue();
    let deletedCount = 0;

    for (const item of items) {
      if (
        (item.status === ReviewStatus.APPROVED || item.status === ReviewStatus.RESOLVED) &&
        item.reviewedAt &&
        item.reviewedAt < cutoffDate
      ) {
        await this.deleteItem(item.id);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[ManualReviewQueue] Cleaned up ${deletedCount} old items`);
    }

    return deletedCount;
  }

  /**
   * Calculate priority based on failure reason and extraction data
   */
  private calculatePriority(options: AddToQueueOptions): ReviewPriority {
    const { reason, extractionResult } = options;

    // Timeout = HIGH
    if (reason.toLowerCase().includes('timeout')) {
      return ReviewPriority.HIGH;
    }

    // Low confidence but has data = LOW
    if (extractionResult && extractionResult.metadata.confidence_score < 75) {
      return ReviewPriority.LOW;
    }

    // No data extracted = MEDIUM
    if (reason.toLowerCase().includes('no data')) {
      return ReviewPriority.MEDIUM;
    }

    // Default = MEDIUM
    return ReviewPriority.MEDIUM;
  }

  /**
   * Sort queue items
   */
  private sortItems(
    items: ReviewQueueItem[],
    sortBy: 'priority' | 'queuedAt' | 'confidence',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): ReviewQueueItem[] {
    const priorityOrder: Record<ReviewPriority, number> = {
      [ReviewPriority.URGENT]: 4,
      [ReviewPriority.HIGH]: 3,
      [ReviewPriority.MEDIUM]: 2,
      [ReviewPriority.LOW]: 1,
    };

    return items.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'priority') {
        comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
      } else if (sortBy === 'queuedAt') {
        comparison = a.queuedAt.getTime() - b.queuedAt.getTime();
      } else if (sortBy === 'confidence') {
        const aConf = a.confidence || 0;
        const bConf = b.confidence || 0;
        comparison = aConf - bConf;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Generate unique ID for queue items
   */
  private generateId(): string {
    if (this.queueRepository) {
      // Database will generate UUID
      return `temp-${Date.now()}`;
    } else {
      // In-memory: simple counter
      return `review-${this.idCounter++}`;
    }
  }

  /**
   * Reset queue (for testing)
   */
  resetQueue(): void {
    this.queue.clear();
    this.idCounter = 1;
    console.log('[ManualReviewQueue] Queue reset');
  }
}

/**
 * Export types and enums
 */
export type {
  ReviewQueueItem,
  AddToQueueOptions,
  QueueFilterOptions,
};
