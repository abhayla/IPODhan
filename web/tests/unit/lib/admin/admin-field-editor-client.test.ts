import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadFieldVersions,
  saveTypedField,
  holdShownField,
  bulkHoldFields,
  bulkHoldMessage,
  versionKey,
} from '@/lib/admin/admin-field-editor-client';

describe('M2: the legacy editors send the version token they opened with (§9.2 item 20)', () => {
  it('loadFieldVersions reads each field token under its SQL table name', async () => {
    const get = vi.fn(async (url: string) => ({ data: { version: `tok:${new URL(url, 'http://x').searchParams.get('fieldName')}` } }));
    const v = await loadFieldVersions(get, 'ipo-1', [
      { tableName: 'ipos', fieldName: 'lotSize' },
      { tableName: 'financialData', fieldName: 'roe' },
    ]);
    expect(v).toEqual({ 'ipos.lotSize': 'tok:lotSize', 'financial_data.roe': 'tok:roe' });
    expect(get.mock.calls.map((c) => c[0])).toContain('/api/admin/update-field?ipoId=ipo-1&tableName=financial_data&fieldName=roe');
  });

  it('saveTypedField sends expectedVersion, mode typed and the source note', async () => {
    const patch = vi.fn(async () => ({ data: { version: 'v2' } }));
    const r = await saveTypedField(patch, { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'lotSize', value: 50, sourceNote: 'RHP p4', expectedVersion: 'v1' });
    expect(patch).toHaveBeenCalledWith('/api/admin/update-field', expect.objectContaining({ expectedVersion: 'v1', mode: 'typed', sourceNote: 'RHP p4', value: 50 }));
    expect(r.version).toBe('v2');
  });

  it('saveTypedField refuses before sending when there is no source note (OD-108)', async () => {
    const patch = vi.fn();
    await expect(saveTypedField(patch, { ipoId: 'i', tableName: 'ipos', fieldName: 'lotSize', value: 1, sourceNote: '  ', expectedVersion: 'v1' })).rejects.toThrow(/source note/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('holdShownField sends the opened token to the protect endpoint', async () => {
    const post = vi.fn(async () => ({}));
    await holdShownField(post, { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'registrar', expectedVersion: 'v7' });
    expect(post).toHaveBeenCalledWith('/api/admin/protection/fields/ipo-1', expect.objectContaining({ expectedVersion: 'v7', isProtected: true }));
  });

  it('bulk hold sends each field token and reports the refused list, never a blanket success', async () => {
    const post = vi.fn(async () => ({ data: { updatedCount: 1, refused: [{ fieldName: 'sector', kind: 'INVALID', reason: 'shows no value' }] } }));
    const r = await bulkHoldFields(post, {
      ipoId: 'ipo-1',
      tableName: 'ipos',
      fieldNames: ['registrar', 'sector'],
      versions: { [versionKey('ipos', 'registrar')]: 'a', [versionKey('ipos', 'sector')]: 'b' },
    });
    expect(post).toHaveBeenCalledWith('/api/admin/protection/fields/bulk', expect.objectContaining({ versions: { registrar: 'a', sector: 'b' } }));
    const msg = bulkHoldMessage(r);
    expect(msg).toMatch(/^Error: 1 field\(s\) refused, 1 protected/);
    expect(msg).toContain('sector (INVALID: shows no value)');
    expect(msg).not.toMatch(/2 field/);
  });
});

describe('M2: the editors are wired to the helpers (source check)', () => {
  const root = path.resolve(__dirname, '../../../../app/admin');
  it('the IPO edit page saves, protects and bulk-protects through the token-carrying helpers', () => {
    const src = readFileSync(path.join(root, 'edit/[slug]/page.tsx'), 'utf8');
    for (const fn of ['saveTypedField(adminPatch', 'holdShownField(adminPost', 'bulkHoldFields(adminPost', 'bulkHoldMessage(', 'loadFieldVersions(adminGet']) expect(src).toContain(fn);
    expect(src).not.toMatch(/adminPatch\('\/api\/admin\/update-field'/);
    expect(src).not.toMatch(/fields \$\{protect \? 'protected' : 'unprotected'\} successfully/);
  });
  it('the objectives page sends its opened token and a source note', () => {
    const src = readFileSync(path.join(root, 'dynamic/ipos/[id]/objectives/page.tsx'), 'utf8');
    expect(src).toMatch(/versions: objectivesVersion \? \{ objectives: objectivesVersion \}/);
    expect(src).toMatch(/sourceNote,/);
  });
});

describe('A2 round-2 MAJOR-2: a field whose shown value is not the stored value keeps no token', () => {
  it('omits the token and reports the field when the page shows an older value', async () => {
    const { loadFieldVersions: load } = await import('@/lib/admin/admin-field-editor-client');
    const get = vi.fn(async () => ({ data: { version: 'tok-1', currentValue: 150 } }));
    const stale: string[] = [];
    const out = await load(get, 'ipo-1', [{ tableName: 'ipos', fieldName: 'lotSize', shown: 100 }], (k) => stale.push(k));
    expect(out).toEqual({});
    expect(stale).toEqual(['ipos.lotSize']);
  });

  it('keeps the token when the shown value matches (numeric text vs number, blank vs null)', async () => {
    const { loadFieldVersions: load } = await import('@/lib/admin/admin-field-editor-client');
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { version: 'tok-a', currentValue: '100.00' } })
      .mockResolvedValueOnce({ data: { version: 'tok-b', currentValue: null } });
    const stale: string[] = [];
    const out = await load(
      get,
      'ipo-1',
      [
        { tableName: 'ipos', fieldName: 'lotSize', shown: 100 },
        { tableName: 'ipos', fieldName: 'registrar', shown: '' },
      ],
      (k) => stale.push(k)
    );
    expect(stale).toEqual([]);
    expect(Object.keys(out).sort()).toEqual(['ipos.lotSize', 'ipos.registrar']);
  });

  it('keeps the old behaviour when no shown value is passed', async () => {
    const { loadFieldVersions: load } = await import('@/lib/admin/admin-field-editor-client');
    const get = vi.fn(async () => ({ data: { version: 'tok-1', currentValue: 150 } }));
    expect(await load(get, 'ipo-1', [{ tableName: 'ipos', fieldName: 'lotSize' }])).toEqual({ 'ipos.lotSize': 'tok-1' });
  });
});
