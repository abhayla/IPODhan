/**
 * Integration Tests: Admin Protection API
 * Tests all admin protection API endpoints with real DB and Redis
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  ipos,
  fieldProtectionMetadata,
} from '@ipodhan/shared/db/schema';
import { eq, and } from 'drizzle-orm';

// Test data
const TEST_ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'test-admin-token';
const API_BASE = 'http://localhost:3000/api/admin/protection';

let testIPOId: string;

describe('Admin Protection API - Integration Tests', () => {
  beforeAll(async () => {
    // Enable admin panel for tests
    process.env.ADMIN_PANEL_ENABLED = 'true';
    process.env.ADMIN_AUTH_TOKEN = TEST_ADMIN_TOKEN;

    // Create test IPO
    const db = await getDb();
    const [testIPO] = await db
      .insert(ipos)
      .values({
        companyName: 'Test Company for Protection',
        slug: `test-protection-${Date.now()}`,
        status: 'OPEN',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
      })
      .returning();

    testIPOId = testIPO.id;
  });

  afterAll(async () => {
    // Clean up test data
    const db = await getDb();
    if (testIPOId) {
      await db.delete(fieldProtectionMetadata).where(eq(fieldProtectionMetadata.ipoId, testIPOId));
      await db.delete(ipos).where(eq(ipos.id, testIPOId));
    }

    // Clear Redis cache
    const redis = getRedisClient();
    const keys = await redis.keys('protection:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  beforeEach(async () => {
    // Clear field protections before each test
    const db = await getDb();
    await db.delete(fieldProtectionMetadata).where(eq(fieldProtectionMetadata.ipoId, testIPOId));

    // Reset IPO lock
    await db
      .update(ipos)
      .set({
        scraperLocked: false,
        scraperLockNote: null,
        lastManualEditAt: null,
      })
      .where(eq(ipos.id, testIPOId));

    // Clear Redis cache
    const redis = getRedisClient();
    const keys = await redis.keys(`protection:*${testIPOId}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe('IPO Lock API', () => {
    describe('GET /api/admin/protection/ipo/[ipoId]', () => {
      it('should return 401 without auth token', async () => {
        const response = await fetch(`${API_BASE}/ipo/${testIPOId}`);

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBe('Unauthorized');
      });

      it('should return IPO lock status', async () => {
        const response = await fetch(`${API_BASE}/ipo/${testIPOId}`, {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toMatchObject({
          ipoId: testIPOId,
          companyName: 'Test Company for Protection',
          scraperLocked: false,
          scraperLockNote: null,
        });
      });

      it('should return 404 for non-existent IPO', async () => {
        const response = await fetch(`${API_BASE}/ipo/non-existent-id`, {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          },
        });

        expect(response.status).toBe(404);
      });
    });

    describe('PATCH /api/admin/protection/ipo/[ipoId]', () => {
      it('should enable IPO lock', async () => {
        const response = await fetch(`${API_BASE}/ipo/${testIPOId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scraperLocked: true,
            scraperLockNote: 'Test lock note',
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.scraperLocked).toBe(true);
        expect(data.data.scraperLockNote).toBe('Test lock note');

        // Verify in database
        const db = await getDb();
        const [ipo] = await db
          .select()
          .from(ipos)
          .where(eq(ipos.id, testIPOId))
          .limit(1);

        expect(ipo.scraperLocked).toBe(true);
        expect(ipo.lastManualEditAt).not.toBeNull();
      });

      it('should disable IPO lock', async () => {
        // First enable
        await fetch(`${API_BASE}/ipo/${testIPOId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scraperLocked: true }),
        });

        // Then disable
        const response = await fetch(`${API_BASE}/ipo/${testIPOId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scraperLocked: false }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.data.scraperLocked).toBe(false);
      });

      it('should invalidate cache after toggle', async () => {
        const redis = getRedisClient();

        // Set cache
        await redis.setex(`protection:ipo_locked:${testIPOId}`, 3600, '0');

        // Toggle lock
        await fetch(`${API_BASE}/ipo/${testIPOId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scraperLocked: true }),
        });

        // Cache should be invalidated
        const cached = await redis.get(`protection:ipo_locked:${testIPOId}`);
        expect(cached).toBeNull();
      });
    });
  });

  describe('Field Protection API', () => {
    describe('GET /api/admin/protection/fields/[ipoId]', () => {
      it('should return empty list when no protections', async () => {
        const response = await fetch(`${API_BASE}/fields/${testIPOId}`, {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.protections).toEqual([]);
        expect(data.data.totalProtected).toBe(0);
      });

      it('should return field protections', async () => {
        // Create protection
        const db = await getDb();
        await db.insert(fieldProtectionMetadata).values({
          ipoId: testIPOId,
          tableName: 'ipos',
          fieldName: 'lotSize',
          isProtected: true,
          autoProtected: true,
          manuallyEditedBy: 'Admin',
        });

        const response = await fetch(`${API_BASE}/fields/${testIPOId}`, {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.data.protections).toHaveLength(1);
        expect(data.data.protections[0]).toMatchObject({
          tableName: 'ipos',
          fieldName: 'lotSize',
          isProtected: true,
          autoProtected: true,
        });
        expect(data.data.totalProtected).toBe(1);
      });

      it('should filter by table name', async () => {
        // Create protections in different tables
        const db = await getDb();
        await db.insert(fieldProtectionMetadata).values([
          {
            ipoId: testIPOId,
            tableName: 'ipos',
            fieldName: 'lotSize',
            isProtected: true,
          },
          {
            ipoId: testIPOId,
            tableName: 'financial_data',
            fieldName: 'revenueFy2024',
            isProtected: true,
          },
        ]);

        const response = await fetch(`${API_BASE}/fields/${testIPOId}?tableName=ipos`, {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.data.protections).toHaveLength(1);
        expect(data.data.protections[0].tableName).toBe('ipos');
      });
    });

    describe('POST /api/admin/protection/fields/[ipoId]', () => {
      it('should create field protection', async () => {
        const response = await fetch(`${API_BASE}/fields/${testIPOId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tableName: 'ipos',
            fieldName: 'lotSize',
            isProtected: true,
            autoProtected: true,
            editNote: 'Corrected lot size',
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toMatchObject({
          tableName: 'ipos',
          fieldName: 'lotSize',
          isProtected: true,
          autoProtected: true,
          editNote: 'Corrected lot size',
        });

        // Verify in database
        const db = await getDb();
        const [protection] = await db
          .select()
          .from(fieldProtectionMetadata)
          .where(
            and(
              eq(fieldProtectionMetadata.ipoId, testIPOId),
              eq(fieldProtectionMetadata.tableName, 'ipos'),
              eq(fieldProtectionMetadata.fieldName, 'lotSize')
            )
          );

        expect(protection).toBeDefined();
        expect(protection.isProtected).toBe(true);
      });

      it('should update existing field protection', async () => {
        // Create initial protection
        const db = await getDb();
        await db.insert(fieldProtectionMetadata).values({
          ipoId: testIPOId,
          tableName: 'ipos',
          fieldName: 'lotSize',
          isProtected: true,
        });

        // Update to unprotected
        const response = await fetch(`${API_BASE}/fields/${testIPOId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tableName: 'ipos',
            fieldName: 'lotSize',
            isProtected: false,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.data.isProtected).toBe(false);
      });

      it('should return 400 without required fields', async () => {
        const response = await fetch(`${API_BASE}/fields/${testIPOId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tableName: 'ipos',
            // Missing fieldName and isProtected
          }),
        });

        expect(response.status).toBe(400);
      });
    });

    describe('DELETE /api/admin/protection/fields/[ipoId]', () => {
      it('should delete field protection', async () => {
        // Create protection
        const db = await getDb();
        await db.insert(fieldProtectionMetadata).values({
          ipoId: testIPOId,
          tableName: 'ipos',
          fieldName: 'lotSize',
          isProtected: true,
        });

        // Delete
        const response = await fetch(
          `${API_BASE}/fields/${testIPOId}?tableName=ipos&fieldName=lotSize`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            },
          }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);

        // Verify deletion
        const [protection] = await db
          .select()
          .from(fieldProtectionMetadata)
          .where(
            and(
              eq(fieldProtectionMetadata.ipoId, testIPOId),
              eq(fieldProtectionMetadata.tableName, 'ipos'),
              eq(fieldProtectionMetadata.fieldName, 'lotSize')
            )
          );

        expect(protection).toBeUndefined();
      });

      it('should return 404 for non-existent protection', async () => {
        const response = await fetch(
          `${API_BASE}/fields/${testIPOId}?tableName=ipos&fieldName=nonexistent`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            },
          }
        );

        expect(response.status).toBe(404);
      });
    });
  });

  describe('Bulk Operations API', () => {
    describe('POST /api/admin/protection/fields/bulk', () => {
      it('should protect multiple fields', async () => {
        const response = await fetch(`${API_BASE}/fields/bulk`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ipoId: testIPOId,
            tableName: 'ipos',
            fieldNames: ['lotSize', 'priceRangeMin', 'priceRangeMax'],
            isProtected: true,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.updatedCount).toBe(3);

        // Verify in database
        const db = await getDb();
        const protections = await db
          .select()
          .from(fieldProtectionMetadata)
          .where(eq(fieldProtectionMetadata.ipoId, testIPOId));

        expect(protections).toHaveLength(3);
        expect(protections.every(p => p.isProtected)).toBe(true);
      });

      it('should unprotect multiple fields', async () => {
        // First protect
        await fetch(`${API_BASE}/fields/bulk`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ipoId: testIPOId,
            tableName: 'ipos',
            fieldNames: ['lotSize', 'priceRangeMin'],
            isProtected: true,
          }),
        });

        // Then unprotect
        const response = await fetch(`${API_BASE}/fields/bulk`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ipoId: testIPOId,
            tableName: 'ipos',
            fieldNames: ['lotSize', 'priceRangeMin'],
            isProtected: false,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.data.updatedCount).toBe(2);
      });
    });
  });

  describe('Notifications API', () => {
    describe('GET /api/admin/protection/notifications', () => {
      it('should return empty list when no notifications', async () => {
        const response = await fetch(`${API_BASE}/notifications`, {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.notifications).toEqual([]);
      });

      it('should return notifications with stats', async () => {
        // Add mock notifications to Redis
        const redis = getRedisClient();
        const notification = JSON.stringify({
          ipoId: testIPOId,
          tableName: 'ipos',
          fieldName: 'lotSize',
          scraperName: 'NSE-Scraper',
          reason: 'field_protected',
          timestamp: new Date().toISOString(),
          attemptedValue: 3000,
        });

        await redis.zadd('protection:blocked_updates', Date.now(), notification);

        const response = await fetch(`${API_BASE}/notifications?limit=10`, {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.data.notifications).toHaveLength(1);
        expect(data.data.stats.total).toBe(1);
        expect(data.data.stats.byReason).toHaveProperty('field_protected');
      });
    });
  });
});
