import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  decidePurge,
  hasStoredFile,
  storeDocument,
  isPurgeDue,
  getMaxRetentionDays,
  DEFAULT_MAX_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
} from '../../../src/services/document-store.js';
import { demoteMissingFiles } from '../../../src/services/document-cycle.js';
import { InMemoryDocumentFetchStateStore } from '../../../src/services/in-memory-document-fetch-state-store.js';
import { planIpoCycle } from '../../../src/services/document-state-machine.js';

/**
 * T-403 M7 — purge before extraction.
 *
 * The first cut deleted local PDFs on the DATE alone. That throws away files
 * that were downloaded and never read: WP C would then have to re-fetch them
 * from an exchange that has often already taken them down. The rule now keeps an
 * unread file past the soft window, up to a hard cap that protects the disk
 * (this project has already lost prod's DB, SSH and runner to a full disk once).
 */

const CLOSE = '2026-08-27';
const at = (iso: string) => new Date(iso);
const day = (n: number) => at(new Date(Date.parse('2026-08-27T12:00:00Z') + n * 86_400_000).toISOString());

describe('decidePurge — the three arms', () => {
  it('KEEPS everything inside the soft window, read or not', () => {
    for (const allDocumentsRead of [true, false]) {
      expect(
        decidePurge({ closeDate: CLOSE, allDocumentsRead, now: day(5) })
      ).toEqual({ purge: false, reason: 'not_due' });
    }
  });

  it('PURGES past the soft window when every document has been read', () => {
    expect(decidePurge({ closeDate: CLOSE, allDocumentsRead: true, now: day(8) })).toEqual({
      purge: true,
      reason: 'read_and_expired',
    });
  });

  it('KEEPS past the soft window while anything is still UNREAD — the M7 fix', () => {
    // The defect: at close+8 the old rule deleted this file even though nothing
    // had ever read it.
    expect(decidePurge({ closeDate: CLOSE, allDocumentsRead: false, now: day(8) })).toEqual({
      purge: false,
      reason: 'unread_within_hard_cap',
    });
    expect(decidePurge({ closeDate: CLOSE, allDocumentsRead: false, now: day(29) }).purge).toBe(false);
  });

  it('PURGES at the HARD cap even when unread — disk safety wins eventually', () => {
    expect(DEFAULT_MAX_RETENTION_DAYS).toBe(30);
    expect(decidePurge({ closeDate: CLOSE, allDocumentsRead: false, now: day(31) })).toEqual({
      purge: true,
      reason: 'hard_cap',
    });
  });

  it('PURGES immediately on withdrawal, whatever the dates say (F15)', () => {
    expect(
      decidePurge({ closeDate: '2027-12-31', withdrawn: true, allDocumentsRead: false, now: day(0) })
    ).toEqual({ purge: true, reason: 'withdrawn' });
  });

  it('NEVER purges an IPO with no usable close date', () => {
    expect(decidePurge({ closeDate: null, allDocumentsRead: true, now: day(999) })).toEqual({
      purge: false,
      reason: 'no_close_date',
    });
    expect(decidePurge({ closeDate: 'not-a-date', allDocumentsRead: true, now: day(999) }).purge).toBe(false);
  });

  it('honours PROSPECTUS_MAX_RETENTION_DAYS from the environment', () => {
    expect(getMaxRetentionDays({ PROSPECTUS_MAX_RETENTION_DAYS: '3' } as NodeJS.ProcessEnv)).toBe(3);
    expect(getMaxRetentionDays({} as NodeJS.ProcessEnv)).toBe(DEFAULT_MAX_RETENTION_DAYS);
    expect(
      decidePurge({ closeDate: CLOSE, allDocumentsRead: false, maxRetentionDays: 3, now: day(4) })
    ).toEqual({ purge: true, reason: 'hard_cap' });
  });

  it('the date-only isPurgeDue still behaves as before (soft window)', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(7);
    expect(isPurgeDue({ closeDate: CLOSE, now: day(6) })).toBe(false);
    expect(isPurgeDue({ closeDate: CLOSE, now: day(8) })).toBe(true);
  });
});

describe('hasStoredFile — a FOUND row whose file vanished must be re-fetchable', () => {
  const IPO = '11111111-2222-3333-4444-555555555555';
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x41)]);
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-purge-'));
  });
  afterEach(async () => {
    await fsp.rm(storeDir, { recursive: true, force: true });
  });

  it('is TRUE after storing, and FALSE once the file is gone', async () => {
    expect(hasStoredFile(IPO, 'RHP', storeDir)).toBe(false);
    await storeDocument({ ipoId: IPO, docType: 'RHP', pdf, storeDir });
    expect(hasStoredFile(IPO, 'RHP', storeDir)).toBe(true);

    // The scenario the demotion exists for: purged too early, disk wiped, or a
    // failed rename. Without detecting this the state says FOUND forever and the
    // document is silently absent.
    await fsp.rm(join(storeDir, IPO), { recursive: true, force: true });
    expect(hasStoredFile(IPO, 'RHP', storeDir)).toBe(false);
  });

  it('does not confuse one document type with another', async () => {
    await storeDocument({ ipoId: IPO, docType: 'RHP', pdf, storeDir });
    expect(hasStoredFile(IPO, 'RHP', storeDir)).toBe(true);
    expect(hasStoredFile(IPO, 'CORRIGENDUM', storeDir)).toBe(false);
    // ...and a prefix collision must not count either.
    expect(hasStoredFile(IPO, 'RH', storeDir)).toBe(false);
  });

  it('returns FALSE (never throws) for a store that does not exist', () => {
    expect(hasStoredFile(IPO, 'RHP', join(storeDir, 'nope'))).toBe(false);
  });
});

describe('demoteMissingFiles — a lost file is re-fetched, never silently missing', () => {
  const IPO = '11111111-2222-3333-4444-555555555555';
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x41)]);
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await fsp.mkdtemp(join(os.tmpdir(), 't403-demote-'));
  });
  afterEach(async () => {
    await fsp.rm(storeDir, { recursive: true, force: true });
  });

  const store = new InMemoryDocumentFetchStateStore();

  async function seed(docType: string, state: string) {
    const row = await store.ensureRow(IPO + docType, docType);
    return { ...row, ipoId: IPO, state: state as never, documentId: 'doc-1' };
  }

  it('demotes a FOUND row with no file, and leaves one WITH a file alone', async () => {
    await storeDocument({ ipoId: IPO, docType: 'RHP', pdf, storeDir });
    const rows = [await seed('RHP', 'FOUND'), await seed('CORRIGENDUM', 'FOUND')];

    const demoted = await demoteMissingFiles(store as never, IPO, rows as never, storeDir);

    expect(demoted).toBe(1);
    expect(rows.find((r) => r.docType === 'RHP')!.state).toBe('FOUND');
    const corr = rows.find((r) => r.docType === 'CORRIGENDUM')!;
    expect(corr.state).toBe('WANTED');
    // documentId is cleared too — it points at a row whose bytes are gone.
    expect(corr.documentId).toBeNull();
  });

  it('never touches a row that is not FOUND', async () => {
    const rows = [await seed('PROSPECTUS', 'NOT_YET_FILED'), await seed('DRHP', 'NOT_APPLICABLE')];
    expect(await demoteMissingFiles(store as never, IPO, rows as never, storeDir)).toBe(0);
    expect(rows.map((r) => r.state)).toEqual(['NOT_YET_FILED', 'NOT_APPLICABLE']);
  });

  it('mutates the rows in place so the SAME cycle re-fetches, not the next one', async () => {
    const rows = [await seed('RHP', 'FOUND')];
    await demoteMissingFiles(store as never, IPO, rows as never, storeDir);
    const plan = planIpoCycle({
      stage: 'PRE_OPEN',
      rows: rows.map((r) => ({
        docType: r.docType as never,
        state: r.state,
        attempts: r.attempts,
        nextRetryAt: r.nextRetryAt,
        blockedSinceAt: r.blockedSinceAt,
        filingDate: r.filingDate,
        extractorVersion: r.extractorVersion,
        lastAttemptAt: r.lastAttemptAt,
      })),
      options: { now: new Date('2026-08-28T06:00:00Z') },
    });
    expect(plan.due).toContain('RHP');
  });
});
