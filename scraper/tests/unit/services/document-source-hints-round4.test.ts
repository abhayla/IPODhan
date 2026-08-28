import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { ChittorgarhIPOSchema, validateChittorgarhIPOData } from '../../../src/utils/validators.js';
import {
  isVerifierUrl,
  normalizeCompanyUrl,
  extractWebsiteFromCoverText,
  isTrustedDocumentHost,
  TRUSTED_DOCUMENT_HOSTS,
} from '../../../src/services/company-host-source.js';
import { recordDocumentSourceHints } from '../../../src/services/data-persister.js';
import { assertTestDatabase } from '../../../scripts/run-document-discovery.js';
import { hasStoredFile, storeDocument } from '../../../src/services/document-store.js';

/**
 * T-403 round 4 — the source hints (`ipos.company_website`, `ipos.verifier_url`)
 * and the guards on the values that reach them.
 *
 * These two columns feed rungs 4 and the verifier, which means they feed a
 * FETCH. Everything here is about the two ways that went wrong: a value that
 * never arrived (H-1), and a value that arrived unchecked (M-a / M-b).
 */

// ---------------------------------------------------------------------------
// H-1
// ---------------------------------------------------------------------------

const CHITTORGARH_ROW = {
  dataSource: 'CHITTORGARH' as const,
  companyName: 'Skyways Air Services Ltd.',
  slug: 'skyways-air-services-ltd',
  openDate: '2026-08-24',
  closeDate: '2026-08-27',
  segment: 'MAINBOARD' as const,
  status: 'CLOSED' as const,
  listingExchange: 'BOTH' as const,
  offeringType: 'IPO' as const,
};

describe('H-1 verifierUrl must survive schema validation', () => {
  it('is KEPT by parse, not silently stripped', () => {
    // The blocker: `verifierUrl` was declared as a type-level intersection only.
    // zod strips unknown keys, so `parse()` deleted it on every row — which is
    // why `ipos.verifier_url` was NULL for every IPO in production and the
    // verifier rung recorded "skipped:no_verifier_url" forever. Nothing failed;
    // the field simply evaporated between the scraper and the writer.
    const parsed = ChittorgarhIPOSchema.parse({
      ...CHITTORGARH_ROW,
      verifierUrl: 'https://www.chittorgarh.com/ipo/skyways-air-ipo/2801/',
    });
    expect(parsed.verifierUrl).toBe('https://www.chittorgarh.com/ipo/skyways-air-ipo/2801/');
  });

  it('is optional — a row without one still validates', () => {
    const result = validateChittorgarhIPOData(CHITTORGARH_ROW);
    expect(result.success).toBe(true);
    expect(result.data?.verifierUrl).toBeUndefined();
  });

  it('rejects a verifier URL that is not a chittorgarh.com https page', () => {
    for (const bad of [
      'https://evil.test/ipo/1/',
      'http://www.chittorgarh.com/ipo/1/', // http, not https
      'https://chittorgarh.com.evil.test/ipo/1/', // suffix smuggling
    ]) {
      const result = validateChittorgarhIPOData({ ...CHITTORGARH_ROW, verifierUrl: bad });
      expect(result.success).toBe(false);
    }
  });
});

describe('H-1/M-b the write path validates what it stores', () => {
  const writer = () => {
    const patches: Record<string, unknown>[] = [];
    return {
      patches,
      // The narrow repository method (H-1): it writes exactly these two columns
      // and returns only the id, so it also runs on a journal-built `ipos`.
      updateDocumentSourceHints: vi.fn(async (_id: string, data: Record<string, unknown>) => {
        patches.push(data);
        return { id: _id, slug: 'x' };
      }),
    };
  };

  it('writes a valid verifier URL and a valid website', async () => {
    const w = writer();
    await recordDocumentSourceHints(w as never, 'ipo-1', {
      companyWebsite: 'https://skyways-air.in',
      verifierUrl: 'https://www.chittorgarh.com/ipo/skyways-air-ipo/2801/',
    });
    expect(w.patches[0].companyWebsite).toBe('https://skyways-air.in');
    expect(w.patches[0].verifierUrl).toBe('https://www.chittorgarh.com/ipo/skyways-air-ipo/2801/');
  });

  it('refuses a verifier URL on any other host, and writes nothing at all', async () => {
    const w = writer();
    await recordDocumentSourceHints(w as never, 'ipo-1', {
      verifierUrl: 'https://evil.test/ipo/1/',
    });
    // Not "writes null" — writes NOTHING. An update with only updatedAt would
    // still touch the row and imply we had something to say.
    expect(w.updateDocumentSourceHints).not.toHaveBeenCalled();
  });

  it('refuses an internal-host website — the SSRF guard is on the WRITE too', async () => {
    const w = writer();
    await recordDocumentSourceHints(w as never, 'ipo-1', {
      companyWebsite: 'http://metadata.google.internal/computeMetadata/v1/',
    });
    expect(w.updateDocumentSourceHints).not.toHaveBeenCalled();
  });

  it('keeps companyWebsite write-once — a later cover cannot overwrite it', async () => {
    const w = writer();
    await recordDocumentSourceHints(
      w as never,
      'ipo-1',
      { companyWebsite: 'https://new.example.com' },
      { companyWebsite: 'https://already-known.example.com' }
    );
    expect(w.updateDocumentSourceHints).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M-a
// ---------------------------------------------------------------------------

describe('M-a the SSRF guard lives at extraction, so no caller can forget it', () => {
  it('refuses an internal host printed on a filing cover', () => {
    // The runner stored this value, FETCHED it on the company rung, and
    // persisted it — three uses, and only one of them called the normaliser.
    expect(extractWebsiteFromCoverText('Website: metadata.google.internal')).toBeNull();
    expect(extractWebsiteFromCoverText('Website: foo.internal:8080')).toBeNull();
    expect(extractWebsiteFromCoverText('Website: localhost.local')).toBeNull();
    expect(extractWebsiteFromCoverText('Website: 169.254.169.254')).toBeNull();
  });

  it('still returns a normal issuer website, as an https origin', () => {
    expect(extractWebsiteFromCoverText('Website: www.skyways-air.in')).toBe(
      'https://www.skyways-air.in'
    );
  });

  it('normalizeCompanyUrl refuses non-default ports and private ranges', () => {
    expect(normalizeCompanyUrl('https://example.com:8080')).toBeNull();
    expect(normalizeCompanyUrl('http://192.168.1.10')).toBeNull();
    expect(normalizeCompanyUrl('https://example.com')).toBe('https://example.com');
  });
});

// ---------------------------------------------------------------------------
// M-b / NIT-6
// ---------------------------------------------------------------------------

describe('M-b/NIT-6 the host allowlists', () => {
  it('isVerifierUrl accepts chittorgarh.com and its subdomains over https only', () => {
    expect(isVerifierUrl('https://www.chittorgarh.com/ipo/x/1/')).toBe(true);
    expect(isVerifierUrl('https://chittorgarh.com/ipo/x/1/')).toBe(true);
    expect(isVerifierUrl('http://www.chittorgarh.com/ipo/x/1/')).toBe(false);
    expect(isVerifierUrl('https://www.chittorgarh.com.evil.test/ipo/x/1/')).toBe(false);
    expect(isVerifierUrl('https://www.chittorgarh.com:8443/ipo/x/1/')).toBe(false);
    expect(isVerifierUrl(null)).toBe(false);
    expect(isVerifierUrl('')).toBe(false);
  });

  it('the document allowlist carries no redundant subdomain entries', () => {
    // NIT-6: matching is exact-or-DNS-suffix, so listing a subdomain of an
    // already-listed domain implies the list is exhaustive when it is not.
    for (const host of TRUSTED_DOCUMENT_HOSTS) {
      const others = TRUSTED_DOCUMENT_HOSTS.filter((h) => h !== host);
      expect(others.some((o) => host.endsWith('.' + o))).toBe(false);
    }
    // And the subdomains that were removed are still trusted, via the suffix.
    expect(isTrustedDocumentHost('https://listing.bseindia.com/x.pdf')).toBe(true);
    expect(isTrustedDocumentHost('https://nsearchives.nseindia.com/x.zip')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NIT-2
// ---------------------------------------------------------------------------

describe('NIT-2 the harness refuses to write outside a _test database', () => {
  it('refuses production and staging by name', () => {
    // `scraper/.env` points DATABASE_URL at the production host, so a stray
    // --db in the wrong shell was one keystroke from writing to prod.
    expect(() => assertTestDatabase('postgresql://u:p@host:5432/ipodhan')).toThrow(/does not end in _test/);
    expect(() => assertTestDatabase('postgresql://u:p@host:5432/ipodhan_staging')).toThrow(
      /does not end in _test/
    );
  });

  it('refuses an unparseable URL rather than interpreting it', () => {
    expect(() => assertTestDatabase('not a url')).toThrow(/not parseable/);
  });

  it('allows a _test database, case-insensitively', () => {
    expect(() => assertTestDatabase('postgresql://u:p@host:5432/ipodhan_test')).not.toThrow();
    expect(() => assertTestDatabase('postgresql://u:p@host:5432/ipodhan_TEST')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// W-1
// ---------------------------------------------------------------------------

describe('W-1 a FOUND row is checked against the file its hash names', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(os.tmpdir(), 't403-sha-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('accepts the exact file and rejects a different document of the same type', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('R'.repeat(80_000))]);
    const stored = await storeDocument({ ipoId: 'ipo-1', docType: 'RHP', pdf, storeDir: dir });
    expect(stored.stored).toBe(true);
    const sha = (stored as { sha256: string }).sha256;

    expect(hasStoredFile('ipo-1', 'RHP', dir, sha)).toBe(true);

    // A file of the right TYPE but the wrong bytes. The name-prefix check calls
    // this healthy; the hash check is what notices.
    fs.renameSync(join(dir, 'ipo-1', 'RHP-' + sha.slice(0, 8) + '.pdf'), join(dir, 'ipo-1', 'RHP-deadbeef.pdf'));
    expect(hasStoredFile('ipo-1', 'RHP', dir)).toBe(true);
    expect(hasStoredFile('ipo-1', 'RHP', dir, sha)).toBe(false);
  });

  it('falls back to the type check when no hash is known', () => {
    // Rows stored before the column existed have no hash, and must not be
    // demoted merely for that.
    fs.mkdirSync(join(dir, 'ipo-2'), { recursive: true });
    fs.writeFileSync(join(dir, 'ipo-2', 'RHP-12345678.pdf'), 'x');
    expect(hasStoredFile('ipo-2', 'RHP', dir, null)).toBe(true);
  });
});
