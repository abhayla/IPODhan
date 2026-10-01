/**
 * #1293 class guard: every NOT_APPLICABLE statement in spec §1.11 ("Exceptions by IPO type,
 * gathered") is carried by the field manifest's `na` list for that field and type.
 *
 * Class: a field whose manifest applicability disagrees with §1.11. `na` decides two live things —
 * the plan generator never asks a source for a not-applicable field, and the reader payload hides it
 * (web/lib/ipo-field-applicability.ts, OD-142). #1293 was one member (ipos.issue_size for
 * BUYBACK/TENDER, fixed in #1327); the sweep in #1293's PR found seven more, all OFS: §1.11 says
 * "The price band, lot size, anchor and allotment fields are NOT_APPLICABLE for this type", and the
 * manifest marked only the anchor fields. Measured on staging before the change
 * (docs/design/probes/ofs-rights-applicability.out.json): 0 of 19 OFS rows hold a value in any of
 * the seven columns, so the change hides nothing a reader sees today.
 *
 * The table below is §1.11 transcribed statement by statement (quoted); the manifest is generated
 * from docs/design/field-source-resolution.spec.mjs. A §1.11 change and a manifest change must move
 * together. Fail closed: a group that resolves to no manifest field fails the suite.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../config/field-manifest.json');

type Manifest = { fields: Record<string, { na?: string[] }> };

/** A group is either exact `table.column` names or a whole table (`table.*`). */
const SPEC_1_11: Array<{ type: string; quote: string; fields: string[] }> = [
  {
    type: 'BUYBACK',
    quote: 'Issue size is `NOT_APPLICABLE` for them',
    fields: ['ipos.issue_size'],
  },
  {
    type: 'TENDER',
    quote: 'Issue size is `NOT_APPLICABLE` for them',
    fields: ['ipos.issue_size'],
  },
  {
    type: 'OFS',
    quote: 'The price band, lot size, anchor and allotment fields are `NOT_APPLICABLE` for this type',
    fields: [
      'ipos.price_range_min',
      'ipos.price_range_max',
      'ipos.lot_size',
      'anchor_investors.*',
      'ipos.allotment_date',
      'ipo_details.basis_of_allotment_date',
      'ipo_details.initiation_of_refunds_date',
      'ipo_details.credit_of_shares_date',
    ],
  },
  {
    type: 'RIGHTS',
    // §1.6 numbers fields 93-109 (ipo_valuation, the price-band advertisement table) and §1.7
    // numbers 131-137 (anchor_investors): "no price band advertisement, no anchor round".
    quote: 'Fields 93–109, 131–137 are `NOT_APPLICABLE`, not gaps',
    fields: ['ipo_valuation.*', 'anchor_investors.*'],
  },
  {
    type: 'NCD',
    quote: 'Price band, EPS, PE, promoter holding and peer comparison are all `NOT_APPLICABLE`',
    fields: [
      'ipos.price_range_min',
      'ipos.price_range_max',
      'financial_data.pre_ipo_eps',
      'financial_data.post_ipo_eps',
      'financial_data.pe_ratio',
      'ipo_valuation.pe_at_floor',
      'ipo_valuation.pe_at_cap',
      'financial_data.promoter_holding_pre_issue',
      'financial_data.promoter_holding_post_issue',
      'peer_companies.*',
    ],
  },
];

/** Every (field, type) pair §1.11 declares not applicable that the manifest does not mark. */
export function missingNotApplicable(manifest: Manifest): string[] {
  const keys = Object.keys(manifest.fields);
  const missing: string[] = [];
  for (const group of SPEC_1_11) {
    for (const pattern of group.fields) {
      const matched = pattern.endsWith('.*')
        ? keys.filter((k) => k.startsWith(pattern.slice(0, -1)))
        : keys.filter((k) => k === pattern);
      if (matched.length === 0) throw new Error(`§1.11 ${group.type}: ${pattern} matches no manifest field`);
      for (const k of matched) {
        if (!(manifest.fields[k].na ?? []).includes(group.type)) missing.push(`${k} not marked na for ${group.type}`);
      }
    }
  }
  return missing;
}

describe('#1293: the field manifest carries every §1.11 NOT_APPLICABLE statement', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;

  it('no §1.11 not-applicable (field, type) pair is missing from the manifest', () => {
    const missing = missingNotApplicable(manifest);
    expect(
      missing,
      `spec §1.11 says these are NOT_APPLICABLE but scraper/config/field-manifest.json still plans them: ` +
        `${missing.join('; ')}. Fix the row in docs/design/field-source-resolution.spec.mjs, then ` +
        `node scripts/generate-field-manifest.mjs --write.`
    ).toEqual([]);
  });

  it('detects a removed marking and an unresolvable group (self-test: the guard can fail)', () => {
    const copy = JSON.parse(JSON.stringify(manifest)) as Manifest;
    copy.fields['ipos.lot_size'].na = (copy.fields['ipos.lot_size'].na ?? []).filter((t) => t !== 'OFS');
    expect(missingNotApplicable(copy)).toEqual(['ipos.lot_size not marked na for OFS']);

    const noAnchors = JSON.parse(JSON.stringify(manifest)) as Manifest;
    for (const k of Object.keys(noAnchors.fields)) if (k.startsWith('anchor_investors.')) delete noAnchors.fields[k];
    expect(() => missingNotApplicable(noAnchors)).toThrow(/matches no manifest field/);
  });
});
