/**
 * F-31 snapshot housekeeping (review round 3 minor): the files are kept outside
 * the release directory on purpose, so nothing else ever prunes them -- one file
 * per closed-IPO night would grow forever on the VPS. And the reader's `expected`
 * target must be required: an optional target lets a caller skip the
 * wrong-database refusal by simply not passing it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CLOSED_IPO_SNAPSHOT_RETENTION_DAYS,
  pruneOldFieldSourcesSnapshots,
  readFieldSourcesSnapshot,
} from '../../../src/scheduler/closed-ipo-snapshot.js';

const DAY = 24 * 60 * 60 * 1000;
const dirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f31-prune-'));
  dirs.push(d);
  return d;
}
function touch(dir: string, name: string, ageDays: number, now: Date): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, '{"kind":"closed-ipo-field-sources-snapshot"}');
  const t = new Date(now.getTime() - ageDays * DAY);
  fs.utimesSync(p, t, t);
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('F-31 snapshot retention', () => {
  it('the bound is 30 days', () => {
    expect(CLOSED_IPO_SNAPSHOT_RETENTION_DAYS).toBe(30);
  });

  it('deletes snapshot files (and stray .tmp) older than the bound; keeps younger ones and anything that is not a snapshot', () => {
    const now = new Date('2026-09-23T16:30:00Z');
    const dir = tmpDir();
    touch(dir, 'field-sources-prod-ipodhan-old.json', 31, now);
    touch(dir, 'field-sources-prod-ipodhan-old.json.tmp', 40, now);
    touch(dir, 'field-sources-prod-ipodhan-edge.json', 29, now);
    touch(dir, 'field-sources-prod-ipodhan-new.json', 0, now);
    touch(dir, 'notes.json', 400, now);

    const removed = pruneOldFieldSourcesSnapshots(dir, { now });

    expect(removed.map((p) => path.basename(p)).sort()).toEqual([
      'field-sources-prod-ipodhan-old.json',
      'field-sources-prod-ipodhan-old.json.tmp',
    ]);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'field-sources-prod-ipodhan-edge.json',
      'field-sources-prod-ipodhan-new.json',
      'notes.json',
    ]);
  });

  it('a missing directory prunes nothing and does not throw', () => {
    expect(pruneOldFieldSourcesSnapshots(path.join(os.tmpdir(), 'f31-does-not-exist-xyz'), { now: new Date() })).toEqual([]);
  });
});

describe('F-31 snapshot reader target', () => {
  it('refuses to read without a target -- the wrong-database refusal cannot be skipped', () => {
    const dir = tmpDir();
    const file = touch(dir, 'field-sources-x.json', 0, new Date());
    expect(() => readFieldSourcesSnapshot(file, undefined as never)).toThrow(/target/);
  });
});
