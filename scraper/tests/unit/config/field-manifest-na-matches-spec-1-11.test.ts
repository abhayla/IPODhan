/**
 * #1293 class guard: every NOT_APPLICABLE statement in spec §1.11 ("Exceptions by IPO type,
 * gathered") is carried by the field manifest's `na` list, for every field of the family the
 * statement names.
 *
 * Class: a field whose manifest applicability disagrees with §1.11. `na` decides two live things —
 * the plan generator never asks a source for a not-applicable field, and the reader payload hides it
 * (web/lib/ipo-field-applicability.ts, OD-142). #1293 was one member (ipos.issue_size for
 * BUYBACK/TENDER, fixed in #1327); the sweep found more, all OFS and RIGHTS, because the first
 * version of this guard hand-copied the sentence and hand-listed the fields: a field the list forgot
 * (ipo_details.anchor_shares_offered, retail_max_allottees, lot_multiple) was never checked.
 *
 * So the guard works in three fail-closed steps, nothing hand-listed per field:
 *  1. It parses the §1.11 table rows out of the spec text. Every row that says NOT_APPLICABLE or
 *     "do(es) not apply" must be REGISTERED below with the exact number of such mentions; a new
 *     statement, or a new row, fails the suite naming that row.
 *  2. Each registered statement quotes the spec (the quote must still be in that row) and names
 *     field FAMILIES (price band, lot, anchor, allotment, ...). A family is a predicate over the
 *     manifest's `table.column` names, not a list.
 *  3. Every manifest field the family matches must carry the type in `na`. A new anchor / lot /
 *     allotment field is therefore covered the day it enters the manifest. A family that matches
 *     no field fails (the predicate or the manifest was restructured).
 *
 * Judgment calls (supervisor decisions, recorded in the PR): RIGHTS "no lot size in the IPO sense"
 * is read as lot_size AND lot_multiple not applicable; OFS "allotment fields" includes
 * retail_max_allottees (an exchange OFS is an auction, there is no lottery) and the post-allotment
 * refund/credit dates; RIGHTS "no price band advertisement" is the ipo_valuation table (fields
 * 93-109), NOT ipos.price_range_* (5 of 6 staging rights rows store their issue price there).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../config/field-manifest.json');
const SPEC_PATH = path.resolve(__dirname, '../../../../docs/design/data-sourcing-pull-model.md');

type Manifest = { fields: Record<string, { na?: string[] }> };
type Family = { name: string; matches: (table: string, leaf: string) => boolean };

const word = (re: string) => new RegExp(`(^|_)${re}(_|$)`);
const PRICE_BAND: Family = { name: 'price band', matches: (_t, l) => /price_range/.test(l) };
const LOT: Family = { name: 'lot', matches: (_t, l) => word('lot').test(l) };
const ANCHOR: Family = { name: 'anchor', matches: (t, l) => t === 'anchor_investors' || /anchor/.test(l) };
const ALLOTMENT: Family = { name: 'allotment', matches: (_t, l) => /allot|refund|credit_of_shares/.test(l) };
const VALUATION_TABLE: Family = { name: 'ipo_valuation table', matches: (t) => t === 'ipo_valuation' };
const FACE_VALUE: Family = { name: 'face value', matches: (_t, l) => l === 'face_value' };
const ISSUE_SIZE: Family = { name: 'issue size', matches: (t, l) => t === 'ipos' && l === 'issue_size' };
const FIN = new Set(['financial_data', 'ipo_valuation', 'peer_companies']);
const EPS: Family = { name: 'EPS', matches: (t, l) => FIN.has(t) && /eps/.test(l) };
const PE: Family = { name: 'PE', matches: (t, l) => FIN.has(t) && word('pe').test(l) };
const PROMOTER_HOLDING: Family = {
  name: 'promoter holding',
  matches: (t, l) => t === 'financial_data' && /promoter_holding/.test(l),
};
const PEER_TABLE: Family = { name: 'peer table', matches: (t) => t === 'peer_companies' };

type Statement = { quote: string; families: Family[] };
type Registered = {
  rowLabel: RegExp;
  types: string[];
  /** Exact count of `NOT_APPLICABLE` and of "do(es) not apply" mentions in the row. */
  mentions: { notApplicable: number; doesNotApply: number };
  statements: Statement[];
};

const REGISTERED: Registered[] = [
  {
    rowLabel: /^Rights issue$/,
    types: ['RIGHTS'],
    // the one "does not apply" is the bidding-window CHECK (F-71), not a field.
    mentions: { notApplicable: 1, doesNotApply: 1 },
    statements: [
      { quote: 'no price band advertisement', families: [VALUATION_TABLE] },
      { quote: 'no anchor round', families: [ANCHOR] },
      { quote: 'no lot size in the IPO sense', families: [LOT] },
      // §1.6 numbers 93-109 (ipo_valuation) and §1.7 numbers 131-137 (anchor_investors).
      { quote: 'Fields 93–109, 131–137 are `NOT_APPLICABLE`, not gaps', families: [VALUATION_TABLE, ANCHOR] },
    ],
  },
  {
    rowLabel: /^OFS$/,
    types: ['OFS'],
    mentions: { notApplicable: 1, doesNotApply: 0 },
    statements: [
      {
        quote: 'The price band, lot size, anchor and allotment fields are `NOT_APPLICABLE` for this type',
        families: [PRICE_BAND, LOT, ANCHOR, ALLOTMENT],
      },
    ],
  },
  {
    rowLabel: /^NCD$/,
    types: ['NCD'],
    mentions: { notApplicable: 1, doesNotApply: 0 },
    statements: [
      {
        quote: 'Price band, EPS, PE, promoter holding and peer comparison are all `NOT_APPLICABLE`',
        families: [PRICE_BAND, EPS, PE, PROMOTER_HOLDING, PEER_TABLE],
      },
    ],
  },
  {
    rowLabel: /^INVITS \/ REITS$/,
    types: ['INVITS', 'REITS'],
    mentions: { notApplicable: 0, doesNotApply: 1 },
    statements: [{ quote: 'lot size and face value do not apply in the same sense', families: [LOT, FACE_VALUE] }],
  },
  {
    rowLabel: /^BUYBACK \/ TENDER$/,
    types: ['BUYBACK', 'TENDER'],
    mentions: { notApplicable: 1, doesNotApply: 0 },
    statements: [{ quote: 'Issue size is `NOT_APPLICABLE` for them', families: [ISSUE_SIZE] }],
  },
];

/** The §1.11 table rows: `| **label** | population | text |`. Throws when the section is not found. */
export function section111Rows(spec: string): Array<{ label: string; text: string }> {
  const start = spec.indexOf('### 1.11 Exceptions by IPO type');
  const end = spec.indexOf('### 1.11.1', start);
  if (start === -1 || end === -1) throw new Error('spec §1.11 heading not found — spec restructured');
  const rows: Array<{ label: string; text: string }> = [];
  for (const line of spec.slice(start, end).split('\n')) {
    const m = /^\| \*\*(.+?)\*\* \|[^|]*\|(.*)\|\s*$/.exec(line);
    if (m) rows.push({ label: m[1].trim(), text: m[2] });
  }
  if (rows.length < 8) throw new Error(`only ${rows.length} §1.11 rows parsed — table format changed`);
  return rows;
}

/** Every disagreement between the spec's §1.11 and the manifest; [] means they agree. */
export function problems(manifest: Manifest, spec: string): string[] {
  const out: string[] = [];
  const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
  const entries = Object.keys(manifest.fields).map((k) => {
    const dot = k.indexOf('.');
    return { key: k, table: k.slice(0, dot), leaf: k.slice(dot + 1) };
  });
  const rows = section111Rows(spec);
  for (const row of rows) {
    const na = count(row.text, /NOT_APPLICABLE/g);
    const dna = count(row.text, /\bdo(?:es)? not apply\b/g);
    const reg = REGISTERED.find((r) => r.rowLabel.test(row.label));
    if (!reg) {
      if (na + dna > 0) out.push(`§1.11 row "${row.label}" states not-applicable (${na + dna}x) but has no registered statement`);
      continue;
    }
    if (reg.mentions.notApplicable !== na || reg.mentions.doesNotApply !== dna) {
      out.push(
        `§1.11 row "${row.label}" has ${na} NOT_APPLICABLE and ${dna} "not apply" mention(s); registered ` +
          `${reg.mentions.notApplicable} and ${reg.mentions.doesNotApply} — a statement was added or removed`
      );
    }
    for (const st of reg.statements) {
      if (!row.text.includes(st.quote)) {
        out.push(`§1.11 row "${row.label}": quoted text no longer in the spec: "${st.quote}"`);
        continue;
      }
      for (const fam of st.families) {
        const hit = entries.filter((e) => fam.matches(e.table, e.leaf));
        if (hit.length === 0) out.push(`§1.11 row "${row.label}": family "${fam.name}" matches no manifest field`);
        for (const e of hit) {
          for (const type of reg.types) {
            if (!(manifest.fields[e.key].na ?? []).includes(type)) {
              out.push(`${e.key} not marked na for ${type} (§1.11 ${row.label}: family "${fam.name}")`);
            }
          }
        }
      }
    }
  }
  for (const reg of REGISTERED) {
    if (!rows.some((r) => reg.rowLabel.test(r.label))) out.push(`registered §1.11 row ${reg.rowLabel} is not in the spec`);
  }
  return [...new Set(out)];
}

describe('#1293: the field manifest carries every §1.11 NOT_APPLICABLE statement', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  const spec = fs.readFileSync(SPEC_PATH, 'utf8');
  const clone = () => JSON.parse(JSON.stringify(manifest)) as Manifest;

  it('no §1.11 not-applicable (field, type) pair is missing from the manifest', () => {
    const found = problems(manifest, spec);
    expect(
      found,
      `spec §1.11 and scraper/config/field-manifest.json disagree: ${found.join('; ')}. Fix the row in ` +
        `docs/design/field-source-resolution.spec.mjs, then node scripts/generate-field-manifest.mjs --write.`
    ).toEqual([]);
  });

  it('covers the forgotten members of round 1: anchor_shares_offered, retail_max_allottees, lot_multiple, rights lot_size', () => {
    const f = manifest.fields;
    expect(f['ipo_details.anchor_shares_offered'].na).toEqual(expect.arrayContaining(['OFS', 'RIGHTS']));
    expect(f['ipo_details.retail_max_allottees'].na).toContain('OFS');
    expect(f['ipo_details.lot_multiple'].na).toEqual(expect.arrayContaining(['OFS', 'RIGHTS']));
    expect(f['ipos.lot_size'].na).toContain('RIGHTS');
  });

  it('detects a removed marking (self-test: the guard can fail)', () => {
    const copy = clone();
    copy.fields['ipo_details.anchor_shares_offered'].na = [];
    expect(problems(copy, spec).join('|')).toContain('ipo_details.anchor_shares_offered not marked na for OFS');
  });

  it('covers a NEW field of a family without a list edit (family derivation)', () => {
    const copy = clone();
    copy.fields['ipo_details.anchor_bonus_shares'] = { na: [] };
    copy.fields['ipo_details.lot_rounding'] = { na: [] };
    copy.fields['ipos.allotment_notice_url'] = { na: [] };
    const found = problems(copy, spec).join('|');
    expect(found).toContain('ipo_details.anchor_bonus_shares not marked na for OFS');
    expect(found).toContain('ipo_details.anchor_bonus_shares not marked na for RIGHTS');
    expect(found).toContain('ipo_details.lot_rounding not marked na for RIGHTS');
    expect(found).toContain('ipos.allotment_notice_url not marked na for OFS');
  });

  it('fails closed on an unregistered or changed statement, naming the row', () => {
    const extra = spec.replace('| **FPO** | **0 today** |', '| **FPO** | **0 today** | The lot size is `NOT_APPLICABLE` here. |\n| **XXX** | 0 |');
    expect(problems(manifest, extra).join('|')).toMatch(/row "FPO" states not-applicable/);
    const added = spec.replace('are `NOT_APPLICABLE` for this type', 'are `NOT_APPLICABLE` for this type, and tick size is `NOT_APPLICABLE`');
    expect(problems(manifest, added).join('|')).toMatch(/row "OFS" has 2 NOT_APPLICABLE/);
    const reworded = spec.replace('no lot size in the IPO sense', 'a lot size');
    expect(problems(manifest, reworded).join('|')).toMatch(/row "Rights issue": quoted text no longer in the spec/);
    expect(() => problems(manifest, 'no table here')).toThrow(/§1.11 heading not found/);
  });

  it('fails closed when a family resolves to no manifest field', () => {
    const copy = clone();
    for (const k of Object.keys(copy.fields)) if (/anchor/.test(k)) delete copy.fields[k];
    expect(problems(copy, spec).join('|')).toContain('family "anchor" matches no manifest field');
  });
});
