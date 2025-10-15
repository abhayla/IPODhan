/**
 * Broker Affiliate Service
 * Story 5.7: Broker Affiliates DB Migration
 *
 * Business logic layer for broker affiliate operations.
 * Handles errors gracefully without throwing exceptions.
 */

import { db } from '../db';
import { getRedisClient } from '../cache/redis-client';
import { BrokerAffiliateRepository, type BrokerAffiliate } from '../repositories/broker-affiliate-repository';

/**
 * Get all active broker affiliates sorted by display order
 *
 * This function handles errors gracefully and returns an empty array on failure.
 * It does not throw exceptions to prevent page crashes.
 *
 * @returns Promise<BrokerAffiliate[]> - Array of active brokers (empty if error)
 */
export async function getActiveBrokers(): Promise<BrokerAffiliate[]> {
  try {
    const redis = getRedisClient();
    const repository = new BrokerAffiliateRepository(db, redis);

    const brokers = await repository.findAllActive();

    console.log(`[BrokerAffiliateService] Retrieved ${brokers.length} active brokers`);

    return brokers;
  } catch (error) {
    console.error('[BrokerAffiliateService] Failed to fetch broker affiliates:', error);
    console.error('[BrokerAffiliateService] Returning empty array to prevent page crash');

    // Return empty array - graceful degradation
    return [];
  }
}
