import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  storeDocument,
  purgeIpoDocuments,
  isPurgeDue,
  getStoreSizeBytes,
  documentFileName,
  documentPath,
  getStoreDir,
  getRetentionDays,
  getMaxStoreBytes,
  DEFAULT_RETENTION_DAYS,
} from '../../../src/services/document-store.js';

const IPO_ID = '11111111-2222-3333-4444-555555555555';
const pdf = (size = 4096) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size, 0x41)]);

let storeDir: string;

beforeEach(async () => {
  storeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 't403-store-'));
});
afterEach(async () => {
  await fsp.rm(storeDir, { recursive: true, force: true });
});

describe('storeDocument', () => {
  it('T53 writes atomically and leaves NO .tmp file behind', async () => {
    const buf = pdf();
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const result = await storeDocument({ ipoId: IPO_ID, docType: 'RHP', pdf: buf, sha256, storeDir });

    expect(result.stored).toBe(true);
    if (!result.stored) return;
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(path.basename(result.filePath)).toBe(`RHP-${sha256.slice(0, 8)}.pdf`);

    const entries = await fsp.readdir(path.join(storeDir, IPO_ID));
    expect(entries.some((e) => e.includes('.tmp-'))).toBe(false);
    expect(entries).toHaveLength(1);
  });

  it('T53b is idempotent by CONTENT — re-storing the same PDF does not rewrite (R3)', async () => {
    const buf = pdf();
    const first = await storeDocument({ ipoId: IPO_ID, docType: 'RHP', pdf: buf, storeDir });
    const second = await storeDocument({ ipoId: IPO_ID, docType: 'RHP', pdf: buf, storeDir });
    expect(first.stored && !first.alreadyPresent).toBe(true);
    expect(second.stored && second.alreadyPresent).toBe(true);
    expect(await fsp.readdir(path.join(storeDir, IPO_ID))).toHaveLength(1);
  });

  it('T55 REFUSES the write when the store is over its cap, and does not create the file', async () => {
    const buf = pdf(10_000);
    const result = await storeDocument({
      ipoId: IPO_ID,
      docType: 'RHP',
      pdf: buf,
      storeDir,
      maxStoreBytes: 1024, // smaller than the incoming document
    });
    expect(result.stored).toBe(false);
    if (!result.stored) {
      expect(result.reason).toBe('store_full');
      expect(result.detail).toContain('document store is full');
    }
    expect(fs.existsSync(path.join(storeDir, IPO_ID))).toBe(false);
  });

  it('T55b counts what is already held when deciding, not just the incoming size', async () => {
    const cap = 12_000;
    const a = await storeDocument({ ipoId: IPO_ID, docType: 'RHP', pdf: pdf(5000), storeDir, maxStoreBytes: cap });
    expect(a.stored).toBe(true);
    // The second 5 KB document fits on its own but not on top of the first.
    const b = await storeDocument({ ipoId: IPO_ID, docType: 'ADDENDUM', pdf: pdf(9000), storeDir, maxStoreBytes: cap });
    expect(b.stored).toBe(false);
  });

  it('getStoreSizeBytes totals every file and returns 0 for a missing store', async () => {
    expect(await getStoreSizeBytes(path.join(storeDir, 'nope'))).toBe(0);
    await storeDocument({ ipoId: IPO_ID, docType: 'RHP', pdf: pdf(3000), storeDir });
    expect(await getStoreSizeBytes(storeDir)).toBeGreaterThan(3000);
  });
});

describe('isPurgeDue — D4 retention', () => {
  const at = (iso: string) => new Date(iso);

  it('T56 purges at close+8 and KEEPS at close+6 (7-day retention)', () => {
    const closeDate = '2026-08-27';
    expect(isPurgeDue({ closeDate, now: at('2026-09-02T12:00:00Z') })).toBe(false); // +6
    expect(isPurgeDue({ closeDate, now: at('2026-09-03T12:00:00Z') })).toBe(false); // +7, not yet
    expect(isPurgeDue({ closeDate, now: at('2026-09-04T12:00:00Z') })).toBe(true); // +8
  });

  it('T56b purges immediately on withdrawal, regardless of the date (F15)', () => {
    expect(isPurgeDue({ closeDate: '2026-12-31', withdrawn: true, now: at('2026-08-28T00:00:00Z') })).toBe(true);
  });

  it('T56c NEVER purges an IPO with no close date — guessing would delete a live IPO', () => {
    expect(isPurgeDue({ closeDate: null, now: at('2030-01-01T00:00:00Z') })).toBe(false);
    expect(isPurgeDue({ closeDate: 'not-a-date', now: at('2030-01-01T00:00:00Z') })).toBe(false);
  });

  it('T56d the boundary does not move with the time of day', () => {
    const closeDate = '2026-08-27';
    expect(isPurgeDue({ closeDate, now: at('2026-09-04T00:00:01Z') })).toBe(true);
    expect(isPurgeDue({ closeDate, now: at('2026-09-04T23:59:59Z') })).toBe(true);
    expect(isPurgeDue({ closeDate, now: at('2026-09-03T23:59:59Z') })).toBe(false);
  });
});

describe('purgeIpoDocuments', () => {
  it('T57 deletes the FILES and the directory, and never throws', async () => {
    await storeDocument({ ipoId: IPO_ID, docType: 'RHP', pdf: pdf(3000), storeDir });
    await storeDocument({ ipoId: IPO_ID, docType: 'CORRIGENDUM', pdf: pdf(2000), storeDir });
    expect(await fsp.readdir(path.join(storeDir, IPO_ID))).toHaveLength(2);

    const result = await purgeIpoDocuments(IPO_ID, storeDir);
    expect(result.purged).toBe(true);
    expect(result.filesDeleted).toBe(2);
    expect(result.bytesFreed).toBeGreaterThan(5000);
    expect(fs.existsSync(path.join(storeDir, IPO_ID))).toBe(false);
    // The store itself survives — only this IPO's directory goes.
    expect(fs.existsSync(storeDir)).toBe(true);
  });

  it('T57b is a no-op (not an error) when the IPO has no local directory', async () => {
    const result = await purgeIpoDocuments('no-such-ipo', storeDir);
    expect(result).toMatchObject({ purged: false, filesDeleted: 0, bytesFreed: 0 });
    expect(result.error).toBeUndefined();
  });
});

describe('store configuration', () => {
  it('reads PROSPECTUS_STORE_DIR / RETENTION_DAYS / MAX_GB from the environment', () => {
    expect(getStoreDir({ PROSPECTUS_STORE_DIR: 'D:/store' } as NodeJS.ProcessEnv)).toBe('D:/store');
    expect(getRetentionDays({ PROSPECTUS_RETENTION_DAYS: '3' } as NodeJS.ProcessEnv)).toBe(3);
    expect(getMaxStoreBytes({ PROSPECTUS_STORE_MAX_GB: '2' } as NodeJS.ProcessEnv)).toBe(2 * 1024 ** 3);
  });

  it('falls back to safe defaults for absent or nonsense values', () => {
    expect(getRetentionDays({} as NodeJS.ProcessEnv)).toBe(DEFAULT_RETENTION_DAYS);
    expect(getRetentionDays({ PROSPECTUS_RETENTION_DAYS: 'soon' } as NodeJS.ProcessEnv)).toBe(DEFAULT_RETENTION_DAYS);
    expect(getMaxStoreBytes({ PROSPECTUS_STORE_MAX_GB: '0' } as NodeJS.ProcessEnv)).toBe(5 * 1024 ** 3);
    expect(getStoreDir({ DEPLOY_SLOT: 'blue' } as NodeJS.ProcessEnv)).toContain(path.join('prospectus', 'blue'));
  });

  it('builds a stable, greppable file name from the type and sha prefix', () => {
    expect(documentFileName('RHP', 'abcdef1234567890')).toBe('RHP-abcdef12.pdf');
    expect(documentPath(IPO_ID, 'RHP', 'abcdef1234567890', '/s')).toBe(
      path.join('/s', IPO_ID, 'RHP-abcdef12.pdf')
    );
  });
});
