/**
 * Item 3 slice S1b, card correction C2: `fieldNameToColumn` must round-trip EVERY key of the
 * real `field-manifest.json` (190 keys, no hard-coded subset) — an unstable round trip on any
 * one of them is a red test here, never a silent runtime mismatch in the writer's resolver call.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { columnToCamelCase, fieldNameToColumn } from '../../../src/config/field-name-case.js';

const MANIFEST_PATH = join(__dirname, '..', '..', '..', 'config', 'field-manifest.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as {
  fields: Record<string, unknown>;
};

describe('field-name-case (item 3 S1b, C2)', () => {
  it('the manifest actually has 190 keys (guards against a silently truncated fixture)', () => {
    expect(Object.keys(manifest.fields).length).toBe(190);
  });

  it('every field-manifest.json key round-trips column -> camelCase -> column', () => {
    const keys = Object.keys(manifest.fields);
    expect(keys.length).toBe(Object.keys(manifest.fields).length);

    const failures: string[] = [];
    for (const key of keys) {
      const dot = key.indexOf('.');
      expect(dot).toBeGreaterThan(-1);
      const column = key.slice(dot + 1);
      const camel = columnToCamelCase(column);
      const back = fieldNameToColumn(camel);
      if (back !== column) {
        failures.push(`${key}: column="${column}" -> camel="${camel}" -> back="${back}"`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('digits and existing underscores survive the round trip (ronw_weighted_3y)', () => {
    // columnToCamelCase's `/_([a-z])/g` only consumes an underscore followed by a
    // lowercase letter, so `_3y` (underscore + digit) is left as-is — the round trip
    // still holds because fieldNameToColumn only ever inserts `_` before an uppercase
    // letter, never before a digit.
    const camel = columnToCamelCase('ronw_weighted_3y');
    expect(camel).toBe('ronwWeighted_3y');
    expect(fieldNameToColumn(camel)).toBe('ronw_weighted_3y');
  });

  it('bse_ipo_no round-trips', () => {
    expect(columnToCamelCase('bse_ipo_no')).toBe('bseIpoNo');
    expect(fieldNameToColumn('bseIpoNo')).toBe('bse_ipo_no');
  });
});
