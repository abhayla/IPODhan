/**
 * Spec §9.2 item 9 and §9.4. End to end on ipodhan_test: an admin saves `ipos.issue_size`, a
 * document first seen after the save printed a different value (its receipt), the scraper's item 9
 * writer (`recordNewerDocumentSuggestions`, the walk's held-field hook) records the suggestion, and
 * the admin queue — the SQL page query (queueCte) through AdminQueueService — lists it as one item
 * naming that document (page null: F-205).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { AdminQueueService } from '@/lib/services/admin-queue-service';
import { adminQueueCacheKeys } from '@/lib/cache/cache-keys';
import { readAdminFieldVersion, writeAdminFieldValue } from '@ipodhan/shared/services/admin-field-write';
import { recordNewerDocumentSuggestions } from '../../../../scraper/src/services/newer-document-suggestions';

const tag = `i9q-${Date.now().toString(36)}`;
const ipoId = randomUUID();
const slug = `${tag}-ipo`;

async function dropQueueCache(): Promise<void> {
  try {
    await getRedisClient().del(...adminQueueCacheKeys());
  } catch {
    // No Redis in this environment: the cache helpers fall back to the database.
  }
}

async function cleanup(): Promise<void> {
  for (const t of ['audit_logs', 'data_conflicts', 'field_sources', 'field_protection_metadata', 'documents']) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE ipo_id = ${ipoId}`);
  }
  await db.execute(sql`DELETE FROM ipos WHERE id = ${ipoId}`);
}

describe('admin queue lists a newer-document suggestion with its document (§9.2 item 9, ipodhan_test)', () => {
  beforeAll(async () => {
    await db.execute(sql`INSERT INTO ipos (id, slug, company_name, segment, status, offering_type, open_date, close_date)
      VALUES (${ipoId}, ${slug}, ${`${tag} Ltd`}, 'MAINBOARD', 'UPCOMING', 'IPO', '2026-10-20', '2026-10-22')`);
  });

  afterAll(async () => {
    await cleanup();
    await dropQueueCache();
  });

  it('one queue item for the field, naming the newer document; a second run adds nothing', async () => {
    const opened = await readAdminFieldVersion(db as never, ipoId, 'ipos', 'issueSize');
    const saved = await writeAdminFieldValue(db as never, {
      ipoId,
      tableName: 'ipos',
      fieldName: 'issueSize',
      value: '1230000000',
      mode: { kind: 'typed', sourceNote: 'RHP page 7' },
      expectedVersion: opened!.version,
      actor: { name: 'i9q-admin', adminId: 'admin-i9q' },
      entryPoint: 'test',
      overrideReason: 'proof fixture',
    });
    expect(saved.kind, JSON.stringify(saved)).toBe('OK');

    const doc = await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status)
      VALUES (${ipoId}, 'RHP', ${`${tag} RHP`}, 'https://example.invalid/i9q.pdf', 'COMPLETED')
      RETURNING id::text AS id`);
    const documentId = String((doc.rows[0] as { id: string }).id);
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value)
      VALUES (${documentId}::uuid, 'ipos', '', 'issueSize', '300000000')`);

    const first = await recordNewerDocumentSuggestions(db as never, { ipoId, tableName: 'ipos', rowKey: '', fieldName: 'issue_size' });
    expect(first.inserted, JSON.stringify(first)).toBe(1);
    const again = await recordNewerDocumentSuggestions(db as never, { ipoId, tableName: 'ipos', rowKey: '', fieldName: 'issue_size' });
    expect(again).toMatchObject({ inserted: 0, duplicates: 1 });

    await dropQueueCache();
    const service = new AdminQueueService(db as never, getRedisClient() as never);
    const r = await service.getQueue({ page: 1, pageSize: 50, ipo: slug });
    const items = r.entries.flatMap((e) => (e.type === 'item' ? [e.item] : []));
    const suggestions = items.filter((i) => i.document?.origin === 'NEWER_DOCUMENT');
    expect(suggestions, JSON.stringify(items.map((i) => [i.id, i.kind, i.ruleFilter, i.document]))).toHaveLength(1);
    const s = suggestions[0];
    expect(s.id).toBe(`conflict:${first.ids[0]}`);
    expect(s.tableName).toBe('ipos');
    expect(s.fieldName).toBe('issueSize');
    expect(s.document).toEqual({ id: documentId, type: 'RHP', title: `${tag} RHP`, page: null, origin: 'NEWER_DOCUMENT' });
    expect(s.sources?.map((x) => [x.source, x.value])).toEqual([
      ['ADMIN', '1230000000'],
      ['DRHP', '300000000'],
    ]);
    expect(s.editorHref).toContain(slug);
  });
});
