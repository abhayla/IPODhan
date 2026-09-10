import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader';

const REAL_MANIFEST_PATH = path.join(__dirname, '../../../config/field-manifest.json');

const tmpFiles: string[] = [];

function writeTmpFile(content: unknown): string {
  const filePath = path.join(
    os.tmpdir(),
    `field-manifest-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf-8');
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

// A minimal, otherwise-valid manifest row — tests mutate a clone of this.
function baseField() {
  return {
    class: 'D' as const,
    rank: { MAINBOARD: ['DOC', 'BSE'] },
    capability: {
      DOC: { capable: true, reason: 'doc reason' },
      BSE: { capable: true, reason: 'bse reason' },
    },
    unit: 'crore' as const,
  };
}

describe('loadFieldManifest', () => {
  it('loads the real scraper/config/field-manifest.json and returns the typed object', () => {
    const manifest = loadFieldManifest(REAL_MANIFEST_PATH);
    expect(manifest.version).toBe(1);
    expect(manifest.fields['ipos.issue_size'].rank.MAINBOARD).toEqual(['DOC', 'BSE', 'CHITTORGARH']);
    expect(manifest.fields['ipo_details.fresh_issue'].unit).toBe('crore');
    expect(manifest.fields['financial_statements.revenue'].rank.MAINBOARD).toEqual([
      'DOC',
      'CHITTORGARH',
      'MONEYCONTROL',
    ]);
  });

  it('throws, naming the field AND the source, when rank[] names a source with capability.capable: false', () => {
    const field = baseField();
    field.rank.MAINBOARD = ['DOC', 'NSE'];
    field.capability = {
      ...field.capability,
      NSE: { capable: false, reason: 'NSE cannot serve this field' },
    };
    const filePath = writeTmpFile({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: { 'ipos.some_field': field },
    });

    let thrown: Error | undefined;
    try {
      loadFieldManifest(filePath);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('ipos.some_field');
    expect(thrown!.message).toContain('NSE');
  });

  it('throws, naming the field AND the source, when rank[] names a source with NO capability entry at all', () => {
    const field = baseField();
    field.rank.MAINBOARD = ['DOC', 'CHITTORGARH'];
    // CHITTORGARH intentionally absent from `capability` entirely.
    const filePath = writeTmpFile({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: { 'ipos.other_field': field },
    });

    let thrown: Error | undefined;
    try {
      loadFieldManifest(filePath);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('ipos.other_field');
    expect(thrown!.message).toContain('CHITTORGARH');
  });

  it('throws a SCHEMA error (not the cross-check error) for an unknown class value', () => {
    // This fixture is DELIBERATELY both schema-invalid (class: 'ZZZ') AND
    // cross-check-violating (rank names NSE, whose capability is false) —
    // that is what makes this test order-sensitive: schema validation must
    // run first (per the card) and report ITS error, never the cross-check's.
    const field: Record<string, unknown> = {
      ...baseField(),
      class: 'ZZZ',
      rank: { MAINBOARD: ['DOC', 'NSE'] },
      capability: {
        DOC: { capable: true, reason: 'doc reason' },
        NSE: { capable: false, reason: 'nse cannot serve this' },
      },
    };
    const filePath = writeTmpFile({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: { 'ipos.bad_class_field': field },
    });

    let thrown: Error | undefined;
    try {
      loadFieldManifest(filePath);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    // Distinct wording from the cross-check error: this must be the
    // loadValidatedConfig schema-validation message, not
    // loadFieldManifest's cross-check message.
    expect(thrown!.message).toContain('failed schema validation');
    expect(thrown!.message).not.toContain('must be marked capable:true');
  });

  it('throws when a row is missing the required MAINBOARD key in rank — never silently defaults to []', () => {
    const field = baseField();
    // @ts-expect-error - deliberately constructing an invalid rank object for the fixture
    field.rank = { SME_BSE: ['DOC'] };
    const filePath = writeTmpFile({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: { 'ipos.missing_mainboard_field': field },
    });

    let thrown: Error | undefined;
    try {
      loadFieldManifest(filePath);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('failed schema validation');
  });

  it('catches a violation in a non-MAINBOARD rank key (SME_NSE-only) — not just MAINBOARD', () => {
    const field = baseField();
    field.rank = {
      MAINBOARD: ['DOC', 'BSE'],
      SME_NSE: ['DOC', 'CHITTORGARH'],
    } as any;
    // CHITTORGARH intentionally absent from `capability` — the violation is
    // reachable ONLY through the SME_NSE key, never through MAINBOARD.
    const filePath = writeTmpFile({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: { 'ipos.sme_nse_only_violation_field': field },
    });

    let thrown: Error | undefined;
    try {
      loadFieldManifest(filePath);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('ipos.sme_nse_only_violation_field');
    expect(thrown!.message).toContain('CHITTORGARH');
  });

  it('renders a full dotted path for a bad value nested inside rank.MAINBOARD', () => {
    const field = baseField();
    field.rank.MAINBOARD = ['DOC', 'NOT_A_REAL_SOURCE_CODE'];
    const filePath = writeTmpFile({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: { 'ipos.nested_path_field': field },
    });

    let thrown: Error | undefined;
    try {
      loadFieldManifest(filePath);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain('fields.ipos.nested_path_field.rank.MAINBOARD.1');
  });

  it('renders a full dotted path for a bad value nested inside capability.<source>.capable', () => {
    const field: Record<string, unknown> = baseField();
    (field as any).capability.BSE.capable = 'not-a-boolean';
    const filePath = writeTmpFile({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: { 'ipos.nested_capability_field': field },
    });

    let thrown: Error | undefined;
    try {
      loadFieldManifest(filePath);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.message).toContain(
      'fields.ipos.nested_capability_field.capability.BSE.capable'
    );
  });
});
