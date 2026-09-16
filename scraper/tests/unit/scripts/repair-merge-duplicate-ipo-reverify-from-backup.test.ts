/**
 * `--reverify-from-backup <merge-backup.json>` (item 12, 2026-09-16): re-derives
 * the merge patch from a pre-write backup file (full `keep`/`drop` rows +
 * `children.field_sources`) via the REAL `planCarryFields`/`buildCarryFieldInputs`,
 * then re-runs the read-back. Only the backup-parsing/derivation refusal path is
 * unit-tested here (no DB call reached) — the DB-reading half is exercised by
 * hand against staging, never by this suite.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reverifyFromBackup } from '../../../scripts/repair-merge-duplicate-ipo';
import { buildCarryFieldInputs, buildProvenanceMap, planCarryFields } from '@ipodhan/shared/utils/duplicate-ipo-merge';

const tmpFiles: string[] = [];
function writeTmpBackup(payload: unknown): string {
  const file = path.join(os.tmpdir(), `reverify-from-backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  tmpFiles.push(file);
  return file;
}

afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    try {
      fs.rmSync(f);
    } catch {
      // already gone
    }
  }
});

describe('reverifyFromBackup — parsing/derivation refuses before touching a database', () => {
  it('refuses with exit 1 when the backup file does not exist', async () => {
    const code = await reverifyFromBackup(path.join(os.tmpdir(), 'reverify-from-backup-does-not-exist.json'));
    expect(code).toBe(1);
  });

  it('refuses with exit 1 when the backup file is not valid JSON', async () => {
    const file = path.join(os.tmpdir(), `reverify-from-backup-badjson-${Date.now()}.json`);
    fs.writeFileSync(file, '{not json');
    tmpFiles.push(file);
    const code = await reverifyFromBackup(file);
    expect(code).toBe(1);
  });

  it('refuses with exit 1 when "keep" is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const file = writeTmpBackup({ drop: { id: 'd', slug: 'drop-slug' }, children: {} });
      const code = await reverifyFromBackup(file);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('missing "keep"'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('refuses with exit 1 when "drop" is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const file = writeTmpBackup({ keep: { id: 'k' }, children: {} });
      const code = await reverifyFromBackup(file);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('missing "drop"'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('refuses with exit 1 when keep.id / drop.id / drop.slug are missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const file = writeTmpBackup({ keep: { id: 'k' }, drop: { id: 'd' /* no slug */ }, children: {} });
      const code = await reverifyFromBackup(file);
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('missing keep.id / drop.id / drop.slug'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  // The load-bearing case: a drop row carrying a CARRY_IF_ABSENT column (allotmentDate) that the
  // keep row lacks must survive derivation into the patch as its snake_case column name
  // (allotment_date) — proving the backup-derived patch matches what the live apply path would
  // have computed, via the SAME planCarryFields/buildCarryFieldInputs functions, not a
  // reimplementation that could silently diverge.
  it('derives a patch containing allotment_date when drop has it and keep does not (real planCarryFields/buildCarryFieldInputs)', () => {
    const keep: Record<string, unknown> = {
      id: 'keep-id',
      slug: 'keep-slug',
      companyName: 'Example Ltd',
      allotmentDate: null,
    };
    const drop: Record<string, unknown> = {
      id: 'drop-id',
      slug: 'drop-slug',
      companyName: 'Example Ltd',
      allotmentDate: '2026-09-10',
    };
    const dropProvRows = [
      { ipoId: 'drop-id', fieldName: 'allotmentDate', source: 'CHITTORGARH', confidence: 80 },
    ];
    const dropProv = buildProvenanceMap(dropProvRows, 'drop-id');
    const patch = planCarryFields(buildCarryFieldInputs(keep, drop, dropProv), 'drop-id');
    const allotment = patch.find((p) => p.column === 'allotment_date');
    expect(allotment).toBeDefined();
    expect(allotment?.value).toBe('2026-09-10');
    expect(allotment?.source).toBe('CHITTORGARH');
  });
});
