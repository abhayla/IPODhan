/**
 * OD-74's "one read per IPO, ever" (docs/design/data-sourcing-pull-model.md OD-74, §5.2), made
 * enforceable on every database — not only on the laptop that happened to hold an untracked cache.
 *
 * Every CHITTORGARH byte the repair reads lives in a TRACKED store
 * (scraper/scripts/data/od74-issue-size/): the page gzipped, plus manifest.json pinning its url,
 * sha256 (of the raw html) and read time. A pinned entry is read from the store and its hash is
 * verified; a missing file or a hash mismatch is a refusal, never a re-fetch. A url that is not
 * pinned may be fetched ONCE — and only when the run is not in prod mode; the bytes are pinned the
 * moment they arrive, so the next run (and the committed tree) holds them. Production never fetches.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface PinnedEntry {
  file: string;
  sha256: string;
  bytes: number;
  readAt: string;
}

export interface LookupEntry extends PinnedEntry {
  url: string;
  /** The detail page the lookup resolved to, or null when no row matched exactly. */
  match: string | null;
  candidates: number;
}

export interface StoreManifest {
  tool: string;
  od: 'OD-74';
  pages: Record<string, PinnedEntry>;
  lookups: Record<string, LookupEntry>;
  /**
   * What each pinned page says, per IPO slug — the held-proof invariant
   * (scripts/lib/repair-invariants/issue-size-od74.mjs) reads THIS, not the row's lineage, so a
   * later lower-ranked overwrite cannot erase the evidence of what the row must hold.
   */
  expected?: Record<string, { url: string; printedRupees: number | null; status: string }>;
}

export type ReadDecision = 'READ_PINNED' | 'FETCH' | 'REFUSE';

/**
 * Pure: may this url be read, and how. Pinned -> the store (never the network). Not pinned ->
 * fetch once, unless prod mode or fetching is switched off, in which case the run refuses.
 */
export function decidePageRead(input: { pinned: boolean; prodMode: boolean; allowFetch: boolean }): { decision: ReadDecision; reason: string } {
  if (input.pinned) return { decision: 'READ_PINNED', reason: 'pinned in the tracked store' };
  if (input.prodMode) return { decision: 'REFUSE', reason: 'not pinned and prod mode never fetches (OD-74: one read per IPO, the staging read is the read)' };
  if (!input.allowFetch) return { decision: 'REFUSE', reason: 'not pinned and --no-fetch' };
  return { decision: 'FETCH', reason: 'not pinned; read once and pin' };
}

export const sha256Of = (text: string): string => createHash('sha256').update(text).digest('hex');

export class PageStore {
  readonly manifestPath: string;
  manifest: StoreManifest;

  constructor(readonly dir: string, tool: string) {
    this.manifestPath = path.join(dir, 'manifest.json');
    this.manifest = fs.existsSync(this.manifestPath)
      ? (JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as StoreManifest)
      : { tool, od: 'OD-74', pages: {}, lookups: {} };
  }

  isPagePinned(url: string): boolean {
    return url in this.manifest.pages;
  }

  /** Read a pinned page and verify it byte-for-byte. Throws on a missing file or a hash mismatch. */
  readPinned(url: string): { text: string; entry: PinnedEntry } {
    const entry = this.manifest.pages[url] ?? this.lookupEntryByUrl(url);
    if (!entry) throw new Error(`not pinned: ${url}`);
    return { text: this.readVerified(entry, url), entry };
  }

  readLookup(slug: string): { text: string; entry: LookupEntry } | null {
    const entry = this.manifest.lookups[slug];
    return entry ? { text: this.readVerified(entry, entry.url), entry } : null;
  }

  pinPage(url: string, text: string, fileName: string, readAt: Date): PinnedEntry {
    const entry = this.write(text, path.join('pages', fileName), readAt);
    this.manifest.pages[url] = entry;
    this.save();
    return entry;
  }

  pinLookup(slug: string, url: string, text: string, match: string | null, candidates: number, readAt: Date): LookupEntry {
    const entry: LookupEntry = { ...this.write(text, path.join('lookups', `${slug}.json.gz`), readAt), url, match, candidates };
    this.manifest.lookups[slug] = entry;
    this.save();
    return entry;
  }

  /** Deterministic (same page -> same entry), so re-runs leave the tracked file unchanged. */
  recordExpected(slug: string, e: { url: string; printedRupees: number | null; status: string }): void {
    const cur = this.manifest.expected?.[slug];
    if (cur && cur.url === e.url && cur.printedRupees === e.printedRupees && cur.status === e.status) return;
    this.manifest.expected = { ...(this.manifest.expected ?? {}), [slug]: e };
    this.save();
  }

  private lookupEntryByUrl(url: string): PinnedEntry | undefined {
    return Object.values(this.manifest.lookups).find((l) => l.url === url);
  }

  private readVerified(entry: PinnedEntry, url: string): string {
    const file = path.join(this.dir, entry.file);
    if (!fs.existsSync(file)) throw new Error(`pinned file missing for ${url}: ${file} — refusing; the page is never fetched twice (OD-74)`);
    const text = gunzipSync(fs.readFileSync(file)).toString('utf8');
    const got = sha256Of(text);
    if (got !== entry.sha256) throw new Error(`pinned file for ${url} fails its hash (${got} != ${entry.sha256}) — refusing`);
    return text;
  }

  private write(text: string, rel: string, readAt: Date): PinnedEntry {
    const file = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, gzipSync(Buffer.from(text, 'utf8'), { level: 9 }));
    return { file: rel.split(path.sep).join('/'), sha256: sha256Of(text), bytes: Buffer.byteLength(text), readAt: readAt.toISOString() };
  }

  private save(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`);
  }
}
