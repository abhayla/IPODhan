// Item 37 (OD-164, spec 2.5.6): the five document-yield / every-source detection checks, as pure
// predicates so scripts/tests/audit-detection-floor.test.mjs runs the SAME code the nightly audit runs.
// Each evaluator returns { status: 'PASS'|'FAIL'|'UNVERIFIABLE', offenders, labels, detail }.
// B4(c): a shape the check cannot resolve (unknown document type, a field the manifest does not
// list, an unparsable amount) is counted and named and is never silently a PASS.
import { familyForField } from '../../scraper/config/plan-supersession-rule.mjs';

export const OFFER_DOC_TYPES = Object.freeze(['RHP', 'DRHP', 'PROSPECTUS']);
// Floor share of the fields a document type gives. Today's staging median is 3 receipts of ~100
// expected (F-224), so 0.10 flags every thin read; raise it as items 38-40 land (a ratchet).
export const DOC_YIELD_FLOOR_SHARE = 0.10;

export const toSnake = (name) => String(name).replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const fieldKey = (table, field) => `${table}.${toSnake(field)}`;
const verdict = (offenders, unresolved) =>
  offenders.length ? 'FAIL' : unresolved > 0 ? 'UNVERIFIABLE' : 'PASS';
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/** Manifest fields a document of `docType` should give: the field's documentType family contains
 * docType and DOC is a capable rank for some IPO type. Returns a Set of "table.snake_field". */
export function expectedFieldsForDocType(manifest, docType) {
  const out = new Set();
  for (const [key, entry] of Object.entries(manifest.fields ?? {})) {
    if (!entry.documentType) continue;
    if (!familyForField(entry.documentType, docType).includes(docType)) continue;
    const ranked = Object.values(entry.rank ?? {}).some((r) => (r ?? []).includes('DOC'));
    if (!ranked || entry.capability?.DOC?.capable !== true) continue;
    out.add(key);
  }
  return out;
}

// ---- 1. doc_yield_per_document ----------------------------------------------------------------
// docs: [{slug, documentId, type, receiptFields: [[table, field], ...]}]. Answer states read: a
// receipt row = delivered by that document; no receipt = nothing delivered. A document extracted
// before the receipts table existed is excluded by the caller (OD-91: no re-read).
export function evaluateDocYieldPerDocument(docs, manifest, floorShare = DOC_YIELD_FLOOR_SHARE) {
  const cache = new Map();
  const offenders = [];
  let unresolved = 0;
  for (const d of docs) {
    if (!OFFER_DOC_TYPES.includes(d.type)) { unresolved++; continue; }
    if (!cache.has(d.type)) cache.set(d.type, expectedFieldsForDocType(manifest, d.type));
    const expected = cache.get(d.type);
    if (expected.size === 0) { unresolved++; continue; }
    const delivered = new Set(d.receiptFields.map(([t, f]) => fieldKey(t, f)).filter((k) => expected.has(k)));
    if (delivered.size < expected.size * floorShare) {
      offenders.push({ slug: d.slug, type: d.type, id: d.documentId, delivered: delivered.size, expected: expected.size });
    }
  }
  offenders.sort((a, b) => a.delivered / a.expected - b.delivered / b.expected);
  return {
    status: verdict(offenders, unresolved), unresolved, offenders,
    labels: offenders.map((o) => `${o.slug} ${o.type} ${String(o.id).slice(0, 8)} ${o.delivered}/${o.expected}`),
    detail: `${offenders.length} of ${docs.length} COMPLETED offer document(s) below ${Math.round(floorShare * 100)}% of the fields their type gives`
      + (unresolved ? `; ${unresolved} unresolvable (unknown type or no expected fields)` : ''),
  };
}

// ---- 2. doc_rank1_unanswered_with_offer_doc ---------------------------------------------------
// rows: rank1=DOC plan rows whose cause is rank1:DOC:CHECK_FAILED (incl. [gap:NO_DOCUMENT_PROVENANCE])
// attempted after a family document completed. NOT_AVAILABLE_YET is the other check's case
// (pull_doc_nay_with_offer_doc) and is not read here. docTypesByIpo: ipoId -> Set of COMPLETED types.
export function evaluateDocRank1Unanswered(rows, docTypesByIpo, manifest) {
  const offenders = [];
  let unresolved = 0;
  for (const r of rows) {
    const entry = manifest.fields?.[`${r.tableName}.${r.fieldName}`];
    if (!entry?.documentType) { unresolved++; continue; }
    const family = familyForField(entry.documentType, null);
    const have = docTypesByIpo.get(r.ipoId);
    if (have && family.some((t) => have.has(t))) offenders.push(r);
  }
  const byIpo = new Map();
  for (const o of offenders) {
    const e = byIpo.get(o.slug) ?? { n: 0, tables: new Map() };
    e.n++; e.tables.set(o.tableName, (e.tables.get(o.tableName) ?? 0) + 1);
    byIpo.set(o.slug, e);
  }
  const ipos = [...byIpo.entries()].sort((a, b) => b[1].n - a[1].n);
  return {
    status: verdict(offenders, unresolved), unresolved, offenders, ipos,
    labels: ipos.map(([s, e]) => `${s}=${e.n} [${[...e.tables.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t}:${n}`).join(',')}]`),
    detail: `${offenders.length} rank-1 DOC row(s) unanswered on ${ipos.length} IPO(s) that hold a COMPLETED family document`
      + (unresolved ? `; ${unresolved} row(s) with no manifest documentType (unresolvable)` : ''),
  };
}

// ---- 3. witness_missing_on_stored_value -------------------------------------------------------
// rows: field_sources {slug, status, tableName, fieldName, source, updatedBy, witnesses}. Answer
// states: witnesses null or [] = nothing recorded (offender); a non-empty list = recorded (any
// outcome: SUPPLIED / NOT_PRINTED / NOT_AVAILABLE_YET / CHECK_FAILED). ADMIN rows are out of scope
// (spec 2.7). A value with no other listed source has nobody to witness it.
const DOC_LABELS = new Set(['DRHP', 'RHP', 'PROSPECTUS', 'DOC']);
const asLabel = (s) => (DOC_LABELS.has(s) ? 'DOC' : s);
export function evaluateWitnessMissing(rows, manifest) {
  const listed = new Map();
  for (const [key, entry] of Object.entries(manifest.fields ?? {})) {
    listed.set(key, new Set(Object.values(entry.rank ?? {}).flat().filter(Boolean)));
  }
  const offenders = [];
  let unresolved = 0;
  let inScope = 0;
  for (const r of rows) {
    if (r.source === 'ADMIN') continue;
    const sources = listed.get(fieldKey(r.tableName, r.fieldName));
    if (!sources) { unresolved++; continue; }
    const others = [...sources].filter((s) => s !== asLabel(r.source));
    if (others.length === 0) continue;
    inScope++;
    const w = typeof r.witnesses === 'string' ? safeParse(r.witnesses) : r.witnesses;
    if (!Array.isArray(w) || w.length === 0) offenders.push(r);
  }
  const tally = (keyFn) => {
    const m = new Map();
    for (const o of offenders) m.set(keyFn(o), (m.get(keyFn(o)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byStatus = tally((o) => o.status);
  const byWriter = tally((o) => `${o.updatedBy ?? 'null'}/${o.source}`);
  const byIpo = tally((o) => o.slug);
  return {
    status: verdict(offenders, unresolved), unresolved, offenders, byStatus, byWriter, byIpo,
    labels: [
      `by status ${byStatus.map(([k, n]) => `${k}=${n}`).join(' ')}`,
      `by writer ${byWriter.slice(0, 5).map(([k, n]) => `${k}=${n}`).join(' ')}`,
      `top IPOs ${byIpo.slice(0, 5).map(([k, n]) => `${k}=${n}`).join(' ')}`,
    ],
    detail: `${offenders.length} of ${inScope} stored value(s) with other listed sources have no recorded witness on ${byIpo.length} IPO(s)`
      + (unresolved ? `; ${unresolved} row(s) on a field the manifest does not list (unresolvable)` : ''),
  };
}

// ---- 4. listed_source_never_asked -------------------------------------------------------------
// rows: ipo_field_plan {slug, tableName, fieldName, state, rank2Source, rank3Source, cause, answers}.
// Two shapes: (a) the walk stamped [gap:NO_MAPPING] (or NO_FETCHER) naming the source;
// (b) a row that settled with NO value (so every rank was due to be asked) whose recorded answers
// (OD-137) omit a listed rank-2/3 source. A row with no recorded answers is unread, not clean.
// baselineGaps: the shrink-only #884 list ("table.field SRC NO_MAPPING"); a pair in it is labelled.
export function evaluateListedSourceNeverAsked(rows, baselineGaps = []) {
  const known = new Set(baselineGaps);
  const pairs = new Map();
  let unread = 0;
  const add = (pair, kind, slug) => {
    const key = `${pair} ${kind}`;
    const e = pairs.get(key) ?? new Set();
    e.add(slug);
    pairs.set(key, e);
  };
  for (const r of rows) {
    const field = `${r.tableName}.${r.fieldName}`;
    const cause = r.cause ?? '';
    const gap = /\[gap:(NO_MAPPING|NO_FETCHER)\]/.exec(cause);
    if (gap) {
      const named = [...cause.matchAll(/rank([23]):([A-Z_]+):/g)].pop();
      add(`${field} ${named ? named[2] : 'UNKNOWN_SOURCE'}`, gap[1], r.slug);
      continue;
    }
    if (r.state === 'SUPPLIED') continue;
    const listed = [r.rank2Source, r.rank3Source].filter(Boolean);
    if (listed.length === 0) continue;
    const answers = typeof r.answers === 'string' ? safeParse(r.answers) : r.answers;
    if (!Array.isArray(answers)) { unread++; continue; }
    const asked = new Set(answers.map((a) => a.source));
    for (const s of listed) if (!asked.has(s)) add(`${field} ${s}`, 'NEVER_ASKED', r.slug);
  }
  const list = [...pairs.entries()].sort((a, b) => b[1].size - a[1].size);
  const bySource = new Map();
  for (const [k] of list) {
    const src = k.split(' ')[1];
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }
  return {
    status: list.length ? 'FAIL' : 'PASS', unresolved: unread, offenders: list,
    labels: list.map(([k, s]) => `${k}=${s.size} IPO(s) [${[...s].slice(0, 2).join(', ')}]${known.has(k) ? ' (baseline #884)' : ''}`),
    detail: `${list.length} source/field pair(s) listed but never asked or unmapped; by source ${[...bySource.entries()].map(([k, n]) => `${k}=${n}`).join(' ')}`
      + (unread ? `; ${unread} unsettled row(s) with no recorded answers (unread, not clean)` : ''),
  };
}

// ---- 5. ocr_amount_magnitude ------------------------------------------------------------------
// ocr: [{slug, tableName, fieldName, rowKey, value}] OCR/MIXED receipts of 'keep'-unit MONEY fields;
// comparisons: [{slug, tableName, fieldName, rowKey, value, via}] text receipts / exchange or website
// stored values. FAIL when max/min is within 5% (in log10) of 10^k, k >= 1. Unparsable or non-positive
// OCR amounts are skipped and counted (unresolved).
export function evaluateOcrAmountMagnitude(ocr, comparisons) {
  const idx = new Map();
  for (const c of comparisons) {
    const k = `${c.slug}|${c.tableName}|${c.rowKey ?? ''}|${c.fieldName}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(c);
  }
  const found = [];
  let unresolved = 0;
  for (const o of ocr) {
    const a = Number(String(o.value).replace(/,/g, ''));
    if (!Number.isFinite(a) || a <= 0) { unresolved++; continue; }
    for (const c of idx.get(`${o.slug}|${o.tableName}|${o.rowKey ?? ''}|${o.fieldName}`) ?? []) {
      const b = Number(String(c.value).replace(/,/g, ''));
      if (!Number.isFinite(b) || b <= 0) continue;
      const l = Math.log10(a / b);
      const k = Math.round(Math.abs(l));
      if (k >= 1 && Math.abs(Math.abs(l) - k) < 0.05) {
        found.push({ slug: o.slug, field: `${o.tableName}.${o.fieldName}`, ocr: o.value, other: c.value, via: c.via, factor: `10^${l > 0 ? k : -k}` });
      }
    }
  }
  const seen = new Set();
  const offenders = found.filter((o) => {
    const k = `${o.slug}|${o.field}|${o.ocr}|${o.other}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    status: verdict(offenders, unresolved), unresolved, offenders,
    labels: offenders.map((o) => `${o.slug} ${o.field} OCR=${o.ocr} vs ${o.via}=${o.other} (${o.factor})`),
    detail: `${offenders.length} OCR amount(s) off by a power of ten against a text or exchange value (of ${ocr.length} OCR receipts)`
      + (unresolved ? `; ${unresolved} unparsable OCR value(s)` : ''),
  };
}

// ---- SQL collectors (read-only SELECTs). `q(sql, params)` resolves to rows; the nightly audit passes
// its own pool, the staging proof harness passes the read-only probe pool, so both run THIS code.
export async function runDocYieldPerDocument(q, manifest) {
  // Documents extracted before the first receipt was ever written predate the table (OD-91: no re-read).
  const docs = await q(
    `SELECT i.slug, d.id AS "documentId", d.type::text AS type,
            COALESCE(json_agg(json_build_array(r.table_name, r.field_name)) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS "receiptFields"
       FROM documents d
       JOIN ipos i ON i.id = d.ipo_id
       LEFT JOIN document_field_receipts r ON r.document_id = d.id
      WHERE d.extraction_status = 'COMPLETED' AND d.is_active IS NOT FALSE
        AND d.type IN ('RHP', 'DRHP', 'PROSPECTUS')
        AND d.extracted_at >= (SELECT MIN(created_at) FROM document_field_receipts)
      GROUP BY i.slug, d.id, d.type`
  );
  return evaluateDocYieldPerDocument(docs, manifest);
}

export async function runDocRank1Unanswered(q, manifest) {
  const rows = await q(
    `SELECT p.ipo_id AS "ipoId", i.slug, p.table_name AS "tableName", p.field_name AS "fieldName", p.state::text AS state
       FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
      WHERE p.rank1_source = 'DOC' AND p.cause LIKE '%rank1:DOC:CHECK_FAILED%'`
  );
  const docs = await q(
    `SELECT ipo_id AS "ipoId", type::text AS type FROM documents
      WHERE extraction_status = 'COMPLETED' AND is_active IS NOT FALSE AND extracted_at IS NOT NULL
        AND type IN ('RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD')`
  );
  const byIpo = new Map();
  for (const d of docs) {
    if (!byIpo.has(d.ipoId)) byIpo.set(d.ipoId, new Set());
    byIpo.get(d.ipoId).add(d.type);
  }
  return evaluateDocRank1Unanswered(rows, byIpo, manifest);
}

export async function runWitnessMissing(q, manifest) {
  const rows = await q(
    `SELECT i.slug, i.status::text AS status, fs.table_name AS "tableName", fs.field_name AS "fieldName",
            fs.source::text AS source, fs.updated_by AS "updatedBy", fs.witnesses
       FROM field_sources fs JOIN ipos i ON i.id = fs.ipo_id`
  );
  return evaluateWitnessMissing(rows, manifest);
}

export async function runListedSourceNeverAsked(q, baselineGaps) {
  const rows = await q(
    `SELECT i.slug, p.table_name AS "tableName", p.field_name AS "fieldName", p.state::text AS state,
            p.rank2_source AS "rank2Source", p.rank3_source AS "rank3Source", p.cause, p.answers
       FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
      WHERE p.cause LIKE '%[[]gap:NO_MAPPING]%' OR p.cause LIKE '%[[]gap:NO_FETCHER]%'
         OR (p.state <> 'SUPPLIED' AND (p.rank2_source IS NOT NULL OR p.rank3_source IS NOT NULL))`
  );
  return evaluateListedSourceNeverAsked(rows, baselineGaps);
}

export async function runOcrAmountMagnitude(q, manifest) {
  const moneyKeep = new Set(Object.entries(manifest.fields)
    .filter(([k, v]) => /^(ipos|ipo_details)\./.test(k) && v.unit === 'keep' && v.comparisonFamily === 'MONEY').map(([k]) => k));
  const receipts = await q(
    `SELECT i.slug, r.table_name AS "tableName", r.field_name AS "fieldName", r.row_key AS "rowKey", r.value, r.source_text AS "sourceText"
       FROM document_field_receipts r JOIN documents d ON d.id = r.document_id JOIN ipos i ON i.id = d.ipo_id
      WHERE r.table_name IN ('ipos', 'ipo_details') AND r.value IS NOT NULL`
  );
  const money = receipts.filter((r) => moneyKeep.has(`${r.tableName}.${toSnake(r.fieldName)}`));
  const ocr = money.filter((r) => r.sourceText === 'OCR' || r.sourceText === 'MIXED');
  const comparisons = money.filter((r) => r.sourceText === 'TEXT').map((r) => ({ ...r, via: 'TEXT receipt' }));
  // The stored value counts as a text/exchange value only where an exchange or website page wrote it.
  const cols = new Map();
  for (const t of ['ipos', 'ipo_details']) {
    const c = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t]);
    cols.set(t, new Set(c.map((x) => x.column_name)));
  }
  const pairs = new Map();
  for (const r of ocr) pairs.set(`${r.tableName}|${r.fieldName}`, { tableName: r.tableName, fieldName: r.fieldName });
  for (const { tableName, fieldName } of pairs.values()) {
    const col = toSnake(fieldName);
    if (!cols.get(tableName)?.has(col)) continue;
    const joinOn = tableName === 'ipos' ? 'x.id = i.id' : 'x.ipo_id = i.id';
    const stored = await q(
      `SELECT i.slug, fs.source::text AS via, x."${col}"::text AS value
         FROM ipos i JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name = $1 AND fs.field_name = $2 AND fs.row_key = ''
         JOIN ${tableName} x ON ${joinOn}
        WHERE fs.source IN ('NSE', 'BSE', 'CHITTORGARH', 'MONEYCONTROL') AND x."${col}" IS NOT NULL`,
      [tableName, fieldName]
    );
    for (const s of stored) comparisons.push({ slug: s.slug, tableName, fieldName, rowKey: '', value: s.value, via: s.via });
  }
  return evaluateOcrAmountMagnitude(ocr, comparisons);
}
