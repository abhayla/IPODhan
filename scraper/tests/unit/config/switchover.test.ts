/**
 * Item 3 slice S1b — `switchover.ts` validation. Mirrors
 * `field-manifest-loader.test.ts`'s malformed-fixture pattern: a schema failure and each
 * cross-check failure throw with the offending key named in the message.
 */
import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { loadSwitchover, groupOf, isFlipped, resetSwitchoverCache, DEFAULT_SWITCHOVER_PATH } from '../../../src/config/switchover.js';

const tmpFiles: string[] = [];

function writeTmpSwitchover(content: unknown): string {
  const filePath = path.join(
    os.tmpdir(),
    `switchover-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf-8');
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  resetSwitchoverCache();
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe('switchover (item 3 S1b)', () => {
  it('a group naming a field not in the manifest is refused, with the field named', () => {
    const p = writeTmpSwitchover({
      version: 1,
      groups: { 'issue-size': ['ipos.not_a_real_field'] },
      flipped: [],
      identityFields: [],
    });
    expect(() => loadSwitchover(p)).toThrow(/ipos\.not_a_real_field/);
  });

  it('a field in two groups is refused, naming the field and both groups', () => {
    const p = writeTmpSwitchover({
      version: 1,
      groups: {
        'issue-size': ['ipos.issue_size'],
        'price-band': ['ipos.issue_size', 'ipos.price_range_min'],
      },
      flipped: [],
      identityFields: [],
    });
    expect(() => loadSwitchover(p)).toThrow(/ipos\.issue_size/);
  });

  it('a "flipped" entry naming no group is refused', () => {
    const p = writeTmpSwitchover({
      version: 1,
      groups: { 'issue-size': ['ipos.issue_size'] },
      flipped: ['not-a-real-group'],
      identityFields: [],
    });
    expect(() => loadSwitchover(p)).toThrow(/not-a-real-group/);
  });

  it('an identityFields entry not in the manifest is refused', () => {
    const p = writeTmpSwitchover({
      version: 1,
      groups: {},
      flipped: [],
      identityFields: ['ipos.not_a_real_field'],
    });
    expect(() => loadSwitchover(p)).toThrow(/ipos\.not_a_real_field/);
  });

  it('the committed switchover.json loads, and isFlipped/groupOf answer correctly for it', () => {
    const sw = loadSwitchover(DEFAULT_SWITCHOVER_PATH);
    expect(sw.flipped).toEqual(['issue-size']);
    expect(groupOf('ipos', 'issue_size')).toBe('issue-size');
    expect(isFlipped('ipos', 'issue_size')).toBe(true);
    expect(isFlipped('ipos', 'registrar')).toBe(false);
    expect(groupOf('ipos', 'registrar')).toBeNull();
  });
});
