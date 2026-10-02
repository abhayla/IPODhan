/**
 * PR #1483 review round 1 (MAJOR-1 / MAJOR-2): no outcome of the price-band OCR guards
 * (scraper/scripts/ocr_pages.guard_price_band_lost_digit) may CLEAR a stored band on a re-read.
 *
 * The envelopes are produced by the REAL extractor (extract_filing.run, OCR pages) on the
 * glass-wall advert's stored text (scraper/tests/fixtures/price-band-ad/, provenance in .meta.json)
 * and on the reviewer's probe strings, then handed to the real clear path (clearRereadAnswers)
 * over a DB whose stored band is an older read of the same document. Every case must clear nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

vi.mock('../../../src/services/data-persister.js', () => ({ clearIpoColumnsForRereadAnswer: vi.fn(async (_tx: unknown, _id: string, cols: string[]) => cols) }));
vi.mock('../../../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@ipodhan/shared/services/field-hold', () => ({
  protectionTableName: (t: string) => t,
  lockAndReadFieldHolds: vi.fn(async (_tx: unknown, ids: string[]) => new Map(ids.map((id) => [id, { hidden: false, writeBlocked: false, protectedFields: new Set() }]))),
}));

import { clearRereadAnswers, type RereadExecutor, type RereadEnvelopeField } from '../../../src/services/reread-answer-clear';

const OLDER = 'extract_filing.py@2026-10-03';
const NEWER = 'extract_filing.py@2026-10-04';
const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts');

function fakeDb() {
  const calls = { transactions: 0 };
  const tx: RereadExecutor = {
    execute: async () => ({ rows: [{ source: 'DRHP', data_lineage: { documentId: 'd1', extractorVersion: OLDER }, ipo_id: 'i1', id: 'p1' }] }),
    transaction: async (fn) => { calls.transactions += 1; return fn(tx); },
  };
  return { db: tx, calls };
}

const CODE = `
import json, sys, os
from extract_filing import run
fx = os.path.join("..", "tests", "fixtures", "price-band-ad", "glass-wall-ocr-price-band-ad.json")
gw = [(int(i), t) for i, t in json.load(open(fx, encoding="utf-8"))["pages"]]
head = "PRICE BAND: 172.00 TO 182.00 PER EQUITY SHARE OF FACE VALUE OF 2 EACH"
cases = {
  "lost_digit": [(i, t.replace(head, head.replace("172.00 TO 182.00", "72.00 TO 82.00"))) for i, t in gw],
  "extra_digit": [(i, t.replace(head, "PRICE BAND: 7172.00 TO 7182.00 PER EQUITY SHARE OF FACE VALUE OF 72 EACH")) for i, t in gw],
  "glyph_as_7_market_cap": [(1, "PRICE BAND: 408.00 TO 429.00 PER EQUITY SHARE OF FACE VALUE OF 10 EACH" + chr(10) + "At Floor Price of 7408.00 per equity share At Cap Price of 7429.00 per equity share")],
  "pe_line": [(1, "PRICE BAND: 72.00 TO 82.00 PER EQUITY SHARE OF FACE VALUE OF 10 EACH" + chr(10) + "P/E at Floor Price 172 / Cap Price 182")],
  "ocr_unordered": [(1, "PRICE BAND: 296.00 to 31 1.00 PER EQUITY SHARE OF FACE VALUE OF 10.00 EACH")],
}
out = {k: run(p, "PRICE_BAND_AD", k, "MAINBOARD", ocr_confidence={i: 95 for i, _ in p})["fields"] for k, p in cases.items()}
print(json.dumps(out, default=str))
`;

function envelopes(): Record<string, Record<string, RereadEnvelopeField>> | null {
  const py = (bin: string) => spawnSync(bin, ['-c', CODE], { cwd: scripts, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } });
  let out = py('python3');
  if (out.error) out = py('python');
  if (out.error) return null;
  expect(out.status, out.stderr).toBe(0);
  return JSON.parse(out.stdout.trim().split('\n').pop() as string);
}

describe('PR #1483: the price-band OCR guards never clear a stored band', () => {
  it('every reviewer probe and both glass-wall faults clear nothing on the real clear path', async (ctx) => {
    const env = envelopes();
    // No interpreter on this runner: the python suite (pr-gate python-tests) covers the guard's side.
    if (env === null) ctx.skip();
    for (const name of ['lost_digit', 'extra_digit', 'glyph_as_7_market_cap', 'pe_line', 'ocr_unordered']) {
      const fields = env![name];
      for (const f of ['price_band_floor', 'price_band_cap', 'face_value']) {
        expect(fields[f]?.state, `${name}.${f}`).not.toBe('REFUSED');
      }
      const { db, calls } = fakeDb();
      const r = await clearRereadAnswers(db, { ipoId: 'i1', docType: 'PRICE_BAND_AD', documentId: 'd1', sourceSha: 's1', extractorVersion: NEWER, fields: fields as never });
      expect(r.cleared, name).toEqual([]);
      expect(calls.transactions, name).toBe(0);
    }
    // The true bands of the two reviewer probes stay values.
    expect(env!.glyph_as_7_market_cap.price_band_floor.value).toBe(408);
    expect(env!.pe_line.price_band_cap.value).toBe(82);
    // The faults never become a value.
    for (const name of ['lost_digit', 'extra_digit', 'ocr_unordered']) {
      expect(env![name].price_band_floor.value, name).toBeNull();
      expect(env![name].price_band_cap.value, name).toBeNull();
    }
    expect(env!.extra_digit.face_value.value).toBeNull();
  });
});
