import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STATED_ABSENCE_REASONS,
  isStatedAbsenceReason,
} from '../../../src/config/stated-absence-reasons';

const here = dirname(fileURLToPath(import.meta.url));
const scraperRoot = resolve(here, '..', '..', '..');

describe('#1420 stated-absence allow-list (one list, two readers)', () => {
  it('is read from the shared JSON file, entry for entry', () => {
    const raw = JSON.parse(
      readFileSync(resolve(scraperRoot, 'src', 'config', 'stated-absence-reasons.json'), 'utf8')
    ) as { reasons: { reason: string }[] };
    expect([...STATED_ABSENCE_REASONS].sort()).toEqual(raw.reasons.map((r) => r.reason).sort());
    expect(STATED_ABSENCE_REASONS.size).toBeGreaterThan(0);
  });

  it('never lists a pattern-miss reason', () => {
    for (const miss of [
      'peer_comparison_table_not_in_document',
      'ratio_note_not_in_document',
      'ratio_row_not_in_note',
      'our_promoters_statement_not_on_cover',
    ]) {
      expect(isStatedAbsenceReason(miss)).toBe(false);
    }
    expect(isStatedAbsenceReason(undefined)).toBe(false);
    expect(isStatedAbsenceReason('not_applicable_no_qualifying_transaction')).toBe(true);
  });

  it('matches the set the python extractor loads', (ctx) => {
    const code = 'import json, answer_states; print(json.dumps(sorted(answer_states.STATED_ABSENCE_REASONS)))';
    const run = (bin: string) =>
      spawnSync(bin, ['-c', code], {
        cwd: resolve(scraperRoot, 'scripts'),
        encoding: 'utf8',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      });
    let py = run('python3');
    if (py.error) py = run('python');
    // No interpreter on this runner: the python suite (pr-gate python-tests)
    // asserts the python reader against the same JSON file instead.
    if (py.error) ctx.skip();
    expect(py.status, py.stderr).toBe(0);
    expect(JSON.parse(py.stdout.trim())).toEqual([...STATED_ABSENCE_REASONS].sort());
  });
});
