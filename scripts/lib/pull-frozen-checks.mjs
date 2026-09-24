// PULL-FROZEN (spec docs/design/data-sourcing-pull-model.md §4, guard on §2.5; OD-91; item 6).
//
// A SUPPLIED plan row is frozen when a COMPLETED document of the same IPO outranks the row's
// chosen document AND that document's own receipt (document_field_receipts) has the field AND the
// row was never reopened in that document's favour (superseded_by). A row reopened and then
// re-answered from the older document (the newer one printed a different value, OD-73) is not
// frozen: the walk decided it.
// The rule itself is scraper/config/plan-supersession-rule.mjs, the module the scraper runs too
// (precedence, non-reopening types, per-field families, Rule 1/Rule 3) -- no copy here.
//
// Both new objects (the document_field_receipts table and ipo_field_plan.superseded_by) are
// probed first: the nightly audit runs main's code against prod, which can lag migrations. With
// no receipts table there is nothing a receipt could have reopened, so the check reports
// UNVERIFIABLE with that reason rather than a PASS it did not earn.
//
// `q(sql, params)` resolves to the row ARRAY (the audit's own `q`).
import { readFileSync } from 'node:fs';
import {
  decidePlanRowSupersession,
  familyForField,
  isFixedPriceIssue,
  PRECEDENCE,
} from '../../scraper/config/plan-supersession-rule.mjs';

export { PRECEDENCE };

const MANIFEST = JSON.parse(readFileSync(new URL('../../scraper/config/field-manifest.json', import.meta.url), 'utf8'));

/** The manifest documentType of a plan row's field (snake_case key, as the plan stores it). */
export function manifestDocumentType(tableName, fieldName) {
  return MANIFEST.fields?.[`${tableName}.${fieldName}`]?.documentType;
}

function asRows(res) {
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

/** The same call the scraper makes (one rule module): does `cand` supersede `chosen` for this field? */
export function supersedesForField(tableName, fieldName, chosen, cand, fixedPrice) {
  const family = familyForField(manifestDocumentType(tableName, fieldName), chosen.docType);
  return decidePlanRowSupersession(chosen, cand, { family, fixedPrice }).supersede;
}

/**
 * @param {(sql: string, params?: any[]) => Promise<any[]>} q
 * @returns {Promise<{ status: 'PASS'|'FAIL'|'UNVERIFIABLE', offenders: string[], detail: string }>}
 */
export async function collectPullFrozen(q) {
  const probe = asRows(
    await q(
      `SELECT to_regclass('public.document_field_receipts')::text AS receipts,
              EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'ipo_field_plan'
                         AND column_name = 'superseded_by') AS superseded_by`
    )
  );
  if (!probe[0]?.receipts || !probe[0]?.superseded_by) {
    return {
      status: 'UNVERIFIABLE',
      offenders: [],
      detail: 'document_field_receipts / ipo_field_plan.superseded_by not on this database yet (migration 0060 not applied)',
    };
  }
  const rows = asRows(
    await q(
      `SELECT p.id AS plan_row_id, i.slug, p.table_name, p.row_key, p.field_name,
              c.id AS chosen_id, c.type::text AS chosen_type, c.filing_date::text AS chosen_filing, c.sha256 AS chosen_sha,
              d.id AS cand_id, d.type::text AS cand_type, d.filing_date::text AS cand_filing, d.sha256 AS cand_sha,
              det.issue_type::text AS issue_type, i.price_range_min, i.price_range_max
         FROM ipo_field_plan p
         JOIN ipos i ON i.id = p.ipo_id
         JOIN documents c ON c.id = p.chosen_document_id
         JOIN documents d ON d.ipo_id = p.ipo_id AND d.id <> c.id
                         AND d.extraction_status = 'COMPLETED' AND d.is_active IS NOT FALSE
         JOIN document_field_receipts r ON r.document_id = d.id AND r.table_name = p.table_name
                         AND r.row_key = p.row_key
                         AND lower(replace(r.field_name, '_', '')) = lower(replace(p.field_name, '_', ''))
         LEFT JOIN ipo_details det ON det.ipo_id = p.ipo_id
        WHERE p.state = 'SUPPLIED'
          AND p.superseded_by IS DISTINCT FROM d.id
        ORDER BY i.slug, p.table_name, p.field_name`
    )
  );
  const seen = new Set();
  const offenders = [];
  for (const r of rows) {
    const fixed = isFixedPriceIssue(r.issue_type, r.price_range_min, r.price_range_max);
    const chosen = { id: r.chosen_id, docType: r.chosen_type, filingDate: r.chosen_filing, sha256: r.chosen_sha };
    const cand = { id: r.cand_id, docType: r.cand_type, filingDate: r.cand_filing, sha256: r.cand_sha };
    if (seen.has(r.plan_row_id) || !supersedesForField(r.table_name, r.field_name, chosen, cand, fixed)) continue;
    seen.add(r.plan_row_id);
    offenders.push(
      `${r.slug} ${r.table_name}.${r.field_name}${r.row_key ? `[${r.row_key}]` : ''}: chosen ${r.chosen_type} ${r.chosen_id}, outranked by receipted ${r.cand_type} ${r.cand_id}`
    );
  }
  return {
    status: offenders.length === 0 ? 'PASS' : 'FAIL',
    offenders,
    detail:
      offenders.length === 0
        ? 'no SUPPLIED plan row is outranked by a COMPLETED document whose receipt has the field'
        : `${offenders.length} frozen plan row(s): ${offenders.slice(0, 20).join('; ')}`,
  };
}
