/**
 * §9.2 item 23 (OD-116/OD-118): a public route keyed by an IPO id answers only for a row a reader
 * may see. Routes that read child tables (gmp_records, subscriptions) by ipo id never touch `ipos`,
 * so they call this before answering. `IPORepository.findById` drops a hidden row after its cache,
 * so a hide is honoured as soon as the row's id cache is cleared.
 */
import type Redis from 'ioredis';
import { db } from '@/lib/db/index';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export const IPO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function isPublicIpoId(ipoId: string, redis: Redis): Promise<boolean> {
  const row = await new IPORepository(db, redis).findById(ipoId);
  return row !== null;
}
